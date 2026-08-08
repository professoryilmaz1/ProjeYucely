import { randomUUID } from 'node:crypto';
import { PaymentLedger, ResilientMockPaymentProvider } from './payments.js';
import { calculateCfo } from './life-finance.js';

const now=()=>new Date().toISOString();

export class CommerceEngine {
  constructor({ ledger = new PaymentLedger(), provider = new ResilientMockPaymentProvider(), store = null } = {}) {
    this.ledger=ledger; this.provider=provider; this.store=store; this.jobs=new Map(); this.disputes=new Map(); this.events=[];
  }
  _event(type,job,metadata={}){const e={id:randomUUID(),type,job_id:job?.id??null,metadata,created_at:now()};this.events.push(e);return e;}
  fundJob({ requesterId, workerId, amount, currency='usd', opportunityId=null, needId=null, idempotencyKey }) {
    if(!requesterId||!workerId)throw new Error('PARTIES_REQUIRED'); if(!idempotencyKey)throw new Error('IDEMPOTENCY_REQUIRED');
    const existing=[...this.jobs.values()].find(j=>j.fund_idempotency_key===idempotencyKey); if(existing)return existing;
    const intent=this.provider.createIntent({amount,currency,idempotencyKey:`fund:${idempotencyKey}`});
    if(intent instanceof Promise) throw new Error('ASYNC_PROVIDER_REQUIRES_ASYNC_ENGINE');
    if(intent.status!=='succeeded')throw new Error('PAYMENT_NOT_CAPTURED');
    const escrow=this.ledger.createEscrow({payerId:requesterId,payeeId:workerId,amount,idempotencyKey:`escrow:${idempotencyKey}`,metadata:{opportunityId,needId,provider_intent_id:intent.id}});
    const job={id:randomUUID(),requester_id:requesterId,worker_id:workerId,opportunity_id:opportunityId,need_id:needId,amount:Number(amount),currency,provider_intent_id:intent.id,payment_id:escrow.id,status:'FUNDED',fund_idempotency_key:idempotencyKey,payout_attempts:0,created_at:now(),updated_at:now()};
    this.jobs.set(job.id,job); this._event('JOB_FUNDED',job,{amount:job.amount}); return job;
  }
  completeJob(jobId,{idempotencyKey}={}){
    const job=this.jobs.get(jobId);if(!job)throw new Error('JOB_NOT_FOUND');if(['PAID_OUT','PAYOUT_PENDING'].includes(job.status))return job;if(job.status!=='FUNDED')throw new Error('INVALID_JOB_STATE');if(!idempotencyKey)throw new Error('IDEMPOTENCY_REQUIRED');
    const released=this.ledger.release(job.payment_id); const payout=this.provider.createPayout({amount:released.payout_amount,currency:job.currency,payeeId:job.worker_id,idempotencyKey:`payout:${idempotencyKey}`});
    if(payout instanceof Promise)throw new Error('ASYNC_PROVIDER_REQUIRES_ASYNC_ENGINE');
    Object.assign(job,{status:payout.status==='paid'?'PAID_OUT':payout.status==='failed'?'PAYOUT_FAILED':'PAYOUT_PENDING',payout_id:payout.id,payout_amount:released.payout_amount,platform_fee:released.platform_fee,tax_reserve:released.tax_reserve,safety_reserve:released.safety_reserve,distributable_profit:released.distributable_profit,payout_attempts:1,completed_at:now(),updated_at:now()});
    this._event('JOB_COMPLETED',job,{payout_status:payout.status}); return job;
  }
  reconcilePayout(jobId,{idempotencyKey}={}){
    const job=this.jobs.get(jobId);if(!job)throw new Error('JOB_NOT_FOUND');if(job.status==='PAID_OUT')return job;if(!['PAYOUT_PENDING','PAYOUT_FAILED'].includes(job.status))throw new Error('INVALID_JOB_STATE');
    const current=this.provider.getPayout?.(job.payout_id); if(current?.status==='paid'){job.status='PAID_OUT';job.updated_at=now();this._event('PAYOUT_RECONCILED',job,{status:'paid'});return job;}
    if(job.status==='PAYOUT_PENDING'&&current?.status==='pending')return job;
    if(!idempotencyKey)throw new Error('IDEMPOTENCY_REQUIRED');
    const retry=this.provider.createPayout({amount:job.payout_amount,currency:job.currency,payeeId:job.worker_id,idempotencyKey:`retry:${job.id}:${idempotencyKey}`});
    if(retry instanceof Promise)throw new Error('ASYNC_PROVIDER_REQUIRES_ASYNC_ENGINE');
    job.payout_id=retry.id;job.payout_attempts=Number(job.payout_attempts??0)+1;job.status=retry.status==='paid'?'PAID_OUT':retry.status==='failed'?'PAYOUT_FAILED':'PAYOUT_PENDING';job.updated_at=now();this._event('PAYOUT_RETRY',job,{status:retry.status,attempts:job.payout_attempts});return job;
  }
  refundJob(jobId){const job=this.jobs.get(jobId);if(!job)throw new Error('JOB_NOT_FOUND');if(job.status==='REFUNDED')return job;if(job.status!=='FUNDED')throw new Error('INVALID_JOB_STATE');this.ledger.refund(job.payment_id);job.status='REFUNDED';job.updated_at=now();this._event('JOB_REFUNDED',job);return job;}
  openDispute(jobId,{openedBy,reason='other',amount=null,idempotencyKey}={}){
    const job=this.jobs.get(jobId);if(!job)throw new Error('JOB_NOT_FOUND');if(!idempotencyKey)throw new Error('IDEMPOTENCY_REQUIRED');
    const existing=[...this.disputes.values()].find(d=>d.idempotency_key===idempotencyKey);if(existing)return existing;
    if(!['FUNDED','PAID_OUT','PAYOUT_PENDING','PAYOUT_FAILED'].includes(job.status))throw new Error('INVALID_JOB_STATE');
    const d={id:randomUUID(),job_id:jobId,opened_by:openedBy,reason,amount:Number(amount??job.amount),status:'OPEN',idempotency_key:idempotencyKey,created_at:now(),updated_at:now()};this.disputes.set(d.id,d);job.dispute_status='OPEN';job.updated_at=now();this._event('DISPUTE_OPENED',job,{dispute_id:d.id,reason});return d;
  }
  resolveDispute(disputeId,{resolution='REJECT',note=null}={}){
    const d=this.disputes.get(disputeId);if(!d)throw new Error('DISPUTE_NOT_FOUND');if(d.status!=='OPEN')return d;const job=this.jobs.get(d.job_id);
    if(!['REFUND','REJECT'].includes(resolution))throw new Error('INVALID_DISPUTE_RESOLUTION');
    if(resolution==='REFUND'&&job.status==='FUNDED')this.refundJob(job.id);
    d.status=resolution==='REFUND'?'RESOLVED_REFUND':'RESOLVED_REJECTED';d.note=note;d.updated_at=now();if(job){job.dispute_status=d.status;job.updated_at=now();}this._event('DISPUTE_RESOLVED',job,{dispute_id:d.id,resolution});return d;
  }
  recordChargeback(jobId,{providerDisputeId,amount,reason='unknown'}={}){const job=this.jobs.get(jobId);if(!job)throw new Error('JOB_NOT_FOUND');job.chargeback={provider_dispute_id:providerDisputeId??null,amount:Number(amount??job.amount),reason,status:'OPEN',created_at:now()};job.status='CHARGEBACK_OPEN';job.updated_at=now();this._event('CHARGEBACK_OPENED',job,job.chargeback);return job;}
  getJob(id){return this.jobs.get(id)??null;}
  listTransactions({userId=null,limit=100}={}){let jobs=[...this.jobs.values()];if(userId)jobs=jobs.filter(j=>j.requester_id===userId||j.worker_id===userId);return jobs.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,limit).map(j=>({job_id:j.id,status:j.status,amount:j.amount,currency:j.currency,requester_id:j.requester_id,worker_id:j.worker_id,platform_fee:j.platform_fee??0,payout_amount:j.payout_amount??0,payout_attempts:j.payout_attempts??0,dispute_status:j.dispute_status??null,created_at:j.created_at,updated_at:j.updated_at}));}
  reconciliationReport(){const jobs=[...this.jobs.values()];return {total_jobs:jobs.length,funneled:{funded:jobs.filter(x=>x.status==='FUNDED').length,paid_out:jobs.filter(x=>x.status==='PAID_OUT').length,payout_pending:jobs.filter(x=>x.status==='PAYOUT_PENDING').length,payout_failed:jobs.filter(x=>x.status==='PAYOUT_FAILED').length,refunded:jobs.filter(x=>x.status==='REFUNDED').length,chargeback_open:jobs.filter(x=>x.status==='CHARGEBACK_OPEN').length},open_disputes:[...this.disputes.values()].filter(d=>d.status==='OPEN').length,ledger:this.ledger.summary()};}
  financialSnapshot({activeUsers=0,operatingCosts=0,refunds=0,fraudLosses=0,taxRate=.25}={}){const jobs=[...this.jobs.values()],paid=jobs.filter(j=>j.status==='PAID_OUT');const revenue=paid.reduce((s,j)=>s+Number(j.platform_fee??0),0),payouts=paid.reduce((s,j)=>s+Number(j.payout_amount??0),0);const cfo=calculateCfo({revenue,operating_costs:operatingCosts,payouts:0,refunds,fraud_losses:fraudLosses,tax_rate:taxRate,active_users:activeUsers});return {jobs:jobs.length,paid_jobs:paid.length,gross_marketplace_volume:paid.reduce((s,j)=>s+Number(j.amount??0),0),platform_revenue:revenue,worker_payouts:payouts,ledger_tax_reserve:paid.reduce((s,j)=>s+Number(j.tax_reserve??0),0),ledger_safety_reserve:paid.reduce((s,j)=>s+Number(j.safety_reserve??0),0),ledger_distributable_profit:paid.reduce((s,j)=>s+Number(j.distributable_profit??0),0),cfo};}
}
