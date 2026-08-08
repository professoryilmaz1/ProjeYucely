export function evaluatePolicy(intent) {
  if (intent.risk_flags.includes('HIGH_RISK_REQUEST')) {
    return { outcome: 'BLOCK', reasons: ['High-risk request requires a restricted safety flow.'] };
  }
  if (intent.risk_flags.includes('POTENTIAL_EMPLOYMENT_DISCRIMINATION')) {
    return { outcome: 'REQUIRE_APPROVAL', reasons: ['Potential protected-trait employment criterion must be reviewed or reframed.'] };
  }
  if (intent.risk_flags.includes('SENSITIVE_MATCHING_DATA')) {
    return { outcome: 'REQUIRE_APPROVAL', reasons: ['Relationship matching requires explicit opt-in and privacy consent.'] };
  }
  return { outcome: 'ALLOW', reasons: [] };
}
