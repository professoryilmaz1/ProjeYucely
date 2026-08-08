import { randomUUID } from 'node:crypto';

const cents = (n) => Math.round(Number(n ?? 0) * 100);

export class StripeConnectProvider {
  constructor({ secretKey, apiBase='https://api.stripe.com/v1', fetchImpl=globalThis.fetch } = {}) {
    this.secretKey = secretKey;
    this.apiBase = apiBase.replace(/\/$/,'');
    this.fetchImpl = fetchImpl;
  }
  _requireKey(){ if(!this.secretKey) throw new Error('STRIPE_SECRET_KEY_REQUIRED'); }
  async _get(path){
    this._requireKey();
    if(!this.fetchImpl) throw new Error('FETCH_UNAVAILABLE');
    const res=await this.fetchImpl(`${this.apiBase}${path}`,{method:'GET',headers:{authorization:`Bearer ${this.secretKey}`}});
    const data=await res.json();
    if(!res.ok){const e=new Error(data?.error?.message??'STRIPE_API_ERROR');e.code=data?.error?.code??null;e.status=res.status;throw e;}
    return data;
  }
  async _post(path, form={}, idempotencyKey=null){
    this._requireKey();
    if(!this.fetchImpl) throw new Error('FETCH_UNAVAILABLE');
    const body = new URLSearchParams();
    for (const [k,v] of Object.entries(form)) if(v!==undefined && v!==null) body.set(k,String(v));
    const res = await this.fetchImpl(`${this.apiBase}${path}`, {
      method:'POST',
      headers:{
        authorization:`Bearer ${this.secretKey}`,
        'content-type':'application/x-www-form-urlencoded',
        ...(idempotencyKey ? {'idempotency-key': idempotencyKey} : {})
      },
      body
    });
    const data = await res.json();
    if(!res.ok){
      const e = new Error(data?.error?.message ?? 'STRIPE_API_ERROR');
      e.code = data?.error?.code ?? null;
      e.status = res.status;
      throw e;
    }
    return data;
  }
  async createIntent({ amount, currency='usd', idempotencyKey, customerId=null, metadata={} }){
    const amountCents=cents(amount); if(amountCents<=0) throw new Error('INVALID_AMOUNT');
    const form={amount:amountCents,currency,'automatic_payment_methods[enabled]':'true',capture_method:'automatic'};
    if(customerId) form.customer=customerId;
    for(const [k,v] of Object.entries(metadata)) form[`metadata[${k}]`]=v;
    return this._post('/payment_intents',form,idempotencyKey);
  }
  async confirmIntent({ paymentIntentId, paymentMethod='pm_card_visa', idempotencyKey }){
    if(!paymentIntentId) throw new Error('PAYMENT_INTENT_REQUIRED');
    return this._post(`/payment_intents/${paymentIntentId}/confirm`,{payment_method:paymentMethod},idempotencyKey);
  }
  async createConnectedAccount({ email=null, country='US', idempotencyKey }){
    const form={type:'express',country,'capabilities[card_payments][requested]':'true'};
    if(email) form.email=email;
    form['capabilities[transfers][requested]']='true';
    return this._post('/accounts',form,idempotencyKey);
  }
  async retrieveAccount(accountId){ if(!accountId) throw new Error('CONNECTED_ACCOUNT_REQUIRED'); return this._get(`/accounts/${accountId}`); }
  async createAccountLink({ accountId, refreshUrl, returnUrl, idempotencyKey }){
    if(!accountId||!refreshUrl||!returnUrl) throw new Error('ACCOUNT_LINK_FIELDS_REQUIRED');
    return this._post('/account_links',{account:accountId,refresh_url:refreshUrl,return_url:returnUrl,type:'account_onboarding'},idempotencyKey);
  }
  async createTransfer({ amount, currency='usd', connectedAccountId, sourceTransaction=null, transferGroup=null, idempotencyKey, metadata={} }){
    const amountCents=cents(amount); if(amountCents<=0) throw new Error('INVALID_AMOUNT');
    if(!connectedAccountId) throw new Error('CONNECTED_ACCOUNT_REQUIRED');
    const form={amount:amountCents,currency,destination:connectedAccountId};
    if(sourceTransaction) form.source_transaction=sourceTransaction;
    if(transferGroup) form.transfer_group=transferGroup;
    for(const [k,v] of Object.entries(metadata)) form[`metadata[${k}]`]=v;
    return this._post('/transfers',form,idempotencyKey);
  }
  async createRefund({ paymentIntentId, amount=null, idempotencyKey }){
    if(!paymentIntentId) throw new Error('PAYMENT_INTENT_REQUIRED');
    const form={payment_intent:paymentIntentId}; if(amount!=null) form.amount=cents(amount);
    return this._post('/refunds',form,idempotencyKey);
  }
}

export class StripeConnectSandboxStub {
  constructor(){ this.calls=[]; this.accounts=new Map(); this.intents=new Map(); this.transfers=new Map(); this.refunds=new Map(); }
  async createIntent({amount,currency='usd',idempotencyKey,metadata={}}){
    const prev=this.calls.find(c=>c.op==='intent'&&c.key===idempotencyKey); if(prev) return prev.result;
    const result={id:`pi_test_${randomUUID()}`,amount:cents(amount),currency,status:'requires_confirmation',metadata};
    this.calls.push({op:'intent',key:idempotencyKey,result}); this.intents.set(result.id,result); return result;
  }
  async confirmIntent({paymentIntentId,paymentMethod='pm_card_visa',idempotencyKey}){
    const p=this.intents.get(paymentIntentId); if(!p) throw new Error('PAYMENT_INTENT_NOT_FOUND');
    const prev=this.calls.find(c=>c.op==='confirm'&&c.key===idempotencyKey); if(prev) return prev.result;
    Object.assign(p,{status:'succeeded',payment_method:paymentMethod,latest_charge:`ch_test_${randomUUID()}`});
    this.calls.push({op:'confirm',key:idempotencyKey,result:p}); return p;
  }
  async createConnectedAccount({email=null,country='US',idempotencyKey}){
    const prev=this.calls.find(c=>c.op==='account'&&c.key===idempotencyKey); if(prev) return prev.result;
    const result={id:`acct_test_${randomUUID()}`,email,country,charges_enabled:false,payouts_enabled:false,details_submitted:false};
    this.accounts.set(result.id,result); this.calls.push({op:'account',key:idempotencyKey,result}); return result;
  }
  async createAccountLink({accountId,refreshUrl,returnUrl,idempotencyKey}){
    if(!this.accounts.has(accountId)) throw new Error('ACCOUNT_NOT_FOUND');
    return {object:'account_link',created:Math.floor(Date.now()/1000),expires_at:Math.floor(Date.now()/1000)+1800,url:`https://connect.stripe.test/${accountId}`,refresh_url:refreshUrl,return_url:returnUrl,type:'account_onboarding'};
  }
  async retrieveAccount(accountId){ const a=this.accounts.get(accountId); if(!a) throw new Error('ACCOUNT_NOT_FOUND'); return a; }
  markAccountReady(accountId){ const a=this.accounts.get(accountId); if(!a) throw new Error('ACCOUNT_NOT_FOUND'); Object.assign(a,{charges_enabled:true,payouts_enabled:true,details_submitted:true}); return a; }
  async createTransfer({amount,currency='usd',connectedAccountId,idempotencyKey,transferGroup=null,metadata={}}){
    const acct=this.accounts.get(connectedAccountId); if(!acct?.payouts_enabled) throw new Error('CONNECTED_ACCOUNT_NOT_READY');
    const prev=this.calls.find(c=>c.op==='transfer'&&c.key===idempotencyKey); if(prev) return prev.result;
    const result={id:`tr_test_${randomUUID()}`,amount:cents(amount),currency,destination:connectedAccountId,transfer_group:transferGroup,metadata};
    this.transfers.set(result.id,result); this.calls.push({op:'transfer',key:idempotencyKey,result}); return result;
  }
  async createRefund({paymentIntentId,amount=null,idempotencyKey}){
    const p=this.intents.get(paymentIntentId); if(!p) throw new Error('PAYMENT_INTENT_NOT_FOUND');
    const prev=this.calls.find(c=>c.op==='refund'&&c.key===idempotencyKey); if(prev) return prev.result;
    const result={id:`re_test_${randomUUID()}`,payment_intent:paymentIntentId,amount:amount==null?p.amount:cents(amount),status:'succeeded'};
    this.refunds.set(result.id,result); this.calls.push({op:'refund',key:idempotencyKey,result}); return result;
  }
}
