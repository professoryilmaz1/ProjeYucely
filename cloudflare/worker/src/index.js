const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...headers,
    },
  });

function securityHeaders(resp) {
  const h = new Headers(resp.headers);

  h.set("x-frame-options", "DENY");
  h.set("permissions-policy", "camera=(), microphone=(), geolocation=(self)");
  h.set("strict-transport-security", "max-age=31536000; includeSubDomains");

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: h,
  });
}

function getStripeTestKey(env) {
  const key = env.STRIPE_SECRET_KEY || "";

  if (
    !key.startsWith("rk_test_") &&
    !key.startsWith("sk_test_")
  ) {
    return null;
  }

  return key;
}

function isAdminRequest(request, env) {
  const configured = env.CONNECT_ADMIN_TOKEN || "";
  const supplied = request.headers.get("x-admin-token") || "";

  if (!configured || !supplied) return false;

  return supplied === configured;
}

async function stripeRequest(url, stripeKey, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      ...(options.headers || {}),
    },
  });

  let data;

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

async function serveAsset(request, env) {
  if (!env.ASSETS?.fetch) return null;

  const response = await env.ASSETS.fetch(request);
  return response.status === 404 ? null : response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const stripeKey = getStripeTestKey(env);

    // -----------------------------
    // HEALTH
    // -----------------------------

    if (request.method === "GET" && url.pathname === "/health") {
      return securityHeaders(
        json({
          ok: true,
          service: "projeyucely-cloudflare-edge",
          version: "2.1.0-cf3",
          stripe_configured: Boolean(env.STRIPE_SECRET_KEY),
          stripe_test_key: Boolean(stripeKey),
          connect_admin_configured: Boolean(env.CONNECT_ADMIN_TOKEN),
        })
      );
    }

    // -----------------------------
    // STRIPE CONNECTION TEST
    // -----------------------------

    if (request.method === "GET" && url.pathname === "/stripe/test") {
      if (!stripeKey) {
        return securityHeaders(
          json(
            {
              ok: false,
              error: "STRIPE_TEST_KEY_REQUIRED",
            },
            403
          )
        );
      }

      const stripe = await stripeRequest(
        "https://api.stripe.com/v1/balance",
        stripeKey,
        { method: "GET" }
      );

      if (!stripe.ok) {
        return securityHeaders(
          json(
            {
              ok: false,
              stripe_connected: false,
              stripe_status: stripe.status,
              error:
                stripe.data?.error?.type ||
                "STRIPE_AUTH_FAILED",
              message:
                stripe.data?.error?.message ||
                "Stripe request failed",
            },
            502
          )
        );
      }

      return securityHeaders(
        json({
          ok: true,
          stripe_connected: true,
          livemode: Boolean(stripe.data.livemode),
          object: stripe.data.object || null,
        })
      );
    }

    // -----------------------------
    // CREATE CONNECTED ACCOUNT
    // -----------------------------

    if (
      request.method === "POST" &&
      url.pathname === "/connect/account"
    ) {
      if (!stripeKey) {
        return securityHeaders(
          json(
            {
              ok: false,
              error: "STRIPE_TEST_KEY_REQUIRED",
            },
            403
          )
        );
      }

      if (!isAdminRequest(request, env)) {
        return securityHeaders(
          json(
            {
              ok: false,
              error: "UNAUTHORIZED",
            },
            401
          )
        );
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return securityHeaders(
          json(
            {
              ok: false,
              error: "INVALID_JSON",
            },
            400
          )
        );
      }

      const email =
        typeof body?.email === "string"
          ? body.email.trim()
          : "";

      const displayName =
        typeof body?.display_name === "string"
          ? body.display_name.trim()
          : "";

      const country =
        typeof body?.country === "string"
          ? body.country.trim().toLowerCase()
          : "us";

      if (!email || !displayName) {
        return securityHeaders(
          json(
            {
              ok: false,
              error: "EMAIL_AND_DISPLAY_NAME_REQUIRED",
            },
            400
          )
        );
      }

      const accountPayload = {
        contact_email: email,
        display_name: displayName,

        defaults: {
          responsibilities: {
            fees_collector: "application",
            losses_collector: "application",
          },
        },

        dashboard: "express",

        identity: {
          country,
        },

        configuration: {
          recipient: {
            capabilities: {
              stripe_balance: {
                stripe_transfers: {
                  requested: true,
                },
              },
            },
          },
        },

        include: [
          "configuration.recipient",
          "identity",
          "requirements",
        ],
      };

      const stripe = await stripeRequest(
        "https://api.stripe.com/v2/core/accounts",
        stripeKey,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Stripe-Version": "2026-07-29.preview",
          },
          body: JSON.stringify(accountPayload),
        }
      );

      if (!stripe.ok) {
        return securityHeaders(
          json(
            {
              ok: false,
              error: "CONNECTED_ACCOUNT_CREATE_FAILED",
              stripe_status: stripe.status,
              stripe_error:
                stripe.data?.error?.type || null,
              message:
                stripe.data?.error?.message ||
                "Stripe account creation failed",
            },
            502
          )
        );
      }

      return securityHeaders(
        json({
          ok: true,
          account_created: true,
          account_id: stripe.data.id,
          livemode: Boolean(stripe.data.livemode),
        })
      );
    }

    // -----------------------------
    // CREATE HOSTED ONBOARDING LINK
    // -----------------------------

    if (
      request.method === "POST" &&
      url.pathname === "/connect/onboarding-link"
    ) {
      if (!stripeKey) {
        return securityHeaders(
          json(
            {
              ok: false,
              error: "STRIPE_TEST_KEY_REQUIRED",
            },
            403
          )
        );
      }

      if (!isAdminRequest(request, env)) {
        return securityHeaders(
          json(
            {
              ok: false,
              error: "UNAUTHORIZED",
            },
            401
          )
        );
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return securityHeaders(
          json(
            {
              ok: false,
              error: "INVALID_JSON",
            },
            400
          )
        );
      }

      const accountId =
        typeof body?.account_id === "string"
          ? body.account_id.trim()
          : "";

      if (!accountId.startsWith("acct_")) {
        return securityHeaders(
          json(
            {
              ok: false,
              error: "VALID_ACCOUNT_ID_REQUIRED",
            },
            400
          )
        );
      }

      const origin = url.origin;

      const accountLinkPayload = {
        account: accountId,

        use_case: {
          type: "account_onboarding",

          account_onboarding: {
            configurations: ["recipient"],

            collection_options: {
              fields: "eventually_due",
            },

            refresh_url:
              `${origin}/connect/refresh?account=` +
              encodeURIComponent(accountId),

            return_url:
              `${origin}/connect/return?account=` +
              encodeURIComponent(accountId),
          },
        },
      };

      const stripe = await stripeRequest(
        "https://api.stripe.com/v2/core/account_links",
        stripeKey,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Stripe-Version": "2026-07-29.preview",
          },
          body: JSON.stringify(accountLinkPayload),
        }
      );

      if (!stripe.ok) {
        return securityHeaders(
          json(
            {
              ok: false,
              error: "ONBOARDING_LINK_CREATE_FAILED",
              stripe_status: stripe.status,
              stripe_error:
                stripe.data?.error?.type || null,
              message:
                stripe.data?.error?.message ||
                "Stripe onboarding link creation failed",
            },
            502
          )
        );
      }

      return securityHeaders(
        json({
          ok: true,
          onboarding_ready: true,
          account_id: accountId,
          onboarding_url: stripe.data.url,
          expires_at: stripe.data.expires_at || null,
        })
      );
    }

    // -----------------------------
    // ONBOARDING RETURN
    // -----------------------------

    if (
      request.method === "GET" &&
      url.pathname === "/connect/return"
    ) {
      return securityHeaders(
        json({
          ok: true,
          onboarding_flow_returned: true,
          account_id: url.searchParams.get("account"),
          message:
            "Stripe onboarding flow returned to ProjeYucely. Account status must still be verified before payouts.",
        })
      );
    }

    // -----------------------------
    // EXPIRED/USED ONBOARDING LINK
    // -----------------------------

    if (
      request.method === "GET" &&
      url.pathname === "/connect/refresh"
    ) {
      return securityHeaders(
        json(
          {
            ok: false,
            error: "ONBOARDING_LINK_REFRESH_REQUIRED",
            account_id: url.searchParams.get("account"),
            message:
              "Create a new authenticated onboarding link from the ProjeYucely application.",
          },
          409
        )
      );
    }

    // -----------------------------
    // CORE API MIGRATION GATE
    // -----------------------------

    if (url.pathname.startsWith("/v1/")) {
      return securityHeaders(
        json(
          {
            error: "API_MIGRATION_IN_PROGRESS",
            message:
              "Core API remains disabled on Cloudflare until D1-backed persistence and auth migration pass regression tests.",
          },
          503
        )
      );
    }

    const asset = await serveAsset(request, env);

    if (asset) {
      return securityHeaders(asset);
    }

    return securityHeaders(
      json(
        {
          error: "NOT_FOUND",
        },
        404
      )
    );
  },
};
