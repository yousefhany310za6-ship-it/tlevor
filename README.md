# Tlevor Framework

A high-performance backend framework for Node.js and TypeScript.

## Features

- **Radix Tree Router** - O(L) route matching with zero-allocation parameter extraction
- **Async Hook Pipeline** - Flat async hooks instead of recursive middleware chains
- **Encapsulated Plugin System** - Scoped hooks and dependency graph
- **TypeBox Validation** - Pre-compiled schemas for maximum performance
- **Pino Logger** - High-performance structured logging
- **Request Injection** - Test without starting a real server

## Packages

| Package | Description |
|---------|-------------|
| `@tlevor/types` | Core TypeScript interfaces and types |
| `@tlevor/router` | High-performance Radix Tree router |
| `@tlevor/core` | Application core, context, hooks, plugins |
| `@tlevor/validation` | TypeBox + Ajv validation |
| `@tlevor/logger` | Pino-based logging |
| `@tlevor/testing` | Request injection for testing |

## Quick Start

```bash
npm install @tlevor/core
```

```typescript
import { createApp } from '@tlevor/core';

const app = createApp();

app.addRoute({
  method: 'GET',
  path: '/hello',
  handler: (ctx) => {
    return { message: 'Hello from Tlevor!' };
  },
});

app.listen(3000);
```

## License

MIT
