const Koa = require('koa');
const Router = require('@koa/router');

const app = new Koa();
const router = new Router();

router.get('/json', (ctx) => {
  ctx.body = { message: 'Hello, World!' };
});

router.get('/user/:id', (ctx) => {
  ctx.body = { id: ctx.params.id, name: 'John Doe', email: 'john@example.com' };
});

router.get('/text', (ctx) => {
  ctx.body = 'Hello, World!';
});

router.post('/json', async (ctx) => {
  let body = '';
  await new Promise(resolve => {
    ctx.req.on('data', chunk => body += chunk);
    ctx.req.on('end', resolve);
  });
  try { ctx.body = JSON.parse(body); } catch { ctx.body = {}; }
});

router.get('/headers', (ctx) => {
  ctx.set('X-Custom', 'value');
  ctx.body = { contentType: ctx.request.headers['content-type'] };
});

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = process.env.PORT || 7003;
app.listen(PORT, () => console.log(`Koa on ${PORT}`));
