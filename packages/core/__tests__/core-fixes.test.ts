import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApp, serveStatic, NoopLogger, TlevorError, PayloadTooLargeError } from '../src/index';

const apps: any[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) {
    try { await app.close(); } catch { /* ignore */ }
  }
});

function app(options: any = {}) {
  const a = createApp({ logger: false, ...options });
  apps.push(a);
  return a;
}

describe('core regressions', () => {
  it('respects ctx.res.status() for JSON responses', async () => {
    const a = app();
    a.addRoute({
      method: 'POST',
      path: '/users',
      handler: async (ctx) => { ctx.res.status(201); return { id: 1 }; },
    });
    const res = await a.inject({ method: 'POST', url: '/users', body: {} });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe(1);
  });

  it('respects ctx.res.status() for text responses', async () => {
    const a = app();
    a.addRoute({ method: 'GET', path: '/', handler: async (ctx) => { ctx.res.status(202); return 'ok'; } });
    const res = await a.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(202);
    expect(res.body).toBe('ok');
  });

  it('auto-ends a 204 handler that returns nothing (does not hang)', async () => {
    const a = app();
    a.addRoute({ method: 'DELETE', path: '/users/:id', handler: async (ctx) => { ctx.res.status(204); } });
    const res = await Promise.race([
      a.inject({ method: 'DELETE', url: '/users/1' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('inject hung')), 2000)),
    ]);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('auto-ends a handler that returns nothing with the default status', async () => {
    const a = app();
    a.addRoute({ method: 'GET', path: '/', handler: async () => { /* no return */ } });
    const res = await Promise.race([
      a.inject({ method: 'GET', url: '/' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('inject hung')), 2000)),
    ]);
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when a route handler falls through (returns false)', async () => {
    const a = app();
    a.addRoute({
      method: 'GET',
      path: '/*',
      handler: serveStatic({ root: tmpdir(), fallthrough: true }),
    });
    const res = await a.inject({ method: 'GET', url: '/definitely-missing-123.txt' });
    expect(res.statusCode).toBe(404);
  });

  it('passes inject() query options', async () => {
    const a = app();
    a.addRoute({ method: 'GET', path: '/search', handler: async (ctx) => ctx.req.query });
    const res = await a.inject({ method: 'GET', url: '/search?x=1', query: { q: 'hi', page: '2' } });
    expect(res.json()).toEqual({ x: '1', q: 'hi', page: '2' });
  });

  it('applies response schema: serializes and validates', async () => {
    const a = app();
    a.addRoute({
      method: 'GET',
      path: '/user',
      schema: { response: { type: 'object', required: ['id'], properties: { id: { type: 'number' }, name: { type: 'string' } } } },
      handler: async () => ({ id: 1, name: 'John', password: 'secret' }),
    });
    const res = await a.inject({ method: 'GET', url: '/user' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 1, name: 'John' });
    expect(res.json()).not.toHaveProperty('password');
  });

  it('500 when response does not match its schema', async () => {
    const a = app();
    a.addRoute({
      method: 'GET',
      path: '/bad',
      schema: { response: { type: 'object', properties: { id: { type: 'number' } } } },
      handler: async () => ({ id: 'not-a-number' }),
    });
    const res = await a.inject({ method: 'GET', url: '/bad' });
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe('RESPONSE_VALIDATION_ERROR');
  });

  it('runs preParsing hooks before the body is parsed', async () => {
    const a = app({ bodyParser: true });
    const seen: string[] = [];
    a.addHook('preParsing', async (ctx) => { seen.push(`pre:${JSON.stringify(ctx.req.body)}`); });
    a.addRoute({
      method: 'POST',
      path: '/',
      handler: async (ctx) => { seen.push(`handler:${JSON.stringify(ctx.req.body)}`); return { ok: true }; },
    });
    await a.inject({ method: 'POST', url: '/', body: { a: 1 } });
    expect(seen[0]).toBe('pre:{}');
    expect(seen[1]).toBe('handler:{"a":1}');
  });

  it('continues the hook chain when a hook returns false without writing', async () => {
    const a = app();
    const order: string[] = [];
    a.addHook('onRequest', async () => { order.push('first'); return false; });
    a.addHook('onRequest', async () => { order.push('second'); });
    a.addRoute({ method: 'GET', path: '/', handler: async () => { order.push('handler'); return { ok: true }; } });
    const res = await a.inject({ method: 'GET', url: '/' });
    expect(order).toEqual(['first', 'second', 'handler']);
    expect(res.statusCode).toBe(200);
  });

  it('does not hang when a preParsing hook short-circuits with a response', async () => {
    const a = app();
    a.addHook('preParsing', async (ctx) => { ctx.res.status(415).json({ error: 'nope' }); });
    a.addRoute({ method: 'GET', path: '/', handler: async () => ({ ok: true }) });
    const res = await Promise.race([
      a.inject({ method: 'GET', url: '/' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('inject hung')), 2000)),
    ]);
    expect(res.statusCode).toBe(415);
  });

  it('runs onResponse hooks even when a handler throws', async () => {
    const a = app();
    const onResponse = vi.fn();
    a.addHook('onResponse', async () => { onResponse(); });
    a.addRoute({ method: 'GET', path: '/boom', handler: async () => { throw new Error('boom'); } });
    const res = await a.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(onResponse).toHaveBeenCalled();
  });

  it('applies security headers to 404 responses', async () => {
    const a = app({ security: true });
    const res = await a.inject({ method: 'GET', url: '/missing' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('logs to a noop logger when logger is false', () => {
    const a = app({ logger: false });
    expect(a['logger']).toBeInstanceOf(NoopLogger);
  });

  it('keys route schemas by path+method so one handler can be reused', async () => {
    const a = app();
    const handler = async (ctx: any) => ctx.req.body;
    a.addRoute({ method: 'POST', path: '/a', schema: { body: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } } }, handler });
    a.addRoute({ method: 'POST', path: '/b', schema: { body: { type: 'object', required: ['b'], properties: { b: { type: 'string' } } } }, handler });
    const ok = await a.inject({ method: 'POST', url: '/a', body: { a: 'x' } });
    const bad = await a.inject({ method: 'POST', url: '/b', body: { a: 'x' } });
    expect(ok.statusCode).toBe(200);
    expect(bad.statusCode).toBe(400);
  });

  it('rejects listen() when the port is already in use', async () => {
    const a1 = app();
    await a1.listen(0);
    const port = (a1.getServer() as any).address().port;
    const a2 = app();
    await expect(a2.listen(port)).rejects.toThrow();
  });

  it('enforces payload size limits with a 413', async () => {
    const a = app({ bodyParser: { jsonLimit: 10 } });
    a.addRoute({ method: 'POST', path: '/', handler: async (ctx) => ctx.req.body });
    const res = await a.inject({ method: 'POST', url: '/', body: JSON.stringify({ big: 'value'.repeat(50) }) });
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('blocks after the rate limit is exceeded with 429', async () => {
    const a = app();
    a.rateLimit({ max: 2, window: 60000 });
    a.addRoute({ method: 'GET', path: '/', handler: async () => ({ ok: true }) });
    expect((await a.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
    const blocked = await a.inject({ method: 'GET', url: '/' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['x-ratelimit-limit']).toBe('2');
  });

  it('supports async plugin registration', async () => {
    const a = app();
    let pluginDone = false;
    await a.registerPlugin(async (appInstance: any) => {
      appInstance.addRoute({ method: 'GET', path: '/plugin', handler: async () => ({ via: 'plugin' }) });
      await new Promise((r) => setTimeout(r, 5));
      pluginDone = true;
    });
    expect(pluginDone).toBe(true);
    const res = await a.inject({ method: 'GET', url: '/plugin' });
    expect(res.json().via).toBe('plugin');
  });

  it('handles malformed cookie and query values without crashing', async () => {
    const a = app();
    a.addRoute({ method: 'GET', path: '/', handler: async (ctx) => ({ c: ctx.req.cookies, q: ctx.req.query }) });
    const res = await a.inject({ method: 'GET', url: '/?x=%zz', headers: { cookie: 'a=%zz; b=ok' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().c.a).toBe('%zz');
    expect(res.json().c.b).toBe('ok');
    expect(res.json().q.x).toBe('%zz');
  });

  it('echoes the request origin when CORS credentials are enabled', async () => {
    const a = app({ cors: { credentials: true } });
    a.addRoute({ method: 'GET', path: '/', handler: async () => ({ ok: true }) });
    const res = await a.inject({ method: 'GET', url: '/', headers: { origin: 'https://site.example' } });
    expect(res.headers['access-control-allow-origin']).toBe('https://site.example');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not hijack OPTIONS requests when cors is disabled', async () => {
    const a = app();
    a.addRoute({ method: 'OPTIONS', path: '/x', handler: async () => ({ custom: true }) });
    const res = await a.inject({ method: 'OPTIONS', url: '/x' });
    expect(res.statusCode).toBe(200);
    expect(res.json().custom).toBe(true);
  });
});

describe('serveStatic', () => {
  it('serves files, applies prefix/index, and blocks traversal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tlevor-static-'));
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'assets', 'hello.txt'), 'hello world');
    writeFileSync(join(dir, 'index.html'), '<h1>Home</h1>');

    const a = app();
    a.addRoute({ method: 'GET', path: '/static/*', handler: serveStatic({ root: dir, prefix: '/static', fallthrough: false }) });
    a.addRoute({ method: 'GET', path: '/static', handler: serveStatic({ root: dir, prefix: '/static', fallthrough: false }) });
    const file = await a.inject({ method: 'GET', url: '/static/assets/hello.txt' });
    expect(file.statusCode).toBe(200);
    expect(file.body).toBe('hello world');
    expect(file.headers['content-type']).toBe('text/plain');

    const index = await a.inject({ method: 'GET', url: '/static' });
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('<h1>Home</h1>');

    const traversal = await a.inject({ method: 'GET', url: '/static/../../etc/passwd' });
    expect(traversal.statusCode).toBe(403);

    const missing = await a.inject({ method: 'GET', url: '/static/nope.txt' });
    expect(missing.statusCode).toBe(404);
  });

  it('works as middleware with fallthrough (falls through to the handler)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tlevor-static-mw-'));
    writeFileSync(join(dir, 'hit.txt'), 'static hit');
    const a = app();
    a.use(serveStatic({ root: dir, fallthrough: true }));
    a.addRoute({ method: 'GET', path: '/*', handler: async () => ({ from: 'handler' }) });

    const hit = await a.inject({ method: 'GET', url: '/hit.txt' });
    expect(hit.statusCode).toBe(200);
    expect(hit.body).toBe('static hit');

    const miss = await a.inject({ method: 'GET', url: '/missing.txt' });
    expect(miss.statusCode).toBe(200);
    expect(miss.json().from).toBe('handler');
  });
});

describe('PayloadTooLargeError', () => {
  it('is a TlevorError with status 413', () => {
    const err = new PayloadTooLargeError(1024);
    expect(err).toBeInstanceOf(TlevorError);
    expect(err.statusCode).toBe(413);
    expect(err.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
