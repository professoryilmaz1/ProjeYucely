import { randomUUID } from 'node:crypto';

const SAFE_AUTO_ACTIONS = new Set([
  'create_need_and_find_candidates',
  'build_availability_and_find_opportunities',
  'build_money_plan',
  'build_life_plan',
  'build_save_plan',
  'simulate_what_if',
  'open_support_case',
]);

const ALWAYS_APPROVAL_ACTIONS = new Set([
  'send_message',
  'apply_to_opportunity',
  'book_service',
  'make_payment',
  'cancel_subscription',
  'share_contact_details',
  'publish_external_post',
  'external_account_change',
]);

export function actionPolicy(action, context = {}) {
  if (ALWAYS_APPROVAL_ACTIONS.has(action)) {
    return { outcome: 'REQUIRE_APPROVAL', reason: 'External or consequential action requires explicit user approval.' };
  }
  if (SAFE_AUTO_ACTIONS.has(action)) {
    return { outcome: 'ALLOW', reason: 'Low-risk internal planning/action.' };
  }
  if (context.external === true || context.financial === true || context.sensitive === true) {
    return { outcome: 'REQUIRE_APPROVAL', reason: 'Potentially consequential action.' };
  }
  return { outcome: 'REQUIRE_APPROVAL', reason: 'Unknown action defaults to approval.' };
}

export class AgentOrchestrator {
  constructor(store, service) { this.store = store; this.service = service; }

  createTask(userId, input = {}) {
    if (!this.store.getUser(userId)) throw new Error('USER_NOT_FOUND');
    const action = String(input.action ?? '').trim();
    if (!action) throw new Error('ACTION_REQUIRED');
    const policy = actionPolicy(action, input.context ?? {});
    const task = {
      id: randomUUID(), user_id: userId, action, payload: input.payload ?? {}, context: input.context ?? {},
      policy, status: policy.outcome === 'ALLOW' ? 'READY' : 'NEEDS_APPROVAL',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    this.store.saveAgentTask(task);
    if (task.status === 'READY') return this.executeTask(userId, task.id);
    return task;
  }

  approveTask(userId, taskId) {
    const task = this.store.getAgentTask(taskId);
    if (!task) throw new Error('AGENT_TASK_NOT_FOUND');
    if (task.user_id !== userId) throw new Error('FORBIDDEN');
    if (task.status !== 'NEEDS_APPROVAL') return task;
    this.store.updateAgentTask(taskId, { status: 'APPROVED' });
    return this.executeTask(userId, taskId);
  }

  executeTask(userId, taskId) {
    const task = this.store.getAgentTask(taskId);
    if (!task) throw new Error('AGENT_TASK_NOT_FOUND');
    if (task.user_id !== userId) throw new Error('FORBIDDEN');
    if (!['READY','APPROVED'].includes(task.status)) return task;
    let result;
    switch (task.action) {
      case 'create_need_and_find_candidates': {
        const need = this.service.postNeed(userId, task.payload);
        result = { need, matches: this.service.findMatches(need.id) };
        break;
      }
      case 'build_availability_and_find_opportunities': {
        const availability = this.service.addAvailability(userId, task.payload.availability ?? {});
        const opportunities = this.store.listOpenOpportunities().filter(o=>o.owner_id!==userId).slice(0,10);
        result = { availability, opportunities };
        break;
      }
      case 'build_money_plan': {
        result = this.service.buildMoneyMissionForUser(userId, Number(task.payload.target_amount));
        break;
      }
      case 'build_life_plan': {
        result = this.service.getDashboard(userId);
        break;
      }
      case 'open_support_case': {
        result = { queued: true, topic: task.payload.topic ?? null };
        break;
      }
      default: {
        // External/consequential actions are represented as execution intents only in this version.
        // Real providers are attached later behind the same approval gate.
        result = { execution_intent_created: true, action: task.action, payload: task.payload };
      }
    }
    return this.store.updateAgentTask(taskId, { status: 'COMPLETED', result, completed_at: new Date().toISOString() });
  }
}
