const fastify = require('fastify')({ logger: false });

fastify.get('/json', async () => ({ message: 'Hello, World!' }));

fastify.get('/user/:id', async (request) => ({
  id: request.params.id, name: 'John Doe', email: 'john@example.com'
}));

fastify.get('/text', async () => 'Hello, World!');

fastify.post('/json', async (request) => request.body || {});

fastify.get('/headers', async (request) => {
  return { contentType: request.headers['content-type'] };
});

const PORT = process.env.PORT || 7002;
fastify.listen({ port: PORT, host: '0.0.0.0' }, () => console.log(`Fastify on ${PORT}`));
