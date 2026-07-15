// Benchmark server: Koa
// Handler logic is identical across all frameworks.
const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');

const JSON_RESPONSE = { message: 'Hello, World!' };
const app = new Koa();
const router = new Router();

app.use(bodyParser());

router.get('/json', (ctx) => { ctx.body = JSON_RESPONSE; });
router.get('/user/:id', (ctx) => { ctx.body = { id: ctx.params.id, name: 'John Doe', email: 'john@example.com' }; });
router.get('/text', (ctx) => { ctx.type = 'text/plain'; ctx.body = 'Hello, World!'; });
router.post('/json', async (ctx) => { ctx.body = ctx.request.body || {}; });
router.get('/headers', (ctx) => {
  ctx.set('X-Custom-1', 'value-1');
  ctx.set('X-Custom-2', 'value-2');
  ctx.set('X-Custom-3', 'value-3');
  ctx.set('X-Custom-4', 'value-4');
  ctx.set('X-Custom-5', 'value-5');
  ctx.body = { contentType: ctx.get('content-type') || 'none' };
});

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = process.env.PORT || 7003;
app.listen(PORT, () => console.log(`Koa on ${PORT}`));
