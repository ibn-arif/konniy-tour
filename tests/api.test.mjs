import test from 'node:test';
import assert from 'node:assert/strict';
import api from '../js/api.js';

globalThis.KT_SUPABASE = { url: 'https://example.supabase.co', key: 'pk' };

test('withTimeout rejects with code timeout', async () => {
  await assert.rejects(api.withTimeout(new Promise(() => {}), 10), e => e instanceof api.ApiError && e.code === 'timeout');
});

test('rpc posts JSON with the key and returns the body', async () => {
  let seen;
  globalThis.fetch = async (url, opts) => { seen = { url, opts }; return new Response('[{"x":1}]', { status: 200 }); };
  const out = await api.rpc('free_slots', { p_route: 'short' });
  assert.deepEqual(out, [{ x: 1 }]);
  assert.equal(seen.url, 'https://example.supabase.co/rest/v1/rpc/free_slots');
  assert.equal(seen.opts.method, 'POST');
  assert.equal(seen.opts.headers.apikey, 'pk');
  assert.equal(seen.opts.headers.Authorization, 'Bearer pk');
  assert.equal(seen.opts.body, '{"p_route":"short"}');
});

test('rpc turns an error body into ApiError', async () => {
  globalThis.fetch = async () => new Response('{"message":"Это время только что заняли","code":"P0001"}', { status: 400 });
  await assert.rejects(api.rpc('create_request', {}), e => e instanceof api.ApiError && e.message === 'Это время только что заняли' && e.code === 'P0001');
});

test('rpc reports a network failure', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(api.rpc('free_slots', {}), e => e.code === 'network');
});

test('rpc with a void result returns null', async () => {
  globalThis.fetch = async () => new Response(null, { status: 204 });
  assert.equal(await api.rpc('head_reject', {}), null);
});

test('configured() is false without settings', () => {
  const saved = globalThis.KT_SUPABASE;
  globalThis.KT_SUPABASE = undefined;
  assert.equal(api.configured(), false);
  globalThis.KT_SUPABASE = saved;
  assert.equal(api.configured(), true);
});
