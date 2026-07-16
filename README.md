# Tlevor Framework

A high-performance backend framework for Node.js and TypeScript.

## Features

- **Radix Tree Router** - O(L) route matching with zero-allocation parameter extraction
- **Async Hook Pipeline** - Flat async hooks instead of recursive middleware chains
- **Encapsulated Plugin System** - Scoped hooks and dependency graph
- **Unified Validation** - Route schemas validated by the shared `@tlevor/validation` engine (required fields, types, string/number constraints, enums, patterns)
- **ORM** - Adapter-based data layer (`@tlevor/orm`) with in-memory and SQLite adapters behind one `Model`/`createAdapter` API
- **Built-in Logger** - Lightweight structured logger (no external dependency)
- **Request Injection** - Test without starting a real server

## Packages

| Package | Description |
|---------|-------------|
| `@tlevor/types` | Core TypeScript interfaces and types |
| `@tlevor/router` | High-performance Radix Tree router |
| `@tlevor/core` | Application core, context, hooks, plugins, validation, static files, CORS, rate limiting |
| `@tlevor/validation` | Schema validation engine used by core |
| `@tlevor/orm` | Adapter-based ORM (Memory + SQLite) with `Model` and `createAdapter` |
| `@tlevor/logger` | Structured logging |
| `@tlevor/testing` | Request injection for testing |

## Quick Start

```bash
npm install @tlevor/core @tlevor/orm
```

```typescript
import { createApp } from '@tlevor/core';
import { createAdapter, Model } from '@tlevor/orm';

const app = createApp({ bodyParser: true });

// Adapter-backed data layer (swap 'memory' for 'sqlite' to persist to disk)
const adapter = createAdapter('memory');
await adapter.connect();
const User = new Model(adapter, { tableName: 'users', primaryKey: 'id' });

// Route schema is validated by the shared @tlevor/validation engine
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

## License

MIT
