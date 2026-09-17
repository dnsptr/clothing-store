import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../../src/lib/cdek.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function loadCdekModule(fetchMock = async () => ({ ok: true, json: async () => ({}) })) {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    console,
    URL,
    encodeURIComponent,
    fetch: fetchMock,
    require: (name) => {
      if (name === './medusa') {
        return {
          isMedusaConfigured: false,
          medusaRequest: async () => { throw new Error('offline'); },
        };
      }
      throw new Error(`Unexpected require: ${name}`);
    },
  });
  return exports;
}

test('MARIO_MIKKE_PICKUP_STORES returns 3 retail locations in Moscow', () => {
  const cdek = loadCdekModule();
  const stores = cdek.getPickupStores();
  assert.equal(stores.length, 3);

  const ids = stores.map(s => s.id);
  assert.ok(ids.includes('store_vodny'));
  assert.ok(ids.includes('store_govorovo'));
  assert.ok(ids.includes('store_nebo'));

  const vodny = stores.find(s => s.id === 'store_vodny');
  assert.ok(vodny.name.includes('Водный'));
  assert.ok(vodny.address.includes('Головинское шоссе'));
  assert.ok(vodny.metro.includes('Водный стадион'));
  assert.ok(vodny.phone.length > 0);
});

test('searchCdekCities matches cities from query in offline fallback', async () => {
  const cdek = loadCdekModule();
  const moscowResults = await cdek.searchCdekCities('Моск');
  assert.ok(moscowResults.length > 0);
  assert.equal(moscowResults[0].city, 'Москва');
  assert.equal(moscowResults[0].code, 44);

  const spbResults = await cdek.searchCdekCities('Петербург');
  assert.ok(spbResults.length > 0);
  assert.equal(spbResults[0].city, 'Санкт-Петербург');
  assert.equal(spbResults[0].code, 137);

  const emptyResults = await cdek.searchCdekCities('   ');
  assert.equal(emptyResults.length, 0);
});

test('fetchCdekDeliveryPoints returns Moscow PVZ and postamats in offline fallback', async () => {
  const cdek = loadCdekModule();
  const points = await cdek.fetchCdekDeliveryPoints(44);
  assert.ok(points.length >= 3);

  const hasPvz = points.some(p => p.type === 'PVZ');
  const hasPostamat = points.some(p => p.type === 'POSTAMAT');
  assert.ok(hasPvz, 'Must contain PVZ');
  assert.ok(hasPostamat, 'Must contain Postamat');

  const first = points[0];
  assert.ok(first.code);
  assert.ok(first.location.address);
  assert.ok(first.work_time);
});

test('estimateCdekDelivery returns 0 customer cost (promo launch) and realistic timelines', async () => {
  const cdek = loadCdekModule();
  const moscowEstimate = await cdek.estimateCdekDelivery(44, 'pvz');
  assert.equal(moscowEstimate.customerCost, 0);
  assert.ok(moscowEstimate.periodMin >= 1);
  assert.ok(moscowEstimate.periodMax >= moscowEstimate.periodMin);

  const courierEstimate = await cdek.estimateCdekDelivery(44, 'courier');
  assert.equal(courierEstimate.customerCost, 0);
  assert.ok(courierEstimate.periodMin >= 1);
});
