// Benchmark server: Express
// Handler logic is identical across all frameworks.
const express = require('express');

const JSON_RESPONSE = { message: 'Hello, World!' };
const app = express();

app.use(express.json());

app.get('/json', (req, res) => res.json(JSON_RESPONSE));

app.get('/user/:id', (req, res) => res.json({ id: req.params.id, name: 'John Doe', email: 'john@example.com' }));

app.get('/text', (req, res) => res.type('text/plain').send('Hello, World!'));

app.post('/json', (req, res) => res.json(req.body || {}));

app.get('/headers', (req, res) => {
  res.set('X-Custom-1', 'value-1');
  res.set('X-Custom-2', 'value-2');
  res.set('X-Custom-3', 'value-3');
  res.set('X-Custom-4', 'value-4');
  res.set('X-Custom-5', 'value-5');
  res.json({ contentType: req.get('content-type') || 'none' });
});

const PORT = process.env.PORT || 7001;
app.listen(PORT, () => console.log(`Express on ${PORT}`));
