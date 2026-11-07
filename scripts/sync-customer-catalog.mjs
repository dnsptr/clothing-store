import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Run with node --env-file=.env.server-admin.local. Dry-run unless --apply.
const apply = process.argv.includes("--apply");
const publish = process.argv.includes("--publish-previews");
const cleanup = process.argv.includes("--archive-demo");
const home = process.argv.includes("--home");
const base = (process.env.CATALOG_API_URL || "https://api.mariomikke.shop").replace(/\/$/, "");
const media = article => `${base}/static/catalog/2026-11/${article}`;
const source = await fs.readFile("medusa-prototype/apps/backend/src/scripts/data/customer-catalog.ts", "utf8");
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports });
const { CUSTOMER_CATALOG: rows, CUSTOMER_CATALOG_SHARED: shared, parseCustomerColors, customerVariantSku } = exports;
const physical = new Map(Object.entries(JSON.parse(await fs.readFile("medusa-prototype/apps/backend/src/scripts/data/customer-physical.json", "utf8"))));
for (const row of rows) {
  const dimensions = physical.get(row.article);
  if (!dimensions || Object.values(dimensions).some(value => typeof value !== "number" || value <= 0)) throw new Error(`Invalid physical data: ${row.article}`);
}
const manifest = JSON.parse(await fs.readFile(".env-catalog-media/manifest.json", "utf8"));
const photos = new Map(manifest.map(item => [item.article, item.images.map(image => media(path.basename(image.file)))]));
for (const key of ["MEDUSA_ADMIN_EMAIL", "MEDUSA_ADMIN_PASSWORD", "BASIC_AUTH_PASSWORD"]) if (!process.env[key]) throw new Error(`Missing ${key}`);
const basic = Buffer.from(`${process.env.BASIC_AUTH_USER || "admin"}:${process.env.BASIC_AUTH_PASSWORD}`).toString("base64");
const login = await fetch(`${base}/auth/user/emailpass`, { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: process.env.MEDUSA_ADMIN_EMAIL, password: process.env.MEDUSA_ADMIN_PASSWORD }) });
if (!login.ok) throw new Error(`Login HTTP ${login.status}`);
const { token } = await login.json();
const request = async (endpoint, body, method = "POST") => {
  const response = await fetch(base + endpoint, { method: body === undefined ? "GET" : method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${endpoint} HTTP ${response.status}: ${data.message}`);
  return data;
};
const [productData, categoryData, collectionData, slideData] = await Promise.all([
  request("/admin/products?limit=1000&fields=*variants,*variants.prices,*variants.options,*options,*options.values,*categories,*images,+metadata"),
  request("/admin/product-categories?limit=1000"), request("/admin/collections?limit=1000"), request("/admin/content/slides"),
]);
const byHandle = new Map(productData.products.map(p => [p.handle,p]));
const categories = new Map(categoryData.product_categories.map(p => [p.handle,p]));
const collections = new Map(collectionData.collections.map(p => [p.handle,p]));
console.log(JSON.stringify({mode:apply?"apply":"dry-run",products:productData.count,rows:rows.length,photos:manifest.length,missingPhotos:rows.filter(r=>!photos.has(r.article.split("-")[0])).map(r=>r.article),publish,cleanup,home,collections:collectionData.collections.map(c=>({id:c.id,handle:c.handle,title:c.title}))}));
if (!apply) process.exit(0);
await fs.mkdir(".env-catalog-media/snapshots", { recursive: true });
await fs.writeFile(`.env-catalog-media/snapshots/admin-${Date.now()}.json`, JSON.stringify({ productData, categoryData, collectionData, slideData }));
const collectionDefinitions = [
  {handle:"everyday-knitwear",title:"Трикотаж на каждый день"},
  {handle:"cardigans",title:"Кардиганы"},
  {handle:"skirts",title:"Юбки"},
];
for (const definition of collectionDefinitions) if (!collections.has(definition.handle)) {
  const { collection } = await request("/admin/collections", definition);
  collections.set(collection.handle,collection);
}
if (!categories.has("cardigans")) {
  const { product_category } = await request("/admin/product-categories", {name:"Кардиганы",handle:"cardigans",is_active:true});
  categories.set("cardigans",product_category);
}
const palette = {бежевый:"#d2bea4",белый:"#f4f3ef",черный:"#252525",чёрный:"#252525",бордовый:"#7b293d",голубой:"#9cb9cf",джинсовый:"#6d8da5",коричневый:"#775c49",кремовый:"#e8dfca",молочный:"#f1eee4",синий:"#344e72",серый:"#9b9996",хаки:"#7d8062",горчичный:"#b79a32",шоколадный:"#5a4034",капучино:"#aa927e",лён:"#c6b9a0"};
const hex = name => palette[name.toLocaleLowerCase("ru")] || (name.includes("синий") ? "#344e72" : name.includes("беж") ? "#cdb99e" : name.includes("коричнев") ? "#775c49" : "#a29b90");
let updated = 0;
for (const row of rows) {
  const product = byHandle.get(`mario-mikke-${row.article.toLowerCase()}`);
  if (!product) throw new Error(`Expected existing customer draft ${row.article}`);
  if (product.metadata?.import_source !== "mario-mikke-customer-sheet") throw new Error(`Unexpected owner: ${row.article}`);
  const colors = parseCustomerColors(row.colors);
  const oldOptions = new Map(product.options.map(o=>[o.title,o]));
  for (const [title,desired] of [["Размер",["ONE SIZE"]],["Цвет",colors]]) {
    const option = oldOptions.get(title);
    if (!option) throw new Error(`Missing option ${row.article}/${title}`);
    const union = [...new Set([...option.values.map(v=>v.value),...desired])];
    if (union.length !== option.values.length) await request(`/admin/product-options/${option.id}`,{values:union});
  }
  const oldVariants = new Map(product.variants.map(v=>[v.sku,v]));
  const create=[], update=[];
  for (const [index,color] of colors.entries()) {
    const sku = customerVariantSku(row.article,index);
    const existing=oldVariants.get(sku);
    const variant = {title:`ONE SIZE / ${color}`,manage_inventory:true,allow_backorder:false,prices:[...(existing?.prices ?? []).filter(p=>p.currency_code!=="rub").map(p=>({currency_code:p.currency_code,amount:p.amount})),{currency_code:"rub",amount:row.price}]};
    if (existing) update.push({id:existing.id,...variant});
    else create.push({...variant,sku,options:{Размер:"ONE SIZE",Цвет:color}});
  }
  await request(`/admin/products/${product.id}/variants/batch`, { create, update });
  const images=photos.get(row.article.split("-")[0]) ?? [`${base}/static/catalog/2026-11/placeholder.webp`];
  const physicalData=physical.get(row.article);
  const dimensions={weight:physicalData.weight,length:physicalData.length,width:physicalData.width,height:physicalData.height};
  const cardigan=row.name.includes("Кардиган");
  const collection=collections.get(row.category==="skirts"?"skirts":cardigan?"cardigans":"everyday-knitwear");
  const profile={...(product.metadata?.catalog_profile??{}),model:row.article,composition:row.composition??"",country:shared.country,manufacturer:shared.manufacturer,manufacturer_address:row.manufacturerAddress,care:shared.care,brand:shared.brand,no_lining:true,lining:"",conformity_document:row.conformityDocument??""};
  await request(`/admin/products/${product.id}`, {
    title:`${row.name} ${row.article}`, status:publish?"published":product.status,
    ...dimensions,images:images.map(url=>({url})),thumbnail:images[0],collection_id:collection.id,
    categories:[{id:categories.get(row.category).id},...(cardigan?[{id:categories.get("cardigans").id}]:[])],
    metadata:{...product.metadata,catalog_profile:profile,storefront_preview:true,uses_placeholder_image:!photos.has(row.article.split("-")[0]),import_source_date:"2026-11-07",is_new:true,material_slugs:[...(row.composition?.includes("шерсть")?["wool"]:[]),...(row.composition?.includes("хлопок")?["cotton"]:[]),...(row.composition?.includes("вискоза")?["viscose"]:[])],colors:colors.map(name=>({name,hex:hex(name.split("/")[0])}))},
  });
  console.log(`UPDATED ${row.article} (${++updated}/${rows.length})`);
}
if (cleanup) {
  if (!publish) throw new Error("Publish verified previews before archiving demo products");
  for (const product of productData.products.filter(p=>p.metadata?.import_source==="mario-mikke-demo")) {
    await request(`/admin/products/${product.id}`, {status:"rejected",collection_id:null});
    console.log(`ARCHIVED ${product.handle}`);
  }
  for (const handle of ["linen-look","autumn-chic","cashmere-cozy"]) {
    const collection=collections.get(handle);
    if (collection) await request(`/admin/collections/${collection.id}`,{},"DELETE");
  }
  for (const handle of ["outerwear","trousers","shoes","accessories"]) {
    const category=categories.get(handle);
    if (category) await request(`/admin/product-categories/${category.id}`,{is_active:false,is_internal:true});
  }
}
if (home) {
  const slides = [
    {section:"hero",rank:0,title:"MARIO MIKKE",eyebrow:"Новая коллекция",media_url:media("2015-1.webp"),href:"/catalog?section=new",alt:"Кардиган Mario Mikke",object_position:"50% 35%"},
    {section:"hero",rank:1,title:"Трикотаж",eyebrow:"На каждый день",media_url:media("1351-1.webp"),href:"/collection/everyday-knitwear",alt:"Трикотаж Mario Mikke",object_position:"50% 30%"},
    {section:"hero",rank:2,title:"Юбки",eyebrow:"Новая коллекция",media_url:media("1916-2.webp"),href:"/collection/skirts",alt:"Трикотажная юбка Mario Mikke",object_position:"50% 60%"},
    ...[["Трикотаж","1351","/catalog?category=knitwear"],["Кардиганы","2015","/catalog?category=cardigans"],["Юбки","1916","/catalog?category=skirts"],["Новинки","1647","/catalog?section=new"]].map(([title,article,href],rank)=>({section:"shortcut",rank,title,eyebrow:"Каталог",media_url:media(`${article}-1.webp`),href,alt:title})),
    ...[["Шерсть","1999","wool"],["Хлопок","1603","cotton"],["Вискоза","4262","viscose"]].map(([title,article,slug],rank)=>({section:"material",rank,title,eyebrow:"Материалы в деталях",media_url:media(`${article}-1.webp`),href:`/catalog?material=${slug}`,alt:title})),
    {section:"promo",rank:0,title:"Кардиганы",eyebrow:"MARIO MIKKE",media_url:media("2014-2.webp"),href:"/collection/cardigans",cta_label:"Смотреть",alt:"Длинный кардиган Mario Mikke",object_position:"50% 35%"},
  ];
  const owned=slideData.slides.filter(s=>["hero","shortcut","material","promo"].includes(s.section));
  for (const definition of slides) {
    const existing=owned.find(s=>s.section===definition.section && s.rank===definition.rank);
    const body={...definition,is_active:true,media_type:"image",poster_url:null,poster_key:null,media_key:null,duration_ms:6500};
    await request(existing?`/admin/content/slides/${existing.id}`:"/admin/content/slides",body);
  }
  for (const existing of owned.filter(s=>!slides.some(d=>d.section===s.section&&d.rank===s.rank))) await request(`/admin/content/slides/${existing.id}`,{is_active:false});
  for (const existing of slideData.slides.filter(s=>s.section==="store" && /^(Магазин 0\d|Онлайн)$/.test(s.title))) await request(`/admin/content/slides/${existing.id}`,{is_active:false});
  console.log(`HOME ${slides.length} slides updated`);
}
console.log(JSON.stringify({updated,mode:publish?"preview":"stage",inventorySeeded:false}));
