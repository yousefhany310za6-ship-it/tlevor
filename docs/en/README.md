# Tlevor Framework

A high-performance backend framework for Node.js and TypeScript. Tlevor pairs a core-level Radix Tree router with a flat asynchronous hook pipeline and a flexible adapter-based data layer.

---

## 1. Overview

Tlevor is organized as a `pnpm` monorepo. Every core capability ships as an independent package under `packages/`. The repository contains 23 packages split into:

- **Core packages:** `types`, `router`, `core`, `validation`, `orm`, `logger`, `testing`
- **Feature packages:** `auth`, `cache`, `config`, `di`, `graphql`, `monitoring`, `queue`, `scheduler`, `swagger`, `tracing`, `cloud`, `mailer`, `cli`, `integration`

The goal: a full-featured HTTP server with minimal lost flexibility and performance competitive with Fastify, Hono, and Express.

---

## 2. Key Features

| Feature | Description |
|---------|-------------|
| **Radix Tree Router** | O(L) route matching with zero-allocation parameter extraction. Static routes are cached for fast lookup. |
| **Async Hook Pipeline** | Flat async hooks instead of recursive middleware chains: `onRequest`, `preParsing`, `preValidation`, `preHandler`, `postHandler`, `onResponse`. |
| **Encapsulated Plugin System** | Scoped hooks and a dependency graph. |
| **Unified Validation** | Route schemas validated by the shared `@tlevor/validation` engine (required fields, types, string/number constraints, enums, patterns). |
| **ORM** | Adapter-based data layer (`@tlevor/orm`) with in-memory and SQLite adapters behind one `Model`/`createAdapter` API. |
| **Built-in Logger** | Lightweight structured logger (no external dependency). |
| **Request Injection** | Test routes without starting a real server via `app.inject()`. |

---

## 3. Quick Start

```bash
pnpm install
pnpm build      # build all packages
pnpm test       # run the full suite (202 tests)
```

Minimal example:

```typescript
import { createApp } from '@tlevor/core';
import { createAdapter, Model } from '@tlevor/orm';

const app = createApp({ bodyParser: true });

const adapter = createAdapter('memory');
await adapter.connect();
const User = new Model(adapter, { tableName: 'users', primaryKey: 'id' });

app.addRoute({
  method: 'POST',
  path: '/users',
  schema: {
    body: {
      type: 'object',
      required: ['name', 'email'],
      properties: {
        name: { type: 'string', minLength: 2 },
        email: { type: 'string' },
      },
    },
  },
  handler: async (ctx) => {
    const user = await User.create(ctx.req.body);
    ctx.res.status(201);
    return user;
  },
});

app.addRoute({
  method: 'GET',
  path: '/users/:id',
  handler: async (ctx) => User.findById(ctx.req.params.id),
});

await app.listen(3000);
```

---

## 4. The `@tlevor/core` Package

The operational heart of the framework. It exposes the `TlevorApp` class and the `createApp()` factory.

### 4.1 Request Lifecycle

On an incoming HTTP request:

1. The route is matched via `Router.findRouteByMethod`.
2. CORS headers are applied (an `OPTIONS` request returns 204 immediately).
3. Security headers are applied (when `security: true`).
4. The Rate Limiter runs — it sets `X-RateLimit-*` and returns 429 on overflow.
5. A `TlevorContext` is built (with `req`, `res`, `state`, `logger`).
6. The body is parsed for `POST/PUT/PATCH` when `bodyParser` is enabled.
7. The hook chain runs: `onRequest → preParsing → [schema validation] → preValidation → preHandler → handler → postHandler → onResponse`.
8. The response is written; if the handler returns a value it is serialized to JSON/text.

### 4.2 Hooks

```typescript
app.addHook('onRequest', async (ctx) => {
  ctx.state.start = Date.now();
});
app.addHook('preHandler', async (ctx) => {
  if (!ctx.req.headers['authorization']) return false; // stops processing
});
```

Returning `false` from a hook stops the chain and prevents the handler from running.

### 4.3 Validation

A `schema` is passed per route. It supports `body`, `query`, `params`, and `response`. On failure a `400 VALIDATION_ERROR` with details is returned.

### 4.4 Built-in Capabilities

- **Body Parsing:** JSON and `application/x-www-form-urlencoded` with a size limit (`PayloadTooLargeError`).
- **CORS:** via `cors: true` or an options object (`origin`, `methods`, `credentials`, ...).
- **Cookies:** `ctx.res.cookie()`, `clearCookie()`, and `ctx.req.cookies`.
- **Security Headers:** `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, and more.
- **Rate Limiting:** `app.rateLimit({ max, window })`.
- **Static Files:** `serveStatic({ root, prefix })`.
- **WebSockets:** `app.ws('/path', { onConnection, onMessage, onClose, onError })` (via `ws`).
- **Request Injection:** `const res = await app.inject({ method, url, body });`.

### 4.5 Built-in Errors

`TlevorError` with derived classes: `ValidationError` (400), `NotFoundError` (404), `UnauthorizedError` (401), `ForbiddenError` (403), `ConflictError` (409), `PayloadTooLargeError` (413). Any unhandled error becomes `500 INTERNAL_ERROR`.

---

## 5. The `@tlevor/router` Package

A Radix Tree router. The primary interface is `Router`:

```typescript
const router = new Router();
router.addRoute('GET', '/users/:id', handler);
const match = router.findRouteByMethod('GET', '/users/42');
// match.handler, match.params = { id: '42' }
```

- Supports `:name` parameters and `*` wildcards.
- Caches static routes in a `Map` for fast lookup.
- `getRoutes()` returns every registered route (useful for Swagger).

---

## 6. The `@tlevor/orm` Package

An adapter-based data layer. The current structure is modular:

```
packages/orm/src/
├── index.ts            # re-exports the full public API
├── query-builder.ts   # QueryBuilder + execute()
├── model.ts           # Model, createModel
├── adapter.ts         # DatabaseAdapter interface
├── adapters/
│   ├── memory.ts      # MemoryAdapter (built-in mini SQL interpreter)
│   ├── sqlite.ts      # SqliteAdapter (better-sqlite3)
│   ├── prisma.ts      # PrismaAdapter
│   └── drizzle.ts     # DrizzleAdapter
├── migrations.ts      # MigrationManager
├── decorators.ts      # @Table, @Column, @PrimaryKey, syncModel
└── factory.ts         # createAdapter
```

### 6.1 Creating an Adapter

```typescript
import { createAdapter } from '@tlevor/orm';

const mem = createAdapter('memory');
const sqlite = createAdapter('sqlite', { sqlite: { memory: true } });
// or: createAdapter('prisma', { prisma: client })
// or: createAdapter('drizzle', { drizzle: db })
```

### 6.2 The Model

```typescript
const User = new Model(adapter, { tableName: 'users', primaryKey: 'id' });

await User.create({ name: 'Alice' });          // auto-adds timestamps
await User.findById(1);
await User.findMany({ where: { age: 30 }, orderBy: { age: 'asc' }, limit: 10 });
await User.update(1, { name: 'Bob' });
await User.delete(1);
await User.count({ active: true });
await User.upsert({ id: 1, name: 'X' });
```

- With `timestamps` enabled (default), `createdAt`/`updatedAt` are added as **ISO strings** consistently across adapters.
- `Model.sync(columns)` creates the table on DDL-capable adapters (SQLite).

### 6.3 The QueryBuilder — Now Functional

```typescript
import { QueryBuilder } from '@tlevor/orm';

await new QueryBuilder('users')
  .insert({ name: 'Alice', age: 30 })
  .execute(adapter);

const adults = await new QueryBuilder('users')
  .select('id', 'name')
  .where('age', '>', 18)
  .and('active', '=', true)
  .orderBy('name', 'desc')
  .limit(10)
  .offset(20)
  .execute(adapter);   // returns the rows
```

- `execute(adapter)` calls `adapter.raw()` for select/count and `adapter.execute()` for writes (insert/update/delete/upsert).
- Supports: `in`, `notIn`, `like`, `between`, `isNull`, `isNotNull`, `join/leftJoin/rightJoin`, `returning`.
- `upsert` uses the SQLite-compatible `ON CONFLICT(id) DO UPDATE SET` form.
- `MemoryAdapter` ships a built-in SQL interpreter supporting the same statements, so it behaves identically to SQLite.

### 6.4 Adapters

| Adapter | Storage | DDL (`sync`) | Status |
|---------|---------|--------------|--------|
| `MemoryAdapter` | in-memory map | no | tested |
| `SqliteAdapter` | file/memory (better-sqlite3) | yes | tested |
| `PrismaAdapter` | Prisma client | via Prisma | untested* |
| `DrizzleAdapter` | Drizzle instance | via Drizzle | untested* |

\* Require a live client; provided as drop-in implementations of the `DatabaseAdapter` contract.

### 6.5 Decorator-based Sync

```typescript
@Table({ tableName: 'products' })
class Product {
  @PrimaryKey() id!: number;
  @Column({ type: 'string' }) name!: string;
  @Column({ type: 'number' }) price!: number;
}

await syncModel(Product, adapter); // creates the table on SQLite
```

### 6.6 Migrations

```typescript
const mm = new MigrationManager({ adapter });
mm.addMigration({ name: 'init', up: ['CREATE TABLE ...'], down: ['DROP TABLE ...'] });
await mm.up();
```

---

## 7. Feature Packages

| Package | Purpose | Core Interface |
|---------|---------|----------------|
| `@tlevor/auth` | JWT authentication | `JwtOptions`, `sign`, `verify` |
| `@tlevor/cache` | Caching | `CacheAdapter`, `MemoryCache`, `cacheMiddleware` |
| `@tlevor/config` | Configuration management | `Config`, `ConfigOptions` |
| `@tlevor/di` | Dependency injection | `Container`, `ServiceDefinition` |
| `@tlevor/graphql` | GraphQL schema building | `GraphQLSchemaBuilder` |
| `@tlevor/monitoring` | Metrics | `Counter`, `Gauge`, `MetricOptions` |
| `@tlevor/queue` | Job queues | `Job`, `JobProcessor`, `QueueEvents` |
| `@tlevor/scheduler` | Cron scheduling | `parseCron`, `cronMatches` |
| `@tlevor/swagger` | OpenAPI docs | `SwaggerOptions`, `RouteDoc` |
| `@tlevor/tracing` | Distributed tracing | `Tracer`, `Span`, `SpanOptions` |
| `@tlevor/cloud` | Docker generation | `generateDockerfile`, `writeDockerfile` |
| `@tlevor/mailer` | Mail sending | `Mailer`, `MailMessage` |
| `@tlevor/cli` | Command-line tool | — |
| `@tlevor/integration` | Integration test suite | — |

---

## 8. Testing

- Run with `pnpm test` (vitest).
- Test files live in `packages/*/__tests__/*.test.ts`.
- Tests import from `../src/index` directly, so the `index.ts` public API is kept stable.
- Current suite: **202 tests, all passing**.

---

## 9. Project Layout

```
ramses/
├── packages/          # 23 packages (core + features)
├── examples/basic/    # example application
├── benchmarks/        # performance comparisons (Tlevor vs Express/Fastify/Koa/Hono)
├── benchmarks-fair/   # scientific + stress benchmarks
├── pnpm-workspace.yaml
├── tsconfig.json
└── vitest.config.ts
```

---

## 10. License

MIT
