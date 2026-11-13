// Клиент базы расписания: вызовы функций Supabase (PostgREST RPC) без библиотек.
// В браузере — window.KTApi, в Node — module.exports (для тестов).
(function (root) {
  class ApiError extends Error {
    constructor(message, code) { super(message); this.name = 'ApiError'; this.code = code; }
  }

  function withTimeout(promise, ms) {
    let timer;
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new ApiError('timeout', 'timeout')), ms); });
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
  }

  const configured = () => { const c = root.KT_SUPABASE; return !!(c && c.url && c.key); };

  async function rpc(name, args, { timeout = 4000 } = {}) {
    if (!configured()) throw new ApiError('not configured', 'config');
    const { url, key } = root.KT_SUPABASE;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const call = (async () => {
      let res;
      try {
        res = await root.fetch(`${url}/rest/v1/rpc/${name}`, {
          method: 'POST',
          headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(args || {}),
          signal: ctrl ? ctrl.signal : undefined,
        });
      } catch (e) {
        throw new ApiError('network', 'network');
      }
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
      if (!res.ok) throw new ApiError((body && body.message) || `HTTP ${res.status}`, (body && body.code) || String(res.status));
      return body;
    })();
    try {
      return await withTimeout(call, timeout);
    } catch (e) {
      if (e.code === 'timeout' && ctrl) ctrl.abort();
      throw e;
    }
  }

  const api = { ApiError, withTimeout, rpc, configured };
  root.KTApi = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
