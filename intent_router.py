import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, YucelyService } from '../src/index.js';

test('profile + availability + need + match work together', () => {
  const store = new MemoryStore();
  const svc = new YucelyService(store);
  const requester = svc.createProfile({ display_name: 'A' });
  const worker = svc.createProfile({ display_name: 'B', skills: ['dog_sitting'], trust_score: 0.9 });
  svc.addAvailability(worker.id, { start_time: '13:00', end_time: '17:00', minimum_amount: 30, distance_km: 3 });
  const need = svc.postNeed(requester.id, { start_time: '13:00', end_time: '17:00', duration_hours: 4, amount: 50, required_skills: ['dog_sitting'], max_distance_km: 10 });
  const matches = svc.findMatches(need.id);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].candidate.id, worker.id);
  assert.ok(matches[0].score >= 70);
});

test('money mission uses open opportunities and excludes own listings', () => {
  const store = new MemoryStore();
  const svc = new YucelyService(store);
  const user = svc.createProfile({ display_name: 'Worker' });
  const a = svc.createProfile({ display_name: 'A' });
  const b = svc.createProfile({ display_name: 'B' });
  svc.postOpportunity(a.id, { start_time: '09:00', end_time: '11:00', net_amount: 80 });
  svc.postOpportunity(b.id, { start_time: '12:00', end_time: '14:00', net_amount: 70 });
  svc.postOpportunity(user.id, { start_time: '15:00', end_time: '16:00', net_amount: 500 });
  const mission = svc.buildMoneyMissionForUser(user.id, 140);
  assert.equal(mission.target_met, true);
  assert.equal(mission.projected_amount, 150);
  assert.equal(mission.selected.length, 2);
});

test('dashboard summarizes user activity',()=>{
  const store=new MemoryStore(); const svc=new YucelyService(store);
  const u=svc.createProfile({display_name:'Dash',email:'dash@example.com'});
  svc.addAvailability(u.id,{start_time:'09:00',end_time:'12:00',minimum_amount:20});
  svc.postNeed(u.id,{title:'Help needed',amount:40});
  const d=svc.getDashboard(u.id);
  assert.equal(d.metrics.availability_slots,1);
  assert.equal(d.metrics.open_needs,1);
  assert.equal(d.needs[0].title,'Help needed');
});
