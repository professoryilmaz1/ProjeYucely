import {
  HttpError,
  applyAbuseControls,
  createCorrelationId,
  createSecurityEvent,
  deterministicId,
  emitSecurityEvent,
  errorResponse,
  isAdminRequest,
  parseJsonRequest,
  requireString,
  secureJson,
  secureResponse,
} from "./security.js";
import {
  getStripeTestKey,
  loadStripeBoundaryConfig,
  paymentOperationIdentifiers,
  resolveAllowedConnectOrigin,
  resolveConnectedAccount,
  resolveMarketplaceOperation,
  retrieveAndVerifyConnectedAccount,
  verifyPlatformScope,
} from "./stripe-boundary.js";

const STRIPE_V2_VERSION = "2026-07-29.preview";

async function stripeRequest(url, stripeKey, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        ...(options.headers || {}),
      },
    });
  } catch {
    return { ok: false, status: 0, data: {}, networkError: true };
  }

  let data = {};
  try {
    data = await response.json();
  } catch {}

  return {
    ok: response.ok,
    status: response.status,
    data,
    networkError: false,
  };
}

async function stripeFormRequest(
  url,
  stripeKey,
  form,
  { idempotencyKey } = {}
) {
  return stripeRequest(url, stripeKey, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: form.toString(),
  });
}

async function serveAsset(request, env) {
  if (!env.ASSETS?.fetch) return null;
  const response = await env.ASSETS.fetch(request);
  return response.status === 404 ? null : response;
}

function requireStripeTestKey(env) {
  const key = getStripeTestKey(env);
  if (!key) throw new HttpError(403, "STRIPE_TEST_KEY_REQUIRED");
  return key;
}

async function authorizeAdmin({ request, env, route, correlationId }) {
  await applyAbuseControls({ request, env, route, correlationId });
  if (!(await isAdminRequest(request, env))) {
    emitSecurityEvent(
      createSecurityEvent({
        type: "ADMIN_AUTHORIZATION_FAILED",
        severity: "MEDIUM",
        request,
        correlationId,
        route,
        outcome: "BLOCKED",
      }),
      env
    );
    throw new HttpError(401, "UNAUTHORIZED");
  }
}

function stripeRequester(stripeKey) {
  return (url, options) => stripeRequest(url, stripeKey, options);
}

function emitAudit({
  request,
  env,
  correlationId,
  route,
  type,
  outcome,
  severity = "INFO",
  metadata = {},
}) {
  emitSecurityEvent(
    createSecurityEvent({
      type,
      severity,
      request,
      correlationId,
      route,
      outcome,
      metadata,
    }),
    env
  );
}

function accountPayload(body) {
  const email = requireString(body.email, {
    code: "VALID_EMAIL_REQUIRED",
    maxLength: 254,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    normalize: (value) => value.trim().toLowerCase(),
  });
  const displayName = requireString(body.display_name, {
    code: "VALID_DISPLAY_NAME_REQUIRED",
    maxLength: 100,
  });
  const country = requireString(body.country ?? "US", {
    code: "VALID_COUNTRY_REQUIRED",
    minLength: 2,
    maxLength: 2,
    pattern: /^[A-Za-z]{2}$/,
    normalize: (value) => value.trim().toUpperCase(),
  });

  return {
    email,
    displayName,
    country,
  };
}

async function handleHealth(env, correlationId) {
  const stripeKey = getStripeTestKey(env);
  return secureJson(
    {
      ok: true,
      service: "projeyucely-cloudflare-edge",
      version: "2.1.0-cf4",
      stripe_configured: Boolean(env.STRIPE_SECRET_KEY),
      stripe_test_key: Boolean(stripeKey),
      connect_admin_configured: Boolean(env.CONNECT_ADMIN_TOKEN),
    },
    200,
    correlationId
  );
}

async function handleStripeTest({ request, env, correlationId }) {
  const route = "/stripe/test";
  const stripeKey = requireStripeTestKey(env);
  await authorizeAdmin({ request, env, route, correlationId });
  const stripe = await stripeRequest(
    "https://api.stripe.com/v1/balance",
    stripeKey,
    { method: "GET" }
  );

  if (!stripe.ok) throw new HttpError(502, "STRIPE_CONNECTION_FAILED");

  return secureJson(
    {
      ok: true,
      stripe_connected: true,
      livemode: Boolean(stripe.data.livemode),
      object: stripe.data.object || null,
    },
    200,
    correlationId
  );
}

async function handleConnectAccount({ request, env, correlationId }) {
  const route = "/connect/account";
  const stripeKey = requireStripeTestKey(env);
  await authorizeAdmin({ request, env, route, correlationId });
  const body = await parseJsonRequest(request, {
    allowedFields: ["email", "display_name", "country"],
  });
  const input = accountPayload(body);
  const config = loadStripeBoundaryConfig(env);
  const requester = stripeRequester(stripeKey);

  await verifyPlatformScope({ config, stripeRequest: requester });

  const idempotencyKey = await deterministicId(
    "projeyucely_connect_account_v1",
    `${input.email}\u0000${input.displayName}\u0000${input.country}`
  );
  const stripe = await stripeRequest(
    "https://api.stripe.com/v2/core/accounts",
    stripeKey,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Stripe-Version": STRIPE_V2_VERSION,
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        contact_email: input.email,
        display_name: input.displayName,
        defaults: {
          responsibilities: {
            fees_collector: "application",
            losses_collector: "application",
          },
        },
        dashboard: "express",
        identity: { country: input.country },
        configuration: {
          recipient: {
            capabilities: {
              stripe_balance: {
                stripe_transfers: { requested: true },
              },
            },
          },
        },
        include: [
          "configuration.recipient",
          "identity",
          "requirements",
        ],
      }),
    }
  );

  if (!stripe.ok) {
    emitAudit({
      request,
      env,
      correlationId,
      route,
      type: "CONNECTED_ACCOUNT_CREATE_FAILED",
      outcome: "FAILED",
      severity: "MEDIUM",
      metadata: { provider_status: stripe.status },
    });
    throw new HttpError(502, "CONNECTED_ACCOUNT_CREATE_FAILED");
  }

  emitAudit({
    request,
    env,
    correlationId,
    route,
    type: "CONNECTED_ACCOUNT_CREATED",
    outcome: "SUCCEEDED",
  });
  return secureJson(
    {
      ok: true,
      account_created: true,
      livemode: false,
      correlation_id: correlationId,
      next_action:
        "Register the account in trusted server-side boundary configuration before onboarding or payment.",
    },
    200,
    correlationId
  );
}

async function handleOnboardingLink({ request, env, correlationId, url }) {
  const route = "/connect/onboarding-link";
  const stripeKey = requireStripeTestKey(env);
  await authorizeAdmin({ request, env, route, correlationId });
  const body = await parseJsonRequest(request, {
    allowedFields: ["account_reference"],
  });
  const config = loadStripeBoundaryConfig(env);
  const account = resolveConnectedAccount(config, body.account_reference, {
    requireConfiguredReady: false,
  });
  const origin = resolveAllowedConnectOrigin(env, url.origin);
  const requester = stripeRequester(stripeKey);

  await retrieveAndVerifyConnectedAccount({
    config,
    account,
    stripeRequest: requester,
    requireReady: false,
  });

  const stripe = await stripeRequest(
    "https://api.stripe.com/v2/core/account_links",
    stripeKey,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Stripe-Version": STRIPE_V2_VERSION,
      },
      body: JSON.stringify({
        account: account.accountId,
        use_case: {
          type: "account_onboarding",
          account_onboarding: {
            configurations: ["recipient"],
            collection_options: { fields: "eventually_due" },
            refresh_url: `${origin}/connect/refresh`,
            return_url: `${origin}/connect/return`,
          },
        },
      }),
    }
  );

  if (!stripe.ok || typeof stripe.data.url !== "string") {
    emitAudit({
      request,
      env,
      correlationId,
      route,
      type: "ONBOARDING_LINK_CREATE_FAILED",
      outcome: "FAILED",
      severity: "MEDIUM",
      metadata: { provider_status: stripe.status },
    });
    throw new HttpError(502, "ONBOARDING_LINK_CREATE_FAILED");
  }

  emitAudit({
    request,
    env,
    correlationId,
    route,
    type: "ONBOARDING_LINK_CREATED",
    outcome: "SUCCEEDED",
  });
  return secureJson(
    {
      ok: true,
      onboarding_ready: true,
      onboarding_url: stripe.data.url,
      expires_at: stripe.data.expires_at || null,
      correlation_id: correlationId,
    },
    200,
    correlationId
  );
}

async function handleMarketplacePayment({ request, env, correlationId }) {
  const route = "/payments/test-marketplace";
  const stripeKey = requireStripeTestKey(env);
  await authorizeAdmin({ request, env, route, correlationId });
  const body = await parseJsonRequest(request, {
    allowedFields: ["operation_reference"],
  });
  const operation = resolveMarketplaceOperation(
    env,
    body.operation_reference
  );
  const identifiers = await paymentOperationIdentifiers(operation.operationId);
  const operationCorrelationId = identifiers.correlationId;
  const requester = stripeRequester(stripeKey);

  await retrieveAndVerifyConnectedAccount({
    config: operation.config,
    account: operation.account,
    stripeRequest: requester,
    requireReady: true,
  });

  const paymentForm = new URLSearchParams();
  paymentForm.set("amount", String(operation.amount));
  paymentForm.set("currency", operation.currency);
  paymentForm.set("payment_method", "pm_card_visa");
  paymentForm.set("confirm", "true");
  paymentForm.set("payment_method_types[]", "card");
  paymentForm.set("description", "ProjeYucely sandbox marketplace test");
  paymentForm.set("metadata[platform]", "ProjeYucely");
  paymentForm.set("metadata[test]", "true");
  paymentForm.set("metadata[correlation_id]", operationCorrelationId);

  const payment = await stripeFormRequest(
    "https://api.stripe.com/v1/payment_intents",
    stripeKey,
    paymentForm,
    { idempotencyKey: identifiers.paymentIdempotencyKey }
  );

  if (!payment.ok) {
    emitAudit({
      request,
      env,
      correlationId: operationCorrelationId,
      route,
      type: "SANDBOX_PAYMENT_FAILED",
      outcome: "FAILED",
      severity: "MEDIUM",
      metadata: { provider_status: payment.status },
    });
    throw new HttpError(502, "TEST_PAYMENT_FAILED");
  }
  if (payment.data.status !== "succeeded") {
    throw new HttpError(409, "PAYMENT_NOT_SUCCEEDED");
  }
  if (typeof payment.data.latest_charge !== "string") {
    throw new HttpError(502, "CHARGE_REFERENCE_MISSING");
  }

  const transferForm = new URLSearchParams();
  transferForm.set("amount", String(operation.transferAmount));
  transferForm.set("currency", operation.currency);
  transferForm.set("destination", operation.account.accountId);
  transferForm.set("source_transaction", payment.data.latest_charge);
  transferForm.set("description", "ProjeYucely sandbox worker transfer");
  transferForm.set("metadata[platform]", "ProjeYucely");
  transferForm.set("metadata[test]", "true");
  transferForm.set("metadata[correlation_id]", operationCorrelationId);

  const transfer = await stripeFormRequest(
    "https://api.stripe.com/v1/transfers",
    stripeKey,
    transferForm,
    { idempotencyKey: identifiers.transferIdempotencyKey }
  );

  if (!transfer.ok) {
    emitAudit({
      request,
      env,
      correlationId: operationCorrelationId,
      route,
      type: "SANDBOX_TRANSFER_RECONCILIATION_REQUIRED",
      outcome: "PARTIAL_SUCCESS",
      severity: "HIGH",
      metadata: {
        state: "PAYMENT_SUCCEEDED_TRANSFER_PENDING",
        provider_status: transfer.status,
      },
    });
    return secureJson(
      {
        ok: false,
        state: "PAYMENT_SUCCEEDED_TRANSFER_PENDING",
        payment_succeeded: true,
        transfer_succeeded: false,
        retry_creates_new_charge: false,
        reconciliation_required: true,
        correlation_id: operationCorrelationId,
      },
      502,
      operationCorrelationId
    );
  }

  emitAudit({
    request,
    env,
    correlationId: operationCorrelationId,
    route,
    type: "SANDBOX_MARKETPLACE_PAYMENT_COMPLETED",
    outcome: "SUCCEEDED",
    metadata: { state: "PAYMENT_AND_TRANSFER_SUCCEEDED" },
  });
  return secureJson(
    {
      ok: true,
      state: "PAYMENT_AND_TRANSFER_SUCCEEDED",
      test_marketplace_payment: true,
      livemode: false,
      amount_cents: operation.amount,
      platform_fee_cents: operation.platformFee,
      worker_transfer_cents: operation.transferAmount,
      correlation_id: operationCorrelationId,
    },
    200,
    operationCorrelationId
  );
}

async function routeRequest(request, env, correlationId) {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return handleHealth(env, correlationId);
  }
  if (request.method === "GET" && url.pathname === "/stripe/test") {
    return handleStripeTest({ request, env, correlationId });
  }
  if (request.method === "POST" && url.pathname === "/connect/account") {
    return handleConnectAccount({ request, env, correlationId });
  }
  if (
    request.method === "POST" &&
    url.pathname === "/connect/onboarding-link"
  ) {
    return handleOnboardingLink({ request, env, correlationId, url });
  }
  if (
    request.method === "POST" &&
    url.pathname === "/payments/test-marketplace"
  ) {
    return handleMarketplacePayment({ request, env, correlationId });
  }
  if (request.method === "GET" && url.pathname === "/connect/return") {
    return secureJson(
      {
        ok: true,
        onboarding_flow_returned: true,
        onboarding_verified: false,
        next_action: "Verify account status through the authenticated API.",
        correlation_id: correlationId,
      },
      200,
      correlationId
    );
  }
  if (request.method === "GET" && url.pathname === "/connect/refresh") {
    return secureJson(
      {
        ok: false,
        error: "ONBOARDING_LINK_REFRESH_REQUIRED",
        onboarding_verified: false,
        correlation_id: correlationId,
      },
      409,
      correlationId
    );
  }
  if (url.pathname.startsWith("/v1/")) {
    return secureJson(
      {
        error: "API_MIGRATION_IN_PROGRESS",
        message:
          "Core API remains disabled on Cloudflare until persistence and auth migration pass regression tests.",
      },
      503,
      correlationId
    );
  }

  const asset = await serveAsset(request, env);
  if (asset) return secureResponse(asset, correlationId);

  return secureJson({ error: "NOT_FOUND" }, 404, correlationId);
}

export default {
  async fetch(request, env) {
    const correlationId = createCorrelationId();
    try {
      return await routeRequest(request, env, correlationId);
    } catch (error) {
      emitAudit({
        request,
        env,
        correlationId,
        route: new URL(request.url).pathname,
        type: "WORKER_REQUEST_FAILED",
        outcome: "FAILED",
        severity: error instanceof HttpError && error.status < 500 ? "LOW" : "HIGH",
        metadata: {
          error_code:
            error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        },
      });
      return errorResponse(error, correlationId);
    }
  },
};
