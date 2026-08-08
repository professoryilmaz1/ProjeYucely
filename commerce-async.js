import { randomUUID } from 'node:crypto';

const TYPES=new Set(['RELATIONSHIP','BUSINESS','MENTOR','FRIEND']);
const SAFE_FIELDS=new Set(['age_min','age_max','country','city','languages','interests','skills','goals','industry','experience_min','travel_ok']);

function arr(v){return Array.isArray(v)?v.filter(Boolean):[];}
function norm(v){return String(v??'').trim().toLowerCase();}
function overlap(a,b){const A=new Set(arr(a).map(norm)); const B=new Set(arr(b).map(norm)); if(!A.size||!B.size)return null; let n=0; for(const x of A)if(B.has(x))n++; return n/Math.max(A.size,B.size);}
function ageOf(p){const n=Number(p?.age);return Number.isFinite(n)?n:null;}
function checkCriteria(owner,target){const c=owner.criteria??{}; const tp=target.profile??{}; let total=0,score=0; const reasons=[];
  if(c.age_min!=null||c.age_max!=null){total++; const a=ageOf(tp); const ok=a!=null&&(c.age_min==null||a>=Number(c.age_min))&&(c.age_max==null||a<=Number(c.age_max)); if(ok)score++; else reasons.push('AGE_CRITERIA');}
  for(const f of ['country','city','industry']) if(c[f]){total++; if(norm(tp[f])===norm(c[f]))score++; else reasons.push(`${f.toUpperCase()}_CRITERIA`);}
  for(const f of ['languages','interests','skills','goals']) if(arr(c[f]).length){total++; const o=overlap(c[f],tp[f]); if(o!=null){score+=o;if(o===0)reasons.push(`${f.toUpperCase()}_CRITERIA`);}else reasons.push(`${f.toUpperCase()}_MISSING`);}
  if(c.experience_min!=null){total++; const ok=Number(tp.experience_years??0)>=Number(c.experience_min);if(ok)score++;else reasons.push('EXPERIENCE_CRITERIA');}
  if(c.travel_ok===true){total++; if(tp.travel_ok===true)score++; else reasons.push('TRAVEL_CRITERIA');}
  return {score:total?Math.round((score/total)*100):100,reasons};
}

export function sanitizeCriteria(criteria={}){const out={};for(const [k,v] of Object.entries(criteria)){if(SAFE_FIELDS.has(k))out[k]=v;}return out;}
export function validateMatchProfile(input={}){const type=String(input.type??'').toUpperCase(); if(!TYPES.has(type))throw new Error('INVALID_MATCH_TYPE'); if(input.opt_in!==true)throw new Error('MATCH_OPT_IN_REQUIRED'); return {id:input.id??randomUUID(),user_id:input.user_id,type,profile:input.profile??{},criteria:sanitizeCriteria(input.criteria??{}),opt_in:true,discoverable:input.discoverable!==false,status:'ACTIVE',created_at:input.created_at??new Date().toISOString(),updated_at:new Date().toISOString()};}
export function mutualScore(a,b){if(!a||!b||a.user_id===b.user_id||a.type!==b.type||!a.opt_in||!b.opt_in||!a.discoverable||!b.discoverable||a.status!=='ACTIVE'||b.status!=='ACTIVE')return null; const ab=checkCriteria(a,b); const ba=checkCriteria(b,a); const score=Math.round((ab.score+ba.score)/2); return {id:[a.id,b.id].sort().join(':'),type:a.type,a_profile_id:a.id,b_profile_id:b.id,a_user_id:a.user_id,b_user_id:b.user_id,a_to_b:ab.score,b_to_a:ba.score,mutual_score:score,reasons:{a:ab.reasons,b:ba.reasons},eligible:ab.score>=50&&ba.score>=50};}
export function rankMutualMatches(profile,profiles=[]){return profiles.map(p=>mutualScore(profile,p)).filter(x=>x?.eligible).sort((a,b)=>b.mutual_score-a.mutual_score||b.a_to_b-a.a_to_b);}
export function createConnection(match,userA,userB){return {id:randomUUID(),match_id:match.id,type:match.type,user_a:userA,user_b:userB,user_a_approved:false,user_b_approved:false,status:'PENDING_MUTUAL_APPROVAL',contact_revealed:false,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};}
export function approveConnection(connection,userId){const c={...connection}; if(userId===c.user_a)c.user_a_approved=true; else if(userId===c.user_b)c.user_b_approved=true; else throw new Error('FORBIDDEN'); if(c.user_a_approved&&c.user_b_approved){c.status='MUTUALLY_APPROVED';c.contact_revealed=true;} c.updated_at=new Date().toISOString(); return c;}
