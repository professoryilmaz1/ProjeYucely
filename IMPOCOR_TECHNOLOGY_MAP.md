# IMPOCOR TECHNOLOGY — Product & Core Map

This file is an architecture contract only. It does not change runtime behavior, routing, UI, authentication, payments, database behavior, or deployment.

## Corporate layer

- IMPOCOR GROUP LLC — `impocorgroup.com`
- IMPOCOR TECHNOLOGY — public technology/product umbrella

## Public products

| Product | Domain | Status |
|---|---|---|
| KREVUNO | `krevuno.com` | public product |
| IMPOCOR-AI NEXUS | `yynexus.com` | public product |
| VeteranLifeOS / VETLIFEY | `vetlifey.com` | public product |
| ACADAMIYY / AICDRM | `acadamiyy.com` | public product |
| Government Procurement / Contracting AI | `yyvexo.com` | public product |
| Global Sourcing / Trade Technology | `yyvexia.com` | public product |
| YYVEXIS | `yyvexis.com` | reserved |

## Products without dedicated domains yet

These remain under IMPOCOR TECHNOLOGY and are not assigned new domains by this change:

- AI Clinical Decision Support
- AI Malpractice Early Warning
- AI Healthcare Governance & Safety
- Rapid Surge Medical Unit
- Future AI projects

## Private core

The existing `yy-government-core` repository remains the private technical core for:

- AI Governance
- Orchestration
- Security
- Finance
- Automation

The private core must not be exposed as a public product endpoint. Public products should reach shared private services only through authenticated, authorized service boundaries.

## Non-negotiable safety rules

1. Do not rename, delete, move, or rewrite existing application modules as part of the umbrella migration.
2. Do not change existing UI/page layout, authentication, payments, matching, marketplace, database, or business logic merely to establish the umbrella.
3. Do not publish or activate product-domain routes from this map alone.
4. Domain/DNS bindings are a separate deployment step and require explicit publish authorization.
5. Keep product failure isolated where practical; no product should depend on a public URL of another product.
6. Keep secrets and private-core credentials server-side only.

## Intended topology

Internet → Cloudflare Edge/DNS/WAF → individual public product → authenticated service boundary → private core services.

`impocorgroup.com` is the corporate discovery hub. Individual product domains remain independently addressable. The private core remains non-public.
