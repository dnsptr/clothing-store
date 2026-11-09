import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../../src/lib/medusa.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

const cartAccess = {};
vm.runInNewContext(ts.transpileModule(
  readFileSync(new URL('../../src/lib/cartAccess.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, { exports: cartAccess });

function fixture(overrides = {}) {
  return {
    id: 'prod_admin', title: 'Admin product', handle: 'linen-shirt',
    description: 'Original description', metadata: {}, images: [], options: [],
    variants: [{ id: 'variant_admin', manage_inventory: false,
      calculated_price: { calculated_amount: 1500 }, options: [] }],
    ...overrides,
  };
}

function client(products = [fixture()]) {
  const requests = [];
  const exports = {};
  const state = { products };
  vm.runInNewContext(compiled, {
    exports, console, URL, URLSearchParams, DOMException,
    process: { env: { NODE_ENV: 'test', NEXT_PUBLIC_DATA_MODE: 'medusa',
      NEXT_PUBLIC_MEDUSA_BACKEND_URL: 'https://backend.test',
      NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: 'pk_test', NEXT_PUBLIC_MEDUSA_REGION_ID: 'reg_test' } },
    require: (name) => {
      if (name === './cartAccess') return cartAccess;
      if (name === 'next/navigation') {
        return { unstable_rethrow() {} };
      }
      if (name === './payment-config') {
        return {
          SYSTEM_DEFAULT_PAYMENT_PROVIDER_ID: 'pp_system_default',
          TBANK_PAYMENT_PROVIDER_ID: 'pp_tbank_tbank',
          isCheckoutEnabledForConfiguration: () => true,
        };
      }
      throw new Error(`Unexpected require: ${name}`);
    },
    fetch: async (url, options) => {
      requests.push({ url: new URL(url), options });
      if (new URL(url).pathname.endsWith('/shipping-methods')) {
        return { ok: true, json: async () => ({ cart: { id: 'cart_1' } }) };
      }
      return { ok: true, json: async () => ({ products: state.products, count: state.products.length }) };
    },
  });
  return { api: exports, requests, state };
}

test('measurements expose only valid product data', async () => {
  const { api } = client([fixture({ metadata: { catalog_profile: { measurements: [
    { size: 'os', label: 'Length', value: '65,5', internal: 'secret' },
    { size: 'S', label: 'Width', value: '-10' }, null,
  ] } } })]);
  const product = await api.fetchMedusaProductByFrontendId('prod_admin');
  assert.equal(JSON.stringify(product.measurements), JSON.stringify([{ size: 'ONE SIZE', label: 'Length', value: '65.5' }]));
});

test('preview products remain visible but none of their variants can be purchased', async () => {
  const { api } = client([fixture({ metadata: { storefront_preview: true } })]);
  const product = await api.fetchMedusaProductByFrontendId('prod_admin');
  assert.equal(product.isPreview, true);
  assert.equal(product.price, 1500);
  assert.equal(product.available, false);
  assert.ok(product.variants.every(variant => variant.available === false));
});

test('sales without stock tracking use the existing priced variants without fabricating inventory', async () => {
  const { api } = client([fixture({ metadata: { storefront_preview: false, catalog_inventory_mode: 'untracked_until_1c' },
    variants: [{ id: 'variant_admin', manage_inventory: false, allow_backorder: false, inventory_quantity: 0, calculated_price: { calculated_amount: 1500 }, options: [] }],
  })]);
  const product = await api.fetchMedusaProductByFrontendId('prod_admin');
  assert.equal(product.isPreview, false);
  assert.equal(product.available, true);
  assert.equal(product.variants[0].available, true);
  assert.equal(product.price, 1500);
});

test('admin-created product resolves by id, not a fabricated handle', async () => {
  const { api, requests } = client();
  const product = await api.fetchMedusaProductByFrontendId('prod_admin');
  assert.equal(product.id, 'prod_admin');
  assert.equal(requests[0].url.searchParams.get('id[]'), 'prod_admin');
  assert.equal(requests[0].url.searchParams.get('handle'), null);
  assert.equal(requests[0].url.searchParams.get('region_id'), 'reg_test');
});

test('legacy imported URLs remain compatible without metadata', async () => {
  const { api, requests } = client([fixture({ handle: 'mario-mikke-12' })]);
  const product = await api.fetchMedusaProductByFrontendId('12');
  assert.equal(product.id, '12');
  assert.equal(requests[0].url.searchParams.get('handle'), 'mario-mikke-12');
});

test('arbitrary frontend metadata cannot produce an unresolvable catalog URL', async () => {
  const { api } = client([fixture({ metadata: { frontend_id: 'wrong-route' } })]);
  const page = await api.fetchMedusaProducts({ limit: 24, offset: 0 });
  assert.equal(page.products[0].id, 'prod_admin');
  const line = api.mapCartLineToProduct({ id: 'line_1', product_id: 'prod_admin', product_handle: 'linen-shirt' });
  assert.equal(line.id, page.products[0].id);
});

test('missing and unrelated products do not resolve as the requested product', async () => {
  assert.equal(await client([]).api.fetchMedusaProductByFrontendId('prod_admin'), null);
  assert.equal(await client().api.fetchMedusaProductByFrontendId('prod_other'), null);
});

test('subsequent catalog reads return edited content', async () => {
  const { api, state } = client();
  assert.equal((await api.fetchMedusaProductByFrontendId('prod_admin')).description, 'Original description');
  state.products = [fixture({ description: 'Edited description' })];
  assert.equal((await api.fetchMedusaProductByFrontendId('prod_admin')).description, 'Edited description');
});

test('explicit positive cache lifetime never conflicts with no-store', async () => {
  const { api, requests } = client();
  await api.fetchMedusaProductByHandle('linen-shirt', undefined, 60);
  assert.equal(requests[0].options.next.revalidate, 60);
  assert.equal(requests[0].options.cache, undefined);
});


test('public product characteristics use only supported fields and HTTPS registry links', async () => {
  const { api } = client([fixture({ metadata: { catalog_profile: {
    composition: '70% viscose, 30% polyester', lining: 'old lining', no_lining: true,
    registry_url: 'javascript:alert(1)', internal_note: 'not public',
    label_images: [{ name: 'label', url: 'https://assets.example/label.jpg' }, { url: 'javascript:alert(1)' }],
  } } })]);
  const product = await api.fetchMedusaProductByFrontendId('prod_admin');
  assert.equal(product.characteristics.length, 2);
  assert.equal(product.characteristics[0].value, '70% viscose, 30% polyester');
  assert.equal(product.registryUrl, undefined);
  assert.equal(product.labelImages.length, 1);
  assert.equal(JSON.stringify(product).includes('not public'), false);
});



