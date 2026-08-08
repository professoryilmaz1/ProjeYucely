import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

function nowIso() { return new Date().toISOString(); }
function normalizeUser(input = {}) {
  return {
    id: input.id ?? randomUUID(), display_name: input.display_name ?? null,
    email: input.email ?? null, locale: input.locale ?? 'en-US', country: input.country ?? null,
    city: input.city ?? null, skills: Array.isArray(input.skills) ? input.skills : [],
    trust_score: Number.isFinite(input.trust_score) ? input.trust_score : 0.75,
    created_at: input.created_at ?? nowIso(), updated_at: nowIso(),
  };
}

export class MemoryStore {
  constructor() { this.users=new Map(); this.availability=new Map(); this.needs=new Map(); this.opportunities=new Map(); this.credentials=new Map(); this.sessions=new Map(); this.audit=[]; this.oneButtonRequests=new Map(); this.workflows=new Map(); this.agentTasks=new Map(); this.externalSignals=[]; this.feedback=[]; this.featureEvents=[]; this.matchProfiles=new Map(); this.matchConnections=new Map(); }
  createUser(input={}) { const u=normalizeUser(input); this.users.set(u.id,u); return u; }
  getUser(id){return this.users.get(id)??null;} listUsers(){return [...this.users.values()];}
  findUserByEmail(email){return [...this.users.values()].find(u=>u.email?.toLowerCase()===String(email).toLowerCase())??null;}
  saveCredential(userId, passwordHash){this.credentials.set(userId,passwordHash);} getCredential(userId){return this.credentials.get(userId)??null;}
  saveSession(tokenHash,userId,expiresAt){this.sessions.set(tokenHash,{user_id:userId,expires_at:expiresAt});}
  getSession(tokenHash){return this.sessions.get(tokenHash)??null;} deleteSession(tokenHash){this.sessions.delete(tokenHash);}
  appendAudit(event){const r={id:randomUUID(),created_at:nowIso(),...event}; this.audit.push(r); return r;} listAudit(limit=100){return this.audit.slice(-limit).reverse();}
  createOneButtonRequest(userId,input={}){if(!this.users.has(userId))throw new Error('USER_NOT_FOUND');const r={id:randomUUID(),user_id:userId,text:String(input.text??''),context:input.context??{},created_at:nowIso()};this.oneButtonRequests.set(r.id,r);return r;}
  saveWorkflow(w){this.workflows.set(w.id,{...w});return w;} updateWorkflowState(id,state,result_status=null){const w=this.workflows.get(id);if(!w)return null;const n={...w,state,result_status,updated_at:nowIso()};this.workflows.set(id,n);return n;}
  upsertAvailability(userId,input={}){if(!this.users.has(userId))throw new Error('USER_NOT_FOUND');const r={id:input.id??randomUUID(),user_id:userId,date:input.date??null,start_time:input.start_time??null,end_time:input.end_time??null,max_distance_km:input.max_distance_km??25,minimum_amount:input.minimum_amount??null,distance_km:input.distance_km??null,created_at:nowIso(),updated_at:nowIso()};if(!this.availability.has(userId))this.availability.set(userId,[]);this.availability.get(userId).push(r);return r;}
  listAvailability(userId){return [...(this.availability.get(userId)??[])];}
  createNeed(userId,input={}){if(!this.users.has(userId))throw new Error('USER_NOT_FOUND');const n={id:input.id??randomUUID(),requester_id:userId,title:input.title??null,date:input.date??null,start_time:input.start_time??null,end_time:input.end_time??null,duration_hours:input.duration_hours??null,amount:input.amount??null,required_skills:Array.isArray(input.required_skills)?input.required_skills:[],max_distance_km:input.max_distance_km??25,status:input.status??'OPEN',created_at:nowIso(),updated_at:nowIso()};this.needs.set(n.id,n);return n;}
  getNeed(id){return this.needs.get(id)??null;} listOpenNeeds(){return [...this.needs.values()].filter(x=>x.status==='OPEN');}
  listUserNeeds(userId,limit=20){return [...this.needs.values()].filter(x=>x.requester_id===userId).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,limit);}
  createOpportunity(ownerId,input={}){if(!this.users.has(ownerId))throw new Error('USER_NOT_FOUND');const o={id:input.id??randomUUID(),owner_id:ownerId,title:input.title??null,date:input.date??null,start_time:input.start_time??null,end_time:input.end_time??null,gross_amount:Number(input.gross_amount??input.net_amount??0),net_amount:Number(input.net_amount??input.gross_amount??0),skills:Array.isArray(input.skills)?input.skills:[],distance_km:input.distance_km??null,status:input.status??'OPEN',created_at:nowIso(),updated_at:nowIso()};this.opportunities.set(o.id,o);return o;}
  listOpenOpportunities(){return [...this.opportunities.values()].filter(x=>x.status==='OPEN');}
  listUserOpportunities(userId,limit=20){return [...this.opportunities.values()].filter(x=>x.owner_id===userId).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,limit);}
  listUserWorkflows(userId,limit=20){return [...this.workflows.values()].filter(x=>x.user_id===userId).sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||'')).slice(0,limit);}
  saveAgentTask(task){this.agentTasks.set(task.id,{...task});return this.agentTasks.get(task.id);}
  getAgentTask(id){return this.agentTasks.get(id)??null;}
  updateAgentTask(id,patch={}){const t=this.agentTasks.get(id);if(!t)return null;const n={...t,...patch,updated_at:nowIso()};this.agentTasks.set(id,n);return n;}
  listUserAgentTasks(userId,limit=20){return [...this.agentTasks.values()].filter(x=>x.user_id===userId).sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||'')).slice(0,limit);}


  saveMatchProfile(profile){this.matchProfiles.set(profile.id,{...profile});return this.matchProfiles.get(profile.id);}
  getMatchProfile(id){return this.matchProfiles.get(id)??null;}
  getUserMatchProfile(userId,type){return [...this.matchProfiles.values()].find(x=>x.user_id===userId&&x.type===type&&x.status==='ACTIVE')??null;}
  listMatchProfiles(type=null){return [...this.matchProfiles.values()].filter(x=>!type||x.type===type);}
  saveMatchConnection(c){this.matchConnections.set(c.id,{...c});return this.matchConnections.get(c.id);}
  getMatchConnection(id){return this.matchConnections.get(id)??null;}
  listUserMatchConnections(userId){return [...this.matchConnections.values()].filter(x=>x.user_a===userId||x.user_b===userId);}

  addExternalSignal(input={}){const r={id:randomUUID(),source:input.source??'manual',source_ref:input.source_ref??null,text:String(input.text??''),country:input.country??null,language:input.language??null,intent:input.intent??null,topic:input.topic??null,severity:Number(input.severity??2),metadata:input.metadata??{},created_at:input.created_at??nowIso()};this.externalSignals.push(r);return r;}
  listExternalSignals(limit=500){return this.externalSignals.slice(-limit).reverse();}
  addFeedback(input={}){const r={id:randomUUID(),user_id:input.user_id??null,source:input.source??'in_app',text:String(input.text??''),country:input.country??null,severity:Number(input.severity??2),metadata:input.metadata??{},created_at:input.created_at??nowIso()};this.feedback.push(r);return r;}
  listFeedback(limit=2000){return this.feedback.slice(-limit).reverse();}
  addFeatureEvent(input={}){const r={id:randomUUID(),user_id:input.user_id??null,feature:String(input.feature??'UNKNOWN'),status:String(input.status??'SUCCESS'),revenue:Number(input.revenue??0),cost:Number(input.cost??0),metadata:input.metadata??{},created_at:input.created_at??nowIso()};this.featureEvents.push(r);return r;}
  listFeatureEvents(limit=5000){return this.featureEvents.slice(-limit).reverse();}
}

export class SQLiteStore {
  constructor(path='projeyucely.db') { this.db=new DatabaseSync(path); this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,display_name TEXT,email TEXT UNIQUE,locale TEXT,country TEXT,city TEXT,skills TEXT,trust_score REAL,created_at TEXT,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS credentials(user_id TEXT PRIMARY KEY,password_hash TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS availability(id TEXT PRIMARY KEY,user_id TEXT,date TEXT,start_time TEXT,end_time TEXT,max_distance_km REAL,minimum_amount REAL,distance_km REAL,created_at TEXT,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS needs(id TEXT PRIMARY KEY,requester_id TEXT,title TEXT,date TEXT,start_time TEXT,end_time TEXT,duration_hours REAL,amount REAL,required_skills TEXT,max_distance_km REAL,status TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS opportunities(id TEXT PRIMARY KEY,owner_id TEXT,title TEXT,date TEXT,start_time TEXT,end_time TEXT,gross_amount REAL,net_amount REAL,skills TEXT,distance_km REAL,status TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS audit_log(id TEXT PRIMARY KEY,actor_id TEXT,action TEXT,resource_type TEXT,resource_id TEXT,ip TEXT,metadata TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS one_button_requests(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,text TEXT NOT NULL,context TEXT,created_at TEXT,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY,request_id TEXT,user_id TEXT,intent TEXT,policy TEXT,state TEXT,next_action TEXT,result_status TEXT,created_at TEXT,updated_at TEXT,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS agent_tasks(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,action TEXT NOT NULL,payload TEXT,context TEXT,policy TEXT,status TEXT,result TEXT,created_at TEXT,updated_at TEXT,completed_at TEXT,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS external_signals(id TEXT PRIMARY KEY,source TEXT,source_ref TEXT,text TEXT,country TEXT,language TEXT,intent TEXT,topic TEXT,severity REAL,metadata TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY,user_id TEXT,source TEXT,text TEXT,country TEXT,severity REAL,metadata TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS feature_events(id TEXT PRIMARY KEY,user_id TEXT,feature TEXT,status TEXT,revenue REAL,cost REAL,metadata TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS match_profiles(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,type TEXT NOT NULL,profile TEXT,criteria TEXT,opt_in INTEGER,discoverable INTEGER,status TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS match_connections(id TEXT PRIMARY KEY,match_id TEXT,type TEXT,user_a TEXT,user_b TEXT,user_a_approved INTEGER,user_b_approved INTEGER,status TEXT,contact_revealed INTEGER,created_at TEXT,updated_at TEXT);
  `); }
  _user(r){return r?{...r,skills:JSON.parse(r.skills||'[]')}:null;}
  createUser(input={}){const u=normalizeUser(input);this.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?,?)').run(u.id,u.display_name,u.email,u.locale,u.country,u.city,JSON.stringify(u.skills),u.trust_score,u.created_at,u.updated_at);return u;}
  getUser(id){return this._user(this.db.prepare('SELECT * FROM users WHERE id=?').get(id));} listUsers(){return this.db.prepare('SELECT * FROM users').all().map(r=>this._user(r));}
  findUserByEmail(email){return this._user(this.db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(email));}
  saveCredential(userId,h){this.db.prepare('INSERT OR REPLACE INTO credentials VALUES(?,?)').run(userId,h);} getCredential(userId){return this.db.prepare('SELECT password_hash FROM credentials WHERE user_id=?').get(userId)?.password_hash??null;}
  saveSession(h,userId,exp){this.db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?)').run(h,userId,exp);} getSession(h){return this.db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(h)??null;} deleteSession(h){this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(h);}
  appendAudit(e){const r={id:randomUUID(),created_at:nowIso(),...e};this.db.prepare('INSERT INTO audit_log VALUES(?,?,?,?,?,?,?,?)').run(r.id,r.actor_id??null,r.action??null,r.resource_type??null,r.resource_id??null,r.ip??null,JSON.stringify(r.metadata??{}),r.created_at);return r;}
  createOneButtonRequest(userId,input={}){if(!this.getUser(userId))throw new Error('USER_NOT_FOUND');const r={id:randomUUID(),user_id:userId,text:String(input.text??''),context:input.context??{},created_at:nowIso()};this.db.prepare('INSERT INTO one_button_requests VALUES(?,?,?,?,?)').run(r.id,r.user_id,r.text,JSON.stringify(r.context),r.created_at);return r;}
  saveWorkflow(w){this.db.prepare('INSERT OR REPLACE INTO workflows(id,request_id,user_id,intent,policy,state,next_action,result_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(w.id,w.request_id,w.user_id,JSON.stringify(w.intent),JSON.stringify(w.policy),w.state,w.next_action,null,w.created_at,w.created_at);return w;}
  updateWorkflowState(id,state,result_status=null){this.db.prepare('UPDATE workflows SET state=?,result_status=?,updated_at=? WHERE id=?').run(state,result_status,nowIso(),id);return this.db.prepare('SELECT * FROM workflows WHERE id=?').get(id)??null;}
  listAudit(limit=100){return this.db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').all(limit).map(r=>({...r,metadata:JSON.parse(r.metadata||'{}')}));}
  upsertAvailability(userId,input={}){if(!this.getUser(userId))throw new Error('USER_NOT_FOUND');const r={id:input.id??randomUUID(),user_id:userId,date:input.date??null,start_time:input.start_time??null,end_time:input.end_time??null,max_distance_km:input.max_distance_km??25,minimum_amount:input.minimum_amount??null,distance_km:input.distance_km??null,created_at:nowIso(),updated_at:nowIso()};this.db.prepare('INSERT INTO availability VALUES(?,?,?,?,?,?,?,?,?,?)').run(...Object.values(r));return r;}
  listAvailability(userId){return this.db.prepare('SELECT * FROM availability WHERE user_id=?').all(userId);}
  createNeed(userId,input={}){if(!this.getUser(userId))throw new Error('USER_NOT_FOUND');const n={id:input.id??randomUUID(),requester_id:userId,title:input.title??null,date:input.date??null,start_time:input.start_time??null,end_time:input.end_time??null,duration_hours:input.duration_hours??null,amount:input.amount??null,required_skills:Array.isArray(input.required_skills)?input.required_skills:[],max_distance_km:input.max_distance_km??25,status:input.status??'OPEN',created_at:nowIso(),updated_at:nowIso()};this.db.prepare('INSERT INTO needs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(n.id,n.requester_id,n.title,n.date,n.start_time,n.end_time,n.duration_hours,n.amount,JSON.stringify(n.required_skills),n.max_distance_km,n.status,n.created_at,n.updated_at);return n;}
  _need(r){return r?{...r,required_skills:JSON.parse(r.required_skills||'[]')}:null;} getNeed(id){return this._need(this.db.prepare('SELECT * FROM needs WHERE id=?').get(id));} listOpenNeeds(){return this.db.prepare("SELECT * FROM needs WHERE status='OPEN'").all().map(r=>this._need(r));}
  listUserNeeds(userId,limit=20){return this.db.prepare('SELECT * FROM needs WHERE requester_id=? ORDER BY created_at DESC LIMIT ?').all(userId,limit).map(r=>this._need(r));}
  createOpportunity(ownerId,input={}){if(!this.getUser(ownerId))throw new Error('USER_NOT_FOUND');const o={id:input.id??randomUUID(),owner_id:ownerId,title:input.title??null,date:input.date??null,start_time:input.start_time??null,end_time:input.end_time??null,gross_amount:Number(input.gross_amount??input.net_amount??0),net_amount:Number(input.net_amount??input.gross_amount??0),skills:Array.isArray(input.skills)?input.skills:[],distance_km:input.distance_km??null,status:input.status??'OPEN',created_at:nowIso(),updated_at:nowIso()};this.db.prepare('INSERT INTO opportunities VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(o.id,o.owner_id,o.title,o.date,o.start_time,o.end_time,o.gross_amount,o.net_amount,JSON.stringify(o.skills),o.distance_km,o.status,o.created_at,o.updated_at);return o;}
  listOpenOpportunities(){return this.db.prepare("SELECT * FROM opportunities WHERE status='OPEN'").all().map(r=>({...r,skills:JSON.parse(r.skills||'[]')}));}
  listUserOpportunities(userId,limit=20){return this.db.prepare('SELECT * FROM opportunities WHERE owner_id=? ORDER BY created_at DESC LIMIT ?').all(userId,limit).map(r=>({...r,skills:JSON.parse(r.skills||'[]')}));}
  listUserWorkflows(userId,limit=20){return this.db.prepare('SELECT * FROM workflows WHERE user_id=? ORDER BY created_at DESC LIMIT ?').all(userId,limit).map(r=>({...r,intent:JSON.parse(r.intent||'{}'),policy:JSON.parse(r.policy||'{}')}));}
  saveAgentTask(t){this.db.prepare('INSERT OR REPLACE INTO agent_tasks(id,user_id,action,payload,context,policy,status,result,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(t.id,t.user_id,t.action,JSON.stringify(t.payload??{}),JSON.stringify(t.context??{}),JSON.stringify(t.policy??{}),t.status,JSON.stringify(t.result??null),t.created_at,t.updated_at??t.created_at,t.completed_at??null);return t;}
  _agentTask(r){return r?{...r,payload:JSON.parse(r.payload||'{}'),context:JSON.parse(r.context||'{}'),policy:JSON.parse(r.policy||'{}'),result:JSON.parse(r.result||'null')}:null;}
  getAgentTask(id){return this._agentTask(this.db.prepare('SELECT * FROM agent_tasks WHERE id=?').get(id));}
  updateAgentTask(id,patch={}){const cur=this.getAgentTask(id);if(!cur)return null;const n={...cur,...patch,updated_at:nowIso()};this.saveAgentTask(n);return n;}
  listUserAgentTasks(userId,limit=20){return this.db.prepare('SELECT * FROM agent_tasks WHERE user_id=? ORDER BY created_at DESC LIMIT ?').all(userId,limit).map(r=>this._agentTask(r));}


  saveMatchProfile(p){this.db.prepare('INSERT OR REPLACE INTO match_profiles VALUES(?,?,?,?,?,?,?,?,?,?)').run(p.id,p.user_id,p.type,JSON.stringify(p.profile??{}),JSON.stringify(p.criteria??{}),p.opt_in?1:0,p.discoverable?1:0,p.status,p.created_at,p.updated_at);return p;}
  _matchProfile(r){return r?{...r,profile:JSON.parse(r.profile||'{}'),criteria:JSON.parse(r.criteria||'{}'),opt_in:!!r.opt_in,discoverable:!!r.discoverable}:null;}
  getMatchProfile(id){return this._matchProfile(this.db.prepare('SELECT * FROM match_profiles WHERE id=?').get(id));}
  getUserMatchProfile(userId,type){return this._matchProfile(this.db.prepare("SELECT * FROM match_profiles WHERE user_id=? AND type=? AND status='ACTIVE' ORDER BY updated_at DESC LIMIT 1").get(userId,type));}
  listMatchProfiles(type=null){const rows=type?this.db.prepare('SELECT * FROM match_profiles WHERE type=?').all(type):this.db.prepare('SELECT * FROM match_profiles').all();return rows.map(r=>this._matchProfile(r));}
  saveMatchConnection(c){this.db.prepare('INSERT OR REPLACE INTO match_connections VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(c.id,c.match_id,c.type,c.user_a,c.user_b,c.user_a_approved?1:0,c.user_b_approved?1:0,c.status,c.contact_revealed?1:0,c.created_at,c.updated_at);return c;}
  _matchConnection(r){return r?{...r,user_a_approved:!!r.user_a_approved,user_b_approved:!!r.user_b_approved,contact_revealed:!!r.contact_revealed}:null;}
  getMatchConnection(id){return this._matchConnection(this.db.prepare('SELECT * FROM match_connections WHERE id=?').get(id));}
  listUserMatchConnections(userId){return this.db.prepare('SELECT * FROM match_connections WHERE user_a=? OR user_b=? ORDER BY created_at DESC').all(userId,userId).map(r=>this._matchConnection(r));}

  addExternalSignal(input={}){const r={id:randomUUID(),source:input.source??'manual',source_ref:input.source_ref??null,text:String(input.text??''),country:input.country??null,language:input.language??null,intent:input.intent??null,topic:input.topic??null,severity:Number(input.severity??2),metadata:input.metadata??{},created_at:input.created_at??nowIso()};this.db.prepare('INSERT INTO external_signals VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(r.id,r.source,r.source_ref,r.text,r.country,r.language,r.intent,r.topic,r.severity,JSON.stringify(r.metadata),r.created_at);return r;}
  listExternalSignals(limit=500){return this.db.prepare('SELECT * FROM external_signals ORDER BY created_at DESC LIMIT ?').all(limit).map(r=>({...r,metadata:JSON.parse(r.metadata||'{}')}));}
  addFeedback(input={}){const r={id:randomUUID(),user_id:input.user_id??null,source:input.source??'in_app',text:String(input.text??''),country:input.country??null,severity:Number(input.severity??2),metadata:input.metadata??{},created_at:input.created_at??nowIso()};this.db.prepare('INSERT INTO feedback VALUES(?,?,?,?,?,?,?,?)').run(r.id,r.user_id,r.source,r.text,r.country,r.severity,JSON.stringify(r.metadata),r.created_at);return r;}
  listFeedback(limit=2000){return this.db.prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?').all(limit).map(r=>({...r,metadata:JSON.parse(r.metadata||'{}')}));}
  addFeatureEvent(input={}){const r={id:randomUUID(),user_id:input.user_id??null,feature:String(input.feature??'UNKNOWN'),status:String(input.status??'SUCCESS'),revenue:Number(input.revenue??0),cost:Number(input.cost??0),metadata:input.metadata??{},created_at:input.created_at??nowIso()};this.db.prepare('INSERT INTO feature_events VALUES(?,?,?,?,?,?,?,?)').run(r.id,r.user_id,r.feature,r.status,r.revenue,r.cost,JSON.stringify(r.metadata),r.created_at);return r;}
  listFeatureEvents(limit=5000){return this.db.prepare('SELECT * FROM feature_events ORDER BY created_at DESC LIMIT ?').all(limit).map(r=>({...r,metadata:JSON.parse(r.metadata||'{}')}));}
}
