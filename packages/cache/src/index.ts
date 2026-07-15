export interface CacheOptions {
  ttl?: number;
  maxKeys?: number;
  prefix?: string;
}

export interface CacheEntry<T = any> {
  value: T;
  expiresAt: number | null;
  createdAt: number;
}

export interface CacheAdapter {
  get<T = any>(key: string): Promise<T | null>;
  set<T = any>(key: string, value: T, ttl?: number): Promise<void>;
  del(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  keys(pattern?: string): Promise<string[]>;
  ttl(key: string): Promise<number>;
  size(): Promise<number>;
}

// ==================== Memory Cache ====================

export class MemoryCache implements CacheAdapter {
  private store: Map<string, CacheEntry> = new Map();
  private options: Required<Omit<CacheOptions, 'prefix'>>;

  constructor(options: CacheOptions = {}) {
    this.options = {
      ttl: options.ttl || 300000,
      maxKeys: options.maxKeys || 10000,
    };
  }

  private isExpired(entry: CacheEntry): boolean {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  private evict(): void {
    if (this.store.size <= this.options.maxKeys) return;
    const entries = Array.from(this.store.entries())
      .sort((a, b) => (a[1].expiresAt || Infinity) - (b[1].expiresAt || Infinity));
    const toRemove = entries.slice(0, Math.ceil(this.options.maxKeys * 0.1));
    for (const [key] of toRemove) this.store.delete(key);
  }

  async get<T = any>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) { this.store.delete(key); return null; }
    return entry.value as T;
  }

  async set<T = any>(key: string, value: T, ttl?: number): Promise<void> {
    const effectiveTtl = ttl || this.options.ttl;
    this.store.set(key, {
      value,
      expiresAt: effectiveTtl > 0 ? Date.now() + effectiveTtl : null,
      createdAt: Date.now(),
    });
    this.evict();
  }

  async del(key: string): Promise<boolean> { return this.store.delete(key); }
  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) { this.store.delete(key); return false; }
    return true;
  }

  async clear(): Promise<void> { this.store.clear(); }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.store.keys());
    if (!pattern) return allKeys.filter(k => !this.isExpired(this.store.get(k)!));
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return allKeys.filter(k => regex.test(k) && !this.isExpired(this.store.get(k)!));
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) return -1;
    if (entry.expiresAt === null) return -2;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }

  async size(): Promise<number> { return this.store.size; }
}

// ==================== Redis Cache ====================

export interface RedisCacheOptions extends CacheOptions {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  client?: any;
}

export class RedisCache implements CacheAdapter {
  private client: any;
  private prefix: string;
  private defaultTtl: number;
  private ownClient: boolean;

  constructor(options: RedisCacheOptions = {}) {
    this.prefix = options.prefix || 'tlevor:';
    this.defaultTtl = options.ttl || 300000;

    if (options.client) {
      this.client = options.client;
      this.ownClient = false;
    } else {
      try {
        const Redis = require('ioredis');
        this.client = new Redis({
          host: options.host || '127.0.0.1',
          port: options.port || 6379,
          password: options.password,
          db: options.db || 0,
        });
        this.ownClient = true;
      } catch {
        throw new Error('ioredis is required for RedisCache. Install it with: npm install ioredis');
      }
    }
  }

  private prefixedKey(key: string): string { return `${this.prefix}${key}`; }

  async get<T = any>(key: string): Promise<T | null> {
    const data = await this.client.get(this.prefixedKey(key));
    if (!data) return null;
    try { return JSON.parse(data) as T; } catch { return data as T; }
  }

  async set<T = any>(key: string, value: T, ttl?: number): Promise<void> {
    const effectiveTtl = Math.ceil((ttl || this.defaultTtl) / 1000);
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (effectiveTtl > 0) {
      await this.client.setex(this.prefixedKey(key), effectiveTtl, serialized);
    } else {
      await this.client.set(this.prefixedKey(key), serialized);
    }
  }

  async del(key: string): Promise<boolean> {
    const result = await this.client.del(this.prefixedKey(key));
    return result > 0;
  }

  async has(key: string): Promise<boolean> {
    return (await this.client.exists(this.prefixedKey(key))) > 0;
  }

  async clear(): Promise<void> {
    const keys = await this.client.keys(`${this.prefix}*`);
    if (keys.length > 0) await this.client.del(...keys);
  }

  async keys(pattern?: string): Promise<string[]> {
    const searchPattern = `${this.prefix}${pattern || '*'}`;
    const keys = await this.client.keys(searchPattern);
    return keys.map((k: string) => k.slice(this.prefix.length));
  }

  async ttl(key: string): Promise<number> {
    const remaining = await this.client.ttl(this.prefixedKey(key));
    return remaining;
  }

  async size(): Promise<number> {
    const keys = await this.client.keys(`${this.prefix}*`);
    return keys.length;
  }

  async disconnect(): Promise<void> {
    if (this.ownClient && this.client) await this.client.quit();
  }
}

// ==================== Cache Manager ====================

export class CacheManager implements CacheAdapter {
  private adapter: CacheAdapter;
  private prefix: string;

  constructor(adapter?: CacheAdapter, options: CacheOptions = {}) {
    this.adapter = adapter || new MemoryCache(options);
    this.prefix = options.prefix || '';
  }

  private prefixedKey(key: string): string { return this.prefix ? `${this.prefix}:${key}` : key; }

  async get<T = any>(key: string): Promise<T | null> { return this.adapter.get<T>(this.prefixedKey(key)); }
  async set<T = any>(key: string, value: T, ttl?: number): Promise<void> { return this.adapter.set(this.prefixedKey(key), value, ttl); }
  async del(key: string): Promise<boolean> { return this.adapter.del(this.prefixedKey(key)); }
  async has(key: string): Promise<boolean> { return this.adapter.has(this.prefixedKey(key)); }
  async clear(): Promise<void> { return this.adapter.clear(); }
  async keys(pattern?: string): Promise<string[]> { return this.adapter.keys(pattern); }
  async ttl(key: string): Promise<number> { return this.adapter.ttl(this.prefixedKey(key)); }
  async size(): Promise<number> { return this.adapter.size(); }

  getAdapter(): CacheAdapter { return this.adapter; }

  async wrap<T>(key: string, fn: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await fn();
    await this.set(key, value, ttl);
    return value;
  }

  async invalidatePattern(pattern: string): Promise<number> {
    const keys = await this.keys(pattern);
    for (const key of keys) await this.del(key);
    return keys.length;
  }
}

// ==================== Cache Middleware ====================

export interface CacheMiddlewareOptions {
  ttl?: number;
  keyGenerator?: (ctx: any) => string;
  condition?: (ctx: any) => boolean;
}

export function cacheMiddleware(cache: CacheAdapter, options: CacheMiddlewareOptions = {}) {
  const { ttl, keyGenerator, condition } = options;
  return async (ctx: any) => {
    if (condition && !condition(ctx)) return;
    if (ctx.req.method !== 'GET') return;
    const key = keyGenerator ? keyGenerator(ctx) : `${ctx.req.method}:${ctx.req.url}`;
    const cached = await cache.get(key);
    if (cached !== null) { ctx.res.json(cached); return false; }
    const originalJson = ctx.res.json.bind(ctx.res);
    ctx.res.json = (data: any) => { cache.set(key, data, ttl); originalJson(data); };
  };
}

// ==================== Factory ====================

export function createCache(options: CacheOptions & { adapter?: 'memory' | 'redis'; redis?: RedisCacheOptions } = {}): CacheManager {
  let adapter: CacheAdapter;
  if (options.adapter === 'redis') {
    adapter = new RedisCache({ ...options.redis, ttl: options.ttl });
  } else {
    adapter = new MemoryCache(options);
  }
  return new CacheManager(adapter, options);
}