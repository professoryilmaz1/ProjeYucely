function toMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  const a1 = toMinutes(aStart), a2 = toMinutes(aEnd), b1 = toMinutes(bStart), b2 = toMinutes(bEnd);
  if ([a1,a2,b1,b2].some((v) => v == null || Number.isNaN(v))) return 0;
  return Math.max(0, Math.min(a2,b2) - Math.max(a1,b1));
}

function normalizedSkillSet(skills = []) {
  return new Set(skills.map((s) => String(s).trim().toLocaleLowerCase('tr-TR')).filter(Boolean));
}

function skillScore(required = [], offered = []) {
  if (!required.length) return 1;
  const offeredSet = normalizedSkillSet(offered);
  const hits = required.filter((s) => offeredSet.has(String(s).trim().toLocaleLowerCase('tr-TR'))).length;
  return hits / required.length;
}

function distanceScore(distanceKm, maxKm) {
  if (distanceKm == null || maxKm == null) return 0.7;
  if (distanceKm > maxKm) return 0;
  return Math.max(0, 1 - distanceKm / Math.max(maxKm, 1));
}

function budgetScore(offerAmount, minAmount) {
  if (offerAmount == null || minAmount == null) return 0.8;
  if (offerAmount < minAmount) return Math.max(0, offerAmount / Math.max(minAmount, 1) * 0.5);
  return Math.min(1, offerAmount / Math.max(minAmount, 1));
}

export function scoreCandidate(need, candidate) {
  const reasons = [];
  const requiredDuration = need.duration_hours ? need.duration_hours * 60 : null;
  const overlap = overlapMinutes(need.start_time, need.end_time, candidate.start_time, candidate.end_time);
  const candidateSpan = (toMinutes(candidate.end_time) != null && toMinutes(candidate.start_time) != null) ? Math.max(0, toMinutes(candidate.end_time) - toMinutes(candidate.start_time)) : null;
  let time;
  if (need.start_time && need.end_time) {
    time = requiredDuration == null ? (overlap > 0 ? 1 : 0.7) : Math.min(1, overlap / requiredDuration);
  } else if (requiredDuration != null && candidateSpan != null) {
    time = Math.min(1, candidateSpan / requiredDuration);
  } else {
    time = 0.7;
  }
  const skills = skillScore(need.required_skills ?? [], candidate.skills ?? []);
  const distance = distanceScore(candidate.distance_km, need.max_distance_km ?? 25);
  const budget = budgetScore(need.amount, candidate.minimum_amount);
  const trust = Math.min(1, Math.max(0, candidate.trust_score ?? 0.75));

  if (skills < 0.5) reasons.push('LOW_SKILL_MATCH');
  if (time < 0.5) reasons.push('LOW_TIME_OVERLAP');
  if (distance === 0) reasons.push('OUTSIDE_DISTANCE');
  if (budget < 0.5) reasons.push('BUDGET_MISMATCH');

  const blocked = reasons.includes('OUTSIDE_DISTANCE') || reasons.includes('LOW_TIME_OVERLAP');
  const score = blocked ? 0 : Math.round((
    time * 0.30 +
    skills * 0.25 +
    distance * 0.15 +
    budget * 0.15 +
    trust * 0.15
  ) * 100);

  return { candidate_id: candidate.id, score, blocked, reasons, components: { time, skills, distance, budget, trust } };
}

export function matchNeed(need, candidates = [], limit = 10) {
  return candidates
    .map((candidate) => ({ candidate, result: scoreCandidate(need, candidate) }))
    .filter(({ result }) => !result.blocked && result.score > 0)
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, limit)
    .map(({ candidate, result }) => ({ ...result, candidate }));
}

export function buildMoneyMission({ target_amount, opportunities = [], max_items = 20 }) {
  const items = [...opportunities]
    .filter((o) => Number(o.net_amount) > 0)
    .slice(0, Math.min(max_items, 20));

  let best = null;
  const totalMasks = 1 << items.length;
  for (let mask = 1; mask < totalMasks; mask += 1) {
    const selected = [];
    let total = 0;
    let valid = true;

    for (let i = 0; i < items.length; i += 1) {
      if ((mask & (1 << i)) === 0) continue;
      const item = items[i];
      if (selected.some((s) => overlapMinutes(s.start_time, s.end_time, item.start_time, item.end_time) > 0)) {
        valid = false;
        break;
      }
      selected.push(item);
      total += Number(item.net_amount);
    }
    if (!valid) continue;

    const met = total >= target_amount;
    const candidate = {
      target_amount,
      projected_amount: Number(total.toFixed(2)),
      gap: Number(Math.max(0, target_amount - total).toFixed(2)),
      target_met: met,
      selected: selected.sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '')),
    };

    if (!best) {
      best = candidate;
      continue;
    }

    if (candidate.target_met && !best.target_met) {
      best = candidate;
    } else if (candidate.target_met && best.target_met) {
      const candidateOvershoot = candidate.projected_amount - target_amount;
      const bestOvershoot = best.projected_amount - target_amount;
      if (candidateOvershoot < bestOvershoot || (candidateOvershoot === bestOvershoot && candidate.selected.length < best.selected.length)) best = candidate;
    } else if (!candidate.target_met && !best.target_met && candidate.projected_amount > best.projected_amount) {
      best = candidate;
    }
  }

  return best ?? { target_amount, projected_amount: 0, gap: target_amount, target_met: false, selected: [] };
}
