import { randomUUID } from 'node:crypto';
import { createWorkflow } from './workflow.js';
import { calculateBudget } from './life-finance.js';
import { buildSavePlan, simulateWhatIf, fixMyDay } from './life-actions.js';

function inferSkills(text = '') {
  const t = String(text).toLocaleLowerCase('tr-TR');
  const rules = [
    ['dog_sitting', /köpek|köpeğ|kopek|kopeg|dog|pet/],
    ['child_care', /çocuk|cocuk|bebek|babysit|child/],
    ['elder_care', /yaşlı|yasli|elder|senior/],
    ['moving', /taşı|tasi|moving|move|mobilya/],
    ['cleaning', /temiz|clean/],
    ['retail', /market|store|shop|mağaza|magaza/],
    ['repair', /tamir|repair|fix/],
    ['driving', /şoför|sofor|driver|drive|ulaşım|ulasim/],
    ['tutoring', /ders|öğret|ogret|tutor|teach/],
    ['religious_service', /imam|cami|mosque/],
  ];
  return rules.filter(([, re]) => re.test(t)).map(([skill]) => skill);
}

function isTimeInside(op, start, end) {
  if (!start || !end || !op.start_time || !op.end_time) return true;
  return op.start_time >= start && op.end_time <= end;
}

export class OneButtonEngine {
  constructor(store, service) { this.store = store; this.service = service; }

  execute(userId, text, context = {}) {
    const request = this.store.createOneButtonRequest
      ? this.store.createOneButtonRequest(userId, { text, context })
      : { id: randomUUID(), user_id: userId, text, context, created_at: new Date().toISOString() };

    const workflow = createWorkflow({ id: request.id, user_id: userId, text });
    if (this.store.saveWorkflow) this.store.saveWorkflow(workflow);

    if (workflow.state !== 'READY') {
      return { request, workflow, result: { status: workflow.state, action: workflow.next_action } };
    }

    const e = workflow.intent.entities;
    const skills = inferSkills(text);
    let result;

    switch (workflow.intent.primary_intent) {
      case 'NEED_HELP': {
        const need = this.service.postNeed(userId, {
          title: text,
          start_time: e.start_time,
          end_time: e.end_time,
          duration_hours: e.duration_hours,
          amount: e.amount,
          required_skills: skills,
          max_distance_km: Number(context.max_distance_km ?? 25),
        });
        const matches = this.service.findMatches(need.id, { limit: Number(context.limit ?? 10) });
        result = { status: 'NEED_CREATED', need, matches };
        break;
      }
      case 'EARN': {
        let availability = null;
        if (e.start_time || e.end_time || context.date) {
          availability = this.service.addAvailability(userId, {
            date: context.date ?? null,
            start_time: e.start_time,
            end_time: e.end_time,
            minimum_amount: context.minimum_amount ?? null,
            max_distance_km: Number(context.max_distance_km ?? 25),
          });
        }
        const opportunities = this.store.listOpenOpportunities()
          .filter((o) => o.owner_id !== userId)
          .filter((o) => isTimeInside(o, e.start_time, e.end_time))
          .sort((a,b) => Number(b.net_amount) - Number(a.net_amount))
          .slice(0, Number(context.limit ?? 10));
        result = { status: 'EARN_PLAN_READY', availability, opportunities, projected_amount: opportunities.reduce((s,o)=>s+Number(o.net_amount||0),0) };
        break;
      }
      case 'MONEY_MISSION': {
        if (!e.amount) throw new Error('TARGET_AMOUNT_REQUIRED');
        const mission = this.service.buildMoneyMissionForUser(userId, e.amount);
        result = { status: 'MONEY_MISSION_READY', ...mission };
        break;
      }
      case 'SAVE_MONEY': {
        const budget = calculateBudget(context.budget ?? {});
        const plan = buildSavePlan({ target_amount: e.amount ?? context.target_amount ?? 0, budget });
        result = { status: 'SAVE_PLAN_READY', budget, ...plan };
        break;
      }
      case 'PLAN_LIFE': {
        const dashboard = this.service.getDashboard(userId);
        const budget = calculateBudget(context.budget ?? {});
        const opportunities = this.store.listOpenOpportunities().filter((o)=>o.owner_id!==userId);
        result = { status: 'DAY_PLAN_READY', ...fixMyDay({ dashboard, budget, opportunities }) };
        break;
      }
      case 'WHAT_IF': {
        const budget = calculateBudget(context.budget ?? {});
        result = { status: 'WHAT_IF_READY', simulation: simulateWhatIf({ budget, scenario: context.scenario ?? {} }) };
        break;
      }
      case 'SUPPORT': result = { status: 'SUPPORT_CASE_QUEUED' }; break;
      default: result = { status: 'ROUTED', route: workflow.intent.route };
    }

    if (this.store.updateWorkflowState) this.store.updateWorkflowState(workflow.id, 'COMPLETED', result.status);
    return { request, workflow: { ...workflow, state: 'COMPLETED' }, result };
  }
}

export { inferSkills };
