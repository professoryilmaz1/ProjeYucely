const AGENT_KEY='krevuno_agent_v1';
const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;

export function detectIntent(text=''){
  const t=String(text).toLowerCase();
  if(/\b(need|help|hire|worker|someone|lazım|yardım|eleman|ihtiyacım)\b/.test(t))return 'NEED_HELP';
  if(/\b(earn|job|work|income|money|para|kazan|iş|çalış|shift|gig|remote)\b/.test(t)||/\$\s*\d/.test(t))return 'EARN';
  if(/\b(save|budget|expense|spend|tasarruf|bütçe|harcama)\b/.test(t))return 'MONEY';
  if(/\b(match|partner|mentor|friend|eş|arkadaş|ortak)\b/.test(t))return 'MATCH';
  return 'PLAN';
}

export function extractAmount(text=''){
  const m=String(text).replace(/,/g,'').match(/(?:\$|usd\s*)?(\d+(?:\.\d{1,2})?)/i);
  return m?Number(m[1]):null;
}

export function buildAgentReply(text,context={}){
  const intent=detectIntent(text), amount=extractAmount(text);
  const radius=context.radius||25;
  if(intent==='EARN')return amount?`I’ll look for earning opportunities that can help toward $${amount}, prioritizing your selected area and availability.`:'I’ll look for earning opportunities that fit your skills, time and location.';
  if(intent==='NEED_HELP')return `I’ll turn that into a clear need and help you find suitable nearby options within ${radius} miles.`;
  if(intent==='MONEY')return 'I’ll turn the goal into practical money actions using your budget and real opportunities when available.';
  if(intent==='MATCH')return 'I’ll use mutual opt-in and compatibility signals while keeping private contact information protected until both sides approve.';
  return 'Tell me the outcome you want, when you need it, and where. I’ll turn it into the next practical action.';
}

function style(){if(document.getElementById('krevuno-agent-style'))return;const s=document.createElement('style');s.id='krevuno-agent-style';s.textContent=`#krevunoAgent{position:fixed;right:18px;bottom:18px;z-index:9999;font-family:inherit}#krevunoAgent .ka-toggle{border:0;border-radius:999px;padding:13px 18px;font-weight:700;cursor:pointer;box-shadow:0 8px 30px rgba(0,0,0,.22)}#krevunoAgent .ka-panel{display:none;width:min(390px,calc(100vw - 28px));margin-bottom:10px;padding:16px;border-radius:18px;background:#fff;box-shadow:0 14px 45px rgba(0,0,0,.25);border:1px solid rgba(15,23,42,.12)}#krevunoAgent.open .ka-panel{display:block}#krevunoAgent .ka-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}#krevunoAgent button{cursor:pointer}#krevunoAgent .ka-input{width:100%;min-height:76px;resize:vertical;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:10px}#krevunoAgent .ka-result{margin-top:10px;padding:10px;border-radius:10px;background:#f8fafc;min-height:42px}#krevunoAgent .ka-status{font-size:.82rem;opacity:.72;margin-top:7px}#krevunoAgent .ka-media{display:none}`;document.head.appendChild(s)}

function speak(text){if(!('speechSynthesis'in window))return false;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang=(navigator.language||'en-US');u.rate=.98;window.speechSynthesis.speak(u);return true}

function submitToCore(text){const input=document.getElementById('oneText');if(input){input.value=text;document.getElementById('oneForm')?.requestSubmit();return true}return false}

function createUI(){style();const root=document.createElement('div');root.id='krevunoAgent';root.innerHTML=`<div class="ka-panel" aria-live="polite"><strong>KREVUNO AI</strong><div class="ka-status" id="kaStatus">Talk, type, or attach a photo/video.</div><textarea id="kaInput" class="ka-input" placeholder="Example: I need a driver tomorrow from 2–5 PM"></textarea><div class="ka-row"><button id="kaSend" type="button">Send</button><button id="kaVoice" type="button">🎤 Speak</button><button id="kaListen" type="button">🔊 Answer aloud</button><label><button id="kaMediaBtn" type="button">📷 Photo / Video</button><input id="kaMedia" class="ka-media" type="file" accept="image/*,video/*" capture="environment"></label></div><div id="kaResult" class="ka-result">Ready.</div></div><button class="ka-toggle" id="kaToggle" type="button">KREVUNO AI</button>`;document.body.appendChild(root);return root}

function install(){if(document.getElementById('krevunoAgent'))return;const root=createUI(),input=root.querySelector('#kaInput'),result=root.querySelector('#kaResult'),status=root.querySelector('#kaStatus');let lastReply='Ready.';let recognition=null;
  root.querySelector('#kaToggle').addEventListener('click',()=>root.classList.toggle('open'));
  function process(text){text=String(text||'').trim();if(!text)return;input.value=text;const reply=buildAgentReply(text,{radius:Number(localStorage.getItem('krevuno_radius')||25)});lastReply=reply;result.textContent=reply;submitToCore(text);status.textContent=`Intent: ${detectIntent(text)}`}
  root.querySelector('#kaSend').addEventListener('click',()=>process(input.value));
  input.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();process(input.value)}});
  root.querySelector('#kaListen').addEventListener('click',()=>speak(lastReply));
  root.querySelector('#kaVoice').addEventListener('click',()=>{if(!SpeechRecognition){status.textContent='Voice input is not supported in this browser. Text mode remains available.';return}if(recognition){recognition.stop();recognition=null;return}recognition=new SpeechRecognition();recognition.continuous=false;recognition.interimResults=true;recognition.lang=navigator.language||'en-US';status.textContent='Listening…';recognition.onresult=e=>{let final='';for(let i=e.resultIndex;i<e.results.length;i++)final+=e.results[i][0].transcript;if(e.results[e.results.length-1].isFinal){input.value=final;process(final)}};recognition.onerror=e=>{status.textContent=`Voice input: ${e.error}`;recognition=null};recognition.onend=()=>{if(recognition){recognition=null;if(status.textContent==='Listening…')status.textContent='Ready.'}};recognition.start()});
  root.querySelector('#kaMediaBtn').addEventListener('click',()=>root.querySelector('#kaMedia').click());
  root.querySelector('#kaMedia').addEventListener('change',e=>{const file=e.target.files?.[0];if(!file)return;const kind=file.type.startsWith('video/')?'video':'image';status.textContent=`${kind} attached: ${file.name}`;result.textContent=`${kind==='video'?'Video':'Photo'} is ready. Add what you want KREVUNO to do with it, then press Send.`;input.focus()});
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
