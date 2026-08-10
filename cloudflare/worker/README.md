# ProjeYucely Cloudflare Worker

The active Worker is a sandbox-only edge API. Phase 1 adds strict request
handling, trusted Stripe account boundaries, deterministic idempotency, safe
errors, security events, and real route tests.

Run locally:

```bash
npm ci
npm run test:worker
npm run check:worker
npm run build:worker
```

Runtime configuration is managed outside Git:

- `STRIPE_SECRET_KEY`: test or restricted-test credential only.
- `CONNECT_ADMIN_TOKEN`: temporary compatibility authorization.
- `STRIPE_BOUNDARY_CONFIG`: trusted platform, connected-account, and approved
  operation mapping.
- `CONNECT_ALLOWED_ORIGINS`: comma-separated onboarding callback allowlist.
- `CONNECT_RETURN_ORIGIN`: selected server-controlled callback origin.

Optional future bindings:

- `API_RATE_LIMITER`
- `SECURITY_EVENTS`

No live-money support, production deployment automation, D1/Supabase binding,
or historical `/v1` application is enabled.

See `docs/STRIPE_ACCOUNT_BOUNDARIES.md` and
`docs/WORKER_SECURITY_BASELINE.md`.
