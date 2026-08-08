import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, YucelyService, AgentOrchestrator, actionPolicy } from '../src/index.js';

test('safe internal action auto-executes',()=>{
  const store=new MemoryStore(); const u=store.createUser({email:'a@x.com'}); const svc=new YucelyService(store); const a=new AgentOrchestrator(store,svc);
  const t=a.createTask(u.id,{action:'build_life_plan'});
  assert.equal(t.status,'COMPLETED'); assert.ok(t.result.metrics);
});

test('payment requires approval',()=>{
  assert.equal(actionPolicy('make_payment').outcome,'REQUIRE_APPROVAL');
});

test('approved external action completes as execution intent',()=>{
  const store=new MemoryStore(); const u=store.createUser({email:'b@x.com'}); const svc=new YucelyService(store); const a=new AgentOrchestrator(store,svc);
  const pending=a.createTask(u.id,{action:'send_message',payload:{to:'candidate',message:'hello'}});
  assert.equal(pending.status,'NEEDS_APPROVAL');
  const done=a.approveTask(u.id,pending.id);
  assert.equal(done.status,'COMPLETED'); assert.equal(done.result.execution_intent_created,true);
});
