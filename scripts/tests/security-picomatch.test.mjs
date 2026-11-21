import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

// Resolve the installed dependency in the selected npm root, never the vendor
// source directly. Each child is killable even if RegExp.exec blocks its loop.
const consumerRoot = resolve(process.env.PICOMATCH_TEST_ROOT || '.');
const childTimeout = 5_000;
const childSource = String.raw`
  const assert = require('node:assert/strict');
  const { createRequire } = require('node:module');
  const { resolve } = require('node:path');
  const consumerRequire = createRequire(resolve(process.env.PICOMATCH_TEST_ROOT, 'package.json'));
  const scenario = JSON.parse(process.env.PICOMATCH_TEST_CASE);
  const picomatch = consumerRequire(scenario.entry || 'picomatch');

  if (scenario.pattern) {
    const options = scenario.options || {};
    const input = scenario.input || 'a'.repeat(128) + '!';
    assert.equal(picomatch(scenario.pattern, options)(input), false);
    assert.equal(picomatch.makeRe(scenario.pattern, options).test(input), false);
    const parsed = picomatch.parse(scenario.pattern, options);
    assert.equal(picomatch.compileRe(parsed, options).test(input), false);
  } else if (scenario.literalization) {
    // The upstream conservative fallback trades risky glob semantics for literal
    // matching. It must not silently keep an exponential unrestricted matcher.
    for (const pattern of ['+(*a)', '*(*a)', '+(@(*a))', '+(+(a))']) {
      assert.equal(picomatch(pattern)('aaa'), false);
      assert.equal(picomatch.makeRe(pattern).test(pattern), true);
    }
    // Retain the existing language-preserving character-class simplification.
    assert.equal(picomatch('+(*(a)|*(b))')('abba'), true);
    assert.equal(picomatch('+(*(a)|*(b))')('abc'), false);
  } else {
    const files = picomatch('src/**/*.@(js|ts)');
    assert.equal(files('src/nested/item.ts'), true);
    assert.equal(files('src/index.js'), true);
    assert.equal(files('src/item.txt'), false);
    assert.equal(files('src/.hidden.js'), false);
    const negated = picomatch('!**/*.test.js');
    assert.equal(negated('src/index.js'), true);
    assert.equal(negated('src/index.test.js'), false);
    const ignored = picomatch('**/*.js', { ignore: '**/vendor/**' });
    assert.equal(ignored('src/index.js'), true);
    assert.equal(ignored('src/vendor/index.js'), false);
    for (const pattern of ['+(ab|cd)', '*(ab|cd)']) {
      assert.equal(picomatch(pattern)('abcdab'), true);
      assert.equal(picomatch(pattern)('abx'), false);
    }
    assert.equal(picomatch('@(foo|bar).js')('bar.js'), true);
    assert.equal(picomatch('?(foo|bar).js')('foo.js'), true);
    assert.equal(picomatch('!(*.test).js')('index.js'), true);
    assert.equal(picomatch('!(*.test).js')('index.test.js'), false);
    assert.equal(picomatch('+([ab])')('abba'), true);
    assert.equal(picomatch('+([*])')('***'), true);
    assert.equal(picomatch('+(\\*)')('***'), true);
    assert.equal(picomatch('+("*")')('***'), true);
    assert.equal(picomatch('+((*))', { noextglob: true })('aaa'), false);
    assert.equal(picomatch.scan('src/**/*.js').isGlob, true);
    const parsed = consumerRequire('picomatch/lib/parse')('src/*.js', {});
    assert.equal(picomatch.compileRe(parsed).test('src/index.js'), true);
    assert.equal(consumerRequire('picomatch/lib/scan')('*.js').isGlob, true);
  }
`;

function runIsolated(scenario) {
  const child = spawnSync(process.execPath, ['--input-type=commonjs', '--eval', childSource], {
    cwd: consumerRoot,
    env: {
      ...process.env,
      PICOMATCH_TEST_ROOT: consumerRoot,
      PICOMATCH_TEST_CASE: JSON.stringify(scenario),
    },
    encoding: 'utf8',
    timeout: childTimeout,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null, `Child terminated by ${child.signal}`);
  assert.equal(child.status, 0, child.stderr || child.stdout || 'Matcher child failed');
}

const riskyPatterns = [
  '+(*)b', '*(*)b', '+(*a)', '*(*a)', '+(a*)', '*(a*)',
  '+(@(*a))', '*(@(*a))', '+(?(*a))', '+(+(*a))', '+(+(a))',
  '+(*a|b)', '+([a]*a)', '+([*a)', '+((a)*)',
];

for (const pattern of riskyPatterns) {
  test(`rejects adversarial input within a bounded child: ${pattern}`, () => {
    runIsolated({ pattern });
  });
}

for (const options of [
  { capture: true },
  { bash: true },
  { windows: true },
  { fastpaths: false },
  { maxExtglobRecursion: false },
  { maxExtglobRecursion: 100 },
  { nobracket: true },
]) {
  test(`single-branch guard survives options ${JSON.stringify(options)}`, () => {
    runIsolated({ pattern: '+(*a)', options });
  });
}

test('disabled bracket parsing cannot hide a wildcard from the guard', () => {
  runIsolated({
    pattern: '+([*a])',
    options: { nobracket: true },
    input: '[a]'.repeat(128) + '!',
  });
});

test('unescape cannot emit a hidden nested regex quantifier', () => {
  runIsolated({ pattern: '+(a\\*)', options: { unescape: true } });
});

for (const entry of ['picomatch', 'picomatch/posix', 'picomatch/lib/picomatch']) {
  test(`${entry} retains ordinary glob and extglob behavior`, () => {
    runIsolated({ entry });
  });
  test(`${entry} bounds malicious repeated wildcards`, () => {
    runIsolated({ entry, pattern: '+(*a)' });
  });
}

test('risky literalization and the existing safe simplification remain explicit', () => {
  runIsolated({ literalization: true });
});
