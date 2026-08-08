import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

const cents = (n) => Math.round(Number(n ?? 0) * 100);
const money = (c) => Math.round(c) / 100;
const now = () => new Date().toISOString();

export class PaymentLedger {
  constructor({ platformFeeRate = 0.05, taxReserveRate = 0.25, safetyReserveRate = 0.30 } = {}) {
    this.platformFeeRate = platformFeeRate;
    this.taxReserveRate = taxReserveRate;
    this.safetyReserveRate = safetyReserveRate;
    this.accounts = new Map();
    this.entries = [];
    this.payments = new Map();
    this.idempotency = new Map();
  }

  _acct(name) { if (!this.accounts.has(name)) this.accounts.set(name, 0); return name; }
  _post(debit, credit, amountCents, ref, memo) {
    if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error('INVALID_AMOUNT');
    this._acct(debit); this._acct(credit);
    this.accounts.set(debit, this.accounts.get(debit) - amountCents);
    this.accounts.set(credit, this.accounts.get(credit) + amountCents);
    const e = { id: randomUUID(), debit, credit, amount: money(amountCents), ref, memo, created_at: now() };
    this.entries.push(e); return e;
  }

  createEscrow({ payerId, payeeId, amount, idempotencyKey, metadata = {} }) {
    if (!idempotencyKey) throw new Error('IDEMPOTENCY_REQUIRED');
    if (this.idempotency.has(idempotencyKey)) return this.payments.get(this.idempotency.get(idempotencyKey));
    const gross = cents(amount); if (gross <= 0) throw new Error('INVALID_AMOUNT');
    const id = randomUUID();
    const p = { id, payer_id: payerId, payee_id: payeeId, gross_amount: money(gross), status: 'ESCROWED', metadata, created_at: now(), updated_at: now() };
    this.payments.set(id, p); this.idempotency.set(idempotencyKey, id);
    this._post(`payer:${payerId}`, 'escrow:held', gross, id, 'Customer funds placed in escrow');
    return p;
  }

  release(id) {
    const p = this.payments.get(id); if (!p) throw new Error('PAYMENT_NOT_FOUND');
    if (p.status === 'RELEASED') return p;
    if (p.status !== 'ESCROWED') throw new Error('INVALID_PAYMENT_STATE');
    const gross = cents(p.gross_amount);
    const platformFee = Math.round(gross * this.platformFeeRate);
    const payout = gross - platformFee;
    const taxReserve = Math.round(platformFee * this.taxReserveRate);
    const postTaxPlatform = platformFee - taxReserve;
    const safetyReserve = Math.round(postTaxPlatform * this.safetyReserveRate);
    const distributable = postTaxPlatform - safetyReserve;
    this._post('escrow:held', `payee:${p.payee_id}`, payout, id, 'Worker/seller payout liability');
    this._post('escrow:held', 'platform:gross_fee', platformFee, id, 'Platform fee');
    this._post('platform:gross_fee', 'reserve:tax', taxReserve, id, 'Tax reserve');
    this._post('platform:gross_fee', 'reserve:safety', safetyReserve, id, 'Safety reserve');
    this._post('platform:gross_fee', 'platform:distributable', distributable, id, 'Distributable platform profit');
    Object.assign(p, { status: 'RELEASED', platform_fee: money(platformFee), payout_amount: money(payout), tax_reserve: money(taxReserve), safety_reserve: money(safetyReserve), distributable_profit: money(distributable), updated_at: now() });
    return p;
  }

  refund(id) {
    const p = this.payments.get(id); if (!p) throw new Error('PAYMENT_NOT_FOUND');
    if (p.status === 'REFUNDED') return p;
    if (p.status !== 'ESCROWED') throw new Error('INVALID_PAYMENT_STATE');
    const gross = cents(p.gross_amount);
    this._post('escrow:held', `payer:${p.payer_id}`, gross, id, 'Escrow refund');
    p.status = 'REFUNDED'; p.updated_at = now(); return p;
  }

  summary() {
    const balances = Object.fromEntries([...this.accounts.entries()].map(([k,v]) => [k, money(v)]));
    return { balances, entries: this.entries.length, payments: this.payments.size };
  }
}

export class MockPaymentProvider {
  constructor() { this.intents = new Map(); this.payouts = new Map(); }
  createIntent({ amount, currency = 'usd', idempotencyKey }) {
    if (!idempotencyKey) throw new Error('IDEMPOTENCY_REQUIRED');
    const existing = [...this.intents.values()].find(x => x.idempotency_key === idempotencyKey);
    if (existing) return existing;
    const intent = { id: `pi_mock_${randomUUID()}`, amount: Number(amount), currency, status: 'succeeded', idempotency_key: idempotencyKey };
    this.intents.set(intent.id, intent); return intent;
  }

  createPayout({ amount, currency = 'usd', payeeId, idempotencyKey }) {
    if (!idempotencyKey) throw new Error('IDEMPOTENCY_REQUIRED');
    const existing = [...this.payouts.values()].find(x => x.idempotency_key === idempotencyKey);
    if (existing) return existing;
    const payout = { id: `po_mock_${randomUUID()}`, amount: Number(amount), currency, payee_id: payeeId, status: 'paid', idempotency_key: idempotencyKey };
    this.payouts.set(payout.id, payout); return payout;
  }

}


export class ResilientMockPaymentProvider extends MockPaymentProvider {
  constructor({ payoutMode = 'paid' } = {}) {
    super();
    this.payoutMode = payoutMode;
    this.refunds = new Map();
    this.disputes = new Map();
  }

  createPayout(args) {
    const p = super.createPayout(args);
    p.status = this.payoutMode;
    return p;
  }

  setPayoutMode(mode) {
    if (!['paid','pending','failed'].includes(mode)) throw new Error('INVALID_PAYOUT_MODE');
    this.payoutMode = mode;
  }

  getPayout(id) { return this.payouts.get(id) ?? null; }
  markPayout(id, status) {
    const p = this.payouts.get(id); if (!p) throw new Error('PAYOUT_NOT_FOUND');
    if (!['paid','pending','failed'].includes(status)) throw new Error('INVALID_PAYOUT_STATUS');
    p.status = status; return p;
  }

  createRefund({ paymentIntentId, amount, idempotencyKey }) {
    if (!idempotencyKey) throw new Error('IDEMPOTENCY_REQUIRED');
    const existing = [...this.refunds.values()].find(x => x.idempotency_key === idempotencyKey);
    if (existing) return existing;
    const r = { id:`re_mock_${randomUUID()}`, payment_intent_id:paymentIntentId, amount:Number(amount), status:'succeeded', idempotency_key:idempotencyKey };
    this.refunds.set(r.id,r); return r;
  }

  createDispute({ paymentIntentId, amount, reason='unknown', idempotencyKey }) {
    if (!idempotencyKey) throw new Error('IDEMPOTENCY_REQUIRED');
    const existing = [...this.disputes.values()].find(x => x.idempotency_key === idempotencyKey);
    if (existing) return existing;
    const d = { id:`dp_mock_${randomUUID()}`, payment_intent_id:paymentIntentId, amount:Number(amount), reason, status:'needs_response', idempotency_key:idempotencyKey, created_at:now() };
    this.disputes.set(d.id,d); return d;
  }
}

export function verifyStripeSignature({ payload, signatureHeader, webhookSecret, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now()/1000) }) {
  if (!payload || !signatureHeader || !webhookSecret) return false;
  const parts = Object.fromEntries(String(signatureHeader).split(',').map(x=>x.split('=',2)).filter(x=>x.length===2));
  const ts = Number(parts.t); const sig = parts.v1;
  if (!Number.isFinite(ts) || !sig || Math.abs(nowSeconds-ts) > toleranceSeconds) return false;
  const expected = createHmac('sha256', webhookSecret).update(`${ts}.${payload}`).digest('hex');
  try {
    const a=Buffer.from(expected,'hex'), b=Buffer.from(sig,'hex');
    return a.length===b.length && timingSafeEqual(a,b);
  } catch { return false; }
}

export class StripePaymentProvider {
  constructor({ secretKey, apiBase='https://api.stripe.com/v1' } = {}) {
    this.secretKey = secretKey; this.apiBase = apiBase;
  }
  _requireKey(){ if(!this.secretKey) throw new Error('STRIPE_SECRET_KEY_REQUIRED'); }
  async _post(path, form, idempotencyKey){
    this._requireKey();
    const body=new URLSearchParams(); for(const [k,v] of Object.entries(form)) if(v!==undefined&&v!==null) body.set(k,String(v));
    const res=await fetch(`${this.apiBase}${path}`,{method:'POST',headers:{authorization:`Bearer ${this.secretKey}`,'content-type':'application/x-www-form-urlencoded',...(idempotencyKey?{'idempotency-key':idempotencyKey}:{})},body});
    const data=await res.json(); if(!res.ok){const e=new Error(data?.error?.message??'STRIPE_API_ERROR');e.code=data?.error?.code;e.status=res.status;throw e;} return data;
  }
  async createIntent({ amount, currency='usd', idempotencyKey }) {
    const amountCents=cents(amount); if(amountCents<=0) throw new Error('INVALID_AMOUNT');
    return this._post('/payment_intents',{amount:amountCents,currency,'automatic_payment_methods[enabled]':'true',confirm:'true','payment_method':'pm_card_visa'},idempotencyKey);
  }
  async createPayout(){ throw new Error('STRIPE_CONNECT_ACCOUNT_REQUIRED'); }
}
