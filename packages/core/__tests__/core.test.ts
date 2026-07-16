import { describe, it, expect, vi } from 'vitest';
import { createApp, ValidationError, NotFoundError, TlevorError } from '../src/index';
import { createValidator } from '../../validation/src/index';

describe('TlevorApp', () => {
  describe('Basic Routing', () => {
    it('should handle GET requests', async () => {
      const app = createApp({ logger: false });
      app.addRoute({
        method: 'GET',
        path: '/test',
        handler: async () => ({ message: 'Hello' }),
      });
      const res = await app.inject({ method: 'GET', url: '/test' });
      expect(res.statusCode).toBe(200);
      expect(res.json().message).toBe('Hello');
      await app.close();
    });

    it('should handle POST requests', async () => {
      const app = createApp({ logger: false });
      app.addRoute({
        method: 'POST',
        path: '/test',
        handler: async (ctx) => ctx.req.body,
      });
      const res = await app.inject({
        method: 'POST',
        url: '/test',
        body: { name: 'test' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('test');
      await app.close();
    });

    it('should handle URL parameters', async () => {
      const app = createApp({ logger: false });
      app.addRoute({
        method: 'GET',
        path: '/users/:id',
        handler: async (ctx) => ({ id: ctx.req.params.id }),
      });
      const res = await app.inject({ method: 'GET', url: '/users/123' });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe('123');
      await app.close();
    });

    it('should handle query strings', async () => {
      const app = createApp({ logger: false });
      app.addRoute({
        method: 'GET',
        path: '/search',
        handler: async (ctx) => ({ query: ctx.req.query }),
      });
      const res = await app.inject({
        method: 'GET',
        url: '/search?q=test&page=1',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().query.q).toBe('test');
      expect(res.json().query.page).toBe('1');
      await app.close();
    });

    it('should handle 404 for non-existent routes', async () => {
      const app = createApp({ logger: false });
      const res = await app.inject({ method: 'GET', url: '/nonexistent' });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('Not Found');
      await app.close();
    });
  });

  describe('Body Parsing', () => {
    it('should parse JSON body', async () => {
      const app = createApp({ bodyParser: true, logger: false });
      app.addRoute({
        method: 'POST',
        path: '/json',
        handler: async (ctx) => ctx.req.body,
      });
      const res = await app.inject({
        method: 'POST',
        url: '/json',
        body: { key: 'value' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().key).toBe('value');
      await app.close();
    });

    it('should parse URL-encoded body', async () => {
      const app = createApp({ bodyParser: true, logger: false });
      app.addRoute({
        method: 'POST',
        path: '/form',
        handler: async (ctx) => ctx.req.body,
      });
      const res = await app.inject({
        method: 'POST',
        url: '/form',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'name=test&value=123',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('test');
      expect(res.json().value).toBe('123');
      await app.close();
    });
  });

  describe('CORS', () => {
    it('should handle OPTIONS preflight', async () => {
      const app = createApp({ cors: { origin: 'http://example.com' }, logger: false });
      app.addRoute({
        method: 'GET',
        path: '/test',
        handler: async () => ({ message: 'Hello' }),
      });
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/test',
        headers: { 'origin': 'http://example.com' },
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://example.com');
      await app.close();
    });
  });

  describe('Error Handling', () => {
    it('should handle TlevorError', async () => {
      const app = createApp({ logger: false });
      app.addRoute({
        method: 'GET',
        path: '/error',
        handler: async () => {
          throw new TlevorError('Custom error', 422, 'CUSTOM_ERROR');
        },
      });
      const res = await app.inject({ method: 'GET', url: '/error' });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('Custom error');
      expect(res.json().code).toBe('CUSTOM_ERROR');
      await app.close();
    });

    it('should handle ValidationError', async () => {
      const app = createApp({ logger: false });
      app.addRoute({
        method: 'POST',
        path: '/validate',
        handler: async () => {
          throw new ValidationError('Invalid input');
        },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/validate',
        body: { data: 'test' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
      await app.close();
    });

    it('should handle NotFoundError', async () => {
      const app = createApp({ logger: false });
      app.addRoute({
        method: 'GET',
        path: '/notfound',
        handler: async () => {
          throw new NotFoundError('User');
        },
      });
      const res = await app.inject({ method: 'GET', url: '/notfound' });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('User not found');
      await app.close();
    });
  });

  describe('Hooks', () => {
    it('should execute onRequest hook', async () => {
      const app = createApp({ logger: false });
      const hookCalled = vi.fn();
      app.addHook('onRequest', async (ctx) => {
        hookCalled();
        ctx.state.hookData = 'from hook';
      });
      app.addRoute({
        method: 'GET',
        path: '/test',
        handler: async (ctx) => ({ hookData: ctx.state.hookData }),
      });
      const res = await app.inject({ method: 'GET', url: '/test' });
      expect(hookCalled).toHaveBeenCalled();
      expect(res.json().hookData).toBe('from hook');
      await app.close();
    });

    it('should allow hook to stop processing', async () => {
      const app = createApp({ logger: false });
      app.addHook('onRequest', async (ctx) => {
        ctx.res.status(401).json({ error: 'Unauthorized' });
        return false;
      });
      app.addRoute({
        method: 'GET',
        path: '/test',
        handler: async () => ({ message: 'Should not reach' }),
      });
      const res = await app.inject({ method: 'GET', url: '/test' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('Unauthorized');
      await app.close();
    });
  });
});

describe('Validation', () => {
  const validator = createValidator();
  
  it('should validate required fields', () => {
    const schema = {
      type: 'object',
      required: ['name', 'email'],
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
      },
    };

    const result = validator.validate({ name: 'John' }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('"email" is required');
  });

  it('should validate string length', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 10 },
      },
    };

    expect(validator.validate({ name: 'a' }, schema).valid).toBe(false);
    expect(validator.validate({ name: 'ab' }, schema).valid).toBe(true);
    expect(validator.validate({ name: '1234567890' }, schema).valid).toBe(true);
    expect(validator.validate({ name: '12345678901' }, schema).valid).toBe(false);
  });

  it('should validate number ranges', () => {
    const schema = {
      type: 'object',
      properties: {
        age: { type: 'number', minimum: 0, maximum: 150 },
      },
    };

    expect(validator.validate({ age: -1 }, schema).valid).toBe(false);
    expect(validator.validate({ age: 0 }, schema).valid).toBe(true);
    expect(validator.validate({ age: 150 }, schema).valid).toBe(true);
    expect(validator.validate({ age: 151 }, schema).valid).toBe(false);
  });

  it('should validate enum values', () => {
    const schema = {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['admin', 'user', 'guest'] },
      },
    };

    expect(validator.validate({ role: 'admin' }, schema).valid).toBe(true);
    expect(validator.validate({ role: 'superadmin' }, schema).valid).toBe(false);
  });

  it('should serialize data based on schema', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'number' },
        name: { type: 'string' },
      },
    };

    const data = { id: 1, name: 'John', password: 'secret', extra: 'field' };
    const result = validator.serialize(data, schema);
    expect(result).toEqual({ id: 1, name: 'John' });
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('extra');
  });
});

describe('Rate Limiter', () => {
  it('should allow requests within limit', async () => {
    const app = createApp({ logger: false });
    app.rateLimit({ max: 2, window: 60000 });
    app.addRoute({
      method: 'GET',
      path: '/test',
      handler: async () => ({ message: 'Hello' }),
    });

    const res1 = await app.inject({ method: 'GET', url: '/test' });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({ method: 'GET', url: '/test' });
    expect(res2.statusCode).toBe(200);

    await app.close();
  });
});

describe('Static Files', () => {
  it('should serve static files', async () => {
    const app = createApp({ logger: false });
    app.addRoute({
      method: 'GET',
      path: '/static/*',
      handler: async (ctx) => ({ path: ctx.req.path }),
    });

    const res = await app.inject({ method: 'GET', url: '/static/test.txt' });
    expect(res.statusCode).toBe(200);
    expect(res.json().path).toBe('/static/test.txt');
    await app.close();
  });
});

describe('Cookies', () => {
  it('should parse cookies from request', async () => {
    const app = createApp({ logger: false });
    app.addRoute({
      method: 'GET',
      path: '/test',
      handler: async (ctx) => ({ cookies: ctx.req.cookies }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { cookie: 'session=abc123; theme=dark' },
    });
    expect(res.json().cookies.session).toBe('abc123');
    expect(res.json().cookies.theme).toBe('dark');
    await app.close();
  });

  it('should set cookies on response', async () => {
    const app = createApp({ logger: false });
    app.addRoute({
      method: 'GET',
      path: '/test',
      handler: async (ctx) => {
        ctx.res.cookie('session', 'abc123', { httpOnly: true });
        return { message: 'Cookie set' };
      },
    });

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.headers['set-cookie']).toContain('session=abc123');
    expect(res.headers['set-cookie']).toContain('HttpOnly');
    await app.close();
  });
});

describe('Security Headers', () => {
  it('should set security headers', async () => {
    const app = createApp({ security: true, logger: false });
    app.addRoute({
      method: 'GET',
      path: '/test',
      handler: async () => ({ message: 'Hello' }),
    });

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-xss-protection']).toBe('1; mode=block');
    await app.close();
  });
});

describe('Route-level hooks', () => {
  it('runs a route-scoped onRequest hook before the handler', async () => {
    const app = createApp({ logger: false });
    app.addRoute({
      method: 'GET',
      path: '/r',
      hooks: {
        onRequest: async (ctx) => { (ctx.state as any).marked = true; },
      },
      handler: async (ctx) => ({ marked: (ctx.state as any).marked === true }),
    });
    const res = await app.inject({ method: 'GET', url: '/r' });
    expect(res.json().marked).toBe(true);
    await app.close();
  });

  it('blocks the handler when a route-scoped preHandler hook returns false', async () => {
    const app = createApp({ logger: false });
    const handler = vi.fn(async () => ({ ok: true }));
    app.addRoute({
      method: 'GET',
      path: '/admin',
      hooks: {
        preHandler: async (ctx) => {
          ctx.res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', statusCode: 403 });
          return false;
        },
      },
      handler,
    });
    const res = await app.inject({ method: 'GET', url: '/admin' });
    expect(res.statusCode).toBe(403);
    expect(handler).not.toHaveBeenCalled();
    await app.close();
  });

  it('combines global and route-scoped hooks (global runs first)', async () => {
    const app = createApp({ logger: false });
    const order: string[] = [];
    app.addHook('preHandler', async () => { order.push('global'); });
    app.addRoute({
      method: 'GET',
      path: '/r',
      hooks: { preHandler: async () => { order.push('route'); } },
      handler: async () => ({ order: order.join(',') }),
    });
    const res = await app.inject({ method: 'GET', url: '/r' });
    expect(res.json().order).toBe('global,route');
    await app.close();
  });
});

describe('WebSocket', () => {
  it('should register WebSocket handler', async () => {
    const app = createApp({ logger: false });
    app.ws('/ws', {
      onConnection: () => {},
    });
    await app.listen(0);
    expect(app.getServer()).toBeDefined();
    await app.close();
  });

  it('should track WebSocket connections', async () => {
    const app = createApp({ logger: false });
    app.ws('/ws', {
      onConnection: () => {},
    });
    const connections = app.getWebSocketConnections();
    expect(connections).toBeInstanceOf(Map);
    expect(connections.size).toBe(0);
    await app.close();
  });

  it('should close WebSocket server on app close', async () => {
    const app = createApp({ logger: false });
    app.ws('/ws', {
      onConnection: () => {},
    });
    await app.listen(0);
    await app.close();
    expect(app.getServer()).toBeNull();
  });
});