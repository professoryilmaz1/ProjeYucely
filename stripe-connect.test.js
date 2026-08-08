import test from 'node:test';
import assert from 'node:assert/strict';
import { CommerceEngine, ResilientMockPaymentProvider, verifyStripeSignature } from '../src/index.js';
import { createHmac } from 'node:crypto';

test('pending payout reconciles to paid without duplicate ledger release', () => {
  const provider=new ResilientMockPaymentProvider({payoutMode:'pending'});
  const c=new CommerceEngine({provider});
  const j=c.fundJob({requesterId:'r',workerId:'w',amount:100,idempotencyKey:'f1'});
  const x=c.completeJob(j.id,{idempotencyKey:'c1'});
  assert.equal(x.status,'PAYOUT_PENDING');
  const before=c.ledger.entries.length;
  provider.markPayout(x.payout_id,'paid');
  const y=c.reconcilePayout(j.id);
  assert.equal(y.status,'PAID_OUT');
  assert.equal(c.ledger.entries.length,before);
});

test('failed payout can retry idempotently', () => {
  const provider=new ResilientMockPaymentProvider({payoutMode:'failed'});
  const c=new CommerceEngine({provider});
  const j=c.fundJob({requesterId:'r',workerId:'w',amount:80,idempotencyKey:'f2'});
  c.completeJob(j.id,{idempotencyKey:'c2'});
  assert.equal(j.status,'PAYOUT_FAILED');
  provider.setPayoutMode('paid');
  c.reconcilePayout(j.id,{idempotencyKey:'retry1'});
  assert.equal(j.status,'PAID_OUT');
  assert.equal(j.payout_attempts,2);
});

test('dispute is idempotent and refund resolution only refunds funded escrow', () => {
  const c=new CommerceEngine();
  const j=c.fundJob({requesterId:'r',workerId:'w',amount:60,idempotencyKey:'f3'});
  const d1=c.openDispute(j.id,{openedBy:'r',reason:'not_delivered',idempotencyKey:'d1'});
  const d2=c.openDispute(j.id,{openedBy:'r',reason:'not_delivered',idempotencyKey:'d1'});
  assert.equal(d1.id,d2.id);
  c.resolveDispute(d1.id,{resolution:'REFUND'});
  assert.equal(j.status,'REFUNDED');
  assert.equal(d1.status,'RESOLVED_REFUND');
});

test('transaction and reconciliation reports expose payout and dispute state', () => {
  const c=new CommerceEngine();
  const j=c.fundJob({requesterId:'r',workerId:'w',amount:100,idempotencyKey:'f4'});
  c.completeJob(j.id,{idempotencyKey:'c4'});
  const tx=c.listTransactions({userId:'r'});
  assert.equal(tx.length,1); assert.equal(tx[0].status,'PAID_OUT');
  const report=c.reconciliationReport();
  assert.equal(report.funneled.paid_out,1); assert.equal(report.total_jobs,1);
});

test('Stripe webhook signature verifier accepts valid and rejects invalid signatures', () => {
  const payload='{"id":"evt_1"}', secret='whsec_test', ts=1700000000;
  const sig=createHmac('sha256',secret).update(`${ts}.${payload}`).digest('hex');
  assert.equal(verifyStripeSignature({payload,signatureHeader:`t=${ts},v1=${sig}`,webhookSecret:secret,nowSeconds:ts}),true);
  assert.equal(verifyStripeSignature({payload,signatureHeader:`t=${ts},v1=00`,webhookSecret:secret,nowSeconds:ts}),false);
});
