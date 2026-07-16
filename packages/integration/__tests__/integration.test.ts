/**
 * Tlevor Integration Tests
 *
 * These tests wire the framework's feature packages (auth, cache, validation,
 * orm, monitoring, tracing, swagger, graphql) INTO a real TlevorApp instance and
 * exercise them end-to-end through `app.inject()`.
 *
 * The goal is to prove the features work *together*, not just in isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../core/src/index';
import { createAuth } from '../../auth/src/index';
import { MemoryCache, cacheMiddleware } from '../../cache/src/index';
import { createValidator } from '../../validation/src/index';
import { createAdapter, syncModel, Model } from '../../orm/src/index';
import type { DatabaseAdapter } from '../../orm/src/index';
import { createMetricsRegistry, metricsMiddleware } from '../../monitoring/src/index';
import { createTracer, tracingMiddleware } from '../../tracing/src/index';
import { createSwagger, swaggerMiddleware } from '../../swagger/src/index';
import { GraphQLSchemaBuilder, graphqlHandler } from '../../graphql/src/index';

// ─── In-memory ORM adapter (no real DB needed) ──────────────────────────────

class InMemoryAdapter implements DatabaseAdapter {
  private tables: Map<string, Map<any, any>> = new Map();
  private counter = 0;
  private connected = false;

  async connect() { this.connected = true; }
  async disconnect() { this.connected = false; }
  isConnected() { return this.connected; }

  private table(name: string): Map<any, any> {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }

  async findOne(table: string, where: Record<string, any>): Promise<any | null> {
    for (const row of this.table(table).values()) {
      if (Object.entries(where).every(([k, v]) => row[k] == v)) return row;
    }
    return null;
  }

  async findMany(table: string, options: any = {}): Promise<any[]> {
    let rows = Array.from(this.table(table).values());
    if (options.where) rows = rows.filter((r) => Object.entries(options.where).every(([k, v]) => r[k] == v));
    if (options.orderBy) {
      const [k, dir] = Object.entries(options.orderBy)[0];
      rows.sort((a: any, b: any) => (dir === 'desc' ? b[k] - a[k] : a[k] - b[k]));
    }
    if (options.offset) rows = rows.slice(options.offset);
    if (options.limit) rows = rows.slice(0, options.limit);
    return rows;
  }

  async create(table: string, data: Record<string, any>): Promise<any> {
    const row = { ...data };
    if (row.id === undefined) row.id = `rec_${++this.counter}`;
    this.table(table).set(row.id, row);
    return row;
  }

  async update(table: string, id: any, data: Record<string, any>): Promise<any> {
    const row = this.table(table).get(id);
    if (!row) return null;
    const merged = { ...row, ...data };
    this.table(table).set(id, merged);
    return merged;
  }

  async delete(table: string, id: any): Promise<boolean> {
    return this.table(table).delete(id);
  }

  async count(table: string, where?: Record<string, any>): Promise<number> {
    return (await this.findMany(table, { where })).length;
  }

  async upsert(table: string, data: Record<string, any>): Promise<any> {
    if (data.id !== undefined && this.table(table).has(data.id)) return this.update(table, data.id, data);
    return this.create(table, data);
  }

  async transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async execute() { return null; }
  async raw() { return null; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader || '';
  return raw.split(';')[0];
}

// ─── 1. Auth (JWT) ────────────────────────────────────────────────────────────

describe('Integration: Auth (JWT)', () => {
  it('rejects protected routes without a token and accepts valid bearer tokens', async () => {
    const app = createApp({ logger: false });
    const auth = createAuth({ jwt: { secret: 'test-secret' }, unauthenticated: ['/login'] });
    app.addHook('onRequest', auth.authenticate());
    app.addRoute({ method: 'POST', path: '/login', handler: async () => ({ token: auth.getJwt().sign({ sub: 'user-1', roles: ['admin'] }) }) });
    app.addRoute({ method: 'GET', path: '/profile', handler: async (ctx) => ({ id: (ctx.state as any).user.id, role: (ctx.state as any).user.roles[0] }) });

    expect((await app.inject({ method: 'GET', url: '/profile' })).statusCode).toBe(401);

    const login = await app.inject({ method: 'POST', url: '/login' });
    expect(login.statusCode).toBe(200);
    const token = login.json().token;

    const res = await app.inject({ method: 'GET', url: '/profile', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('user-1');
    expect(res.json().role).toBe('admin');

    await app.close();
  });

  it('authorize() enforces roles (403 for insufficient role)', async () => {
    const app = createApp({ logger: false });
    const auth = createAuth({ jwt: { secret: 's' }, unauthenticated: ['/login'] });
    app.addHook('onRequest', auth.authenticate());
    // authorize applies to everything except the login route
    app.addHook('preHandler', async (ctx) => {
      if (ctx.req.path === '/login') return;
      return auth.authorize('admin')(ctx);
    });
    app.addRoute({ method: 'POST', path: '/login', handler: async (ctx) => {
      const role = (ctx.req.query as any).role || 'user';
      return { token: auth.getJwt().sign({ sub: 'u', roles: [role] }) };
    } });
    app.addRoute({ method: 'GET', path: '/admin', handler: async () => ({ secret: 'ok' }) });

    const adminLogin = await app.inject({ method: 'POST', url: '/login?role=admin' });
    const adminRes = await app.inject({ method: 'GET', url: '/admin', headers: { authorization: `Bearer ${adminLogin.json().token}` } });
    expect(adminRes.statusCode).toBe(200);

    const userLogin = await app.inject({ method: 'POST', url: '/login?role=user' });
    const userRes = await app.inject({ method: 'GET', url: '/admin', headers: { authorization: `Bearer ${userLogin.json().token}` } });
    expect(userRes.statusCode).toBe(403);

    await app.close();
  });
});

// ─── 2. Auth (Session) ────────────────────────────────────────────────────────

describe('Integration: Auth (Session)', () => {
  it('logs in, sets a session cookie, and authenticates subsequent requests', async () => {
    const app = createApp({ logger: false });
    const auth = createAuth({ session: { secret: 's' }, unauthenticated: ['/login'] });
    app.addHook('onRequest', auth.authenticate());
    app.addRoute({ method: 'POST', path: '/login', handler: async (ctx) => {
      const sid = await auth.getSession().create('user-2', { name: 'Bob' });
      auth.getSession().setSessionCookie(ctx, sid);
      return { ok: true };
    } });
    app.addRoute({ method: 'GET', path: '/me', handler: async (ctx) => ({ id: (ctx.state as any).user.id, name: (ctx.state as any).user.name }) });

    expect((await app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401);

    const login = await app.inject({ method: 'POST', url: '/login' });
    expect(login.statusCode).toBe(200);
    const cookie = extractCookie((login as any).headers['set-cookie']);

    const res = await app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('user-2');
    expect(res.json().name).toBe('Bob');

    await app.close();
  });
});

// ─── 3. Cache ─────────────────────────────────────────────────────────────────

describe('Integration: Cache', () => {
  it('serves repeated GETs from cache without re-running the handler', async () => {
    const app = createApp({ logger: false });
    const cache = new MemoryCache({ ttl: 1000 });
    app.addHook('preHandler', cacheMiddleware(cache, { ttl: 1000 }));
    let calls = 0;
    // cacheMiddleware caches by intercepting ctx.res.json(), so the handler must write via res.json()
    app.addRoute({ method: 'GET', path: '/data', handler: async () => { calls++; return { n: calls }; } });

    const r1 = await app.inject({ method: 'GET', url: '/data' });
    const r2 = await app.inject({ method: 'GET', url: '/data' });

    expect(calls).toBe(1);
    expect(r1.json().n).toBe(1);
    expect(r2.json().n).toBe(1);

    await app.close();
  });
});

// ─── 4. Validation ────────────────────────────────────────────────────────────

describe('Integration: Validation', () => {
  it('core route schema rejects invalid bodies with 400', async () => {
    const app = createApp({ logger: false, bodyParser: true });
    app.addRoute({
      method: 'POST', path: '/users',
      schema: { body: { required: ['name'] } },
      handler: async (ctx) => ctx.req.body,
    });

    expect((await app.inject({ method: 'POST', url: '/users', body: {} })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/users', body: { name: 'Jane' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().name).toBe('Jane');

    await app.close();
  });

  it('@tlevor/validation Validator hook rejects invalid payloads', async () => {
    const app = createApp({ logger: false, bodyParser: true });
    const validator = createValidator();
    const userSchema = { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] };
    app.addHook('preHandler', async (ctx) => {
      const result = validator.validate(ctx.req.body, userSchema);
      if (!result.valid) { ctx.res.status(400).json({ error: 'invalid', details: result.errors }); return false; }
    });
    app.addRoute({ method: 'POST', path: '/signup', handler: async (ctx) => ctx.req.body });

    expect((await app.inject({ method: 'POST', url: '/signup', body: {} })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/signup', body: { email: 'a@b.com' } });
    expect(ok.statusCode).toBe(200);

    await app.close();
  });
});

// ─── 5. ORM ───────────────────────────────────────────────────────────────────

describe('Integration: ORM (in-memory adapter)', () => {
  let adapter: any;
  let app: any;

  beforeEach(async () => {
    adapter = createAdapter('memory');
    await adapter.connect();
    app = createApp({ logger: false, bodyParser: true });
    const User = new Model(adapter, { tableName: 'users', primaryKey: 'id' });
    app.addRoute({ method: 'POST', path: '/users', handler: async (ctx) => User.create(ctx.req.body) });
    app.addRoute({ method: 'GET', path: '/users/:id', handler: async (ctx) => User.findById(ctx.req.params.id) });
    app.addRoute({ method: 'GET', path: '/users', handler: async () => User.findMany() });
    app.addRoute({ method: 'PUT', path: '/users/:id', handler: async (ctx) => User.update(ctx.req.params.id, ctx.req.body) });
    app.addRoute({ method: 'DELETE', path: '/users/:id', handler: async (ctx) => ({ deleted: await User.delete(ctx.req.params.id) }) });
  });

  afterEach(async () => { if (app && typeof app.close === 'function') await app.close(); if (adapter && typeof adapter.disconnect === 'function') await adapter.disconnect(); });

  it('performs full CRUD through HTTP routes', async () => {
    const created = await app.inject({ method: 'POST', url: '/users', body: { name: 'Alice' } });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    expect(created.json().name).toBe('Alice');
    expect(created.json().id).toBeDefined();

    const fetched = await app.inject({ method: 'GET', url: `/users/${id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().name).toBe('Alice');

    const list = await app.inject({ method: 'GET', url: '/users' });
    expect(list.json().length).toBe(1);

    const updated = await app.inject({ method: 'PUT', url: `/users/${id}`, body: { name: 'Alice2' } });
    expect(updated.json().name).toBe('Alice2');

    const deleted = await app.inject({ method: 'DELETE', url: `/users/${id}` });
    expect(deleted.json().deleted).toBe(true);

    const gone = await app.inject({ method: 'GET', url: `/users/${id}` });
    expect(gone.json()).toBeNull();
  });
});

// ─── 6. Monitoring ────────────────────────────────────────────────────────────

describe('Integration: Monitoring', () => {
  it('records request metrics across the lifecycle', async () => {
    const app = createApp({ logger: false });
    const registry = createMetricsRegistry();
    const m = metricsMiddleware(registry);
    app.addHook('onRequest', m.requestMiddleware);
    app.addHook('onResponse', m.responseMiddleware);
    app.addRoute({ method: 'GET', path: '/ping', handler: async () => ({ pong: true }) });

    await app.inject({ method: 'GET', url: '/ping' });
    await app.inject({ method: 'GET', url: '/missing' });

    const prom = registry.formatPrometheus();
    expect(prom).toContain('http_requests_total');
    expect(prom).toContain('http_request_duration_seconds');
    expect(prom).toContain('http_requests_in_flight');

    await app.close();
  });
});

// ─── 7. Tracing ───────────────────────────────────────────────────────────────

describe('Integration: Tracing', () => {
  it('creates a span per request', async () => {
    const app = createApp({ logger: false });
    const tracer = createTracer('test-svc');
    const t = tracingMiddleware(tracer);
    app.addHook('onRequest', t.requestMiddleware);
    app.addHook('onResponse', t.responseMiddleware);
    app.addRoute({ method: 'GET', path: '/trace', handler: async () => ({ ok: true }) });

    await app.inject({ method: 'GET', url: '/trace' });

    const spans = tracer.getSpans();
    expect(spans.length).toBeGreaterThan(0);
    expect(spans[0].name).toContain('GET');
    expect(spans[0].name).toContain('/trace');

    await app.close();
  });
});

// ─── 8. Swagger ───────────────────────────────────────────────────────────────

describe('Integration: Swagger', () => {
  it('serves generated OpenAPI spec and UI', async () => {
    const app = createApp({ logger: false });
    const doc = createSwagger({ title: 'Test API' });
    doc.addRoute({ method: 'GET', path: '/users', summary: 'List users' });
    // swaggerMiddleware is a route handler (hooks run AFTER route matching, so it must be registered as a route)
    app.addRoute({ method: 'GET', path: '/swagger.json', handler: swaggerMiddleware(doc) });
    app.addRoute({ method: 'GET', path: '/swagger', handler: swaggerMiddleware(doc) });
    app.addRoute({ method: 'GET', path: '/users', handler: async () => [] });

    const spec = await app.inject({ method: 'GET', url: '/swagger.json' });
    expect(spec.statusCode).toBe(200);
    expect(spec.json().paths['/users']).toBeDefined();

    const ui = await app.inject({ method: 'GET', url: '/swagger' });
    expect(ui.statusCode).toBe(200);
    expect(ui.body).toContain('swagger-ui');

    await app.close();
  });
});

// ─── 9. GraphQL ───────────────────────────────────────────────────────────────

describe('Integration: GraphQL', () => {
  it('executes a query through the graphql handler', async () => {
    const app = createApp({ logger: false, bodyParser: true });
    const builder = new GraphQLSchemaBuilder();
    builder.query('hello', 'String', () => 'world');
    builder.query('echo', 'String', (ctx: any) => ctx.variables?.m);
    app.addRoute({ method: 'POST', path: '/graphql', handler: graphqlHandler({ schema: builder }) });

    const res = await app.inject({ method: 'POST', url: '/graphql', body: { query: '{ hello }' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.hello).toBe('world');

    const res2 = await app.inject({ method: 'POST', url: '/graphql', body: { query: 'query($m: String){ echo(msg: $m) }', variables: { m: 'hi' } } });
    expect(res2.json().data.echo).toBe('hi');

    await app.close();
  });
});

// ─── 10. Combined mini-app ────────────────────────────────────────────────────

describe('Integration: Combined (auth + cache + validation + monitoring + tracing)', () => {
  it('wires every feature into one app and behaves correctly', async () => {
    const app = createApp({ logger: false, bodyParser: true });
    const auth = createAuth({ jwt: { secret: 'combined' }, unauthenticated: ['/login', '/public'] });
    const cache = new MemoryCache({ ttl: 1000 });
    const registry = createMetricsRegistry();
    const tracer = createTracer('combined');
    const metrics = metricsMiddleware(registry);
    const tracing = tracingMiddleware(tracer);

    app.addHook('onRequest', auth.authenticate());
    app.addHook('onRequest', metrics.requestMiddleware);
    app.addHook('onRequest', tracing.requestMiddleware);
    app.addHook('preHandler', cacheMiddleware(cache, { ttl: 1000 }));
    app.addHook('onResponse', metrics.responseMiddleware);
    app.addHook('onResponse', tracing.responseMiddleware);

    let publicCalls = 0;
    app.addRoute({ method: 'POST', path: '/login', handler: async () => ({ token: auth.getJwt().sign({ sub: 'u1' }) }) });
    app.addRoute({ method: 'GET', path: '/public', handler: async () => { publicCalls++; return { ok: true }; } });
    app.addRoute({ method: 'GET', path: '/me', handler: async (ctx) => ({ id: (ctx.state as any).user.id }) });

    // Public + cached: handler must run only once across two calls
    await app.inject({ method: 'GET', url: '/public' });
    await app.inject({ method: 'GET', url: '/public' });
    expect(publicCalls).toBe(1);

    // Protected without token -> 401
    expect((await app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401);

    // Protected with token -> 200
    const token = (await app.inject({ method: 'POST', url: '/login' })).json().token;
    const me = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().id).toBe('u1');

    // Monitoring + tracing fired
    expect(registry.formatPrometheus()).toContain('http_requests_total');
    expect(tracer.getSpans().length).toBeGreaterThan(0);

    await app.close();
  });
});
