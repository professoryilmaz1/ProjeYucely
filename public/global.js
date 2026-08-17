const GEO_KEY='vovyyvov_geo_v1';
const SESSION_KEY='vovyyvov_supabase_session';
const SUPABASE_URL='https://hfqjiehsdqwqeivcqfzg.supabase.co';
const SUPABASE_KEY='sb_publishable_GQLUsMvxJ4-TgdxtAD3WXw_aKpp5Qm2';
const geoState=JSON.parse(localStorage.getItem(GEO_KEY)||'{"lat":20,"lng":0,"radius":25,"located":false}');
const countryLang={US:'en',GB:'en',IE:'en',CA:'en',AU:'en',NZ:'en',TR:'tr',DE:'de',AT:'de',CH:'de',FR:'fr',BE:'fr',ES:'es',MX:'es',AR:'es',CO:'es',CL:'es',PE:'es',BR:'pt',PT:'pt',IT:'it',NL:'nl',PL:'pl',CZ:'cs',SK:'sk',HU:'hu',RO:'ro',BG:'bg',GR:'el',UA:'uk',RU:'ru',SE:'sv',NO:'no',DK:'da',FI:'fi',EE:'et',LV:'lv',LT:'lt',JP:'ja',KR:'ko',CN:'zh-CN',TW:'zh-TW',HK:'zh-TW',IN:'hi',PK:'ur',BD:'bn',ID:'id',MY:'ms',PH:'tl',TH:'th',VN:'vi',SA:'ar',AE:'ar',QA:'ar',KW:'ar',EG:'ar',MA:'ar',DZ:'ar',IL:'iw',IR:'fa',ZA:'en',NG:'en',KE:'en',TZ:'sw',ET:'am'};
function preferredLanguage(){return (navigator.languages?.[0]||navigator.language||'en').split('-')[0]||'en'}
function session(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
function idle(fn,timeout=1500){if('requestIdleCallback'in window)requestIdleCallback(fn,{timeout});else setTimeout(fn,250)}
let autoLanguage=preferredLanguage();
window.googleTranslateElementInit=function(){new google.translate.TranslateElement({pageLanguage:'en',autoDisplay:false},'google_translate_element');applyLanguage(autoLanguage)};
function applyLanguage(lang){if(!lang||lang==='en')return;let tries=0;const timer=setInterval(()=>{const combo=document.querySelector('.goog-te-combo');if(combo&&[...combo.options].some(o=>o.value===lang)){combo.value=lang;combo.dispatchEvent(new Event('change'));clearInterval(timer)}else if(++tries>20)clearInterval(timer)},200)}
function loadTranslator(){const s=document.createElement('script');s.src='https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';s.async=true;s.defer=true;s.onerror=()=>{const el=document.getElementById('localeStatus');if(el)el.textContent='Automatic translation unavailable; browser language remains active.'};document.head.appendChild(s)}
async function detectCountryLanguage(lat,lng){try{const r=await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&localityLanguage=en`);if(!r.ok)return;const d=await r.json();const code=String(d.countryCode||'').toUpperCase();if(countryLang[code]){autoLanguage=countryLang[code];applyLanguage(autoLanguage)}const label=[d.locality,d.principalSubdivision,d.countryName].filter(Boolean).join(', ');const status=document.getElementById('mapStatus');if(status)status.textContent=label?`Search center: ${label}`:'Search center updated.'}catch{}}
function installGeoFetchBridge(){const originalFetch=window.fetch.bind(window);window.fetch=async(input,init={})=>{try{const url=typeof input==='string'?input:input?.url||'';const method=String(init?.method||'GET').toUpperCase();const target=/\/rest\/v1\/(vovyyvov_needs|vovyyvov_availability|vovyyvov_money_missions)/.test(url);if(target&&method==='POST'&&geoState.located&&typeof init.body==='string'){const body=JSON.parse(init.body);body.latitude=Number(geoState.lat);body.longitude=Number(geoState.lng);body.search_radius_miles=Number(geoState.radius);init={...init,body:JSON.stringify(body)}}}catch{}return originalFetch(input,init)}}
function initMap(){
  if(!window.L)return;
  document.querySelector('#worldMap .map-loading')?.remove();
  const renderer=L.canvas({padding:.25});
  const map=L.map('worldMap',{worldCopyJump:true,minZoom:1,maxZoom:19,preferCanvas:true,renderer,fadeAnimation:false,markerZoomAnimation:false,zoomAnimation:true}).setView([geoState.lat,geoState.lng],geoState.located?10:1);
  const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,minZoom:1,attribution:'© OpenStreetMap contributors',detectRetina:false,keepBuffer:1,updateWhenIdle:true,updateWhenZooming:false,crossOrigin:true}).addTo(map);
  let centerMarker=L.circleMarker([geoState.lat,geoState.lng],{radius:7,weight:3,fillOpacity:1,renderer}).addTo(map);
  let radiusCircle=L.circle([geoState.lat,geoState.lng],{radius:geoState.radius*1609.344,weight:2,fillOpacity:.07,renderer}).addTo(map);
  const value=document.getElementById('radiusValue'),slider=document.getElementById('radiusSlider'),status=document.getElementById('mapStatus');
  if(slider)slider.value=geoState.radius;if(value)value.textContent=`${geoState.radius} mi`;
  function emitGeo(){const detail={...geoState};window.dispatchEvent(new CustomEvent('vovyyvov:geo-change',{detail}));window.dispatchEvent(new CustomEvent('krevuno:geo-change',{detail}))}
  function saveCenter(lat,lng,located=true){geoState.lat=lat;geoState.lng=lng;geoState.located=located;localStorage.setItem(GEO_KEY,JSON.stringify(geoState));centerMarker.setLatLng([lat,lng]);radiusCircle.setLatLng([lat,lng]);emitGeo()}
  function setRadius(v){geoState.radius=Math.max(5,Math.min(500,Number(v)||25));if(value)value.textContent=`${geoState.radius} mi`;radiusCircle.setRadius(geoState.radius*1609.344);localStorage.setItem(GEO_KEY,JSON.stringify(geoState));emitGeo()}
  slider?.addEventListener('input',e=>setRadius(e.target.value));
  map.on('click',e=>{saveCenter(e.latlng.lat,e.latlng.lng,true);detectCountryLanguage(e.latlng.lat,e.latlng.lng)});
  document.getElementById('locateBtn')?.addEventListener('click',()=>{if(!navigator.geolocation){if(status)status.textContent='Location is not supported in this browser.';return}if(status)status.textContent='Requesting your location…';navigator.geolocation.getCurrentPosition(p=>{const {latitude,longitude}=p.coords;saveCenter(latitude,longitude,true);map.setView([latitude,longitude],12,{animate:false});detectCountryLanguage(latitude,longitude)},()=>{if(status)status.textContent='Location permission was not granted. Click the map to choose a search center.'},{enableHighAccuracy:false,timeout:6000,maximumAge:600000})});
  document.getElementById('worldBtn')?.addEventListener('click',()=>map.setView([20,0],1,{animate:false}));
  let activityScheduled=false;const scheduleActivity=()=>{if(activityScheduled)return;activityScheduled=true;idle(()=>loadActivity(map,renderer),1200)};
  tiles.once('load',scheduleActivity);setTimeout(scheduleActivity,1200);
  if(geoState.located)idle(()=>detectCountryLanguage(geoState.lat,geoState.lng),1200);
  requestAnimationFrame(()=>map.invalidateSize({animate:false}));
}
async function loadActivity(map,renderer){
  const status=document.getElementById('densityStatus');const s=session();
  if(!s?.access_token){if(status)status.textContent='Sign in to view live opt-in KREVUNO marketplace activity. The world map itself is ready.';return}
  try{
    if(status)status.textContent='Loading live opt-in marketplace activity…';
    const r=await fetch(`${SUPABASE_URL}/rest/v1/vovyyvov_opportunities?select=id,title,city,latitude,longitude,status,remote,kind&status=eq.OPEN&limit=250`,{headers:{apikey:SUPABASE_KEY,authorization:`Bearer ${s.access_token}`}});
    if(!r.ok)throw new Error(`HTTP_${r.status}`);const rows=await r.json();let count=0;const layer=L.layerGroup().addTo(map);
    for(const o of rows){const lat=Number(o.latitude),lng=Number(o.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;L.circleMarker([lat,lng],{radius:7,weight:1,fillOpacity:.32,renderer}).bindTooltip(o.city||o.title||'KREVUNO activity').addTo(layer);count++}
    if(status)status.textContent=count?`${count} opt-in KREVUNO opportunity locations visible. Zoom in to explore nearby activity.`:'No live opt-in opportunity locations yet. KREVUNO will populate the map as real location-enabled activity is posted.';
  }catch{if(status)status.textContent='Live activity could not be loaded right now. The map and search-center controls remain available.'}
}
installGeoFetchBridge();
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initMap,{once:true});else initMap();
idle(loadTranslator,1800);
