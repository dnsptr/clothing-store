import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compile = file => ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const shared = {};
vm.runInNewContext(compile('src/lib/account.ts'), { exports:shared });
const server = {};
vm.runInNewContext(compile('src/lib/account-server.ts'), { exports:server, require:name => name === './account' ? shared : {}, AbortSignal, URLSearchParams, Date, process:{env:{}}, fetch });
const customer={id:'cus_1',email:'person@example.com',first_name:'Ирина',metadata:{private:'hidden'}};
const signup={email:' Person@Example.com ',password:'a secure password',password_confirmation:'a secure password',first_name:'Ирина',consent:true};
const env={NEXT_PUBLIC_DATA_MODE:'medusa',MEDUSA_BACKEND_URL:'https://api.test',MEDUSA_PUBLISHABLE_KEY:'pk_test'};
function service(responses) {
  const calls=[];
  const api=server.createAccountService(async (url,options) => {
    calls.push({url,options});
    const result=responses.shift();
    if(result instanceof Error) throw result;
    assert.ok(result,`Unexpected request ${url}`);
    return new Response(JSON.stringify(result.body),{status:result.status||200});
  },env);
  return {api,calls};
}

test('registration validates consent, matching passwords and name before contacting Medusa',async()=>{
  for(const input of [{...signup,consent:false},{...signup,password_confirmation:'different'},{...signup,password:'short',password_confirmation:'short'},{...signup,first_name:''}]) {
    const {api,calls}=service([]);
    await assert.rejects(api.register(input));assert.equal(calls.length,0);
  }
});
test('registration creates a real Medusa identity and customer, refreshes the actor token and strips internal metadata',async()=>{
  const {api,calls}=service([{body:{token:'identity-token'}},{body:{customer}},{body:{token:'customer-token'}},{body:{customer}}]);
  const result=await api.register({...signup,customer_id:'cus_other',metadata:{admin:true}});
  assert.equal(result.token,'customer-token');assert.equal(result.customer.id,'cus_1');assert.equal(result.customer.metadata,undefined);
  assert.equal(calls[0].url,'https://api.test/auth/customer/emailpass/register');
  assert.equal(JSON.parse(calls[0].options.body).email,'person@example.com');
  assert.equal(calls[1].options.headers.Authorization,'Bearer identity-token');
  const body=JSON.parse(calls[1].options.body);assert.equal(body.customer_id,undefined);assert.equal(body.password,undefined);assert.equal(body.metadata.registration_consent.accepted,true);
  assert.ok(calls.every(call=>call.options.cache==='no-store'));
});
test('duplicate email gives an actionable error without creating a second customer',async()=>{
  const {api,calls}=service([{status:401,body:{message:'Identity exists'}}]);
  await assert.rejects(api.register(signup),error=>error.status===409);assert.equal(calls.length,1);
});
test('wrong login cannot create an account or a session',async()=>{
  const {api,calls}=service([{status:401,body:{message:'Invalid password'}}]);
  await assert.rejects(api.login(signup),error=>error.status===401&&error.message.includes('Неверный'));assert.equal(calls.length,1);
});
test('an interrupted registration can be completed after authenticating with the correct password',async()=>{
  const {api,calls}=service([{body:{token:'identity-token'}},{status:401,body:{}},{body:{customer}},{body:{token:'customer-token'}},{body:{customer}}]);
  assert.equal((await api.login(signup)).customer.id,'cus_1');assert.equal(calls[2].url,'https://api.test/store/customers');
});
test('profile updates cannot replace email, customer id or internal metadata',async()=>{
  const {api,calls}=service([{body:{customer}}]);
  await api.profile('token',{first_name:' Ирина ',last_name:'Петрова',phone:'+7 (999) 123-45-67',email:'attacker@example.com',customer_id:'other',metadata:{admin:true}});
  assert.deepEqual(JSON.parse(calls[0].options.body),{first_name:'Ирина',last_name:'Петрова',phone:'+7 (999) 123-45-67'});
});
test('orders are requested through the authenticated customer endpoint, without caller-provided customer filters',async()=>{
  const {api,calls}=service([{body:{orders:[{id:'order_1',display_id:1,created_at:'2026-11-07T00:00:00Z',total:1990,currency_code:'rub',status:'pending',metadata:{private:true},items:[]}],count:1}}]);
  const result=await api.orders('customer-token',0);assert.equal(result.orders[0].metadata,undefined);
  assert.equal(new URL(calls[0].url).searchParams.get('customer_id'),null);assert.equal(calls[0].options.headers.Authorization,'Bearer customer-token');
  await assert.rejects(api.orders('token',-1));
});
test('another registered customer cart cannot be reassigned',async()=>{
  const {api,calls}=service([{body:{customer}},{body:{cart:{id:'cart_1',customer_id:'cus_other',customer:{has_account:true}}}}]);
  await assert.rejects(api.cart('token',{cart_id:'cart_1'}),error=>error.status===409);assert.equal(calls.length,2);
});
test('new carts are linked to the authenticated customer and ignore arbitrary input fields',async()=>{
  const {api,calls}=service([{body:{customer}},{body:{cart:{id:'cart_1'}}},{body:{cart:{id:'cart_1',customer_id:'cus_1'}}}]);
  assert.equal((await api.cart('token',{region_id:'reg_1',customer_id:'other',items:[{variant_id:'other'}]})).cart.customer_id,'cus_1');
  assert.deepEqual(JSON.parse(calls[1].options.body),{region_id:'reg_1'});assert.equal(calls[2].url,'https://api.test/store/carts/cart_1/customer');
});
test('guests can still create carts without an account',async()=>{
  const {api,calls}=service([{body:{cart:{id:'cart_1'}}}]);
  assert.equal((await api.cart(undefined,{})).cart.id,'cart_1');assert.equal(calls[0].options.headers.Authorization,undefined);
});
test('backend failures do not masquerade as a successful login',async()=>{
  const {api}=service([new Error('offline')]);await assert.rejects(api.login(signup),error=>error.status===503);
});

const {NextRequest}=require('next/server');
function routes(overrides={}) {
  const calls=[];
  const service={login:async()=>{calls.push('login');return {token:'private-token',customer};},customer:async()=>customer,...overrides};
  const exports={};
  vm.runInNewContext(compile('src/app/api/account/[action]/route.node.ts'),{exports,Buffer,process:{env:{NODE_ENV:'production'}},require:name=>name==='next/server'?require(name):name==='@/lib/account'?shared:{createAccountService:()=>service}});
  return {...exports,calls};
}
const ctx=action=>({params:Promise.resolve({action})});
function post(action,options={}) {return new NextRequest(`https://shop.test/api/account/${action}`,{method:'POST',headers:{origin:'https://shop.test','content-type':'application/json',...options.headers},body:JSON.stringify(options.body??{})});}
test('cross-site and originless writes are rejected before authentication',async()=>{
  const api=routes();
  assert.equal((await api.POST(post('login',{headers:{origin:'https://attacker.test'}}),ctx('login'))).status,403);
  assert.equal((await api.POST(post('login',{headers:{origin:''}}),ctx('login'))).status,403);assert.equal(api.calls.length,0);
});
test('successful login sets a secure HttpOnly cookie and never exposes the token in JSON',async()=>{
  const api=routes();const response=await api.POST(post('login'),ctx('login'));
  assert.equal(response.status,200);assert.equal((await response.json()).token,undefined);
  const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly/i);assert.match(cookie,/Secure/i);assert.match(cookie,/SameSite=lax/i);assert.match(cookie,/Path=\//);
});
test('orders require a session and are never publicly cached',async()=>{
  const api=routes();const response=await api.GET(new NextRequest('https://shop.test/api/account/orders'),ctx('orders'));
  assert.equal(response.status,401);assert.match(response.headers.get('cache-control'),/no-store/);
});
test('expired sessions are cleared but backend outages keep the cookie for a retry',async()=>{
  const request=()=>new NextRequest('https://shop.test/api/account/session',{headers:{cookie:'mm_customer_session=token'}});
  const expired=await routes({customer:async()=>{throw new shared.AccountError('expired',401);}}).GET(request(),ctx('session'));
  assert.equal((await expired.json()).customer,null);assert.match(expired.headers.get('set-cookie'),/Max-Age=0/);
  const unavailable=await routes({customer:async()=>{throw new shared.AccountError('offline',503);}}).GET(request(),ctx('session'));
  assert.equal(unavailable.status,503);assert.equal(unavailable.headers.get('set-cookie'),null);
});
test('logout removes the browser session',async()=>{
  const response=await routes().POST(post('logout'),ctx('logout'));
  assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
});
