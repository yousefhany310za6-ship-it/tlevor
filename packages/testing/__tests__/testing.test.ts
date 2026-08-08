import { describe, it, expect } from 'vitest';
import { createTestApp, buildTestApp } from '../src/index';

describe('testing helpers', () => {
  it('createTestApp delegates inject to the wrapped app', async () => {
    const fake = {
      inject: async (opts: any) => ({ statusCode: 200, headers: {}, body: JSON.stringify({ ok: opts.url }), json: () => ({ ok: opts.url }) }),
    } as any;
    const testApp = createTestApp(fake);
    const res = await testApp.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: '/ping' });
  });

  it('buildTestApp wires a real Tlevor app through setupFn', async () => {
    const testApp = buildTestApp((app) => {
      app.addRoute({
        method: 'GET',
        path: '/hello',
        handler: async () => ({ message: 'hi' }),
      });
      app.addRoute({
        method: 'POST',
        path: '/echo',
        handler: async (ctx) => ({ body: ctx.req.body }),
      });
    });

    const hello = await testApp.inject({ method: 'GET', url: '/hello' });
    expect(hello.statusCode).toBe(200);
    expect(hello.json()).toEqual({ message: 'hi' });

    const echo = await testApp.inject({ method: 'POST', url: '/echo', body: { a: 1 } });
    expect(echo.json()).toEqual({ body: { a: 1 } });
  });

  it('buildTestApp returns 404 for unmatched routes', async () => {
    const testApp = buildTestApp((app) => {
      app.addRoute({ method: 'GET', path: '/only', handler: async () => ({}) });
    });
    const res = await testApp.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
  });
});
