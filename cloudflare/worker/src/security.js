export const MAX_REQUEST_BODY_BYTES = 32 * 1024;

const SENSITIVE_FIELD =
  /(?:secret|token|authorization|password|credential|api[_-]?key|account[_-]?id|email|onboarding[_-]?url)/i;
const SENSITIVE_VALUE =
  /(?:\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+\b|\bwhsec_[A-Za-z0-9]+\b|\bacct_[A-Za-z0-9_]+\b)/g;

export class HttpError extends Error {
  constructor(status, code, details = null) {
    super(code);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createCorrelationId() {
  return crypto.randomUUID();
}

export async function deterministicId(prefix, value) {
  const bytes = new TextEncoder().encode(`${prefix}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const encoded = btoa(
    String.fromCharCode(...new Uint8Array(digest))
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

  return `${prefix}_${encoded.slice(0, 32)}`;
}

export async function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  if (!left || !right) return false;

  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;

  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }

  return difference === 0 && left.length === right.length;
}

export async function isAdminRequest(request, env) {
  const configured = env.CONNECT_ADMIN_TOKEN || "";
  const supplied = request.headers.get("x-admin-token") || "";
  return constantTimeEqual(configured, supplied);
}

export function requireString(
  value,
  {
    code = "INVALID_STRING",
    minLength = 1,
    maxLength = 256,
    pattern = null,
    normalize = (input) => input.trim(),
  } = {}
) {
  if (typeof value !== "string") throw new HttpError(400, code);
  const normalized = normalize(value);
  if (
    normalized.length < minLength ||
    normalized.length > maxLength ||
    (pattern && !pattern.test(normalized))
  ) {
    throw new HttpError(400, code);
  }
  return normalized;
}

export function requireInteger(
  value,
  { code = "INVALID_INTEGER", min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}
) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, code);
  }
  return value;
}

export function validateAllowedFields(body, allowedFields) {
  const unknown = Object.keys(body).filter((key) => !allowedFields.includes(key));
  if (unknown.length > 0) throw new HttpError(400, "UNKNOWN_REQUEST_FIELD");
}

export async function parseJsonRequest(
  request,
  { maxBytes = MAX_REQUEST_BODY_BYTES, allowedFields = null } = {}
) {
  const contentType = request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new HttpError(415, "JSON_CONTENT_TYPE_REQUIRED");
  }

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)
  ) {
    throw new HttpError(413, "REQUEST_BODY_TOO_LARGE");
  }

  if (!request.body) throw new HttpError(400, "INVALID_JSON");

  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "REQUEST_BODY_TOO_LARGE");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "INVALID_JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "JSON_OBJECT_REQUIRED");
  }
  if (allowedFields) validateAllowedFields(body, allowedFields);
  return body;
}

function redactString(value) {
  return value.replace(SENSITIVE_VALUE, "[REDACTED]");
}

export function redactForLogging(value, depth = 0) {
  if (depth > 6) return "[MAX_DEPTH]";
  if (typeof value === "string") return redactString(value).slice(0, 512);
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactForLogging(item, depth + 1));
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_FIELD.test(key)
        ? "[REDACTED]"
        : redactForLogging(item, depth + 1),
    ])
  );
}

export function requestIndicators(request) {
  const cf = request.cf || {};
  return {
    source_ip_present: Boolean(request.headers.get("cf-connecting-ip")),
    country: typeof cf.country === "string" ? cf.country : null,
    asn: Number.isInteger(cf.asn) ? cf.asn : null,
    colo: typeof cf.colo === "string" ? cf.colo : null,
    bot_score: Number.isFinite(cf.botManagement?.score)
      ? cf.botManagement.score
      : null,
    verified_bot: cf.botManagement?.verifiedBot === true,
  };
}

export function createSecurityEvent({
  type,
  severity = "INFO",
  request,
  correlationId,
  route,
  outcome,
  metadata = {},
}) {
  return {
    schema_version: 1,
    timestamp: new Date().toISOString(),
    type,
    severity,
    correlation_id: correlationId,
    method: request.method,
    route,
    outcome,
    indicators: requestIndicators(request),
    anomaly_score: null,
    fraud_score: null,
    matched_iocs: [],
    containment_action: null,
    deception_signal: false,
    metadata: redactForLogging(metadata),
  };
}

export function emitSecurityEvent(event, env = {}) {
  const safeEvent = redactForLogging(event);
  try {
    console.log(JSON.stringify(safeEvent));
  } catch {}

  if (env.SECURITY_EVENTS?.writeDataPoint) {
    try {
      env.SECURITY_EVENTS.writeDataPoint({
        blobs: [
          String(safeEvent.type || "UNKNOWN"),
          String(safeEvent.severity || "INFO"),
          String(safeEvent.outcome || "UNKNOWN"),
          String(safeEvent.route || "UNKNOWN"),
          String(safeEvent.indicators?.country || "UNKNOWN"),
        ],
        doubles: [
          Number(safeEvent.indicators?.asn || 0),
          Number(safeEvent.indicators?.bot_score || 0),
        ],
        indexes: [String(safeEvent.correlation_id || "UNKNOWN")],
      });
    } catch {}
  }
}

export async function applyAbuseControls({
  request,
  env,
  route,
  correlationId,
}) {
  const source = request.headers.get("cf-connecting-ip") || "unknown";

  if (env.API_RATE_LIMITER?.limit) {
    const result = await env.API_RATE_LIMITER.limit({
      key: `${route}:${source}`,
    });
    if (!result.success) {
      const event = createSecurityEvent({
        type: "RATE_LIMIT_EXCEEDED",
        severity: "MEDIUM",
        request,
        correlationId,
        route,
        outcome: "BLOCKED",
      });
      emitSecurityEvent(event, env);
      throw new HttpError(429, "RATE_LIMITED");
    }
  }

  // Future WAF, Turnstile, anomaly, fraud, IOC, containment and isolated
  // defensive-deception providers attach at this boundary. No caller header
  // is treated as proof that any such control has passed.
  return {
    correlation_id: correlationId,
    indicators: requestIndicators(request),
    turnstile: "NOT_CONFIGURED",
    anomaly_score: null,
    fraud_score: null,
    matched_iocs: [],
  };
}

export function secureJson(body, status = 200, correlationId = null, headers = {}) {
  const responseHeaders = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=(self)",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "cross-origin-resource-policy": "same-origin",
    ...headers,
  });
  if (correlationId) responseHeaders.set("x-correlation-id", correlationId);

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

export function secureResponse(response, correlationId = null) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(self)");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set("cross-origin-resource-policy", "same-origin");
  if (correlationId) headers.set("x-correlation-id", correlationId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function errorResponse(error, correlationId) {
  if (error instanceof HttpError) {
    return secureJson(
      {
        ok: false,
        error: error.code,
        correlation_id: correlationId,
      },
      error.status,
      correlationId,
      error.status === 429 ? { "retry-after": "60" } : {}
    );
  }

  return secureJson(
    {
      ok: false,
      error: "INTERNAL_ERROR",
      correlation_id: correlationId,
    },
    500,
    correlationId
  );
}
