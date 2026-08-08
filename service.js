# ProjeYucely

Global AI-powered life action platform under IMPOCOR GROUP LLC.

Core promise: understand the user's need, plan the next action, help them earn/save money, match them with people/services/opportunities, and execute permitted actions through AI agents.

## Core modules
- ONE BUTTON / I NEED
- EARN
- ProjeZZ: life, budget, planning, What If?
- ProjeKK: Daily 3
- Do It For Me
- Yucely Opportunity Radar
- Mutual Match Engine
- AI CFO / Financial Control Engine
- Global Voice / Issues Intelligence
- Feature Intelligence
- Yucely AI Orchestrator

## Non-negotiable platform principles
- Global-scale architecture with automatic scaling
- Positive-cash-flow bias and minimum 30% safety reserve target
- Privacy, security, compliance and auditability by design
- AI-first automation, human approval only where ownership, legal, financial or high-risk decisions require it
- No single point of failure for critical services
- Multi-region disaster recovery and tested backups

## v0.3 working core
A zero-external-dependency Node.js core now exists under `apps/core`.

Current working flow:
1. Natural-language ONE BUTTON input
2. Intent + amount/time entity extraction
3. Risk flagging
4. Policy decision
5. Workflow creation
6. Routing to NEED / EARN / MONEY / PLANNER / MATCH / SUPPORT agents

Run locally:
```bash
cd apps/core
npm test
npm run demo
```

## v0.7 status
ONE BUTTON is connected end-to-end: authenticated natural-language request -> intent/policy -> persisted workflow -> NEED/EARN/MONEY execution -> matching/database -> audit log.


## Current build
ProjeYucely v0.9 — live dashboard + ONE BUTTON/NEED/EARN web experience.


## v1.1
ONE BUTTON now connects Find Me $X, Save Me $X, Fix My Day, and What If life-action engines. See `docs/V1_1_RELEASE.md`.

## v1.3 Intelligence Layer
Opportunity Radar, Global Voice/Issues and Feature Intelligence are now implemented. See `docs/V1_3_RELEASE.md`.

## v1.4 - Mutual Match
Mutual Match Engine now supports relationship, business, mentor, and friend profiles with two-way criteria scoring, explicit opt-in, privacy gating, and mutual approval before contact reveal. See `docs/V1_4_RELEASE.md`.

## v1.5
Mutual Match is now exposed in the web dashboard with Relationship/Business/Mentor/Friend tabs, explicit opt-in, live two-way score cards, connection requests and mutual approval state. Contact information remains private until both parties approve.


## v1.6
ProjeZZ Life Center now exposes live Budget, Daily 3, What If, Fix My Day, and AI CFO admin cards in the web dashboard. See `docs/V1_6_RELEASE.md`.

## Regression rule (v1.7+)
Every release must pass `./scripts/regression.sh` before packaging. The gate currently runs the full core test suite and syntax checks for API and web code. A failed regression blocks release packaging until fixed.

## Payment safety foundation
The current payment layer is sandbox-only and includes an idempotent escrow state machine, ledger entries, refund/release controls, platform fee allocation, tax reserve allocation, and a 30% safety reserve allocation. No real Stripe secret is stored in source. Real Stripe test-mode integration is a separate owner-authorized step.
