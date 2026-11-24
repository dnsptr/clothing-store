import ts from 'typescript';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const modules = {};
for (const name of ['legalPages', 'infoPages', 'siteContentDefaults']) {
  const code = ts.transpileModule(await fs.readFile(`src/lib/${name}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => modules[name.replace('./', '')] });
  modules[name] = exports;
}
const json = JSON.stringify(modules.siteContentDefaults.DEFAULT_SITE_CONTENT, null, 2) + '\n';
const destination = 'medusa-prototype/apps/backend/src/data/site-content-defaults.json';
if (process.argv.includes('--check')) {
  if (await fs.readFile(destination, 'utf8') !== json) throw new Error('Site content defaults differ; run node scripts/export-site-content-defaults.mjs');
} else {
  await fs.mkdir('medusa-prototype/apps/backend/src/data', { recursive: true });
  await fs.writeFile(destination, json);
}
console.log('Site content defaults are synchronized.');
