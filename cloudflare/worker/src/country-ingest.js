const FETCH_TIMEOUT_MS = 12000;
const MAX_JOBS_PER_COUNTRY = 20;
const DEFAULT_TTL_DAYS = 30;
const ROLLOUT_START_MS = Date.parse("2026-08-20T22:00:00Z");
const ROLLOUT_BATCH_SIZE = 10;
const ROLLOUT_INTERVAL_MS = 4 * 60 * 60 * 1000;
const SHARD_COUNT = 3;

export const GLOBAL_COUNTRIES = Object.freeze([
  ["US","United States"],["DE","Germany"],["GB","United Kingdom"],["IN","India"],["NL","Netherlands"],["FR","France"],["BR","Brazil"],["CA","Canada"],["PL","Poland"],["CH","Switzerland"],
  ["AU","Australia"],["NZ","New Zealand"],["SE","Sweden"],["NO","Norway"],["DK","Denmark"],["FI","Finland"],["IE","Ireland"],["ES","Spain"],["IT","Italy"],["PT","Portugal"],
  ["AT","Austria"],["BE","Belgium"],["CZ","Czechia"],["SK","Slovakia"],["HU","Hungary"],["RO","Romania"],["BG","Bulgaria"],["GR","Greece"],["HR","Croatia"],["SI","Slovenia"],
  ["EE","Estonia"],["LV","Latvia"],["LT","Lithuania"],["LU","Luxembourg"],["IS","Iceland"],["MT","Malta"],["CY","Cyprus"],["RS","Serbia"],["BA","Bosnia and Herzegovina"],["ME","Montenegro"],
  ["MK","North Macedonia"],["AL","Albania"],["MD","Moldova"],["UA","Ukraine"],["GE","Georgia"],["AM","Armenia"],["AZ","Azerbaijan"],["TR","Türkiye"],["IL","Israel"],["AE","United Arab Emirates"],
  ["SA","Saudi Arabia"],["QA","Qatar"],["KW","Kuwait"],["BH","Bahrain"],["OM","Oman"],["JO","Jordan"],["LB","Lebanon"],["IQ","Iraq"],["KZ","Kazakhstan"],["UZ","Uzbekistan"],
  ["KG","Kyrgyzstan"],["TJ","Tajikistan"],["TM","Turkmenistan"],["MN","Mongolia"],["JP","Japan"],["KR","South Korea"],["TW","Taiwan"],["HK","Hong Kong"],["SG","Singapore"],["MY","Malaysia"],
  ["TH","Thailand"],["VN","Vietnam"],["PH","Philippines"],["ID","Indonesia"],["BN","Brunei"],["KH","Cambodia"],["LA","Laos"],["MM","Myanmar"],["BD","Bangladesh"],["PK","Pakistan"],
  ["LK","Sri Lanka"],["NP","Nepal"],["BT","Bhutan"],["MV","Maldives"],["AF","Afghanistan"],["MX","Mexico"],["AR","Argentina"],["CL","Chile"],["CO","Colombia"],["PE","Peru"],
  ["UY","Uruguay"],["PY","Paraguay"],["BO","Bolivia"],["EC","Ecuador"],["VE","Venezuela"],["GY","Guyana"],["SR","Suriname"],["CR","Costa Rica"],["PA","Panama"],["GT","Guatemala"],
  ["HN","Honduras"],["SV","El Salvador"],["NI","Nicaragua"],["BZ","Belize"],["DO","Dominican Republic"],["JM","Jamaica"],["TT","Trinidad and Tobago"],["BS","Bahamas"],["BB","Barbados"],["HT","Haiti"],
  ["CU","Cuba"],["ZA","South Africa"],["NG","Nigeria"],["KE","Kenya"],["GH","Ghana"],["EG","Egypt"],["MA","Morocco"],["TN","Tunisia"],["DZ","Algeria"],["ET","Ethiopia"],
  ["UG","Uganda"],["TZ","Tanzania"],["RW","Rwanda"],["ZM","Zambia"],["ZW","Zimbabwe"],["BW","Botswana"],["NA","Namibia"],["MZ","Mozambique"],["AO","Angola"],["CM","Cameroon"],
  ["SN","Senegal"],["CI","Côte d’Ivoire"],["ML","Mali"],["BF","Burkina Faso"],["NE","Niger"],["GA","Gabon"],["GM","Gambia"],["SL","Sierra Leone"],["LR","Liberia"],["TG","Togo"],
  ["BJ","Benin"],["MG","Madagascar"],["MU","Mauritius"],["SC","Seychelles"],["MW","Malawi"],["LS","Lesotho"],["SZ","Eswatini"],["CD","Democratic Republic of the Congo"],["CG","Republic of the Congo"],["SD","Sudan"]
].map(([code,name]) => Object.freeze({ code, name })));

export const TOP_PRIORITY_COUNTRIES = Object.freeze(GLOBAL_COUNTRIES.slice(0, 10));

export function activeCountryCount(nowMs = Date.now()) {
  const elapsed = Math.max(0, nowMs - ROLLOUT_START_MS);
  const batches = 1 + Math.floor(elapsed / ROLLOUT_INTERVAL_MS);
  return Math.min(GLOBAL_COUNTRIES.length, batches * ROLLOUT_BATCH_SIZE);
}

export function activeCountries(nowMs = Date.now()) {
  return GLOBAL_COUNTRIES.slice(0, activeCountryCount(nowMs));
}

export function shardIndexFromCron(cron = "0 * * * *") {
  const minute = Number(String(cron).trim().split(/\s+/)[0]);
  if (minute === 20) return 1;
  if (minute === 40) return 2;
  return 0;
}

export function countriesForHourlyShard(cron, nowMs = Date.now()) {
  const shard = shardIndexFromCron(cron);
  return activeCountries(nowMs).filter((_, index) => index % SHARD_COUNT === shard);
}

function stripHtml(value, max = 4000) {
  const text = String(value ?? "").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g," ").trim();
  return text ? text.slice(0,max) : null;
}
function uniqueStrings(values=[]) { return [...new Set(values.map(v=>String(v??"").trim()).filter(Boolean))].slice(0,30); }
function toIso(value) { if (value==null||value==="") return null; const d=typeof value==="number"?new Date(value):new Date(String(value)); return Number.isNaN(d.getTime())?null:d.toISOString(); }
function expiresFallback(nowIso) { const d=new Date(nowIso); d.setUTCDate(d.getUTCDate()+DEFAULT_TTL_DAYS); return d.toISOString(); }
function hashString(input="") { let hash=2166136261; for(let i=0;i<input.length;i++){hash^=input.charCodeAt(i);hash=Math.imul(hash,16777619);} return `kr_${(hash>>>0).toString(16).padStart(8,"0")}`; }

export function buildHimalayasCountryUrl(countryCode,page=1) {
  const url=new URL("https://himalayas.app/jobs/api/search");
  url.searchParams.set("country",countryCode);
  url.searchParams.set("exclude_worldwide","true");
  url.searchParams.set("sort","recent");
  url.searchParams.set("page",String(Math.max(1,Number(page)||1)));
  return url.toString();
}

function salaryText(job){const min=Number(job?.minSalary),max=Number(job?.maxSalary);if(!Number.isFinite(min)&&!Number.isFinite(max))return null;const currency=String(job?.currency||"USD").toUpperCase(),period=String(job?.salaryPeriod||"annual"),fmt=v=>new Intl.NumberFormat("en-US",{maximumFractionDigits:0}).format(v);return Number.isFinite(min)&&Number.isFinite(max)?`${currency} ${fmt(min)}–${fmt(max)} / ${period}`:`${currency} ${fmt(Number.isFinite(min)?min:max)} / ${period}`;}

export function normalizeHimalayasJob(job,country,nowIso=new Date().toISOString()) {
  const guid=String(job?.guid||job?.applicationLink||`${job?.companyName||"company"}:${job?.title||"job"}`);
  const restrictions=Array.isArray(job?.locationRestrictions)?job.locationRestrictions:[];
  const locationNames=restrictions.map(item=>typeof item==="string"?item:item?.name||item?.alpha2).filter(Boolean);
  const tags=uniqueStrings([...(Array.isArray(job?.categories)?job.categories:[]),...(Array.isArray(job?.parentCategories)?job.parentCategories:[]),...(Array.isArray(job?.seniority)?job.seniority:job?.seniority?[job.seniority]:[])]);
  const createdAt=toIso(job?.pubDate)||nowIso,sourceId=`${country.code}:${guid}`,description=stripHtml(job?.description||job?.excerpt,4000),minSalary=Number(job?.minSalary);
  return {title:String(job?.title||"Job opportunity").slice(0,200),description,amount:Number.isFinite(minSalary)?minSalary:null,city:null,country:country.name,remote:true,status:"OPEN",kind:"JOB",company_name:stripHtml(job?.companyName,160),source_provider:"himalayas",source_id:sourceId.slice(0,500),source_url:String(job?.applicationLink||"https://himalayas.app/jobs").slice(0,2000),location_text:locationNames.length?locationNames.join(", ").slice(0,500):country.name,currency:String(job?.currency||"USD").slice(0,12),employment_type:String(job?.employmentType||"").slice(0,80)||null,salary_text:salaryText(job),skills:uniqueStrings(Array.isArray(job?.categories)?job.categories:[]),tags,classification:{source:"himalayas",country_code:country.code,seniority:Array.isArray(job?.seniority)?job.seniority:job?.seniority||null,timezone_restrictions:Array.isArray(job?.timezoneRestrictions)?job.timezoneRestrictions.slice(0,20):[]},metadata:{source_homepage:"https://himalayas.app/",attribution:"Sourced from Himalayas; keep visible source name and original link.",country_code:country.code,company_slug:job?.companySlug||null,raw_guid:guid},external:true,public_visibility:true,map_visibility:false,dedupe_hash:hashString(`himalayas|${country.code}|${guid}`),ingested_at:nowIso,last_seen_at:nowIso,source_updated_at:createdAt,expires_at:toIso(job?.expiryDate)||expiresFallback(nowIso),created_at:createdAt,updated_at:nowIso,search_radius_miles:null};
}

async function fetchCountry(country) {
  const response=await fetch(buildHimalayasCountryUrl(country.code),{headers:{accept:"application/json","user-agent":"KREVUNO-Open-Jobs/2.0 (+https://krevuno.com)"},signal:AbortSignal.timeout(FETCH_TIMEOUT_MS)});
  if(!response.ok) throw new Error(`HIMALAYAS_${country.code}_HTTP_${response.status}`);
  const data=await response.json();
  const jobs=Array.isArray(data?.jobs)?data.jobs:[];
  return jobs.slice(0,MAX_JOBS_PER_COUNTRY);
}

async function upsertRows(rows,env){if(!rows.length)return 0;const url=String(env?.SUPABASE_URL||"").replace(/\/$/,"");const key=env?.SUPABASE_SERVICE_ROLE_KEY||env?.SUPABASE_SERVICE_KEY;if(!url||!key)throw new Error("SUPABASE_SERVICE_ROLE_REQUIRED");let written=0;for(let offset=0;offset<rows.length;offset+=40){const batch=rows.slice(offset,offset+40);const response=await fetch(`${url}/rest/v1/vovyyvov_opportunities?on_conflict=source_provider,source_id`,{method:"POST",headers:{apikey:key,authorization:`Bearer ${key}`,"content-type":"application/json",prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(batch),signal:AbortSignal.timeout(20000)});if(!response.ok){const detail=await response.text().catch(()=>"");throw new Error(`SUPABASE_HIMALAYAS_UPSERT_${response.status}:${detail.slice(0,500)}`);}written+=batch.length;}return written;}

export async function runGlobalCountryIngestion(env,options={}) {
  const nowMs=Number.isFinite(options.nowMs)?options.nowMs:Date.now();
  const allActive=activeCountries(nowMs);
  const countries=Array.isArray(options.countries)&&options.countries.length?allActive.filter(c=>options.countries.includes(c.code)):countriesForHourlyShard(options.cron||"0 * * * *",nowMs);
  const nowIso=new Date(nowMs).toISOString(),rows=[],results=[];
  const concurrency=5;
  for(let offset=0;offset<countries.length;offset+=concurrency){
    const chunk=countries.slice(offset,offset+concurrency);
    const settled=await Promise.allSettled(chunk.map(async country=>({country,jobs:await fetchCountry(country)})));
    for(let i=0;i<settled.length;i++){
      const country=chunk[i],result=settled[i];
      if(result.status==="fulfilled"){
        const normalized=result.value.jobs.map(job=>normalizeHimalayasJob(job,country,nowIso));
        rows.push(...normalized);results.push({country:country.code,ok:true,fetched:result.value.jobs.length});
      }else results.push({country:country.code,ok:false,fetched:0,error:result.reason instanceof Error?result.reason.message:String(result.reason)});
    }
  }
  const written=await upsertRows(rows,env);
  return {ok:results.some(r=>r.ok),provider:"himalayas",rollout:{active_countries:allActive.length,total_countries:GLOBAL_COUNTRIES.length,batch_size:ROLLOUT_BATCH_SIZE,interval_hours:4},shard:{index:shardIndexFromCron(options.cron||"0 * * * *"),count:SHARD_COUNT,countries:countries.length},countries:results,fetched:rows.length,written,ran_at:nowIso};
}

export async function runPriorityCountryIngestion(env,options={}) {
  return runGlobalCountryIngestion(env,{...options,countries:options.countries||TOP_PRIORITY_COUNTRIES.map(c=>c.code),cron:"0 * * * *"});
}
