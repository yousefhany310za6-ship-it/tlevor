const express = require('express');
const app = express();

app.get('/json', (req, res) => {
  res.json({ message: 'Hello, World!' });
});

app.get('/user/:id', (req, res) => {
  res.json({ id: req.params.id, name: 'John Doe', email: 'john@example.com' });
});

app.get('/text', (req, res) => {
  res.send('Hello, World!');
});

app.post('/json', (req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      res.json(JSON.parse(body));
    } catch {
      res.json({});
    }
  });
});

app.get('/headers', (req, res) => {
  res.set('X-Custom', 'value');
  res.json({ contentType: req.headers['content-type'] });
});

const PORT = process.env.PORT || 7001;
app.listen(PORT, () => console.log(`Express on ${PORT}`));
