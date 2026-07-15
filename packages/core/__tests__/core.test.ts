import { describe, it, expect } from 'vitest';
import {
  createApp,
  TlevorError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
} from '../src/index';

describe('TlevorApp', () => {
  it('should create an app instance', () => {
    const app = createApp();
    expect(app).toBeDefined();
    expect(app.addRoute).toBeDefined();
    expect(app.addHook).toBeDefined();
    expect(app.inject).toBeDefined();
  });

  it('should handle GET requests', async () => {
    const app = createApp();

    app.addRoute({
      method: 'GET',
      path: '/hello',
      handler: () => ({ message: 'Hello' }),
    });

    const res = await app.inject({ method: 'GET', url: '/hello' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ message: 'Hello' });
  });

  it('should handle POST requests with body', async () => {
    const app = createApp({ bodyParser: true });

    app.addRoute({
      method: 'POST',
      path: '/users',
      handler: (ctx) => {
        return { received: ctx.req.body };
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/users',
      body: { name: 'Ahmed' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: { name: 'Ahmed' } });
  });

  it('should return 404 for non-existent routes', async () => {
    const app = createApp();

    const res = await app.inject({ method: 'GET', url: '/notfound' });
    expect(res.statusCode).toBe(404);
  });

  it('should extract path parameters', async () => {
    const app = createApp();

    app.addRoute({
      method: 'GET',
      path: '/users/:id',
      handler: (ctx) => ({ id: ctx.req.params.id }),
    });

    const res = await app.inject({ method: 'GET', url: '/users/42' });
    expect(res.json()).toEqual({ id: '42' });
  });

  it('should extract query parameters', async () => {
    const app = createApp();

    app.addRoute({
      method: 'GET',
      path: '/search',
      handler: (ctx) => ({ query: ctx.req.query }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/search?q=tlevor&page=1',
    });

    expect(res.json()).toEqual({ query: { q: 'tlevor', page: '1' } });
  });

  it('should execute hooks in order', async () => {
    const app = createApp();
    const order: string[] = [];

    app.addHook('onRequest', () => { order.push('onRequest'); });
    app.addHook('preHandler', () => { order.push('preHandler'); });
    app.addHook('postHandler', () => { order.push('postHandler'); });
    app.addHook('onResponse', () => { order.push('onResponse'); });

    app.addRoute({
      method: 'GET',
      path: '/test',
      handler: () => { order.push('handler'); return {}; },
    });

    await app.inject({ method: 'GET', url: '/test' });

    expect(order).toEqual(['onRequest', 'preHandler', 'handler', 'postHandler', 'onResponse']);
  });

  it('should handle errors gracefully', async () => {
    const app = createApp();

    app.addRoute({
      method: 'GET',
      path: '/error',
      handler: () => {
        throw new Error('Something went wrong');
      },
    });

    const res = await app.inject({ method: 'GET', url: '/error' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('Internal Server Error');
  });

  it('should handle TlevorError with custom status codes', async () => {
    const app = createApp();

    app.addRoute({
      method: 'GET',
      path: '/not-found',
      handler: () => {
        throw new NotFoundError('User');
      },
    });

    const res = await app.inject({ method: 'GET', url: '/not-found' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('should handle ValidationError', async () => {
    const app = createApp();

    app.addRoute({
      method: 'POST',
      path: '/validate',
      handler: () => {
        throw new ValidationError('Invalid email', { field: 'email' });
      },
    });

    const res = await app.inject({ method: 'POST', url: '/validate' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(res.json().details).toEqual({ field: 'email' });
  });

  it('should support CORS preflight', async () => {
    const app = createApp({ cors: true });

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/users',
      headers: { origin: 'http://example.com' },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('should support CORS on responses', async () => {
    const app = createApp({ cors: true });

    app.addRoute({
      method: 'GET',
      path: '/test',
      handler: () => ({ ok: true }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { origin: 'http://example.com' },
    });

    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('should register and use plugins', async () => {
    const app = createApp();
    let pluginCalled = false;

    const myPlugin = (app: any, opts: any) => {
      pluginCalled = true;
      app.addRoute({
        method: 'GET',
        path: '/plugin',
        handler: () => ({ plugin: true }),
      });
    };

    app.registerPlugin(myPlugin);

    expect(pluginCalled).toBe(true);

    const res = await app.inject({ method: 'GET', url: '/plugin' });
    expect(res.json()).toEqual({ plugin: true });
  });
});
