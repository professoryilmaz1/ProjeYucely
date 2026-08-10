import {
  HttpError,
  deterministicId,
  requireInteger,
  requireString,
} from "./security.js";

const ACCOUNT_ID_PATTERN = /^acct_[A-Za-z0-9_]{3,}$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/;
const ACTIVE_CAPABILITY_STATES = new Set(["active", "enabled"]);

function configurationError() {
  return new HttpError(503, "STRIPE_BOUNDARY_CONFIG_INVALID");
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

export function getStripeTestKey(env) {
  const key = env.STRIPE_SECRET_KEY || "";
  if (!key.startsWith("rk_test_") && !key.startsWith("sk_test_")) return null;
  return key;
}

export function loadStripeBoundaryConfig(env) {
  let parsed = env.STRIPE_BOUNDARY_CONFIG;
  if (!parsed) throw new HttpError(503, "STRIPE_BOUNDARY_CONFIG_REQUIRED");

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw configurationError();
    }
  }

  const config = asRecord(parsed);
  if (
    !config ||
    config.mode !== "test" ||
    !ACCOUNT_ID_PATTERN.test(config.platform_account_id || "") ||
    !asRecord(config.connected_accounts) ||
    !asRecord(config.marketplace_operations)
  ) {
    throw configurationError();
  }

  return config;
}

export function resolveConnectedAccount(
  config,
  accountReference,
  { requireConfiguredReady = true } = {}
) {
  const reference = requireString(accountReference, {
    code: "VALID_ACCOUNT_REFERENCE_REQUIRED",
    pattern: REFERENCE_PATTERN,
    maxLength: 128,
  });
  const account = asRecord(config.connected_accounts[reference]);

  if (
    !account ||
    !ACCOUNT_ID_PATTERN.test(account.account_id || "") ||
    (requireConfiguredReady && account.status !== "ready") ||
    (!requireConfiguredReady &&
      !["onboarding", "ready"].includes(account.status)) ||
    !["v1", "v2"].includes(account.api)
  ) {
    throw new HttpError(409, "CONNECTED_ACCOUNT_NOT_READY");
  }

  return {
    reference,
    accountId: account.account_id,
    api: account.api,
    requiresCharges: account.requires_charges === true,
  };
}

export function resolveMarketplaceOperation(env, operationReference) {
  const config = loadStripeBoundaryConfig(env);
  const reference = requireString(operationReference, {
    code: "VALID_OPERATION_REFERENCE_REQUIRED",
    pattern: REFERENCE_PATTERN,
    maxLength: 128,
  });
  const operation = asRecord(config.marketplace_operations[reference]);

  if (!operation || operation.status !== "approved") {
    throw new HttpError(404, "MARKETPLACE_OPERATION_NOT_FOUND");
  }

  let operationId;
  let account;
  let amount;
  let feeBps;
  try {
    operationId = requireString(operation.operation_id, {
      code: "INVALID_OPERATION_CONFIG",
      pattern: REFERENCE_PATTERN,
      maxLength: 128,
    });
    account = resolveConnectedAccount(
      config,
      operation.connected_account_reference
    );
    amount = requireInteger(operation.amount, {
      code: "INVALID_AMOUNT",
      min: 100,
      max: 1_000_000,
    });
    feeBps = requireInteger(operation.fee_bps, {
      code: "INVALID_FEE_BPS",
      min: 0,
      max: 3_000,
    });
  } catch (error) {
    if (
      error instanceof HttpError &&
      ["INVALID_AMOUNT", "INVALID_FEE_BPS"].includes(error.code)
    ) {
      throw error;
    }
    throw configurationError();
  }

  if (operation.currency !== "usd") throw configurationError();

  const platformFee = Math.round((amount * feeBps) / 10_000);
  const transferAmount = amount - platformFee;
  if (transferAmount <= 0) throw configurationError();

  return {
    config,
    reference,
    operationId,
    account,
    amount,
    currency: "usd",
    feeBps,
    platformFee,
    transferAmount,
  };
}

function transferCapability(data) {
  return (
    data.capabilities?.transfers ??
    data.configuration?.recipient?.capabilities?.stripe_balance
      ?.stripe_transfers?.status ??
    null
  );
}

function capabilityIsActive(value) {
  if (value === true) return true;
  if (typeof value === "string") {
    return ACTIVE_CAPABILITY_STATES.has(value.toLowerCase());
  }
  return false;
}

function assertPlatform(platform, config) {
  if (
    !platform ||
    platform.id !== config.platform_account_id ||
    platform.livemode === true
  ) {
    throw new HttpError(409, "STRIPE_PLATFORM_SCOPE_MISMATCH");
  }
}

function assertConnectedAccount(data, account, { requireReady }) {
  if (!data || data.id !== account.accountId || data.livemode === true) {
    throw new HttpError(409, "CONNECTED_ACCOUNT_SCOPE_MISMATCH");
  }
  if (["closed", "disabled", "rejected"].includes(data.status)) {
    throw new HttpError(409, "CONNECTED_ACCOUNT_NOT_READY");
  }
  if (!requireReady) return;

  const currentlyDue = data.requirements?.currently_due;
  if (
    data.requirements?.disabled_reason ||
    (Array.isArray(currentlyDue) && currentlyDue.length > 0) ||
    data.details_submitted === false ||
    data.payouts_enabled === false ||
    !capabilityIsActive(transferCapability(data)) ||
    (account.requiresCharges && data.charges_enabled !== true)
  ) {
    throw new HttpError(409, "CONNECTED_ACCOUNT_NOT_READY");
  }
}

export async function verifyPlatformScope({
  config,
  stripeRequest,
}) {
  const platform = await stripeRequest(
    "https://api.stripe.com/v1/account",
    { method: "GET" }
  );
  if (!platform.ok) {
    throw new HttpError(502, "STRIPE_PLATFORM_VERIFICATION_FAILED");
  }
  assertPlatform(platform.data, config);
  return {
    testMode: true,
    platformVerified: true,
  };
}

export async function retrieveAndVerifyConnectedAccount({
  config,
  account,
  stripeRequest,
  requireReady = true,
}) {
  await verifyPlatformScope({ config, stripeRequest });

  const url =
    account.api === "v2"
      ? `https://api.stripe.com/v2/core/accounts/${encodeURIComponent(
          account.accountId
        )}`
      : `https://api.stripe.com/v1/accounts/${encodeURIComponent(
          account.accountId
        )}`;
  const headers =
    account.api === "v2"
      ? { "Stripe-Version": "2026-07-29.preview" }
      : undefined;
  const result = await stripeRequest(url, { method: "GET", headers });

  if (!result.ok) {
    throw new HttpError(409, "CONNECTED_ACCOUNT_SCOPE_MISMATCH");
  }
  assertConnectedAccount(result.data, account, { requireReady });

  return {
    testMode: true,
    platformVerified: true,
    accountVerified: true,
    ready: requireReady,
    transfersEnabled: capabilityIsActive(transferCapability(result.data)),
    payoutsEnabled: result.data.payouts_enabled !== false,
    chargesEnabled:
      !account.requiresCharges || result.data.charges_enabled === true,
  };
}

export function resolveAllowedConnectOrigin(env, requestOrigin) {
  const allowed = String(env.CONNECT_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const configured = String(env.CONNECT_RETURN_ORIGIN || "").trim();
  const candidate = configured || requestOrigin;

  if (!allowed.includes(candidate)) {
    throw new HttpError(403, "CONNECT_ORIGIN_NOT_ALLOWED");
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw configurationError();
  }
  if (!["https:", "http:"].includes(parsed.protocol)) throw configurationError();
  if (parsed.protocol === "http:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw configurationError();
  }
  return parsed.origin;
}

export async function paymentOperationIdentifiers(operationId) {
  const correlationId = await deterministicId("marketplace", operationId);
  return {
    correlationId,
    paymentIdempotencyKey: await deterministicId(
      "projeyucely_payment_v1",
      operationId
    ),
    transferIdempotencyKey: await deterministicId(
      "projeyucely_transfer_v1",
      operationId
    ),
  };
}
