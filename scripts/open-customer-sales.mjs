import fs from "node:fs/promises";

const apply = process.argv.includes("--apply");
const base = (process.env.CATALOG_API_URL || "https://api.mariomikke.shop").replace(/\/$/, "");
for (const name of ["MEDUSA_ADMIN_EMAIL", "MEDUSA_ADMIN_PASSWORD", "BASIC_AUTH_PASSWORD"]) if (!process.env[name]) throw new Error(`Missing ${name}`);
const basic = Buffer.from(`${process.env.BASIC_AUTH_USER || "admin"}:${process.env.BASIC_AUTH_PASSWORD}`).toString("base64");
const login = await fetch(`${base}/auth/user/emailpass`, { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: process.env.MEDUSA_ADMIN_EMAIL, password: process.env.MEDUSA_ADMIN_PASSWORD }) });
if (!login.ok) throw new Error(`Login HTTP ${login.status}`);
const { token } = await login.json();
const request = async (endpoint, body) => {
  const response = await fetch(base + endpoint, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}: ${data.message}`);
  return data;
};
const list = () => request("/admin/products?limit=1000&fields=id,handle,status,*variants,*variants.prices,+metadata");
const { products } = await list();
const customer = products.filter(product => product.metadata?.import_source === "mario-mikke-customer-sheet");
if (customer.length !== 21) throw new Error(`Expected 21 customer products, found ${customer.length}`);
for (const product of customer) {
  if (product.status !== "published" || !product.variants?.length || product.variants.some(variant => !variant.prices?.some(price => price.currency_code === "rub" && Number(price.amount) > 0))) throw new Error(`Product is not ready: ${product.handle}`);
}
const pending = customer.filter(product => product.metadata.storefront_preview === true || product.metadata.catalog_inventory_mode !== "untracked_until_1c" || product.variants.some(variant => variant.manage_inventory !== false || variant.allow_backorder === true));
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", customerProducts: customer.length, toUpdate: pending.length, variants: customer.reduce((sum, product) => sum + product.variants.length, 0), stockPolicy: "untracked_until_1c", inventoryWillBeSeeded: false }));
if (!apply) process.exit(0);
await fs.mkdir(".env-sales-open", { recursive: true });
await fs.writeFile(`.env-sales-open/before-${Date.now()}.json`, JSON.stringify(customer, null, 2));
for (const product of pending) {
  await request(`/admin/products/${product.id}/variants/batch`, { update: product.variants.map(variant => ({ id: variant.id, manage_inventory: false, allow_backorder: false })) });
  await request(`/admin/products/${product.id}`, { metadata: { ...product.metadata, storefront_preview: false, catalog_inventory_mode: "untracked_until_1c", catalog_inventory_policy_updated_at: new Date().toISOString() } });
  console.log(`OPENED ${product.handle}`);
}
const after = (await list()).products.filter(product => product.metadata?.import_source === "mario-mikke-customer-sheet");
for (const previous of customer) {
  const current = after.find(product => product.id === previous.id);
  if (!current || current.metadata.storefront_preview !== false || current.status !== "published" || current.variants.some(variant => variant.manage_inventory !== false || variant.allow_backorder === true)) throw new Error(`Verification failed: ${previous.handle}`);
  for (const variant of previous.variants) {
    const updated = current.variants.find(item => item.id === variant.id);
    const prices = value => JSON.stringify(value.prices.map(price => [price.currency_code, Number(price.amount)]).sort());
    if (!updated || updated.sku !== variant.sku || prices(updated) !== prices(variant)) throw new Error(`Variant or price changed: ${variant.id}`);
  }
}
console.log(JSON.stringify({ updated: pending.length, purchasableProducts: after.length, inventorySeeded: false, pricesAndVariantIdsPreserved: true }));
