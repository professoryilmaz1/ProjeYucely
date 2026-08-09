const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  },
});

function securityHeaders(resp) {
  const h = new Headers(resp.headers);
  h.set('x-frame-options', 'DENY');
  h.set('permissions-policy', 'camera=(), microphone=(), geolocation=(self)');
  h.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: h
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

    if (request.method === 'GET' && url.pathname === '/health') {
      return securityHeaders(json({
        ok: true,
        service: 'projeyucely-cloudflare-edge',
        version: '2.1.0-cf1',
        stripe_configured: Boolean(env.STRIPE_SECRET_KEY),
        stripe_mode: env.STRIPE_MODE || 'disabled',
      }));
    }
if (request.method === 'GET' && url.pathname === '/stripe/test') {
  if (!env.STRIPE_SECRET_KEY) {
    return securityHeaders(json({
      ok: false,
      error: 'STRIPE_NOT_CONFIGURED'
    }, 500));
  }

  try {
    const response = await fetch('https://api.stripe.com/v1/account', {
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return securityHeaders(json({
        ok: false,
        stripe_status: response.status,
        error: data?.error?.type || 'STRIPE_AUTH_FAILED'
      }, 502));
    }

    return securityHeaders(json({
      ok: true,
      stripe_connected: true,
      livemode: Boolean(data.livemode),
      account_country: data.country || null,
      charges_enabled: Boolean(data.charges_enabled),
      payouts_enabled: Boolean(data.payouts_enabled)
    }));
  } catch {
    return securityHeaders(json({
      ok: false,
      error: 'STRIPE_REQUEST_FAILED'
    }, 502));
  }
}
    if (url.pathname.startsWith('/v1/')) {
      return securityHeaders(json({
        error: 'API_MIGRATION_IN_PROGRESS',
        message: 'Core API remains disabled on Cloudflare until D1-backed persistence and auth migration pass regression tests.'
      }, 503));
    }

    const asset = await serveAsset(request, env);
    if (asset) return securityHeaders(asset);

    return securityHeaders(json({ error: 'NOT_FOUND' }, 404));
  }
};
