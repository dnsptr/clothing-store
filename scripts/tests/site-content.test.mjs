import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const defaults = JSON.parse(readFileSync(new URL('../../medusa-prototype/apps/backend/src/data/site-content-defaults.json', import.meta.url), 'utf8'));
const compile = url => ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const contract = {};
vm.runInNewContext(compile(new URL('../../medusa-prototype/apps/backend/src/lib/site-content-contract.ts', import.meta.url)), { exports: contract, URL });
const compiled = compile(new URL('../../src/lib/siteContent.ts', import.meta.url));
function client(configured = true) {
  const state = { payload: { content: null }, error: null };
  const requests = [];
  class MedusaRequestError extends Error { constructor(status) { super('fixture'); this.status = status; } }
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    if (name === 'next/navigation') return { unstable_rethrow() {} };
    if (name === './siteContentDefaults') return { DEFAULT_SITE_CONTENT: defaults };
    if (name.includes('site-content-contract')) return contract;
    if (name === './medusa') return { isMedusaConfigured: configured, MedusaRequestError, medusaRequest: async (...args) => { requests.push(args); if (state.error) throw state.error; return state.payload; } };
    throw new Error('Unexpected import: ' + name);
  } });
  return { ...exports, state, requests, MedusaRequestError };
}
test('mock mode uses unchanged defaults without backend calls', async () => {
  const api = client(false); assert.equal(await api.getSiteContent(), defaults); assert.equal(api.requests.length, 0);
});
test('unpublished CMS content preserves current pages and links', async () => {
  const api = client(); assert.equal(await api.getSiteContent(), defaults);
  assert.equal(api.requests[0][0], '/store/content/site'); assert.equal(api.requests[0][1].revalidate, 0);
});
test('published pages and footer are read fresh on normal requests', async () => {
  const api = client(); const content = structuredClone(defaults); content.footer.contactTitle = 'New contact';
  api.state.payload = { content }; assert.equal((await api.getSiteContent()).footer.contactTitle, 'New contact');
  content.footer.contactTitle = 'Second contact'; assert.equal((await api.getSiteContent()).footer.contactTitle, 'Second contact');
  assert.equal(api.requests.length, 2);
});
test('endpoint rollout 404 preserves the current static edition', async () => {
  const api = client(); api.state.error = new api.MedusaRequestError(404); assert.equal(await api.getSiteContent(), defaults);
});
test('an unavailable deployed CMS never silently substitutes older legal texts', async () => {
  const api = client(); api.state.error = new api.MedusaRequestError(503); await assert.rejects(api.getSiteContent());
});
test('invalid published links and payloads fail validation', async () => {
  const api = client(); const content = structuredClone(defaults); content.footer.legalLinks[0].href = 'javascript:alert(1)';
  api.state.payload = { content }; await assert.rejects(api.getSiteContent());
});
