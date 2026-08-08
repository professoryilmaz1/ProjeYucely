import test from 'node:test';
import assert from 'node:assert/strict';
import { matchNeed, buildMoneyMission, scoreCandidate } from '../src/index.js';

test('matching engine ranks the stronger candidate first', () => {
  const need = { amount: 40, duration_hours: 4, start_time: '13:00', end_time: '17:00', required_skills: ['dog-care'], max_distance_km: 20 };
  const candidates = [
    { id: 'c1', start_time: '13:00', end_time: '17:00', skills: ['dog-care'], distance_km: 2, minimum_amount: 35, trust_score: 0.95 },
    { id: 'c2', start_time: '13:00', end_time: '17:00', skills: ['dog-care'], distance_km: 15, minimum_amount: 40, trust_score: 0.80 },
  ];
  const matches = matchNeed(need, candidates);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].candidate.id, 'c1');
  assert.ok(matches[0].score > matches[1].score);
});

test('candidate outside time window is blocked', () => {
  const result = scoreCandidate(
    { amount: 40, duration_hours: 4, start_time: '13:00', end_time: '17:00', required_skills: [] },
    { id: 'c1', start_time: '18:00', end_time: '22:00', skills: [], distance_km: 1, minimum_amount: 20 }
  );
  assert.equal(result.blocked, true);
  assert.equal(result.score, 0);
});

test('money mission picks non-overlapping opportunities until target is met', () => {
  const plan = buildMoneyMission({
    target_amount: 100,
    opportunities: [
      { id: 'o1', start_time: '09:00', end_time: '10:00', net_amount: 40 },
      { id: 'o2', start_time: '10:30', end_time: '12:30', net_amount: 70 },
      { id: 'o3', start_time: '09:30', end_time: '11:00', net_amount: 80 },
    ]
  });
  assert.equal(plan.target_met, true);
  assert.equal(plan.projected_amount, 110);
  assert.deepEqual(plan.selected.map((x) => x.id), ['o1', 'o2']);
});
