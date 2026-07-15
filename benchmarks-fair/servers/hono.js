// Benchmark server: Hono
// Handler logic is identical across all frameworks.
const { Hono } = require('hono');
const { serve } = require('@hono/node-server');

const JSON_RESPONSE = { message: 'Hello, World!' };
const app = new Hono();

app.get('/json', (c) => c.json(JSON_RESPONSE));

app.get('/user/:id', (c) => c.json({ id: c.req.param('id'), name: 'John Doe', email: 'john@example.com' }));

app.get('/text', (c) => c.text('Hello, World!'));

app.post('/json', async (c) => {
  try { const body = await c.req.json(); return c.json(body); }
  catch { return c.json({}); }
});

app.get('/headers', (c) => {
  c.header('X-Custom-1', 'value-1');
  c.header('X-Custom-2', 'value-2');
  c.header('X-Custom-3', 'value-3');
  c.header('X-Custom-4', 'value-4');
  c.header('X-Custom-5', 'value-5');
  return c.json({ contentType: c.req.header('content-type') || 'none' });
});

const PORT = process.env.PORT || 7004;
serve({ fetch: app.fetch, port: PORT }, () => console.log(`Hono on ${PORT}`));
