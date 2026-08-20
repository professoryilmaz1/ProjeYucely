import base from "./index.js";

function securityHeaders(response) {
  const out = new Response(response.body, response);
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.set("x-frame-options", "DENY");
  out.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  out.headers.set("permissions-policy", "geolocation=(self)");
  return out;
}

export default {
  async fetch(request, env, ctx) {
    try {
      return securityHeaders(await base.fetch(request, env, ctx));
    } catch (error) {
      console.error("krevuno.runtime.unhandled", {
        message: error instanceof Error ? error.message : String(error),
        path: new URL(request.url).pathname,
      });
      return securityHeaders(
        new Response(
          JSON.stringify({ ok: false, error: "INTERNAL_ERROR" }),
          {
            status: 500,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            },
          }
        )
      );
    }
  },

  async scheduled(controller, env, ctx) {
    if (typeof base.scheduled === "function") {
      return base.scheduled(controller, env, ctx);
    }
  },
};
