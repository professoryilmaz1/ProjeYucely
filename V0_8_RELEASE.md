# ProjeYucely v2.0-rc1

Stripe Connect test-mode readiness release.

## Added
- Stripe Connect provider adapter
- Express connected-account onboarding
- Account status refresh
- PaymentIntent creation/confirmation adapter
- Separate transfer to connected account
- Refund adapter
- Async commerce engine
- API endpoints for Connect onboarding/status/funding/completion
- Idempotency across provider + internal ledger
- 30% safety reserve and tax reserve preserved

## Regression gate
- 60/60 core tests pass
- API syntax check pass
- HTTP smoke: register -> onboard -> READY -> fund -> complete -> transfer pass

## Security
- No Stripe secret keys stored in repository
- Webhook signature verification remains raw-body based
- Live mode not required for this release
