import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../../src/lib/medusa.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

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
      assert.equal(name, 'next/navigation');
      return { unstable_rethrow() {} };
    },
    fetch: async (url, options) => {
      requests.push({ url: new URL(url), options });
      return { ok: true, json: async () => ({ products: state.products, count: state.products.length }) };
    },
  });
  return { api: exports, requests, state };
}

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

test('consecutive reads use no-store and return edited content', async () => {
  const { api, requests, state } = client();
  assert.equal((await api.fetchMedusaProductByFrontendId('prod_admin')).description, 'Original description');
  state.products = [fixture({ description: 'Edited description' })];
  assert.equal((await api.fetchMedusaProductByFrontendId('prod_admin')).description, 'Edited description');
  for (const { options } of requests) {
    assert.equal(options.cache, 'no-store');
    assert.equal(options.next, undefined);
  }
  assert.equal(api.CATALOG_REVALIDATE_SECONDS, 0);
});

test('explicit positive cache lifetime never conflicts with no-store', async () => {
  const { api, requests } = client();
  await api.fetchMedusaProductByHandle('linen-shirt', undefined, 60);
  assert.equal(requests[0].options.next.revalidate, 60);
  assert.equal(requests[0].options.cache, undefined);
});

test('zero revalidation and cancellation are passed to fetch', async () => {
  const { api, requests } = client();
  const controller = new AbortController();
  await api.fetchMedusaProductByFrontendId('prod_admin', controller.signal, 0);
  assert.equal(requests[0].options.signal, controller.signal);
  assert.equal(requests[0].options.cache, 'no-store');
});

test('only the Pages export declares static product parameters', async () => {
  const page = ts.transpileModule(
    readFileSync(new URL('../../src/app/product/[id]/page.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText;
  for (const target of ['pages', 'server']) {
    const exports = {};
    vm.runInNewContext(page, {
      exports, process: { env: { BUILD_TARGET: target } },
      require: (name) => name.endsWith('/mockData') ? { MOCK_PRODUCTS: [{ id: '12' }] } : {},
    });
    if (target === 'pages') {
      assert.equal((await exports.generateStaticParams())[0].id, '12');
    } else {
      assert.equal(exports.generateStaticParams, undefined);
    }
  }
});
