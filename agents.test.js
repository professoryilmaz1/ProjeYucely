import test from 'node:test';
import assert from 'node:assert/strict';
import { CommerceEngine } from '../src/commerce.js';

test('fund -> complete -> payout -> reserves chain works', () => {
  const c = new CommerceEngine();
  const job = c.fundJob({ requesterId:'r1', workerId:'w1', amount:100, idempotencyKey:'abc' });
  assert.equal(job.status,'FUNDED');
  const done = c.completeJob(job.id,{idempotencyKey:'done1'});
  assert.equal(done.status,'PAID_OUT');
  assert.equal(done.payout_amount,95);
  assert.equal(done.platform_fee,5);
  assert.equal(done.tax_reserve,1.25);
  assert.equal(done.safety_reserve,1.13);
  assert.equal(done.distributable_profit,2.62);
});

test('fund and complete are idempotent', () => {
  const c = new CommerceEngine();
  const a = c.fundJob({ requesterId:'r1', workerId:'w1', amount:50, idempotencyKey:'same' });
  const b = c.fundJob({ requesterId:'r1', workerId:'w1', amount:50, idempotencyKey:'same' });
  assert.equal(a.id,b.id);
  const x=c.completeJob(a.id,{idempotencyKey:'finish'});
  const y=c.completeJob(a.id,{idempotencyKey:'finish'});
  assert.equal(x.payout_id,y.payout_id);
});

test('refund prevents later payout', () => {
  const c = new CommerceEngine();
  const j=c.fundJob({requesterId:'r',workerId:'w',amount:25,idempotencyKey:'r1'});
  c.refundJob(j.id);
  assert.throws(()=>c.completeJob(j.id,{idempotencyKey:'x'}),/INVALID_JOB_STATE/);
});

test('financial snapshot does not double subtract worker payouts from platform fee revenue', () => {
  const c=new CommerceEngine();
  const j=c.fundJob({requesterId:'r',workerId:'w',amount:100,idempotencyKey:'s1'});
  c.completeJob(j.id,{idempotencyKey:'s2'});
  const s=c.financialSnapshot({activeUsers:1,operatingCosts:1,taxRate:.25});
  assert.equal(s.platform_revenue,5);
  assert.equal(s.worker_payouts,95);
  assert.equal(s.cfo.pre_tax_profit,4);
  assert.equal(s.cfo.after_tax_net_profit,3);
});
