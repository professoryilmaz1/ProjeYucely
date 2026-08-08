const $=(s)=>document.querySelector(s);
const authView=$('#authView'), appView=$('#appView'), authError=$('#authError');
let token=localStorage.getItem('py_token')||'';
let user=JSON.parse(localStorage.getItem('py_user')||'null');

async function api(path,{method='GET',body,auth=true}={}){
  const headers={'content-type':'application/json'};
  if(auth&&token)headers.authorization=`Bearer ${token}`;
  const res=await fetch(path,{method,headers,body:body?JSON.stringify(body):undefined});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||`HTTP_${res.status}`);
  return data;
}
function showError(message){authError.textContent=message;authError.classList.remove('hidden');}
function clearError(){authError.classList.add('hidden');}
function setSession(out){token=out.token;user=out.user;localStorage.setItem('py_token',token);localStorage.setItem('py_user',JSON.stringify(user));renderSession();refreshDashboard();}
function clearSession(){token='';user=null;localStorage.removeItem('py_token');localStorage.removeItem('py_user');renderSession();}
function renderSession(){const logged=Boolean(token&&user);authView.classList.toggle('hidden',logged);appView.classList.toggle('hidden',!logged);$('#logoutBtn').classList.toggle('hidden',!logged);if(logged)$('#welcomeName').textContent=user.display_name||user.email;}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function money(n){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n||0));}

for(const tab of document.querySelectorAll('.tab'))tab.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===tab));
  $('#loginForm').classList.toggle('hidden',tab.dataset.tab!=='login');
  $('#registerForm').classList.toggle('hidden',tab.dataset.tab!=='register'); clearError();
});
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();clearError();const f=new FormData(e.currentTarget);try{setSession(await api('/v1/auth/login',{method:'POST',auth:false,body:{email:f.get('email'),password:f.get('password')}}));}catch(err){showError(err.message);}});
$('#registerForm').addEventListener('submit',async e=>{e.preventDefault();clearError();const f=new FormData(e.currentTarget);try{setSession(await api('/v1/auth/register',{method:'POST',auth:false,body:{display_name:f.get('display_name'),email:f.get('email'),password:f.get('password'),city:f.get('city')||null,skills:String(f.get('skills')||'').split(',').map(x=>x.trim()).filter(Boolean)}}));}catch(err){showError(err.message);}});
$('#logoutBtn').addEventListener('click',clearSession);
document.querySelectorAll('[data-prompt]').forEach(btn=>btn.addEventListener('click',()=>{$('#oneText').value=btn.dataset.prompt;$('#oneText').focus();}));

function renderOpportunities(items=[]){const box=$('#opportunityList');if(!items.length){box.innerHTML='<div class="empty-state small">Henüz fırsat yok.</div>';return;}box.innerHTML=items.map(o=>`<div class="list-item"><strong>${escapeHtml(o.title||'Fırsat')}</strong><span>${money(o.net_amount)} ${o.start_time?`• ${escapeHtml(o.start_time)}-${escapeHtml(o.end_time||'')}`:''}</span></div>`).join('');}
function renderResult(data){const w=data.workflow||{},r=data.result||{};$('#intentBadge').textContent=w.intent?.primary_intent||'ROUTED';let html='<div class="result-block">';html+=`<div class="result-kpi"><span>Durum</span><strong>${escapeHtml(r.status||w.state||'-')}</strong></div>`;
  if(r.need)html+=`<div class="result-kpi"><span>İhtiyaç</span><strong>${escapeHtml(r.need.title||'Oluşturuldu')}</strong></div>`;
  if(Array.isArray(r.matches)){html+=`<div class="result-kpi"><span>Uygun eşleşme</span><strong>${r.matches.length}</strong></div>`;for(const m of r.matches.slice(0,5))html+=`<div class="list-item match"><strong>Match score: ${Math.round(Number(m.score||0)*100)}%</strong><span>${money(m.minimum_amount||r.need?.amount||0)} • ${Number(m.distance_km??0).toFixed(1)} km</span></div>`;}
  if(Array.isArray(r.opportunities)){html+=`<div class="result-kpi"><span>Bulunan fırsat</span><strong>${r.opportunities.length}</strong></div>`;renderOpportunities(r.opportunities);$('#earnSummary').textContent=money(r.projected_amount||0);}
  if(r.target_amount!==undefined){html+=`<div class="result-kpi"><span>Hedef</span><strong>${money(r.target_amount)}</strong></div><div class="result-kpi"><span>Planlanan kazanç</span><strong>${money(r.projected_amount)}</strong></div>`;renderOpportunities(r.selected||[]);$('#earnSummary').textContent=money(r.projected_amount||0);}
  html+='</div>';$('#resultBox').innerHTML=html;
}
function renderDashboard(d){const m=d.metrics||{};$('#metricNeeds').textContent=m.open_needs||0;$('#metricAvailability').textContent=m.availability_slots||0;$('#metricOpportunities').textContent=m.open_opportunities||0;$('#metricWorkflows').textContent=m.recent_workflows||0;
  const needs=d.needs||[];$('#needList').innerHTML=needs.length?needs.map(n=>`<div class="list-item"><strong>${escapeHtml(n.title||'İhtiyaç')}</strong><span>${escapeHtml(n.status||'OPEN')} ${n.amount?`• ${money(n.amount)}`:''}</span></div>`).join(''):'<div class="empty-state small">Henüz ihtiyaç yok.</div>';
  const wf=d.workflows||[];$('#recentActivity').innerHTML=wf.length?wf.map(x=>`<div class="list-item activity-intent"><div><strong>${escapeHtml(x.intent?.primary_intent||'WORKFLOW')}</strong><span>${escapeHtml(x.state||'-')}</span></div><em>${escapeHtml((x.created_at||'').slice(0,16).replace('T',' '))}</em></div>`).join(''):'<div class="empty-state small">Henüz hareket yok.</div>';
}
async function refreshDashboard(){if(!token)return;try{renderDashboard(await api('/v1/dashboard'));}catch(err){console.warn('dashboard',err.message);}}

$('#oneButtonForm').addEventListener('submit',async e=>{e.preventDefault();const btn=e.currentTarget.querySelector('button[type=submit]'),text=$('#oneText').value.trim();if(!text)return;btn.disabled=true;btn.textContent='ÇALIŞIYOR…';try{const out=await api('/v1/one-button',{method:'POST',body:{text,context:{max_distance_km:25,limit:10}}});renderResult(out);await refreshDashboard();}catch(err){$('#resultBox').innerHTML=`<div class="error">${escapeHtml(err.message)}</div>`;}finally{btn.disabled=false;btn.textContent='ÇÖZ';}});
$('#availabilityForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api(`/v1/users/${user.id}/availability`,{method:'POST',body:{start_time:f.get('start_time')||null,end_time:f.get('end_time')||null,minimum_amount:f.get('minimum_amount')?Number(f.get('minimum_amount')):null,max_distance_km:25}});$('#availabilityStatus').textContent='Müsaitlik kaydedildi.';await refreshDashboard();}catch(err){$('#availabilityStatus').textContent=err.message;}});

(async function boot(){renderSession();if(token){try{const me=await api('/v1/me');user=me.user;localStorage.setItem('py_user',JSON.stringify(user));renderSession();await refreshDashboard();}catch{clearSession();}}})();

// Mutual Match UI
let activeMatchType='RELATIONSHIP';
function csv(v){return String(v||'').split(',').map(x=>x.trim()).filter(Boolean);}
function matchTypeLabel(t){return ({RELATIONSHIP:'Relationship',BUSINESS:'Business',MENTOR:'Mentor',FRIEND:'Friend'})[t]||t;}
function renderMatches(items=[]){
  $('#matchCount').textContent=items.length;
  const box=$('#matchCards');
  if(!items.length){box.innerHTML='<div class="empty-state small">Bu kriterlerde henüz karşılıklı uygun eşleşme yok.</div>';return;}
  box.innerHTML=items.map(m=>`<article class="match-card">
    <div class="section-title"><div><div class="eyebrow">${escapeHtml(matchTypeLabel(m.type))}</div><div class="match-score">${Number(m.mutual_score||0)}% <small>mutual</small></div></div><span class="badge green">Eligible</span></div>
    <div class="match-meter"><span style="width:${Math.max(0,Math.min(100,Number(m.mutual_score||0)))}%"></span></div>
    <div class="match-meta"><span>Sen → aday: <strong>${Number(m.a_to_b||0)}%</strong></span><span>Aday → sen: <strong>${Number(m.b_to_a||0)}%</strong></span></div>
    <div class="match-card-actions"><button class="secondary" data-connect-profile="${escapeHtml(m.b_profile_id)}">Bağlantı isteği oluştur</button></div>
  </article>`).join('');
  box.querySelectorAll('[data-connect-profile]').forEach(btn=>btn.addEventListener('click',async()=>{
    btn.disabled=true;
    try{await api('/v1/mutual-match/connections',{method:'POST',body:{type:activeMatchType,other_profile_id:btn.dataset.connectProfile}});$('#matchStatus').textContent='Bağlantı oluşturuldu. İki tarafın da onayı gerekir.';await refreshConnections();}
    catch(err){$('#matchStatus').textContent=err.message;}
    finally{btn.disabled=false;}
  }));
}
async function refreshMatches(){
  if(!token)return;
  try{const out=await api(`/v1/mutual-match/matches?type=${encodeURIComponent(activeMatchType)}`);renderMatches(out.matches||[]);$('#matchStatus').textContent='';}
  catch(err){if(err.message==='MATCH_PROFILE_NOT_FOUND'){renderMatches([]);$('#matchStatus').textContent=`${matchTypeLabel(activeMatchType)} için önce profil oluştur.`;}else $('#matchStatus').textContent=err.message;}
}
function renderConnections(items=[]){
  const box=$('#connectionList');
  if(!items.length){box.innerHTML='<div class="empty-state small">Henüz bağlantı yok.</div>';return;}
  box.innerHTML=items.map(c=>{
    const mineApproved=c.user_a===user?.id?c.user_a_approved:c.user_b_approved;
    const otherApproved=c.user_a===user?.id?c.user_b_approved:c.user_a_approved;
    const cls=c.status==='MUTUALLY_APPROVED'?'connection-approved':'connection-pending';
    const action=!mineApproved?`<button class="secondary" data-approve-connection="${escapeHtml(c.id)}">Onayla</button>`:'';
    const privacy=c.contact_revealed?'İletişim paylaşımı açıldı':'İletişim bilgileri gizli';
    return `<div class="list-item ${cls}"><strong>${escapeHtml(matchTypeLabel(c.type))} • ${escapeHtml(c.status)}</strong><span>Sen: ${mineApproved?'Onaylı':'Bekliyor'} • Karşı taraf: ${otherApproved?'Onaylı':'Bekliyor'} • ${privacy}</span>${action}</div>`;
  }).join('');
  box.querySelectorAll('[data-approve-connection]').forEach(btn=>btn.addEventListener('click',async()=>{
    btn.disabled=true;try{await api(`/v1/mutual-match/connections/${encodeURIComponent(btn.dataset.approveConnection)}/approve`,{method:'POST'});await refreshConnections();}catch(err){$('#matchStatus').textContent=err.message;}finally{btn.disabled=false;}
  }));
}
async function refreshConnections(){if(!token)return;try{const out=await api('/v1/mutual-match/connections');renderConnections(out.connections||[]);}catch(err){console.warn('connections',err.message);}}

document.querySelectorAll('[data-match-type]').forEach(btn=>btn.addEventListener('click',async()=>{
  activeMatchType=btn.dataset.matchType;
  document.querySelectorAll('[data-match-type]').forEach(x=>x.classList.toggle('active',x===btn));
  $('#matchStatus').textContent='';
  await refreshMatches();
}));
$('#matchProfileForm').addEventListener('submit',async e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);
  const age=f.get('age')?Number(f.get('age')):null,ageMin=f.get('age_min')?Number(f.get('age_min')):null,ageMax=f.get('age_max')?Number(f.get('age_max')):null;
  const profile={city:f.get('city')||null,country:f.get('country')||null,age,languages:csv(f.get('languages')),interests:csv(f.get('interests')),skills:csv(f.get('interests')),goals:csv(f.get('goals'))};
  const criteria={age_min:ageMin,age_max:ageMax,city:f.get('city')||null,country:f.get('country')||null,languages:csv(f.get('languages')),interests:csv(f.get('interests')),goals:csv(f.get('goals'))};
  Object.keys(criteria).forEach(k=>{if(criteria[k]==null||(Array.isArray(criteria[k])&&!criteria[k].length)||criteria[k]==='')delete criteria[k];});
  try{await api('/v1/mutual-match/profile',{method:'POST',body:{type:activeMatchType,profile,criteria,opt_in:f.get('opt_in')==='on',discoverable:f.get('discoverable')==='on'}});$('#matchStatus').textContent='Profil kaydedildi. Karşılıklı uygunluk taranıyor…';await refreshMatches();await refreshConnections();}
  catch(err){$('#matchStatus').textContent=err.message;}
});

const originalRefreshDashboard=refreshDashboard;
refreshDashboard=async function(){await originalRefreshDashboard();if(token){await Promise.allSettled([refreshConnections(),refreshMatches()]);}};

// ProjeZZ Life Center UI
let currentLifeBudget={monthly_income:0,expenses:[]};
function expensePayload(f){return [
  {name:'Housing',category:'housing',amount:Number(f.get('housing')||0)},
  {name:'Transport',category:'transport',amount:Number(f.get('transport')||0)},
  {name:'Food',category:'food',amount:Number(f.get('food')||0)},
  {name:'Other',category:'other',amount:Number(f.get('other')||0)}
].filter(x=>x.amount>0);}
function renderDaily3(items=[]){
  $('#daily3Count').textContent=items.length;
  $('#daily3List').innerHTML=items.length?items.map((a,i)=>`<div class="list-item daily-action ${escapeHtml(a.type||'LIFE')}"><strong>${i+1}. ${escapeHtml(a.title)}</strong><span>${escapeHtml(a.reason)} • ${escapeHtml(a.action)}</span></div>`).join(''):'<div class="empty-state small">Henüz Daily 3 yok.</div>';
}
function renderLifeBudget(out){
  const b=out.budget||{};const bal=Number(b.balance||0);const sr=Number(b.savings_rate||0)*100;
  $('#lifeBalance').textContent=money(bal);$('#lifeSavings').textContent=`${sr.toFixed(1)}%`;$('#lifeBalanceStatus').textContent=b.status||'-';
  $('#lifeStatusBadge').textContent=b.status||'READY';$('#lifeBalance').classList.toggle('status-deficit',bal<0);$('#lifeBalance').classList.toggle('status-positive',bal>=0);renderDaily3(out.daily3||[]);
}
$('#lifeBudgetForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);currentLifeBudget={monthly_income:Number(f.get('monthly_income')||0),expenses:expensePayload(f)};try{const out=await api('/v1/life/budget',{method:'POST',body:currentLifeBudget});renderLifeBudget(out);}catch(err){$('#daily3List').innerHTML=`<div class="error">${escapeHtml(err.message)}</div>`;}});
$('#whatIfForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const out=await api('/v1/life/what-if',{method:'POST',body:{budget:currentLifeBudget,scenario:{monthly_income_delta:Number(f.get('income_delta')||0),monthly_expense_delta:Number(f.get('expense_delta')||0),one_time_cost:Number(f.get('one_time_cost')||0)}}});const r=out.simulation?.result||{};$('#whatIfResult').innerHTML=`<div class="result-kpi"><span>Yeni aylık denge</span><strong>${money(r.monthly_balance||0)}</strong></div><div class="result-kpi"><span>İlk ay</span><strong>${money(r.first_month_balance||0)}</strong></div><div class="result-kpi"><span>Değişim</span><strong>${money(r.monthly_change||0)}</strong></div>`;}catch(err){$('#whatIfResult').innerHTML=`<div class="error">${escapeHtml(err.message)}</div>`;}});
$('#fixMyDayBtn')?.addEventListener('click',async()=>{try{const out=await api('/v1/life/fix-my-day',{method:'POST',body:{budget:currentLifeBudget}});const items=out.plan?.actions||[];$('#fixMyDayList').innerHTML=items.length?items.map((a,i)=>`<div class="list-item daily-action ${escapeHtml(a.type||'LIFE')}"><strong>${i+1}. ${escapeHtml(a.title)}</strong><span>${escapeHtml(a.reason)}</span></div>`).join(''):'<div class="empty-state small">Aksiyon bulunamadı.</div>';}catch(err){$('#fixMyDayList').innerHTML=`<div class="error">${escapeHtml(err.message)}</div>`;}});
$('#cfoPreviewBtn')?.addEventListener('click',async()=>{try{const out=await api('/v1/admin/cfo',{method:'POST',body:{revenue:0,operating_costs:0,payouts:0,refunds:0,fraud_losses:0,tax_rate:.25,active_users:1}});const c=out.cfo||{};$('#cfoResult').innerHTML=`<div class="result-kpi"><span>Growth gate</span><strong>${escapeHtml(c.growth_gate)}</strong></div><div class="result-kpi"><span>Net margin</span><strong>${(Number(c.net_margin||0)*100).toFixed(1)}%</strong></div>`;}catch(err){$('#cfoResult').innerHTML=err.message==='FORBIDDEN'?'<div class="empty-state small">Bu kart yalnız IMPOCOR GROUP LLC admin hesabında canlı açılır.</div>':`<div class="error">${escapeHtml(err.message)}</div>`;}});
