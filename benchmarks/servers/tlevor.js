const { createApp } = require('../../packages/core/dist/index.js');

const app = createApp({ cors: false, bodyParser: true, security: false });

app.addRoute({
  method: 'GET',
  path: '/json',
  handler: async () => ({ message: 'Hello, World!' }),
});

app.addRoute({
  method: 'GET',
  path: '/user/:id',
  handler: async (ctx) => ({
    id: ctx.req.params.id, name: 'John Doe', email: 'john@example.com'
  }),
});

app.addRoute({
  method: 'GET',
  path: '/text',
  handler: async () => 'Hello, World!',
});

app.addRoute({
  method: 'POST',
  path: '/json',
  handler: async (ctx) => ctx.req.body || {},
});

app.addRoute({
  method: 'GET',
  path: '/headers',
  handler: async (ctx) => {
    ctx.res.header('X-Custom', 'value');
    return { contentType: ctx.req.headers['content-type'] };
  },
});

const PORT = process.env.PORT || 7000;
app.listen(PORT).then(() => console.log(`Tlevor on ${PORT}`));
