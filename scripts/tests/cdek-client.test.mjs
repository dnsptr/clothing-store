import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../../src/lib/cdek.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function loadCdekModule({ isMedusaConfigured = false, medusaRequest = async () => { throw new Error('offline'); } } = {}) {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    console,
    URL,
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

test('CDEK client rejects malformed Medusa payloads', async () => {
  const cdek = loadCdekModule({
    isMedusaConfigured: true,
    medusaRequest: async () => ({ cities: [{ code: '44', city: 'Москва' }] }),
  });

  await assert.rejects(cdek.searchCdekCities('Москва'), /CDEK.*unavailable/i);
});
