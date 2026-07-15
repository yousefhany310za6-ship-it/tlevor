import { createApp } from '@tlevor/core';
import { createLogger } from '@tlevor/logger';

const app = createApp();
const logger = createLogger({ level: 'info' });

app.addHook('onRequest', (ctx) => {
  logger.info(`${ctx.req.method} ${ctx.req.url}`);
});

app.addRoute({
  method: 'GET',
  path: '/health',
  handler: (ctx) => {
    return { status: 'ok', timestamp: Date.now() };
  },
});

app.addRoute({
  method: 'GET',
  path: '/hello',
  handler: (ctx) => {
    return { message: 'Hello from Tlevor!' };
  },
});

app.addRoute({
  method: 'GET',
  path: '/users/:id',
  handler: (ctx) => {
    return { userId: ctx.req.params.id, name: 'John Doe' };
  },
});

const port = parseInt(process.env.PORT || '3000', 10);

async function main() {
  try {
    await app.listen(port);
    logger.info(`Server started on port ${port}`);
  } catch (err) {
    logger.error('Failed to start server', { error: err });
    process.exit(1);
  }
}

main();
