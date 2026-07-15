// Benchmark server: Fastify
// Handler logic is identical across all frameworks.
const fastify = require('fastify')({ logger: false });

const JSON_RESPONSE = { message: 'Hello, World!' };

fastify.get('/json', async () => JSON_RESPONSE);

fastify.get('/user/:id', async (request) => ({ id: request.params.id, name: 'John Doe', email: 'john@example.com' }));

fastify.get('/text', async (_, reply) => { reply.header('Content-Type', 'text/plain'); return 'Hello, World!'; });

fastify.post('/json', async (request) => request.body || {});

fastify.get('/headers', async (request, reply) => {
  reply.header('X-Custom-1', 'value-1');
  reply.header('X-Custom-2', 'value-2');
  reply.header('X-Custom-3', 'value-3');
  reply.header('X-Custom-4', 'value-4');
  reply.header('X-Custom-5', 'value-5');
  return { contentType: request.headers['content-type'] || 'none' };
});

const PORT = process.env.PORT || 7002;
fastify.listen({ port: PORT, host: '0.0.0.0' }, () => console.log(`Fastify on ${PORT}`));
