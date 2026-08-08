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
