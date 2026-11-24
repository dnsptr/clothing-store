import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';

const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const navigation = {};
vm.runInNewContext(compile('../../src/lib/catalog-navigation.ts'), { exports: navigation, encodeURIComponent });
const component = {};
vm.runInNewContext(compile('../../src/components/Breadcrumbs.tsx'), {
  exports: component,
  require: name => {
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'next/link') return { __esModule: true, default: props => React.createElement('a', props) };
    if (name.endsWith('.module.css')) return { __esModule: true, default: {} };
    throw new Error('Unexpected dependency: ' + name);
  },
});
const plain = value => JSON.parse(JSON.stringify(value));

test('product navigation links to catalog and its actual category', () => {
  assert.deepEqual(plain(navigation.productBreadcrumbs({ name: 'Кофта 1351', category: 'Трикотаж', categorySlug: 'knitwear' })), [
    { label: 'Главная', href: '/' }, { label: 'Каталог', href: '/catalog' },
    { label: 'Трикотаж', href: '/catalog?category=knitwear' }, { label: 'Кофта 1351' },
  ]);
});
test('missing category and unavailable product still provide a catalog link', () => {
  assert.equal(navigation.productBreadcrumbs()[1].href, '/catalog');
  assert.equal(navigation.productBreadcrumbs({ name: 'Товар', category: 'Каталог', categorySlug: 'catalog' }).length, 3);
});
test('dynamic category handles are encoded and catalog root is not duplicated', () => {
  const items = navigation.productBreadcrumbs({ name: 'Товар', category: 'Одежда', categorySlug: 'трикотаж & новинки' });
  assert.equal(new URL(items[2].href, 'https://store.test').searchParams.get('category'), 'трикотаж & новинки');
  assert.equal(navigation.catalogBreadcrumbs().length, 2);
  assert.equal(navigation.catalogBreadcrumbs('Юбки')[1].href, '/catalog');
});
test('breadcrumbs render semantic navigation, ancestor anchors and escaped current title', () => {
  const html = renderToStaticMarkup(React.createElement(component.default, { items: navigation.productBreadcrumbs({ name: '<Товар>', category: 'Юбки', categorySlug: 'skirts' }) }));
  assert.match(html, /<nav[^>]+aria-label="Хлебные крошки"/);
  assert.match(html, /<ol/);
  assert.match(html, /href="\/catalog"/);
  assert.match(html, /href="\/catalog\?category=skirts"/);
  assert.match(html, /aria-current="page">&lt;Товар&gt;/);
  assert.equal((html.match(/aria-current=/g) ?? []).length, 1);
});
