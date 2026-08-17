const GEO_KEY='vovyyvov_geo_v1';
const SESSION_KEY='vovyyvov_supabase_session';
const geoState=JSON.parse(localStorage.getItem(GEO_KEY)||'{"lat":20,"lng":0,"radius":50,"located":false}');
if(!Number.isFinite(Number(geoState.radius)))geoState.radius=50;
const countryLang={US:'en',GB:'en',IE:'en',CA:'en',AU:'en',NZ:'en',TR:'tr',DE:'de',AT:'de',CH:'de',FR:'fr',BE:'fr',ES:'es',MX:'es',AR:'es',CO:'es',CL:'es',PE:'es',BR:'pt',PT:'pt',IT:'it',NL:'nl',PL:'pl',CZ:'cs',SK:'sk',HU:'hu',RO:'ro',BG:'bg',GR:'el',UA:'uk',RU:'ru',SE:'sv',NO:'no',DK:'da',FI:'fi',EE:'et',LV:'lv',LT:'lt',JP:'ja',KR:'ko',CN:'zh-CN',TW:'zh-TW',HK:'zh-TW',IN:'hi',PK:'ur',BD:'bn',ID:'id',MY:'ms',PH:'tl',TH:'th',VN:'vi',SA:'ar',AE:'ar',QA:'ar',KW:'ar',EG:'ar',MA:'ar',DZ:'ar',IL:'iw',IR:'fa',ZA:'en',NG:'en',KE:'en',TZ:'sw',ET:'am'};
function preferredLanguage(){return (navigator.languages?.[0]||navigator.language||'en').split('-')[0]||'en'}
function idle(fn,timeout=1500){if('requestIdleCallback'in window)requestIdleCallback(fn,{timeout});else setTimeout(fn,250)}
let autoLanguage=preferredLanguage();
window.googleTranslateElementInit=function(){new google.translate.TranslateElement({pageLanguage:'en',autoDisplay:false},'google_translate_element');applyLanguage(autoLanguage)};
function applyLanguage(lang){if(!lang||lang==='en')return;let tries=0;const timer=setInterval(()=>{const combo=document.querySelector('.goog-te-combo');if(combo&&[...combo.options].some(o=>o.value===lang)){combo.value=lang;combo.dispatchEvent(new Event('change'));clearInterval(timer)}else if(++tries>20)clearInterval(timer)},200)}
function loadTranslator(){const s=document.createElement('script');s.src='https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';s.async=true;s.defer=true;s.onerror=()=>{const el=document.getElementById('localeStatus');if(el)el.textContent='Automatic translation unavailable; browser language remains active.'};document.head.appendChild(s)}
async function detectCountryLanguage(lat,lng){try{const r=await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&localityLanguage=en`);if(!r.ok)return;const d=await r.json();const code=String(d.countryCode||'').toUpperCase();if(countryLang[code]){autoLanguage=countryLang[code];applyLanguage(autoLanguage)}const label=[d.locality,d.principalSubdivision,d.countryName].filter(Boolean).join(', ');const status=document.getElementById('mapStatus');if(status)status.textContent=label?`Search center: ${label} • showing opt-in activity around this point.`:'Search center updated.'}catch{}}
function installGeoFetchBridge(){const originalFetch=window.fetch.bind(window);window.fetch=async(input,init={})=>{try{const url=typeof input==='string'?input:input?.url||'';const method=String(init?.method||'GET').toUpperCase();const target=/\/rest\/v1\/(vovyyvov_needs|vovyyvov_availability|vovyyvov_money_missions)/.test(url);if(target&&method==='POST'&&geoState.located&&typeof init.body==='string'){const body=JSON.parse(init.body);body.latitude=Number(geoState.lat);body.longitude=Number(geoState.lng);body.search_radius_miles=Number(geoState.radius||50);init={...init,body:JSON.stringify(body)}}}catch{}return originalFetch(input,init)}}
function initMap(){
  if(!window.L)return;
  document.querySelector('#worldMap .map-loading')?.remove();
  const renderer=L.canvas({padding:.25});
  const map=L.map('worldMap',{worldCopyJump:true,minZoom:1,maxZoom:19,preferCanvas:true,renderer,fadeAnimation:false,markerZoomAnimation:false,zoomAnimation:true}).setView([Number(geoState.lat),Number(geoState.lng)],geoState.located?10:1);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,minZoom:1,attribution:'© OpenStreetMap contributors',detectRetina:false,keepBuffer:1,updateWhenIdle:true,updateWhenZooming:false,crossOrigin:true}).addTo(map);
  const centerMarker=L.circleMarker([Number(geoState.lat),Number(geoState.lng)],{radius:7,weight:3,color:'#111827',fillColor:'#111827',fillOpacity:.95,renderer}).addTo(map);
  const radiusCircle=L.circle([Number(geoState.lat),Number(geoState.lng)],{radius:Number(geoState.radius||50)*1609.344,weight:2,color:'#111827',fillOpacity:.05,renderer}).addTo(map);
  let userMarker=null;
  const value=document.getElementById('radiusValue'),slider=document.getElementById('radiusSlider'),status=document.getElementById('mapStatus');
  if(slider)slider.value=String(geoState.radius||50);if(value)value.textContent=`${geoState.radius||50} mi`;
  function emitGeo(){window.KREVUNO_GEO_STATE=geoState;const detail={...geoState};window.dispatchEvent(new CustomEvent('vovyyvov:geo-change',{detail}));window.dispatchEvent(new CustomEvent('krevuno:geo-change',{detail}))}
  function setRadius(v,emit=true){geoState.radius=Math.max(5,Math.min(100,Number(v)||50));if(value)value.textContent=`${geoState.radius} mi`;if(slider)slider.value=String(geoState.radius);radiusCircle.setRadius(geoState.radius*1609.344);localStorage.setItem(GEO_KEY,JSON.stringify(geoState));if(emit)emitGeo()}
  function saveCenter(lat,lng,located=true){geoState.lat=Number(lat);geoState.lng=Number(lng);geoState.located=located;localStorage.setItem(GEO_KEY,JSON.stringify(geoState));centerMarker.setLatLng([geoState.lat,geoState.lng]);radiusCircle.setLatLng([geoState.lat,geoState.lng]);emitGeo()}
  slider?.addEventListener('input',e=>setRadius(e.target.value));
  map.on('click',e=>{setRadius(50,false);saveCenter(e.latlng.lat,e.latlng.lng,true);if(status)status.textContent='Map point selected • showing opt-in KREVUNO activity within 50 miles.';detectCountryLanguage(e.latlng.lat,e.latlng.lng)});
  document.getElementById('locateBtn')?.addEventListener('click',()=>{if(!navigator.geolocation){if(status)status.textContent='Location is not supported in this browser.';return}if(status)status.textContent='Requesting your location…';navigator.geolocation.getCurrentPosition(p=>{const {latitude,longitude}=p.coords;setRadius(50,false);saveCenter(latitude,longitude,true);if(userMarker)userMarker.setLatLng([latitude,longitude]);else userMarker=L.circleMarker([latitude,longitude],{radius:9,weight:3,color:'#15803d',fillColor:'#22c55e',fillOpacity:.95,renderer}).bindTooltip('Your location — visible only on your screen').addTo(map);map.setView([latitude,longitude],11,{animate:false});if(status)status.textContent='Your location selected • showing opt-in KREVUNO activity within 50 miles.';detectCountryLanguage(latitude,longitude)},()=>{if(status)status.textContent='Location permission was not granted. Click the map to choose a search center instead.'},{enableHighAccuracy:false,timeout:7000,maximumAge:300000})});
  document.getElementById('worldBtn')?.addEventListener('click',()=>map.setView([20,0],1,{animate:false}));
  window.KREVUNO_MAP=map;window.KREVUNO_MAP_RENDERER=renderer;window.KREVUNO_GEO_STATE=geoState;
  window.dispatchEvent(new CustomEvent('krevuno:map-ready',{detail:{map,renderer,geo:{...geoState}}}));
  if(geoState.located)idle(()=>{detectCountryLanguage(geoState.lat,geoState.lng);emitGeo()},700);
  const density=document.getElementById('densityStatus');if(density)density.textContent=geoState.located?'Loading nearby KREVUNO activity…':'Click anywhere on the map or use your location. Red = hiring/needs, blue = people available to work.';
  requestAnimationFrame(()=>map.invalidateSize({animate:false}));
}
installGeoFetchBridge();
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initMap,{once:true});else initMap();
idle(loadTranslator,1800);
