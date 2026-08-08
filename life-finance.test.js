import { randomUUID } from 'node:crypto';
import { PaymentLedger } from './payments.js';
const now=()=>new Date().toISOString();

export class AsyncCommerceEngine {
  constructor({ledger=new PaymentLedger(),provider,connectedAccounts=new Map()}={}){
    if(!provider) throw new Error('PAYMENT_PROVIDER_REQUIRED');
    this.ledger=ledger; this.provider=provider; this.connectedAccounts=connectedAccounts; this.jobs=new Map(); this.events=[];
  }
  async onboardWorker({workerId,email=null,country='US',refreshUrl,returnUrl,idempotencyKey}){
    if(!workerId||!idempotencyKey) throw new Error('ONBOARDING_FIELDS_REQUIRED');
    if(this.connectedAccounts.has(workerId)) return this.connectedAccounts.get(workerId);
    const account=await this.provider.createConnectedAccount({email,country,idempotencyKey:`acct:${idempotencyKey}`});
    const link=await this.provider.createAccountLink({accountId:account.id,refreshUrl,returnUrl,idempotencyKey:`link:${idempotencyKey}`});
    const rec={worker_id:workerId,account_id:account.id,status:'ONBOARDING_REQUIRED',onboarding_url:link.url,created_at:now(),updated_at:now()};
    this.connectedAccounts.set(workerId,rec); return rec;
  }
  async refreshWorkerAccount(workerId){
    const r=this.connectedAccounts.get(workerId); if(!r) throw new Error('CONNECTED_ACCOUNT_NOT_FOUND');
    const a=await this.provider.retrieveAccount(r.account_id);
    r.status=(a.details_submitted && a.payouts_enabled)?'READY':'ONBOARDING_REQUIRED'; r.updated_at=now(); return {...r,charges_enabled:!!a.charges_enabled,payouts_enabled:!!a.payouts_enabled,details_submitted:!!a.details_submitted};
  }
  markWorkerReady(workerId){ const r=this.connectedAccounts.get(workerId); if(!r) throw new Error('CONNECTED_ACCOUNT_NOT_FOUND'); r.status='READY';r.updated_at=now();return r; }
  async fundJob({requesterId,workerId,amount,currency='usd',idempotencyKey}){
    if(!idempotencyKey) throw new Error('IDEMPOTENCY_REQUIRED');
    const existing=[...this.jobs.values()].find(j=>j.fund_idempotency_key===idempotencyKey); if(existing) return existing;
    const acct=this.connectedAccounts.get(workerId); if(!acct||acct.status!=='READY') throw new Error('WORKER_ONBOARDING_REQUIRED');
    const intent=await this.provider.createIntent({amount,currency,idempotencyKey:`intent:${idempotencyKey}`,metadata:{worker_id:workerId}});
    const confirmed=intent.status==='succeeded'?intent:await this.provider.confirmIntent({paymentIntentId:intent.id,idempotencyKey:`confirm:${idempotencyKey}`});
    if(confirmed.status!=='succeeded') throw new Error('PAYMENT_NOT_CAPTURED');
    const escrow=this.ledger.createEscrow({payerId:requesterId,payeeId:workerId,amount,idempotencyKey:`escrow:${idempotencyKey}`,metadata:{provider_intent_id:confirmed.id}});
    const job={id:randomUUID(),requester_id:requesterId,worker_id:workerId,amount:Number(amount),currency,provider_intent_id:confirmed.id,provider_charge_id:confirmed.latest_charge??null,payment_id:escrow.id,status:'FUNDED',fund_idempotency_key:idempotencyKey,created_at:now(),updated_at:now()};
    this.jobs.set(job.id,job); return job;
  }
  async completeJob(jobId,{idempotencyKey}={}){
    const job=this.jobs.get(jobId); if(!job) throw new Error('JOB_NOT_FOUND'); if(job.status==='PAID_OUT') return job; if(job.status!=='FUNDED') throw new Error('INVALID_JOB_STATE');
    const acct=this.connectedAccounts.get(job.worker_id); if(!acct||acct.status!=='READY') throw new Error('WORKER_ONBOARDING_REQUIRED');
    const released=this.ledger.release(job.payment_id);
    const tr=await this.provider.createTransfer({amount:released.payout_amount,currency:job.currency,connectedAccountId:acct.account_id,transferGroup:`job_${job.id}`,idempotencyKey:`transfer:${idempotencyKey??job.id}`,metadata:{job_id:job.id}});
    Object.assign(job,{status:'PAID_OUT',transfer_id:tr.id,payout_amount:released.payout_amount,platform_fee:released.platform_fee,tax_reserve:released.tax_reserve,safety_reserve:released.safety_reserve,distributable_profit:released.distributable_profit,completed_at:now(),updated_at:now()});
    return job;
  }
  async refundJob(jobId,{idempotencyKey}={}){
    const job=this.jobs.get(jobId); if(!job) throw new Error('JOB_NOT_FOUND'); if(job.status==='REFUNDED') return job; if(job.status!=='FUNDED') throw new Error('INVALID_JOB_STATE');
    await this.provider.createRefund({paymentIntentId:job.provider_intent_id,amount:job.amount,idempotencyKey:`refund:${idempotencyKey??job.id}`});
    this.ledger.refund(job.payment_id); job.status='REFUNDED';job.updated_at=now(); return job;
  }
}
