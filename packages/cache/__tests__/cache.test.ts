import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryCache, CacheManager, cacheMiddleware, createCache } from '../src/index';

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => { cache = new MemoryCache({ ttl: 1000 }); });

  it('should set and get values', async () => {
    await cache.set('key1', 'value1');
    const result = await cache.get('key1');
    expect(result).toBe('value1');
  });

  it('should return null for non-existent keys', async () => {
    const result = await cache.get('nonexistent');
    expect(result).toBeNull();
  });

  it('should delete values', async () => {
    await cache.set('key1', 'value1');
    const deleted = await cache.del('key1');
    expect(deleted).toBe(true);
    expect(await cache.get('key1')).toBeNull();
  });

  it('should check if key exists', async () => {
    await cache.set('key1', 'value1');
    expect(await cache.has('key1')).toBe(true);
    expect(await cache.has('key2')).toBe(false);
  });

  it('should expire keys after TTL', async () => {
    const shortCache = new MemoryCache({ ttl: 50 });
    await shortCache.set('key1', 'value1');
    expect(await shortCache.get('key1')).toBe('value1');
    await new Promise(r => setTimeout(r, 100));
    expect(await shortCache.get('key1')).toBeNull();
  });

  it('should clear all keys', async () => {
    await cache.set('key1', 'value1');
    await cache.set('key2', 'value2');
    await cache.clear();
    expect(await cache.size()).toBe(0);
  });

  it('should return keys by pattern', async () => {
    await cache.set('user:1', 'alice');
    await cache.set('user:2', 'bob');
    await cache.set('post:1', 'hello');
    const keys = await cache.keys('user:*');
    expect(keys).toHaveLength(2);
    expect(keys).toContain('user:1');
    expect(keys).toContain('user:2');
  });

  it('should return TTL for keys', async () => {
    await cache.set('key1', 'value1', 5000);
    const ttl = await cache.ttl('key1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5);
  });

  it('should return size', async () => {
    await cache.set('key1', 'value1');
    await cache.set('key2', 'value2');
    expect(await cache.size()).toBe(2);
  });

  it('should handle custom TTL per key', async () => {
    const cache = new MemoryCache({ ttl: 60000 });
    await cache.set('short', 'val', 50);
    await cache.set('long', 'val', 60000);
    await new Promise(r => setTimeout(r, 100));
    expect(await cache.get('short')).toBeNull();
    expect(await cache.get('long')).toBe('val');
  });

  it('should store objects', async () => {
    await cache.set('obj', { name: 'test', count: 42 });
    const result = await cache.get('obj');
    expect(result).toEqual({ name: 'test', count: 42 });
  });

  it('should store arrays', async () => {
    await cache.set('arr', [1, 2, 3]);
    const result = await cache.get('arr');
    expect(result).toEqual([1, 2, 3]);
  });
});

describe('CacheManager', () => {
  let manager: CacheManager;

  beforeEach(() => { manager = new CacheManager(new MemoryCache({ ttl: 60000 })); });

  it('should wrap function calls with caching', async () => {
    let callCount = 0;
    const fn = async () => { callCount++; return { data: 'expensive' }; };
    const result1 = await manager.wrap('key1', fn);
    const result2 = await manager.wrap('key1', fn);
    expect(result1).toEqual({ data: 'expensive' });
    expect(result2).toEqual({ data: 'expensive' });
    expect(callCount).toBe(1);
  });

  it('should invalidate by pattern', async () => {
    await manager.set('user:1', 'alice');
    await manager.set('user:2', 'bob');
    await manager.set('post:1', 'hello');
    const count = await manager.invalidatePattern('user:*');
    expect(count).toBe(2);
    expect(await manager.has('user:1')).toBe(false);
    expect(await manager.has('post:1')).toBe(true);
  });

  it('should use prefix', async () => {
    const prefixed = new CacheManager(new MemoryCache({ ttl: 60000 }), { prefix: 'app' });
    await prefixed.set('key', 'value');
    expect(await prefixed.get('key')).toBe('value');
    const adapter = prefixed.getAdapter() as MemoryCache;
    expect(await adapter.has('app:key')).toBe(true);
  });
});

describe('cacheMiddleware', () => {
  // Simulates a request through the middleware + core's return-value write path.
  const runRequest = async (cache: MemoryCache, middleware: any) => {
    const captured: any = { body: undefined };
    const ctx: any = {
      req: { method: 'GET', url: '/test' },
      res: {
        headersSent: false,
        raw: {
          statusCode: 200,
          _headers: {} as Record<string, any>,
          setHeader(n: string, v: any) { this._headers[n.toLowerCase()] = v; },
          getHeader(n: string) { return this._headers[n.toLowerCase()]; },
          end(chunk: any) { captured.body = chunk; },
        },
        json: (d: any) => { captured.body = JSON.stringify(d); },
      },
    };
    await middleware(ctx);
    // core would serialize a returned value via raw.end
    if (!ctx.res.headersSent) ctx.res.raw.end(JSON.stringify({ hello: 'world' }));
    return captured.body;
  };

  it('should cache GET responses (return-value style)', async () => {
    const cache = new MemoryCache({ ttl: 60000 });
    const middleware = cacheMiddleware(cache, { ttl: 60000 });

    const first = await runRequest(cache, middleware);
    expect(first).toBe(JSON.stringify({ hello: 'world' }));

    const second = await runRequest(cache, middleware);
    expect(second).toBe(JSON.stringify({ hello: 'world' }));
  });

  it('should skip non-GET methods', async () => {
    const cache = new MemoryCache({ ttl: 60000 });
    const middleware = cacheMiddleware(cache);
    const ctx = {
      req: { method: 'POST', url: '/test' },
      res: { json: vi.fn() },
    };
    const result = await middleware(ctx);
    expect(result).toBeUndefined();
    expect(ctx.res.json).not.toHaveBeenCalled();
  });
});

describe('createCache', () => {
  it('should create memory cache by default', () => {
    const cache = createCache();
    expect(cache).toBeInstanceOf(CacheManager);
  });

  it('should create cache with custom options', () => {
    const cache = createCache({ ttl: 5000, prefix: 'test' });
    expect(cache).toBeInstanceOf(CacheManager);
  });
});