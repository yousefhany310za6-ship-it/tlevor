import { createApp, ValidationError, NotFoundError } from '@tlevor/core';
import { createLogger } from '@tlevor/logger';

const app = createApp({
  cors: true,
  bodyParser: true,
  logger: createLogger({ level: 'info' }),
});

// Request logging hook
app.addHook('onRequest', (ctx) => {
  ctx.logger.info(`${ctx.req.method} ${ctx.req.url}`);
});

// Health check
app.addRoute({
  method: 'GET',
  path: '/health',
  handler: (ctx) => {
    return { status: 'ok', timestamp: Date.now() };
  },
});

// Hello world
app.addRoute({
  method: 'GET',
  path: '/hello',
  handler: (ctx) => {
    return { message: 'Hello from Tlevor!' };
  },
});

// User by ID
app.addRoute({
  method: 'GET',
  path: '/users/:id',
  handler: (ctx) => {
    const { id } = ctx.req.params;
    if (id === '999') {
      throw new NotFoundError('User');
    }
    return { userId: id, name: 'John Doe', email: 'john@example.com' };
  },
});

// Create user (POST with body parsing)
app.addRoute({
  method: 'POST',
  path: '/users',
  handler: (ctx) => {
    const { name, email } = ctx.req.body;

    if (!name || !email) {
      throw new ValidationError('Name and email are required');
    }

    return {
      id: Math.floor(Math.random() * 1000),
      name,
      email,
      createdAt: new Date().toISOString(),
    };
  },
});

// Update user (PUT with body parsing)
app.addRoute({
  method: 'PUT',
  path: '/users/:id',
  handler: (ctx) => {
    const { id } = ctx.req.params;
    const { name, email } = ctx.req.body;

    return {
      userId: id,
      name: name || 'Updated Name',
      email: email || 'updated@example.com',
      updatedAt: new Date().toISOString(),
    };
  },
});

// Error handling example
app.addRoute({
  method: 'GET',
  path: '/error',
  handler: (ctx) => {
    throw new Error('Something went wrong!');
  },
});

// Custom error example
app.addRoute({
  method: 'GET',
  path: '/custom-error',
  handler: (ctx) => {
    throw new ValidationError('Invalid input', { field: 'email' });
  },
});

const port = parseInt(process.env.PORT || '3000', 10);

async function main() {
  try {
    await app.listen(port);
    console.log(`\n🚀 Server started on http://localhost:${port}`);
    console.log(`\n📋 Available endpoints:`);
    console.log(`   GET  /health         - Health check`);
    console.log(`   GET  /hello          - Hello world`);
    console.log(`   GET  /users/:id      - Get user by ID`);
    console.log(`   POST /users          - Create user`);
    console.log(`   PUT  /users/:id      - Update user`);
    console.log(`   GET  /error          - Test error handling`);
    console.log(`   GET  /custom-error   - Test custom error`);
    console.log(`\n💡 Try:`);
    console.log(`   curl http://localhost:${port}/health`);
    console.log(`   curl http://localhost:${port}/hello`);
    console.log(`   curl http://localhost:${port}/users/123`);
    console.log(`   curl -X POST http://localhost:${port}/users -H "Content-Type: application/json" -d '{"name":"Ahmed","email":"ahmed@test.com"}'`);
    console.log(`   curl http://localhost:${port}/users/999`);
    console.log(`   curl http://localhost:${port}/error`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

main();
