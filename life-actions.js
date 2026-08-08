import { randomUUID } from 'node:crypto';
import { evaluatePolicy } from './policy.js';
import { routeIntent } from './router.js';

function nextActionFor(route) {
  switch (route) {
    case 'need_agent': return 'create_need_and_find_candidates';
    case 'earn_agent': return 'build_availability_and_find_opportunities';
    case 'money_agent': return 'build_money_plan';
    case 'planner_agent': return 'build_life_plan';
    case 'match_agent': return 'collect_mutual_match_consent';
    case 'opportunity_agent': return 'discover_external_opportunities';
    case 'support_agent': return 'open_support_case';
    default: return 'request_clarification';
  }
}

export function createWorkflow(request) {
  const intent = routeIntent(request.text);
  const policy = evaluatePolicy(intent);
  const state = policy.outcome === 'BLOCK' ? 'BLOCKED' : policy.outcome === 'REQUIRE_APPROVAL' ? 'NEEDS_APPROVAL' : 'READY';

  return {
    id: randomUUID(),
    request_id: request.id,
    user_id: request.user_id,
    intent,
    policy,
    state,
    next_action: state === 'READY' ? nextActionFor(intent.route) : state === 'BLOCKED' ? 'safe_handling_flow' : 'request_user_approval',
    created_at: new Date().toISOString(),
  };
}
