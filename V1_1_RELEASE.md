# ProjeYucely v0.4

## Added
- Matching Engine for NEED ↔ EARN
- Weighted scoring: time, skills, distance, budget, trust
- Hard blocking for time-window and distance failures
- Money Mission planner that selects non-overlapping opportunities toward a target amount
- Automated tests for ranking, blocking, and money-mission planning

## Important design rule
Matching must not silently use protected or sensitive personal attributes. Sensitive relationship matching remains consent-gated and separate from employment/task matching.
