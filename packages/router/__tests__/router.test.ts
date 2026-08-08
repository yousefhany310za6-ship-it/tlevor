import { describe, it, expect } from 'vitest';
import { Router } from '../src/index';

describe('Router', () => {
  it('should add and find static routes', () => {
    const router = new Router();
    const handler = () => {};

    router.addRoute('GET', '/users', handler);

    const result = router.findRouteByMethod('GET', '/users');
    expect(result).not.toBeNull();
    expect(result!.handler).toBe(handler);
  });

  it('should find parameterized routes', () => {
    const router = new Router();
    const handler = () => {};

    router.addRoute('GET', '/users/:id', handler);

    const result = router.findRouteByMethod('GET', '/users/123');
    expect(result).not.toBeNull();
    expect(result!.handler).toBe(handler);
    expect(result!.params).toEqual({ id: '123' });
  });

  it('should find wildcard routes', () => {
    const router = new Router();
    const handler = () => {};

    router.addRoute('GET', '/files/*', handler);

    const result = router.findRouteByMethod('GET', '/files/path/to/file.txt');
    expect(result).not.toBeNull();
    expect(result!.handler).toBe(handler);
    expect(result!.params).toEqual({ '*': 'path/to/file.txt' });
  });

  it('should support multiple methods on same path', () => {
    const router = new Router();
    const getHandler = () => {};
    const postHandler = () => {};

    router.addRoute('GET', '/users', getHandler);
    router.addRoute('POST', '/users', postHandler);

    const getResult = router.findRouteByMethod('GET', '/users');
    const postResult = router.findRouteByMethod('POST', '/users');

    expect(getResult!.handler).toBe(getHandler);
    expect(postResult!.handler).toBe(postHandler);
  });

  it('should return null for non-existent routes', () => {
    const router = new Router();
    router.addRoute('GET', '/users', () => {});

    const result = router.findRouteByMethod('GET', '/posts');
    expect(result).toBeNull();
  });

  it('should return null for wrong method', () => {
    const router = new Router();
    router.addRoute('GET', '/users', () => {});

    const result = router.findRouteByMethod('POST', '/users');
    expect(result).toBeNull();
  });

  it('should track route count', () => {
    const router = new Router();
    expect(router.getRouteCount()).toBe(0);

    router.addRoute('GET', '/users', () => {});
    expect(router.getRouteCount()).toBe(1);

    router.addRoute('POST', '/users', () => {});
    expect(router.getRouteCount()).toBe(2);
  });

  it('should list all routes', () => {
    const router = new Router();
    router.addRoute('GET', '/users', () => {});
    router.addRoute('POST', '/users', () => {});
    router.addRoute('GET', '/posts/:id', () => {});

    const routes = router.getRoutes();
    expect(routes).toHaveLength(3);
  });
});

describe('Router path templates', () => {
  it('returns the route template path for :param routes', () => {
    const router = new Router();
    router.addRoute('GET', '/users/:id', () => {});
    const result = router.findRouteByMethod('GET', '/users/123');
    expect(result!.path).toBe('/users/:id');
  });

  it('returns the route template path for wildcard routes', () => {
    const router = new Router();
    router.addRoute('GET', '/files/*', () => {});
    const result = router.findRouteByMethod('GET', '/files/a/b.txt');
    expect(result!.path).toBe('/files/*');
  });

  it('returns the route template path for nested :param routes', () => {
    const router = new Router();
    router.addRoute('GET', '/users/:id/posts/:postId', () => {});
    const result = router.findRouteByMethod('GET', '/users/1/posts/42');
    expect(result!.path).toBe('/users/:id/posts/:postId');
  });
});
