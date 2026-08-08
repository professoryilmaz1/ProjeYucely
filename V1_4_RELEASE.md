import test from 'node:test';
import assert from 'node:assert/strict';
import { StripeConnectSandboxStub, StripeConnectProvider } from '../src/stripe-connect.js';
import { AsyncCommerceEngine } from '../src/commerce-async.js';

test('Stripe sandbox onboarding -> fund -> transfer is idempotent and reserves remain correct', async()=>{
  const p=new StripeConnectSandboxStub(); const e=new AsyncCommerceEngine({provider:p});
  const ob=await e.onboardWorker({workerId:'w1',email:'w@example.com',refreshUrl:'https://example.com/r',returnUrl:'https://example.com/d',idempotencyKey:'o1'});
  assert.equal(ob.status,'ONBOARDING_REQUIRED');
  p.markAccountReady(ob.account_id); e.markWorkerReady('w1');
  const j=await e.fundJob({requesterId:'r1',workerId:'w1',amount:100,idempotencyKey:'f1'});
  const j2=await e.fundJob({requesterId:'r1',workerId:'w1',amount:100,idempotencyKey:'f1'}); assert.equal(j.id,j2.id);
  const done=await e.completeJob(j.id,{idempotencyKey:'c1'});
  assert.equal(done.status,'PAID_OUT'); assert.equal(done.payout_amount,95); assert.equal(done.platform_fee,5); assert.equal(done.tax_reserve,1.25); assert.equal(done.safety_reserve,1.13);
});

test('worker must finish onboarding before funding', async()=>{
  const p=new StripeConnectSandboxStub(); const e=new AsyncCommerceEngine({provider:p});
  await e.onboardWorker({workerId:'w1',refreshUrl:'https://example.com/r',returnUrl:'https://example.com/d',idempotencyKey:'o2'});
  await assert.rejects(()=>e.fundJob({requesterId:'r',workerId:'w1',amount:20,idempotencyKey:'f2'}),/WORKER_ONBOARDING_REQUIRED/);
});

test('refund hits provider and ledger before release', async()=>{
  const p=new StripeConnectSandboxStub(); const e=new AsyncCommerceEngine({provider:p});
  const ob=await e.onboardWorker({workerId:'w1',refreshUrl:'https://example.com/r',returnUrl:'https://example.com/d',idempotencyKey:'o3'}); p.markAccountReady(ob.account_id); e.markWorkerReady('w1');
  const j=await e.fundJob({requesterId:'r',workerId:'w1',amount:40,idempotencyKey:'f3'}); const r=await e.refundJob(j.id,{idempotencyKey:'r1'}); assert.equal(r.status,'REFUNDED'); assert.equal(p.refunds.size,1);
});

test('Stripe HTTP adapter sends integer cents and idempotency header', async()=>{
  let seen=null; const fakeFetch=async(url,opts)=>{seen={url,opts,body:Object.fromEntries(opts.body.entries())}; return {ok:true,json:async()=>({id:'pi_123',status:'requires_confirmation'})};};
  const p=new StripeConnectProvider({secretKey:'sk_test_fake',apiBase:'https://stripe.test/v1',fetchImpl:fakeFetch}); await p.createIntent({amount:12.34,idempotencyKey:'idem-1'});
  assert.equal(seen.body.amount,'1234'); assert.equal(seen.opts.headers['idempotency-key'],'idem-1'); assert.match(seen.opts.headers.authorization,/Bearer sk_test_fake/);
});

test('refresh worker account only becomes READY when Stripe account is ready', async()=>{
  const p=new StripeConnectSandboxStub(); const e=new AsyncCommerceEngine({provider:p});
  const ob=await e.onboardWorker({workerId:'w9',refreshUrl:'https://example.com/r',returnUrl:'https://example.com/d',idempotencyKey:'o9'});
  const first=await e.refreshWorkerAccount('w9'); assert.equal(first.status,'ONBOARDING_REQUIRED');
  p.markAccountReady(ob.account_id);
  const second=await e.refreshWorkerAccount('w9'); assert.equal(second.status,'READY'); assert.equal(second.payouts_enabled,true);
});
