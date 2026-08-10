import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const ADMIN_FIXTURE = "not-a-secret";
const PLATFORM_FIXTURE = "acct_fixture_platform";
const CONNECTED_FIXTURE = "acct_fixture_connected";

const boundaryConfig = (overrides = {}) => ({
  mode: "test",
  platform_account_id: PLATFORM_FIXTURE,
  connected_accounts: {
    worker_fixture: {
      account_id: CONNECTED_FIXTURE,
      status: "ready",
      api: "v2",
    },
  },
  marketplace_operations: {
    operation_fixture: {
      operation_id: "approved-operation-fixture",
      connected_account_reference: "worker_fixture",
      amount: 10_000,
      currency: "usd",
      fee_bps: 500,
      status: "approved",
    },
  },
  ...overrides,
});

const baseEnv = (overrides = {}) => ({
  STRIPE_SECRET_KEY: "rk_test_x",
  CONNECT_ADMIN_TOKEN: ADMIN_FIXTURE,
  STRIPE_BOUNDARY_CONFIG: boundaryConfig(),
  CONNECT_ALLOWED_ORIGINS: "https://worker.example",
  CONNECT_RETURN_ORIGIN: "https://worker.example",
  ...overrides,
});

function jsonProviderResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function readyConnectedAccount(overrides = {}) {
  return {
    id: CONNECTED_FIXTURE,
    livemode: false,
    status: "active",
    details_submitted: true,
    payouts_enabled: true,
    requirements: { currently_due: [], disabled_reason: null },
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: { status: "active" },
          },
        },
      },
    },
    ...overrides,
  };
}

function installStripeMock(
  mock,
  { connectedAccount = readyConnectedAccount(), transferStatus = 200 } = {}
) {
  const calls = [];
  mock.method(globalThis, "fetch", async (url, options = {}) => {
    const requestUrl = String(url);
    calls.push({ url: requestUrl, options });

    if (requestUrl.endsWith("/v1/account")) {
      return jsonProviderResponse({
        id: PLATFORM_FIXTURE,
        livemode: false,
      });
    }
    if (
      requestUrl.includes("/v2/core/accounts/") &&
      options.method === "GET"
    ) {
      return jsonProviderResponse(connectedAccount);
    }
    if (
      requestUrl.endsWith("/v2/core/accounts") &&
      options.method === "POST"
    ) {
      return jsonProviderResponse({
        id: CONNECTED_FIXTURE,
        livemode: false,
      });
    }
    if (requestUrl.endsWith("/v2/core/account_links")) {
      return jsonProviderResponse({
        object: "account_link",
        url: "https://connect.stripe.example/fixture",
        expires_at: 1_900_000_000,
      });
    }
    if (requestUrl.endsWith("/v1/balance")) {
      return jsonProviderResponse({
        object: "balance",
        livemode: false,
      });
    }
    if (requestUrl.endsWith("/v1/payment_intents")) {
      return jsonProviderResponse({
        id: "pi_fixture",
        status: "succeeded",
        latest_charge: "ch_fixture",
      });
    }
    if (requestUrl.endsWith("/v1/transfers")) {
      return jsonProviderResponse(
        transferStatus === 200
          ? { id: "tr_fixture" }
          : {
              error: {
                type: "invalid_request_error",
                message: "provider detail must not escape",
              },
            },
        transferStatus
      );
    }

    throw new Error(`Unexpected provider URL in test: ${requestUrl}`);
  });
  return calls;
}

function adminHeaders(extra = {}) {
  return {
    "x-admin-token": ADMIN_FIXTURE,
    ...extra,
  };
}

function jsonRequest(path, body, { headers = {}, method = "POST" } = {}) {
  return new Request(`https://worker.example${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function responseJson(response) {
  return response.json();
}

test("GET /health preserves version and applies security headers", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/health"),
    {}
  );
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.version, "2.1.0-cf4");
  assert.equal(body.ok, true);
  assert.equal(body.stripe_configured, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("x-correlation-id"), /^[0-9a-f-]{36}$/);
});

test("important routes reject unsupported HTTP methods", async () => {
  const cases = [
    ["POST", "/health"],
    ["POST", "/stripe/test"],
    ["GET", "/connect/account"],
    ["GET", "/connect/onboarding-link"],
    ["GET", "/payments/test-marketplace"],
    ["POST", "/connect/return"],
    ["POST", "/connect/refresh"],
  ];

  for (const [method, path] of cases) {
    const response = await worker.fetch(
      new Request(`https://worker.example${path}`, { method }),
      {}
    );
    assert.equal(response.status, 404, `${method} ${path}`);
  }
});

test("unknown routes return a secured 404", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/unknown"),
    {}
  );
  assert.equal(response.status, 404);
  assert.equal((await responseJson(response)).error, "NOT_FOUND");
  assert.equal(
    response.headers.get("cross-origin-resource-policy"),
    "same-origin"
  );
});

test("asset passthrough retains Worker security headers", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/asset.txt"),
    {
      ASSETS: {
        fetch: async () =>
          new Response("asset", {
            status: 200,
            headers: { "content-type": "text/plain" },
          }),
      },
    }
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("GET /stripe/test requires a sandbox key and admin authorization", async () => {
  const noKey = await worker.fetch(
    new Request("https://worker.example/stripe/test"),
    { CONNECT_ADMIN_TOKEN: ADMIN_FIXTURE }
  );
  assert.equal(noKey.status, 403);
  assert.equal((await responseJson(noKey)).error, "STRIPE_TEST_KEY_REQUIRED");

  const unauthorized = await worker.fetch(
    new Request("https://worker.example/stripe/test"),
    baseEnv()
  );
  assert.equal(unauthorized.status, 401);
  assert.equal((await responseJson(unauthorized)).error, "UNAUTHORIZED");
});

test("live Stripe credential prefixes are always rejected", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/stripe/test", {
      headers: adminHeaders(),
    }),
    baseEnv({ STRIPE_SECRET_KEY: "rk_live_x" })
  );
  assert.equal(response.status, 403);
  assert.equal(
    (await responseJson(response)).error,
    "STRIPE_TEST_KEY_REQUIRED"
  );
});

test("GET /stripe/test makes an authenticated, sanitized connectivity check", async (t) => {
  const calls = installStripeMock(t.mock);
  const response = await worker.fetch(
    new Request("https://worker.example/stripe/test", {
      headers: adminHeaders(),
    }),
    baseEnv()
  );
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.stripe_connected, true);
  assert.equal(body.livemode, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].options.headers.Authorization, /^Bearer rk_test_/);
});

test("provider errors are replaced by stable public errors", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonProviderResponse(
      {
        error: {
          message: "sensitive provider detail",
          type: "provider_internal",
        },
      },
      403
    )
  );
  const response = await worker.fetch(
    new Request("https://worker.example/stripe/test", {
      headers: adminHeaders(),
    }),
    baseEnv()
  );
  const text = await response.text();

  assert.equal(response.status, 502);
  assert.match(text, /STRIPE_CONNECTION_FAILED/);
  assert.doesNotMatch(text, /sensitive provider detail|provider_internal/);
});

test("admin POST routes reject missing authorization", async () => {
  const paths = [
    "/connect/account",
    "/connect/onboarding-link",
    "/payments/test-marketplace",
  ];
  for (const path of paths) {
    const response = await worker.fetch(jsonRequest(path, {}), baseEnv());
    assert.equal(response.status, 401, path);
    assert.equal((await responseJson(response)).error, "UNAUTHORIZED");
  }
});

test("JSON parsing enforces content type, syntax, object bodies and maximum size", async () => {
  const wrongType = await worker.fetch(
    new Request("https://worker.example/connect/account", {
      method: "POST",
      headers: adminHeaders({ "content-type": "text/plain" }),
      body: "{}",
    }),
    baseEnv()
  );
  assert.equal(wrongType.status, 415);

  const malformed = await worker.fetch(
    new Request("https://worker.example/connect/account", {
      method: "POST",
      headers: adminHeaders({ "content-type": "application/json" }),
      body: "{",
    }),
    baseEnv()
  );
  assert.equal(malformed.status, 400);
  assert.equal((await responseJson(malformed)).error, "INVALID_JSON");

  const arrayBody = await worker.fetch(
    new Request("https://worker.example/connect/account", {
      method: "POST",
      headers: adminHeaders({ "content-type": "application/json" }),
      body: "[]",
    }),
    baseEnv()
  );
  assert.equal(arrayBody.status, 400);
  assert.equal((await responseJson(arrayBody)).error, "JSON_OBJECT_REQUIRED");

  const oversized = await worker.fetch(
    jsonRequest(
      "/connect/account",
      { email: `${"x".repeat(33_000)}@example.test` },
      { headers: adminHeaders() }
    ),
    baseEnv()
  );
  assert.equal(oversized.status, 413);
  assert.equal(
    (await responseJson(oversized)).error,
    "REQUEST_BODY_TOO_LARGE"
  );
});

test("POST /connect/account validates fields and uses deterministic idempotency", async (t) => {
  const calls = installStripeMock(t.mock);

  const invalid = await worker.fetch(
    jsonRequest(
      "/connect/account",
      { email: "invalid", display_name: "Fixture" },
      { headers: adminHeaders() }
    ),
    baseEnv()
  );
  assert.equal(invalid.status, 400);
  assert.equal((await responseJson(invalid)).error, "VALID_EMAIL_REQUIRED");

  const response = await worker.fetch(
    jsonRequest(
      "/connect/account",
      {
        email: "fixture@example.test",
        display_name: "Fixture",
        country: "us",
      },
      { headers: adminHeaders() }
    ),
    baseEnv()
  );
  const body = await responseJson(response);
  const createCall = calls.find((call) =>
    call.url.endsWith("/v2/core/accounts")
  );

  assert.equal(response.status, 200);
  assert.equal(body.account_created, true);
  assert.equal("account_id" in body, false);
  assert.match(
    createCall.options.headers["idempotency-key"],
    /^projeyucely_connect_account_v1_/
  );
  assert.equal(
    JSON.parse(createCall.options.body).identity.country,
    "US"
  );
});

test("POST /connect/onboarding-link requires trusted mapping and allowlisted origin", async (t) => {
  const calls = installStripeMock(t.mock);
  const disallowed = await worker.fetch(
    jsonRequest(
      "/connect/onboarding-link",
      { account_reference: "worker_fixture" },
      { headers: adminHeaders() }
    ),
    baseEnv({
      CONNECT_ALLOWED_ORIGINS: "https://different.example",
      CONNECT_RETURN_ORIGIN: "",
    })
  );
  assert.equal(disallowed.status, 403);
  assert.equal(
    (await responseJson(disallowed)).error,
    "CONNECT_ORIGIN_NOT_ALLOWED"
  );

  const response = await worker.fetch(
    jsonRequest(
      "/connect/onboarding-link",
      { account_reference: "worker_fixture" },
      { headers: adminHeaders() }
    ),
    baseEnv()
  );
  const body = await responseJson(response);
  const linkCall = calls.find((call) =>
    call.url.endsWith("/v2/core/account_links")
  );
  const providerBody = JSON.parse(linkCall.options.body);

  assert.equal(response.status, 200);
  assert.equal(body.onboarding_ready, true);
  assert.equal("account_id" in body, false);
  assert.equal(
    providerBody.use_case.account_onboarding.return_url,
    "https://worker.example/connect/return"
  );
  assert.equal(
    providerBody.use_case.account_onboarding.refresh_url,
    "https://worker.example/connect/refresh"
  );
});

test("payment request rejects caller-controlled financial fields before Stripe", async (t) => {
  const calls = installStripeMock(t.mock);
  const response = await worker.fetch(
    jsonRequest(
      "/payments/test-marketplace",
      {
        operation_reference: "operation_fixture",
        amount: 1,
        fee_bps: 0,
      },
      { headers: adminHeaders() }
    ),
    baseEnv()
  );
  assert.equal(response.status, 400);
  assert.equal((await responseJson(response)).error, "UNKNOWN_REQUEST_FIELD");
  assert.equal(calls.length, 0);
});

test("invalid server-side amount and fee configuration are rejected", async () => {
  const operation = boundaryConfig().marketplace_operations.operation_fixture;
  const invalidAmount = boundaryConfig({
    marketplace_operations: {
      operation_fixture: { ...operation, amount: 99 },
    },
  });
  const amountResponse = await worker.fetch(
    jsonRequest(
      "/payments/test-marketplace",
      { operation_reference: "operation_fixture" },
      { headers: adminHeaders() }
    ),
    baseEnv({ STRIPE_BOUNDARY_CONFIG: invalidAmount })
  );
  assert.equal(amountResponse.status, 400);
  assert.equal((await responseJson(amountResponse)).error, "INVALID_AMOUNT");

  const invalidFee = boundaryConfig({
    marketplace_operations: {
      operation_fixture: { ...operation, fee_bps: 3_001 },
    },
  });
  const feeResponse = await worker.fetch(
    jsonRequest(
      "/payments/test-marketplace",
      { operation_reference: "operation_fixture" },
      { headers: adminHeaders() }
    ),
    baseEnv({ STRIPE_BOUNDARY_CONFIG: invalidFee })
  );
  assert.equal(feeResponse.status, 400);
  assert.equal((await responseJson(feeResponse)).error, "INVALID_FEE_BPS");
});

test("unknown or mismatched accounts are rejected before PaymentIntent creation", async (t) => {
  const mismatched = readyConnectedAccount({ id: "acct_fixture_other" });
  const calls = installStripeMock(t.mock, { connectedAccount: mismatched });
  const response = await worker.fetch(
    jsonRequest(
      "/payments/test-marketplace",
      { operation_reference: "operation_fixture" },
      { headers: adminHeaders() }
    ),
    baseEnv()
  );

  assert.equal(response.status, 409);
  assert.equal(
    (await responseJson(response)).error,
    "CONNECTED_ACCOUNT_SCOPE_MISMATCH"
  );
  assert.equal(
    calls.some((call) => call.url.endsWith("/v1/payment_intents")),
    false
  );
});

test("platform scope mismatch is rejected before connected-account or payment access", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return jsonProviderResponse({
      id: "acct_fixture_wrong_platform",
      livemode: false,
    });
  });
  const response = await worker.fetch(
    jsonRequest(
      "/payments/test-marketplace",
      { operation_reference: "operation_fixture" },
      { headers: adminHeaders() }
    ),
    baseEnv()
  );
  assert.equal(response.status, 409);
  assert.equal(
    (await responseJson(response)).error,
    "STRIPE_PLATFORM_SCOPE_MISMATCH"
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.endsWith("/v1/account"), true);
});

test("connected account readiness is verified before charging", async (t) => {
  const calls = installStripeMock(t.mock, {
    connectedAccount: readyConnectedAccount({ payouts_enabled: false }),
  });
  const response = await worker.fetch(
    jsonRequest(
      "/payments/test-marketplace",
      { operation_reference: "operation_fixture" },
      { headers: adminHeaders() }
    ),
    baseEnv()
  );
  assert.equal(response.status, 409);
  assert.equal(
    (await responseJson(response)).error,
    "CONNECTED_ACCOUNT_NOT_READY"
  );
  assert.equal(
    calls.some((call) => call.url.endsWith("/v1/payment_intents")),
    false
  );
});

test("marketplace payment uses server-controlled terms and deterministic idempotency", async (t) => {
  const calls = installStripeMock(t.mock);
  const response = await worker.fetch(
    jsonRequest(
      "/payments/test-marketplace",
      { operation_reference: "operation_fixture" },
      { headers: adminHeaders() }
    ),
    baseEnv()
  );
  const body = await responseJson(response);
  const paymentCall = calls.find((call) =>
    call.url.endsWith("/v1/payment_intents")
  );
  const transferCall = calls.find((call) =>
    call.url.endsWith("/v1/transfers")
  );
  const paymentForm = Object.fromEntries(
    new URLSearchParams(paymentCall.options.body)
  );
  const transferForm = Object.fromEntries(
    new URLSearchParams(transferCall.options.body)
  );

  assert.equal(response.status, 200);
  assert.equal(body.state, "PAYMENT_AND_TRANSFER_SUCCEEDED");
  assert.equal(body.amount_cents, 10_000);
  assert.equal(body.platform_fee_cents, 500);
  assert.equal(body.worker_transfer_cents, 9_500);
  assert.equal(paymentForm.amount, "10000");
  assert.equal(paymentForm.currency, "usd");
  assert.equal(transferForm.amount, "9500");
  assert.equal(transferForm.destination, CONNECTED_FIXTURE);
  assert.match(
    paymentCall.options.headers["idempotency-key"],
    /^projeyucely_payment_v1_/
  );
  assert.match(
    transferCall.options.headers["idempotency-key"],
    /^projeyucely_transfer_v1_/
  );
  assert.equal("payment_intent_id" in body, false);
  assert.equal("transfer_id" in body, false);
});

test("transfer failure yields a deterministic reconciliation state without provider details", async (t) => {
  const calls = installStripeMock(t.mock, { transferStatus: 400 });
  const request = () =>
    jsonRequest(
      "/payments/test-marketplace",
      { operation_reference: "operation_fixture" },
      { headers: adminHeaders() }
    );
  const first = await worker.fetch(request(), baseEnv());
  const firstBody = await responseJson(first);
  const second = await worker.fetch(request(), baseEnv());
  const secondBody = await responseJson(second);
  const paymentCalls = calls.filter((call) =>
    call.url.endsWith("/v1/payment_intents")
  );
  const transferCalls = calls.filter((call) =>
    call.url.endsWith("/v1/transfers")
  );

  assert.equal(first.status, 502);
  assert.equal(firstBody.state, "PAYMENT_SUCCEEDED_TRANSFER_PENDING");
  assert.equal(firstBody.payment_succeeded, true);
  assert.equal(firstBody.transfer_succeeded, false);
  assert.equal(firstBody.retry_creates_new_charge, false);
  assert.equal(firstBody.reconciliation_required, true);
  assert.equal(firstBody.correlation_id, secondBody.correlation_id);
  assert.equal(
    paymentCalls[0].options.headers["idempotency-key"],
    paymentCalls[1].options.headers["idempotency-key"]
  );
  assert.equal(
    transferCalls[0].options.headers["idempotency-key"],
    transferCalls[1].options.headers["idempotency-key"]
  );
  assert.doesNotMatch(JSON.stringify(firstBody), /provider detail|pi_|ch_|tr_/);
});

test("security telemetry failure never changes a completed payment result", async (t) => {
  installStripeMock(t.mock);
  const response = await worker.fetch(
    jsonRequest(
      "/payments/test-marketplace",
      { operation_reference: "operation_fixture" },
      { headers: adminHeaders() }
    ),
    baseEnv({
      SECURITY_EVENTS: {
        writeDataPoint: () => {
          throw new Error("telemetry unavailable");
        },
      },
    })
  );
  assert.equal(response.status, 200);
  assert.equal(
    (await responseJson(response)).state,
    "PAYMENT_AND_TRANSFER_SUCCEEDED"
  );
});

test("Connect return is navigation only and does not reflect account input", async () => {
  const response = await worker.fetch(
    new Request(
      "https://worker.example/connect/return?account=acct_untrusted_input"
    ),
    {}
  );
  const body = await responseJson(response);
  assert.equal(response.status, 200);
  assert.equal(body.onboarding_flow_returned, true);
  assert.equal(body.onboarding_verified, false);
  assert.equal(JSON.stringify(body).includes("acct_untrusted_input"), false);
});

test("Connect refresh requires a new authenticated link", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/connect/refresh"),
    {}
  );
  const body = await responseJson(response);
  assert.equal(response.status, 409);
  assert.equal(body.error, "ONBOARDING_LINK_REFRESH_REQUIRED");
  assert.equal(body.onboarding_verified, false);
});

test("/v1/* remains disabled for every method", async () => {
  for (const method of ["GET", "POST", "DELETE"]) {
    const response = await worker.fetch(
      new Request("https://worker.example/v1/example", { method }),
      {}
    );
    assert.equal(response.status, 503);
    assert.equal(
      (await responseJson(response)).error,
      "API_MIGRATION_IN_PROGRESS"
    );
  }
});

test("optional Cloudflare rate-limit hook blocks before provider access", async (t) => {
  const calls = installStripeMock(t.mock);
  const response = await worker.fetch(
    new Request("https://worker.example/stripe/test", {
      headers: adminHeaders(),
    }),
    baseEnv({
      API_RATE_LIMITER: {
        limit: async () => ({ success: false }),
      },
    })
  );
  assert.equal(response.status, 429);
  assert.equal((await responseJson(response)).error, "RATE_LIMITED");
  assert.equal(calls.length, 0);
  assert.equal(response.headers.get("retry-after"), "60");
});
