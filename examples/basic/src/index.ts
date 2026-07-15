import { createApp } from '../../packages/core/src/index';
import { serveStatic } from '../../packages/core/src/index';

const app = createApp({
  cors: true,
  bodyParser: true,
  security: true,
});

// Rate limiting
app.rateLimit({ max: 100, window: 60000 }); // 100 requests per minute

// Validation schemas
const createUserSchema = {
  type: 'object',
  required: ['name', 'email'],
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 50 },
    email: { type: 'string', pattern: '^[\\w-\\.]+@[\\w-]+\\.[a-zA-Z]{2,}$' },
    age: { type: 'number', minimum: 0, maximum: 150 },
    role: { type: 'string', enum: ['admin', 'user', 'guest'] },
  },
};

const userResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    email: { type: 'string' },
    role: { type: 'string' },
  },
};

// In-memory user store
let users = [
  { id: 1, name: 'John Doe', email: 'john@example.com', role: 'admin' },
  { id: 2, name: 'Jane Smith', email: 'jane@example.com', role: 'user' },
];

// GET /users - List all users
app.addRoute({
  method: 'GET',
  path: '/users',
  handler: async (ctx) => {
    return { users, total: users.length };
  },
});

// POST /users - Create a new user with validation
app.addRoute({
  method: 'POST',
  path: '/users',
  handler: async (ctx) => {
    const newUser = {
      id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
      ...ctx.req.body,
    };
    users.push(newUser);
    ctx.res.status(201);
    return newUser;
  },
  schema: { body: createUserSchema, response: userResponseSchema },
});

// GET /users/:id - Get user by ID
app.addRoute({
  method: 'GET',
  path: '/users/:id',
  handler: async (ctx) => {
    const id = parseInt(ctx.req.params.id);
    const user = users.find(u => u.id === id);
    if (!user) {
      ctx.res.status(404);
      return { error: 'User not found' };
    }
    return user;
  },
});

// PUT /users/:id - Update user
app.addRoute({
  method: 'PUT',
  path: '/users/:id',
  handler: async (ctx) => {
    const id = parseInt(ctx.req.params.id);
    const index = users.findIndex(u => u.id === id);
    if (index === -1) {
      ctx.res.status(404);
      return { error: 'User not found' };
    }
    users[index] = { ...users[index], ...ctx.req.body };
    return users[index];
  },
  schema: { body: createUserSchema, response: userResponseSchema },
});

// DELETE /users/:id - Delete user
app.addRoute({
  method: 'DELETE',
  path: '/users/:id',
  handler: async (ctx) => {
    const id = parseInt(ctx.req.params.id);
    const index = users.findIndex(u => u.id === id);
    if (index === -1) {
      ctx.res.status(404);
      return { error: 'User not found' };
    }
    users.splice(index, 1);
    ctx.res.status(204);
  },
});

// Cookies example
app.addRoute({
  method: 'POST',
  path: '/cookies/set',
  handler: async (ctx) => {
    ctx.res.cookie('session', 'abc123', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 3600000,
      sameSite: 'strict',
    });
    return { message: 'Cookie set' };
  },
});

app.addRoute({
  method: 'GET',
  path: '/cookies/get',
  handler: async (ctx) => {
    return { cookies: ctx.req.cookies };
  },
});

// Custom header example
app.addRoute({
  method: 'GET',
  path: '/headers',
  handler: async (ctx) => {
    ctx.res.header('X-Custom-Header', 'Hello from Tlevor');
    return { message: 'Custom header set' };
  },
});

// Static files example
app.addRoute({
  method: 'GET',
  path: '/static/*',
  handler: serveStatic({ root: './public', prefix: '/static' }),
});

// Error handling example
app.addRoute({
  method: 'GET',
  path: '/error',
  handler: async (ctx) => {
    throw new Error('This is a test error');
  },
});

// WebSocket example - Chat room
const clients = new Map<string, string>(); // id -> username

app.ws('/ws/chat', {
  onConnection: (conn) => {
    console.log(`Client connected: ${conn.id}`);
    clients.set(conn.id, 'Anonymous');
    conn.send(JSON.stringify({ type: 'welcome', message: 'Connected to chat!', id: conn.id }));
  },
  onMessage: (conn, data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'join') {
        clients.set(conn.id, msg.username || 'Anonymous');
        conn.send(JSON.stringify({ type: 'joined', username: clients.get(conn.id) }));
      } else if (msg.type === 'message') {
        const username = clients.get(conn.id) || 'Anonymous';
        const broadcast = JSON.stringify({ type: 'message', username, content: msg.content, timestamp: Date.now() });
        for (const [id, clientConn] of (app.getWebSocketConnections() as any)) {
          if (id !== conn.id) clientConn.send(broadcast);
        }
        conn.send(JSON.stringify({ type: 'echo', content: msg.content }));
      }
    } catch {
      conn.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  },
  onClose: (conn) => {
    console.log(`Client disconnected: ${conn.id}`);
    clients.delete(conn.id);
  },
});

// WebSocket example - Real-time notifications
app.ws('/ws/notifications', {
  onConnection: (conn) => {
    conn.send(JSON.stringify({ type: 'connected', message: 'Notification service ready' }));
  },
  onMessage: (conn, data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'subscribe') {
      conn.send(JSON.stringify({ type: 'subscribed', channel: msg.channel }));
    }
  },
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await app.close();
  process.exit(0);
});

async function start() {
  try {
    await app.listen(3000);
    console.log('Tlevor server running on http://localhost:3000');
    console.log('Try these endpoints:');
    console.log('  GET    http://localhost:3000/users');
    console.log('  POST   http://localhost:3000/users (with JSON body)');
    console.log('  GET    http://localhost:3000/users/1');
    console.log('  PUT    http://localhost:3000/users/1 (with JSON body)');
    console.log('  DELETE http://localhost:3000/users/1');
    console.log('  POST   http://localhost:3000/cookies/set');
    console.log('  GET    http://localhost:3000/cookies/get');
    console.log('  GET    http://localhost:3000/headers');
    console.log('  GET    http://localhost:3000/error');
    console.log('  WS     ws://localhost:3000/ws/chat');
    console.log('  WS     ws://localhost:3000/ws/notifications');
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();