# Stripe account boundaries

## Phase 1 scope

The Cloudflare Worker is sandbox-only. It accepts only Stripe test or
restricted-test credentials and must reject every live credential. Phase 1 does
not authorize live payments, production deployment, or automatic secret
changes.

Stripe resources are scoped to the credential that created or can retrieve
them. A connected account from another platform, sandbox, or credential scope
is not interchangeable, even when its identifier has the expected format.

## Boundary model

Every financial operation is bound to:

1. `mode`: must be `test`.
2. A canonical platform account.
3. The specific test credential stored by Cloudflare.
4. A server-side connected-account reference.
5. A server-side approved operation containing immutable transaction terms.

The Worker retrieves the platform and connected account with the active
credential before creating a PaymentIntent. Successful retrieval, identifier
matching, and test-mode checks establish provider scope. A raw provider account
identifier supplied by a caller is never payment authorization.

## Temporary trusted configuration

Until persistent storage is introduced, `STRIPE_BOUNDARY_CONFIG` is a
Cloudflare-managed JSON value. It must be managed outside Git and treated as
sensitive operational configuration because it contains provider references.

The conceptual structure is:

```json
{
  "mode": "test",
  "platform_account_id": "<platform-provider-reference>",
  "connected_accounts": {
    "<internal-account-reference>": {
      "account_id": "<connected-provider-reference>",
      "status": "onboarding-or-ready",
      "api": "v2",
      "requires_charges": false
    }
  },
  "marketplace_operations": {
    "<internal-operation-reference>": {
      "operation_id": "<immutable-internal-operation-id>",
      "connected_account_reference": "<internal-account-reference>",
      "amount": 10000,
      "currency": "usd",
      "fee_bps": 500,
      "status": "approved"
    }
  }
}
```

The numbers above illustrate schema types only; they are not a pricing policy.
Real transaction terms must come from an approved server-side order or
engagement.

A database-backed repository can replace this configuration without changing
the boundary interface:

- `resolveConnectedAccount`
- `resolveMarketplaceOperation`
- `verifyPlatformScope`
- `retrieveAndVerifyConnectedAccount`

## Connected-account validation

Before onboarding, the Worker verifies:

- The Worker uses a test credential.
- The configured platform is retrievable and matches the canonical platform.
- The connected account is retrievable under the same credential.
- Neither provider object reports live mode.
- The connected account reference exists in trusted configuration.

Before payment, it additionally requires:

- Trusted configuration status is `ready`.
- No blocking requirements or disabled status.
- Submitted account details when the provider exposes that field.
- Payouts enabled when the provider exposes that field.
- Transfer capability active.
- Charges enabled only when the selected account model requires connected
  account charges. The current separate-charge architecture charges the
  platform, not the connected account.

Stripe-hosted return navigation is never proof of onboarding. Account state
must be retrieved from Stripe and, in the next phase, reconciled from signed
Connect webhooks.

## Payment lifecycle

The Phase 1 sandbox lifecycle is:

1. An admin submits only an internal `operation_reference`.
2. The Worker resolves amount, currency, fee, destination, and approval state
   from trusted server-side configuration.
3. Platform and connected-account boundaries are verified.
4. The Worker creates and confirms a test PaymentIntent on the platform.
5. After payment success, it creates a separate transfer to the verified
   connected account.
6. The platform retains the difference between charge and transfer as the
   configured fee.

Client-supplied amounts, fees, currency, destinations, or provider IDs are
rejected.

## Idempotency

An immutable server-side operation ID deterministically derives:

- A public-safe correlation ID.
- A PaymentIntent idempotency key.
- A transfer idempotency key.

Retries, browser resubmission, network ambiguity, or Worker retries reuse the
same keys. Changing transaction terms requires a new approved operation ID.
Provider object identifiers and idempotency keys are never returned to public
callers or written to normal logs.

## Failure and recovery states

| State | Meaning | Required action |
|---|---|---|
| `PAYMENT_AND_TRANSFER_SUCCEEDED` | Test payment and transfer succeeded | Reconcile through future webhook/ledger flow |
| `PAYMENT_SUCCEEDED_TRANSFER_PENDING` | Payment succeeded; transfer failed or is ambiguous | Do not create another charge; reconcile by correlation ID and retry the idempotent transfer |
| `TEST_PAYMENT_FAILED` | Payment did not complete | Inspect restricted provider logs using the correlation ID |
| `CONNECTED_ACCOUNT_NOT_READY` | Status/capability check failed | Complete or re-verify onboarding before payment |
| `STRIPE_PLATFORM_SCOPE_MISMATCH` | Credential and configured platform disagree | Stop processing and correct environment configuration |

Phase 1 records safe structured events but does not yet provide durable payment
state, a webhook ledger, refunds, transfer reversals, or dispute processing.
Those remain blockers for production money.

## Credential boundaries and secrets policy

- Stripe credentials and admin tokens stay in Cloudflare secret management.
- `STRIPE_BOUNDARY_CONFIG` stays outside Git.
- Test and live credentials, accounts, objects, webhook secrets, and operation
  records must never be mixed.
- Never copy a provider identifier from one sandbox or platform into another.
- Never print credentials, provider account identifiers, onboarding URLs, or
  personal data in logs or CI.
- Rotate each credential independently and record only secret-manager
  references and versions in future persistence.
- Restricted keys should grant only the resources needed by their component.
- Live credential support requires a separate human-approved phase and must not
  be enabled by changing a prefix check alone.

The current Worker requires read access to the platform account and balance,
and write access to connected accounts, account links, PaymentIntents, and
transfers. Remove balance read access when the connectivity endpoint is retired.
Refund, dispute-evidence, and payout permissions are not required by Phase 1.
