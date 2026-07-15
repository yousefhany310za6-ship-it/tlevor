// Benchmark server: Tlevor
// Handler logic is identical across all frameworks.
const { createApp } = require('../../packages/core/dist/index.js');

const JSON_RESPONSE = { message: 'Hello, World!' };

const app = createApp({ cors: false, bodyParser: false, security: false });

app.addRoute({ method: 'GET', path: '/json', handler: async () => JSON_RESPONSE });
app.addRoute({ method: 'GET', path: '/user/:id', handler: async (ctx) => ({ id: ctx.req.params.id, name: 'John Doe', email: 'john@example.com' }) });
app.addRoute({ method: 'GET', path: '/text', handler: async () => 'Hello, World!' });
app.addRoute({ method: 'POST', path: '/json', handler: async (ctx) => {
  // Manual body read - fair comparison (no body parser middleware)
  return await new Promise((resolve) => {
    const chunks = [];
    ctx.req.raw.on('data', (c) => chunks.push(c));
    ctx.req.raw.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}});
app.addRoute({ method: 'GET', path: '/headers', handler: async (ctx) => {
  ctx.res.header('X-Custom-1', 'value-1');
  ctx.res.header('X-Custom-2', 'value-2');
  ctx.res.header('X-Custom-3', 'value-3');
  ctx.res.header('X-Custom-4', 'value-4');
  ctx.res.header('X-Custom-5', 'value-5');
  return { contentType: ctx.req.headers['content-type'] || 'none' };
}});

const PORT = process.env.PORT || 7000;
app.listen(PORT).then(() => console.log(`Tlevor on ${PORT}`));
