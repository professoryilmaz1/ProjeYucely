# ProjeYucely Architecture v0.1

## Recommended starting stack
- Frontend: React / Next.js-class web app, PWA-first
- Edge/security: Cloudflare
- Primary data platform: PostgreSQL-compatible managed service
- Auth: managed auth with MFA/passkey path
- Payments: Stripe/Connect-class marketplace integration
- AI: provider-agnostic orchestration layer
- Async workflows: durable queue/event system
- Observability: logs, metrics, traces, error monitoring
- Testing: unit + API + Playwright + security scans

## Logical services
1. Identity & Consent
2. User Profile & Preferences
3. Intent Router
4. Task & Opportunity Service
5. Matching Engine
6. Availability & Scheduling
7. Finance Ledger
8. Budget & What-If Engine
9. Daily 3 Engine
10. Agent Orchestrator
11. Notifications
12. Feedback Intelligence
13. Feature Analytics
14. Risk/Fraud
15. Admin/Operations

## Data principles
- Separate PII from operational analytics where practical
- Append-only financial ledger for money movement
- Event history for auditable AI actions
- Consent records versioned and queryable
- Region-aware storage strategy for future compliance needs

## Scale principles
- Stateless app/API services
- Horizontal scaling
- Cache hot reads
- Queue bursty/long-running tasks
- Partition high-volume tables
- Isolate financial writes
- Avoid synchronous fan-out to third-party services
- Circuit breakers and retries
