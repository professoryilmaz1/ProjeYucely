# Worker security baseline

## Scope and invariants

This baseline applies only to the existing Cloudflare Worker and Stripe
sandbox. It does not activate the historical API/UI, live Stripe mode,
production deployment, paid Cloudflare products, or production secret changes.

Security invariants:

- Live Stripe credentials are rejected.
- Financial terms and destinations come from trusted server-side state.
- Unknown or mismatched connected accounts are rejected before charging.
- Every financial provider write is deterministic and idempotent.
- Provider errors, credentials, personal data, provider account identifiers,
  and onboarding links are excluded from ordinary logs.
- `/connect/return` is navigation, not account verification.
- `/v1/*` remains disabled.

## Request boundary

`src/security.js` provides the shared request boundary:

- Strict `application/json` enforcement for JSON routes.
- A 32 KiB body limit, enforced from both declared and streamed size.
- Object-only JSON parsing.
- Per-route allowlists for accepted fields.
- Length, format, integer, and range validation.
- Correlation IDs on responses and security events.
- Stable public error codes without raw provider messages.
- Constant-time-compatible comparison of the temporary admin secret.
- Recursive logging redaction for credentials, tokens, personal fields, and
  provider account references.

The temporary `CONNECT_ADMIN_TOKEN` remains for compatibility. It is isolated
behind `isAdminRequest` and must later be replaced with authenticated,
short-lived admin identities, scoped authorization, MFA, and attributed audit
events. It is not a new authentication protocol.

## Endpoint baseline

| Endpoint | Phase 1 policy |
|---|---|
| `GET /health` | Public liveness; no secret values |
| `GET /stripe/test` | Test key plus temporary admin authorization and abuse hook |
| `POST /connect/account` | Admin authorization, strict validation, platform verification, deterministic account-create idempotency |
| `POST /connect/onboarding-link` | Admin authorization, trusted account reference, provider-scope check, allowlisted callback origin |
| `POST /payments/test-marketplace` | Admin authorization, trusted operation, account readiness, deterministic payment and transfer |
| `GET /connect/return` | Navigation acknowledgement only |
| `GET /connect/refresh` | Requires a new authenticated onboarding-link request |
| `/v1/*` | Disabled with `503` |

Unsupported methods do not inherit the behavior of the supported route.

## Security events and logging

Security events use a versioned structure with:

- Timestamp, type, severity, outcome, method, route, and correlation ID.
- Presence-only source-network information plus Cloudflare country, ASN, colo,
  and bot score when available.
- Reserved fields for anomaly score, payment-fraud score, known IOC matches,
  containment action, and defensive-deception signals.
- Redacted metadata.

The default sink is safe structured Worker logging. An optional
`SECURITY_EVENTS` Analytics Engine-style binding can receive constrained
dimensions. No binding is enabled by repository configuration in Phase 1.

IP, ASN, country, device, and source indicators are evidence about traffic.
They must not be presented as proof of a real-world attacker’s identity.

## Cloudflare control hooks

`applyAbuseControls` is the application integration point for:

- Endpoint-specific rate limiting.
- WAF and managed DDoS policy outcomes.
- Turnstile verification.
- Bot and credential-stuffing signals.
- Account-takeover anomaly scoring.
- Payment fraud scoring.
- Threat-intelligence and known-IOC matches.
- Automated containment.
- Central security event aggregation.

Phase 1 supports an optional `API_RATE_LIMITER` binding and fails closed when
that binding reports the limit exceeded. It does not create a binding or
activate a paid service.

Future controls must be server-verified. Caller-provided headers must never be
treated as proof that WAF, Turnstile, bot checks, or fraud checks succeeded.

Recommended control sequence:

1. Cloudflare network DDoS controls.
2. Managed WAF and route-specific rate rules.
3. Bot signal and Turnstile challenge where risk warrants.
4. Worker user/network/provider-budget rate checks.
5. Identity, role, and step-up authorization.
6. Account and payment fraud scoring.
7. Financial boundary and state-machine validation.
8. Provider operation.
9. Security event and reconciliation processing.

## Automated containment

Future containment actions may:

- Reject or challenge suspicious requests.
- Revoke sessions.
- Require step-up authentication.
- Hold a transfer or account change.
- Disable a compromised integration credential.
- Queue an operation for human review.
- Preserve evidence and notify the security channel.

Containment must be proportional, reversible where possible, and auditable.
No hack-back, retaliation, unauthorized access, malware, or offensive action is
permitted.

## Defensive deception

Honeypots or honeytokens may be used only inside infrastructure controlled by
ProjeYucely, isolated from customer data and financial authority. A deception
signal may trigger monitoring or containment but never offensive action.
Credentials that can access real systems must never be used as honeytokens.

## Stripe and webhook preparation

The next phase must add a signed raw-body Stripe Connect webhook endpoint with:

- Environment-specific webhook secrets.
- Official/manual signature verification with timestamp tolerance.
- Durable event-ID and object/type deduplication.
- Connect account context validation.
- Replay-safe, ordered state transitions.
- Asynchronous processing and retries.
- Payment, transfer, refund, reversal, dispute, and payout reconciliation.

Webhook return success must occur only after durable receipt or safe queueing.

## CI and supply chain

Phase 1 CI performs:

- Locked dependency installation with `npm ci`.
- Worker/test syntax checks.
- Real route regression tests.
- High-severity dependency audit.
- Wrangler dry-run bundle validation.
- Patch whitespace checks.

Dependabot is configured for npm and GitHub Actions. CI has read-only repository
permissions and no deployment or production secrets.

Future repository controls should add:

- Secret scanning and push protection.
- CodeQL/SAST and dependency review.
- SBOM generation and provenance.
- Authenticated DAST against staging.
- Protected branches and required reviews.
- Signed, staged deployments with rollback and post-deploy smoke tests.

## Remaining Phase 1 limitations

- Trusted account and operation state is configuration-backed, not durable.
- Security events are not yet an immutable ledger.
- The shared admin token remains.
- WAF, Turnstile, advanced rate limiting, anomaly/fraud providers, IOC feeds,
  and containment automation are interfaces only.
- There is no Stripe webhook, refund, reversal, dispute, payout, or daily
  reconciliation implementation.
- A successful sandbox payment followed by transfer failure is recoverable by
  deterministic keys and correlation ID, but not yet by an automated durable
  workflow.
