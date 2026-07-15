const { Hono } = require('hono');
const { serve } = require('@hono/node-server');

const app = new Hono();

app.get('/json', (c) => c.json({ message: 'Hello, World!' }));

app.get('/user/:id', (c) => c.json({
  id: c.req.param('id'), name: 'John Doe', email: 'john@example.com'
}));

app.get('/text', (c) => c.text('Hello, World!'));

app.post('/json', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(body);
});

app.get('/headers', (c) => {
  c.header('X-Custom', 'value');
  return c.json({ contentType: c.req.header('content-type') });
});

const PORT = process.env.PORT || 7004;
serve({ fetch: app.fetch, port: PORT }, () => console.log(`Hono on ${PORT}`));
