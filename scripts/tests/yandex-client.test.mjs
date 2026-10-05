import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../../src/lib/yandex-delivery.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function loadYandexModule({
  isMedusaConfigured = false,
  medusaRequest = async () => { throw new Error('offline'); },
} = {}) {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    console,
    URL,
    Array,
    Object,
    encodeURIComponent,
    require: (name) => {
      if (name === './medusa') {
        return {
          isMedusaConfigured,
          medusaRequest,
        };
      }
      throw new Error(`Unexpected require: ${name}`);
    },
  });
  return exports;
}

test('Yandex client returns empty array for query shorter than 2 characters', async () => {
  const yandex = loadYandexModule({ isMedusaConfigured: true });
  const cities = await yandex.searchYandexCities('М');
  assert.equal(cities.length, 0);
});

test('fetchYandexDeliveryPoints parses correct response from /store/yandex/pvz', async () => {
  const yandex = loadYandexModule({
    isMedusaConfigured: true,
    medusaRequest: async () => ({
      points: [
        {
          id: 'pvz1',
          name: 'Москва, ТЦ "Мега"',
          type: 'pickup_point',
          address: { full_address: 'ул. Ленина, 10' },
          position: { latitude: 55.7558, longitude: 37.6173 },
          isFittingAllowed: true,
          isPartialRefuseAllowed: false,
        },
      ],
    }),
  });

  const points = await yandex.fetchYandexDeliveryPoints('Москва');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(points)), [
    {
      id: 'pvz1',
      name: 'Москва, ТЦ "Мега"',
      type: 'pickup_point',
      location: {
        address: 'ул. Ленина, 10',
        city: '',
        latitude: 55.7558,
        longitude: 37.6173,
      },
      isFittingAllowed: true,
      isPartialRefuseAllowed: false,
    },
  ]);
});

test('Yandex client throws YandexDeliveryUnavailableError for invalid response or network error', async () => {
  const yandex = loadYandexModule({ isMedusaConfigured: true });

  await assert.rejects(
    yandex.searchYandexCities('Москва'),
    /YandexDeliveryUnavailableError/i,
  );

  await assert.rejects(
    yandex.fetchYandexDeliveryPoints('Москва'),
    /YandexDeliveryUnavailableError/i,
  );
});
