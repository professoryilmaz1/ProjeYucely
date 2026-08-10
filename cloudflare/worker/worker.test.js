import "./test/worker-routes.test.js";

/*
 * Phase 0 false-test snapshot retained as review-only rollback context.
 *
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

async function serveAsset(request, env) {
  if (!env.ASSETS?.fetch) return null;

  const response = await env.ASSETS.fetch(request);
  return response.status === 404 ? null : response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const stripeKey = env.STRIPE_SECRET_KEY || "";

      return securityHeaders(
        json({
          ok: true,
          service: "projeyucely-cloudflare-edge",
          version: "2.1.0-cf2",
          stripe_configured: Boolean(stripeKey),
          stripe_test_key:
            stripeKey.startsWith("rk_test_") ||
            stripeKey.startsWith("sk_test_"),
        })
      );
    }

    if (request.method === "GET" && url.pathname === "/stripe/test") {
      const stripeKey = env.STRIPE_SECRET_KEY || "";

      if (!stripeKey) {
        return securityHeaders(
          json(
            {
              ok: false,
              error: "STRIPE_NOT_CONFIGURED",
            },
            500
          )
        );
      }

      if (
        !stripeKey.startsWith("rk_test_") &&
        !stripeKey.startsWith("sk_test_")
      ) {
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

      try {
        const response = await fetch("https://api.stripe.com/v1/balance", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${stripeKey}`,
          },
        });

        const data = await response.json();

        if (!response.ok) {
          return securityHeaders(
            json(
              {
                ok: false,
                stripe_connected: false,
                stripe_status: response.status,
                error: data?.error?.type || "STRIPE_AUTH_FAILED",
                message: data?.error?.message || "Stripe request failed",
              },
              502
            )
          );
        }

        return securityHeaders(
          json({
            ok: true,
            stripe_connected: true,
            livemode: Boolean(data.livemode),
            object: data.object || null,
          })
        );
      } catch {
        return securityHeaders(
          json(
            {
              ok: false,
              stripe_connected: false,
              error: "STRIPE_REQUEST_FAILED",
            },
            502
          )
        );
      }
    }

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
*/
