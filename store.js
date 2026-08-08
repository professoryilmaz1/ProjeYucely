import { matchNeed, buildMoneyMission } from './matching.js';

export class YucelyService {
  constructor(store) { this.store = store; }

  createProfile(input) { return this.store.createUser(input); }
  addAvailability(userId, input) { return this.store.upsertAvailability(userId, input); }
  postNeed(userId, input) { return this.store.createNeed(userId, input); }
  postOpportunity(userId, input) { return this.store.createOpportunity(userId, input); }

  findMatches(needId, { limit = 10 } = {}) {
    const need = this.store.getNeed(needId);
    if (!need) throw new Error('NEED_NOT_FOUND');
    const candidates = [];
    for (const user of this.store.listUsers()) {
      if (user.id === need.requester_id) continue;
      for (const slot of this.store.listAvailability(user.id)) {
        candidates.push({
          id: user.id,
          skills: user.skills,
          trust_score: user.trust_score,
          start_time: slot.start_time,
          end_time: slot.end_time,
          minimum_amount: slot.minimum_amount,
          distance_km: slot.distance_km ?? 5,
          availability_id: slot.id,
        });
      }
    }
    return matchNeed(need, candidates, limit);
  }

  getDashboard(userId) {
    const user = this.store.getUser(userId);
    if (!user) throw new Error('USER_NOT_FOUND');
    const availability = this.store.listAvailability(userId);
    const needs = this.store.listUserNeeds?.(userId, 8) ?? [];
    const opportunities = this.store.listUserOpportunities?.(userId, 8) ?? [];
    const workflows = this.store.listUserWorkflows?.(userId, 8) ?? [];
    const openNeeds = needs.filter(x=>x.status==='OPEN').length;
    const openOpportunities = opportunities.filter(x=>x.status==='OPEN').length;
    const recentIntents = {};
    for (const w of workflows) { const k=w.intent?.primary_intent||'UNKNOWN'; recentIntents[k]=(recentIntents[k]||0)+1; }
    return {
      user,
      metrics:{availability_slots:availability.length,open_needs:openNeeds,open_opportunities:openOpportunities,recent_workflows:workflows.length},
      availability:availability.slice(-6).reverse(), needs, opportunities, workflows, recent_intents:recentIntents
    };
  }

  buildMoneyMissionForUser(userId, targetAmount) {
    if (!this.store.getUser(userId)) throw new Error('USER_NOT_FOUND');
    const opportunities = this.store.listOpenOpportunities().filter((o) => o.owner_id !== userId);
    return buildMoneyMission({ target_amount: Number(targetAmount), opportunities });
  }
}
