# ProjeYucely Core Data Model v0.2

## Design rules
- UUID/ULID identifiers; no sequential public IDs.
- Every sensitive object has owner/tenant, created_at, updated_at and audit linkage.
- Financial amounts are integer minor-units + ISO currency; never floats.
- PII, finance, relationship and wellness data are logically separated and permission-gated.
- Event log is append-only; derived dashboards are rebuildable.

## Core entities
### Identity & consent
- users: id, status, locale, timezone, country, risk_tier
- profiles: user_id, display_name, coarse_location, skills, preferences
- consents: user_id, purpose, data_category, scope, granted_at, revoked_at
- connected_accounts: user_id, provider, scopes, status, token_reference

### ONE BUTTON / orchestration
- requests: id, user_id, raw_text_ref, language, status, urgency
- intents: request_id, primary_intent, confidence, entities_json, risk_flags
- workflows: id, request_id, workflow_type, state, policy_decision
- agent_runs: workflow_id, agent_type, model_class, input_hash, cost_minor, outcome
- approvals: workflow_id, action_type, risk_level, requested_at, approved_at

### Marketplace / EARN
- opportunities: id, creator_id, type, title, description, location_mode, geo_cell, starts_at, ends_at, compensation_minor, currency, status
- availability: user_id, starts_at, ends_at, location_mode, geo_cell, min_compensation_minor
- skills: id, normalized_name, regulated_flag
- user_skills: user_id, skill_id, evidence_status
- matches: id, opportunity_id, candidate_id, score, reasons_json, mutual_status
- engagements: id, match_id, agreed_amount_minor, state, proof_policy
- proofs: engagement_id, type, object_ref, verification_state
- reviews: engagement_id, reviewer_id, reviewee_id, rating, tags

### Life / ProjeZZ / KK
- goals: user_id, type, target_value, target_date, priority
- calendar_items: user_id, source, starts_at, ends_at, category
- financial_accounts: user_id, provider_ref, type, currency, sync_state
- transactions: account_id, amount_minor, currency, category, occurred_at, merchant_hash
- obligations: user_id, type, amount_minor, due_at, recurrence
- budgets: user_id, period, category, limit_minor
- scenarios: user_id, question, assumptions_json, result_json
- daily3: user_id, date, ranked_actions_json, accepted_actions_json

### Relationship / mutual matching
- match_profiles: user_id, purpose, visibility, criteria_json
- mutual_matches: id, purpose, user_a, user_b, compatibility_score, consent_a, consent_b
- contact_reveals: mutual_match_id, revealed_at, scope

### Finance / AI CFO
- ledger_accounts: id, owner_type, owner_id, account_type, currency
- ledger_entries: id, transaction_group_id, debit_account, credit_account, amount_minor, currency, idempotency_key
- payment_events: provider, provider_event_id, type, amount_minor, state
- reserves: type, currency, target_ratio, current_minor
- cost_events: category, vendor, amount_minor, usage_units, period
- finance_snapshots: period, revenue_minor, obligations_minor, tax_reserve_minor, safety_reserve_minor, net_profit_minor, profit_per_active_user

### Intelligence / feedback
- feedback_events: source, source_ref, language, category, severity, sentiment, text_ref
- issue_clusters: canonical_issue, frequency, severity_score, financial_impact, security_impact, trend
- feature_events: user_id_hash, feature, event_type, timestamp, value_json
- feature_health: feature, period, usage, completion, retention, revenue_minor, cost_minor, complaint_rate, recommendation

### Security / operations
- audit_events: actor_id, actor_type, action, resource_type, resource_id, timestamp, ip_risk, result
- security_events: type, severity, principal, source, evidence_ref, status
- policy_decisions: subject_ref, policy_version, decision, reasons_json
- incidents: type, severity, started_at, resolved_at, region, postmortem_ref
- backups: dataset, region, created_at, immutable_until, restore_tested_at

## Partitioning path
- Early: PostgreSQL primary + read replicas, partition event tables by time.
- Growth: partition high-volume events by region/time; geo-shard marketplace discovery.
- Large scale: regional cells with local request/match processing and globally reconciled financial/audit control planes.
