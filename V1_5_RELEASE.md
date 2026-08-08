import test from 'node:test';
import assert from 'node:assert/strict';
import { PaymentLedger, MockPaymentProvider } from '../src/payments.js';

test('escrow is idempotent', () => {
  const l = new PaymentLedger();
  const a = l.createEscrow({ payerId:'a', payeeId:'b', amount:100, idempotencyKey:'k1' });
  const b = l.createEscrow({ payerId:'a', payeeId:'b', amount:100, idempotencyKey:'k1' });
  assert.equal(a.id, b.id); assert.equal(l.summary().payments, 1);
});

test('release preserves payout, tax and 30 percent safety reserve', () => {
  const l = new PaymentLedger({ platformFeeRate:.05, taxReserveRate:.25, safetyReserveRate:.30 });
  const p = l.createEscrow({ payerId:'a', payeeId:'b', amount:100, idempotencyKey:'k2' });
  const r = l.release(p.id);
  assert.equal(r.payout_amount, 95);
  assert.equal(r.platform_fee, 5);
  assert.equal(r.tax_reserve, 1.25);
  assert.equal(r.safety_reserve, 1.13);
  assert.equal(r.distributable_profit, 2.62);
});

test('refund only works before release', () => {
  const l = new PaymentLedger();
  const p = l.createEscrow({ payerId:'a', payeeId:'b', amount:50, idempotencyKey:'k3' });
  assert.equal(l.refund(p.id).status, 'REFUNDED');
  assert.throws(() => l.release(p.id), /INVALID_PAYMENT_STATE/);
});

test('mock provider is idempotent', () => {
  const p = new MockPaymentProvider();
  const a = p.createIntent({ amount:20, idempotencyKey:'same' });
  const b = p.createIntent({ amount:20, idempotencyKey:'same' });
  assert.equal(a.id, b.id);
});
