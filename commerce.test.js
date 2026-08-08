const STOP = new Set(['the','and','for','with','this','that','bir','ve','icin','için','ile','çok','cok','ama','de','da','to','of','is','it','a','an']);

function words(text=''){
  return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9çğıöşü]+/g)?.filter(w=>w.length>2&&!STOP.has(w))??[];
}
function topicKey(text=''){
  const ws=words(text); if(!ws.length) return 'other';
  const lex={
    payout:['payout','payment','odeme','para','withdraw','withdrawal','gecik','delay'],
    matching:['match','matching','esles','uygun','job','is','worker','calisan'],
    speed:['slow','speed','yavas','donuyor','freeze','latency'],
    login:['login','signin','giris','password','sifre','account'],
    fraud:['fraud','scam','dolandir','stolen','hack','hirsiz'],
    translation:['translation','translate','ceviri','dil','language'],
    pricing:['price','pricing','fee','ucret','komisyon','expensive','pahali'],
  };
  let best=['other',0];
  for(const [k,ks] of Object.entries(lex)){
    const score=ks.reduce((n,x)=>n+(ws.some(w=>w.startsWith(x)||x.startsWith(w))?1:0),0);
    if(score>best[1]) best=[k,score];
  }
  return best[1]?best[0]:ws.slice(0,2).join('_');
}
function severityFor(input={}){
  const t=String(input.text??'').toLowerCase();
  if(/hack|stolen|fraud|dolandir|hirsiz|security|guvenlik|data leak|breach/.test(t)) return 5;
  if(/payment|payout|odeme|para|refund|chargeback/.test(t)) return 4;
  if(/crash|cannot|cant|olmuyor|calismiyor|çalışmıyor|error/.test(t)) return 3;
  return Number(input.severity??2);
}
export function classifySignal(input={}){
  const text=String(input.text??'').trim();
  const type=String(input.type??'AUTO').toUpperCase();
  let intent=type;
  const low=text.toLowerCase();
  if(type==='AUTO'){
    if(/looking for work|need work|is ariyorum|iş arıyorum|available to work|bosum|boşum/.test(low)) intent='WORK_SEEKER';
    else if(/need someone|looking for someone|lazim|lazım|yardim|yardım|help wanted/.test(low)) intent='NEED_HELP';
    else intent='GENERAL';
  }
  return {intent,topic:topicKey(text),severity:severityFor(input),text};
}

export function buildVoiceReport(feedback=[]){
  const groups=new Map();
  for(const f of feedback){
    const c=classifySignal({text:f.text,type:'AUTO',severity:f.severity});
    const g=groups.get(c.topic)??{topic:c.topic,count:0,severity_sum:0,countries:new Map(),sources:new Map(),latest_at:null,samples:[]};
    g.count++; g.severity_sum+=c.severity; g.latest_at=!g.latest_at||String(f.created_at)>g.latest_at?f.created_at:g.latest_at;
    if(f.country)g.countries.set(f.country,(g.countries.get(f.country)||0)+1);
    if(f.source)g.sources.set(f.source,(g.sources.get(f.source)||0)+1);
    if(g.samples.length<3)g.samples.push(f.text);
    groups.set(c.topic,g);
  }
  const total=feedback.length||1;
  const issues=[...groups.values()].map(g=>({
    topic:g.topic,count:g.count,share_pct:Number((g.count*100/total).toFixed(1)),avg_severity:Number((g.severity_sum/g.count).toFixed(2)),
    priority_score:Number((g.count*(g.severity_sum/g.count)).toFixed(2)),
    top_countries:[...g.countries.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([country,count])=>({country,count})),
    top_sources:[...g.sources.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([source,count])=>({source,count})),samples:g.samples,latest_at:g.latest_at
  })).sort((a,b)=>b.priority_score-a.priority_score||b.count-a.count);
  return {total_feedback:feedback.length,issues,critical:issues.filter(x=>x.avg_severity>=4),recommendations:issues.slice(0,3).map(x=>({topic:x.topic,action:x.avg_severity>=4?'ESCALATE_AND_ROOT_CAUSE':'INVESTIGATE_AND_IMPROVE',reason:`${x.count} signals, avg severity ${x.avg_severity}`}))};
}

export function buildFeatureReport(events=[]){
  const map=new Map();
  for(const e of events){
    const k=e.feature||'UNKNOWN'; const g=map.get(k)??{feature:k,uses:0,successes:0,failures:0,unique:new Set(),revenue:0,cost:0};
    g.uses++; if(e.status==='SUCCESS')g.successes++; if(e.status==='FAILURE')g.failures++; if(e.user_id)g.unique.add(e.user_id);g.revenue+=Number(e.revenue??0);g.cost+=Number(e.cost??0);map.set(k,g);
  }
  const rows=[...map.values()].map(g=>({feature:g.feature,uses:g.uses,unique_users:g.unique.size,success_rate_pct:g.uses?Number((g.successes*100/g.uses).toFixed(1)):0,revenue:Number(g.revenue.toFixed(2)),cost:Number(g.cost.toFixed(2)),net_value:Number((g.revenue-g.cost).toFixed(2))})).sort((a,b)=>b.uses-a.uses);
  return {total_events:events.length,most_used:rows.slice(0,5),least_used:[...rows].sort((a,b)=>a.uses-b.uses).slice(0,5),features:rows,recommendations:rows.map(r=>({feature:r.feature,action:r.uses===0?'REVIEW':r.success_rate_pct<60?'IMPROVE':r.net_value<0?'COST_REVIEW':'KEEP_OR_GROW'}))};
}

export function buildOpportunityRadar(signals=[]){
  const classified=signals.map(s=>({...s,...classifySignal(s)}));
  const counts={NEED_HELP:0,WORK_SEEKER:0,GENERAL:0};
  const byCountry=new Map(), bySource=new Map();
  for(const s of classified){counts[s.intent]=(counts[s.intent]||0)+1;if(s.country)byCountry.set(s.country,(byCountry.get(s.country)||0)+1);if(s.source)bySource.set(s.source,(bySource.get(s.source)||0)+1);}
  return {total_signals:classified.length,counts,
    top_countries:[...byCountry.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([country,count])=>({country,count})),
    top_sources:[...bySource.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([source,count])=>({source,count})),
    recent:classified.slice(0,25)};
}
