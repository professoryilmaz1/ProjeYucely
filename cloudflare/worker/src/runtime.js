import base from "./index.js";
import { runWorldCountrySweep } from "./world-country-sweep.js";

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
      return securityHeaders(new Response(JSON.stringify({ ok: false, error: "INTERNAL_ERROR" }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      }));
    }
  },

  async scheduled(controller, env, ctx) {
    const minute = Number(String(controller.cron || "0 * * * *").trim().split(/\s+/)[0]);

    // Existing KREVUNO public providers run once per hour.
    if (minute === 0 && typeof base.scheduled === "function") {
      await base.scheduled(controller, env, ctx);
    }

    // Independent world scanner: all 150 countries are scanned every hour across
    // minute 0/20/40 shards. Public visibility still rolls out +10 countries/4h.
    ctx.waitUntil(
      runWorldCountrySweep(env, { cron: controller.cron })
        .then((result) => console.log("krevuno.world_country_sweep.completed", JSON.stringify(result)))
        .catch((error) => console.error("krevuno.world_country_sweep.failed", {
          message: error instanceof Error ? error.message : String(error),
          cron: controller.cron,
        }))
    );
  },
};
