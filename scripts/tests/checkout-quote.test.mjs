import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../../src/lib/paymentSessionPolicy.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const policy = {};
vm.runInNewContext(compiled, { exports: policy, URL, Set });

const shown = { shippingOptionId: 'so_cdek_pvz', selection: 'cart_1:pvz_1:item_1', price: 350, total: 2350 };

test('payment requires a displayed delivery quote and unchanged final cart amount', () => {
  assert.equal(policy.mustReviewDeliveryQuote(null, shown), true);
  assert.equal(policy.mustReviewDeliveryQuote(shown, { ...shown }), false);
  assert.equal(policy.mustReviewDeliveryQuote(shown, { ...shown, shippingOptionId: 'so_cdek_courier' }), true);
  assert.equal(policy.mustReviewDeliveryQuote(shown, { ...shown, selection: 'cart_1:pvz_2:item_1' }), true);
  assert.equal(policy.mustReviewDeliveryQuote(shown, { ...shown, selection: 'cart_1:pvz_1:item_1:item_2' }), true);
  assert.equal(policy.mustReviewDeliveryQuote(shown, { ...shown, price: 450 }), true);
  assert.equal(policy.mustReviewDeliveryQuote(shown, { ...shown, total: 2450 }), true);
  assert.equal(policy.mustReviewDeliveryQuote(shown, { ...shown, total: Infinity }), true);
});

test('a reused bank session cannot authorize payment for another cart amount or currency', () => {
  const session = {
    id: 'payses_existing',
    provider_id: 'pp_tbank_tbank',
    status: 'pending_authorization',
    amount: 1899,
    currency_code: 'rub',
    data: { paymentUrl: 'https://securepay.tinkoff.ru/payment/existing' },
  };
  assert.equal(policy.decideTbankSession([session], session.provider_id, 1899, 'rub').kind, 'redirect');
  for (const [amount, currency] of [[1900, 'rub'], [1899, 'usd'], [Infinity, 'rub'], [0, 'rub']]) {
    assert.equal(policy.decideTbankSession([session], session.provider_id, amount, currency).kind, 'reject');
  }
});

test('bank redirects reject credentials and alternate ports rather than creating another payment', () => {
  const session = {
    id: 'payses_existing',
    provider_id: 'pp_tbank_tbank',
    status: 'authorized',
    amount: 1899,
    currency_code: 'rub',
  };
  for (const paymentUrl of [
    'https://securepay.tinkoff.ru:8443/payment/existing',
    'https://attacker@securepay.tinkoff.ru/payment/existing',
    'https://securepay.tinkoff.ru.attacker.test/payment/existing',
  ]) {
    assert.equal(policy.decideTbankSession([{ ...session, data: { paymentUrl } }], session.provider_id, 1899, 'rub').kind, 'reject');
  }
});
