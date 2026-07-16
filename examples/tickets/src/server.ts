import { createApp, TlevorApp, TlevorError } from '@tlevor/core';
import { Model } from '@tlevor/orm';
import type { DatabaseAdapter } from '@tlevor/orm';
import { auth, issueToken, passwords } from './auth.js';
import { createDb } from './db.js';
import { seed } from './seed.js';

export async function buildApp(db?: DatabaseAdapter): Promise<{ app: TlevorApp; db: DatabaseAdapter }> {
  const adapter = (db as any) || (await createDb());
  const app = createApp({ bodyParser: true, cors: true });

  const User = new Model(adapter, { tableName: 'users', timestamps: false });
  const TicketType = new Model(adapter, { tableName: 'ticket_types', timestamps: false });
  const Ticket = new Model(adapter, { tableName: 'tickets', timestamps: false });

  // Require a valid JWT/session for every route except the public ones.
  app.addHook('onRequest', auth.authenticate());

  // ---------- Health ----------
  app.addRoute({
    method: 'GET',
    path: '/health',
    schema: {},
    handler: async () => ({ status: 'ok' }),
  });

  // ---------- Auth ----------
  app.addRoute({
    method: 'POST',
    path: '/auth/register',
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password', 'name'],
        properties: {
          email: { type: 'string' },
          password: { type: 'string', minLength: 6 },
          name: { type: 'string' },
        },
      },
    },
    handler: async (ctx) => {
      const { email, password, name } = ctx.req.body;
      const existing = await User.findOne({ where: { email } });
      if (existing) throw new TlevorError('Email already registered', 409, 'EMAIL_TAKEN');
      const user = await User.create({
        email,
        password: await passwords.hash(password),
        name,
        role: 'user',
      });
      return { token: issueToken(user), user: publicUser(user) };
    },
  });

  app.addRoute({
    method: 'POST',
    path: '/auth/login',
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: { email: { type: 'string' }, password: { type: 'string' } },
      },
    },
    handler: async (ctx) => {
      const { email, password } = ctx.req.body;
      const user = await User.findOne({ where: { email } });
      if (!user || !(await passwords.verify(password, user.password))) {
        throw new TlevorError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
      }
      return { token: issueToken(user), user: publicUser(user) };
    },
  });

  app.addRoute({
    method: 'GET',
    path: '/me',
    handler: async (ctx) => {
      const me = await User.findById((ctx.state as any).user.id);
      return publicUser(me);
    },
  });

  // ---------- Ticket Types (admin write) ----------
  app.addRoute({
    method: 'GET',
    path: '/ticket-types',
    handler: async () => TicketType.findMany({ orderBy: { id: 'asc' } }),
  });

  app.addRoute({
    method: 'POST',
    path: '/ticket-types',
    schema: {
      body: {
        type: 'object',
        required: ['name', 'price', 'totalQuantity'],
        properties: {
          name: { type: 'string' },
          price: { type: 'number', minimum: 0 },
          totalQuantity: { type: 'number', minimum: 1 },
        },
      },
    },
    handler: async (ctx) => {
      requireAdmin(ctx);
      const { name, price, totalQuantity } = ctx.req.body;
      const existing = await TicketType.findOne({ where: { name } });
      if (existing) throw new TlevorError('Ticket type already exists', 409, 'TYPE_EXISTS');
      return TicketType.create({ name, price, totalQuantity, available: totalQuantity });
    },
  });

  app.addRoute({
    method: 'PUT',
    path: '/ticket-types/:id',
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          price: { type: 'number', minimum: 0 },
          totalQuantity: { type: 'number', minimum: 1 },
        },
      },
    },
    handler: async (ctx) => {
      requireAdmin(ctx);
      const id = Number(ctx.req.params.id);
      const updates = ctx.req.body;
      const current = await TicketType.findById(id);
      if (!current) throw new TlevorError('Ticket type not found', 404, 'NOT_FOUND');

      const newAvailable = computeAvailable(current, updates);
      return TicketType.update(id, { ...updates, available: newAvailable });
    },
  });

  app.addRoute({
    method: 'DELETE',
    path: '/ticket-types/:id',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const id = Number(ctx.req.params.id);
      const current = await TicketType.findById(id);
      if (!current) throw new TlevorError('Ticket type not found', 404, 'NOT_FOUND');
      const booked = await Ticket.count({ typeId: id });
      if (booked > 0) throw new TlevorError('Cannot delete a ticket type with booked tickets', 409, 'HAS_BOOKINGS');
      return { deleted: await TicketType.delete(id) };
    },
  });

  // ---------- Tickets (booking) ----------
  app.addRoute({
    method: 'GET',
    path: '/tickets',
    handler: async (ctx) => {
      const me = (ctx.state as any).user;
      // Admins see everything; regular users see only their own.
      const where = me.role === 'admin' ? {} : { userId: Number(me.id) };
      return Ticket.findMany({ where, orderBy: { id: 'asc' } });
    },
  });

  app.addRoute({
    method: 'POST',
    path: '/tickets',
    schema: {
      body: {
        type: 'object',
        required: ['typeId'],
        properties: { typeId: { type: 'number' }, seat: { type: 'string' } },
      },
    },
    handler: async (ctx) => {
      const typeId = Number(ctx.req.body.typeId);
      const seat = ctx.req.body.seat ?? null;
      const userId = (ctx.state as any).user.id;

      // Atomic booking: the whole check-and-decrement runs inside a single
      // SQLite transaction so two concurrent requests can never oversell the
      // remaining seats (race condition guard).
      return adapter.transaction(async (tx: DatabaseAdapter) => {
        const Types = new Model(tx, { tableName: 'ticket_types', timestamps: false });
        const Tickets = new Model(tx, { tableName: 'tickets', timestamps: false });

        const type = await Types.findById(typeId);
        if (!type) throw new TlevorError('Ticket type not found', 404, 'NOT_FOUND');
        if (type.available <= 0) throw new TlevorError('Sold out', 409, 'SOLD_OUT');

        await Types.update(typeId, { available: type.available - 1 });
        return Tickets.create({ typeId, userId, seat, status: 'booked' });
      });
    },
  });

  app.addRoute({
    method: 'DELETE',
    path: '/tickets/:id',
    handler: async (ctx) => {
      const id = Number(ctx.req.params.id);
      const me = (ctx.state as any).user;
      const ticket = await Ticket.findById(id);
      if (!ticket) throw new TlevorError('Ticket not found', 404, 'NOT_FOUND');
      if (me.role !== 'admin' && ticket.userId !== Number(me.id)) {
        throw new TlevorError('Forbidden', 403, 'FORBIDDEN');
      }

      // Returning the seat to the pool is done atomically too.
      return adapter.transaction(async (tx: DatabaseAdapter) => {
        const Types = new Model(tx, { tableName: 'ticket_types', timestamps: false });
        const Tickets = new Model(tx, { tableName: 'tickets', timestamps: false });
        const type = await Types.findById(ticket.typeId);
        if (type) await Types.update(ticket.typeId, { available: type.available + 1 });
        await Tickets.delete(id);
        return { cancelled: true };
      });
    },
  });

  return { app, db: adapter };
}

function publicUser(u: any) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}

/** Enforce admin role; throws 403 otherwise. */
function requireAdmin(ctx: any): void {
  const user = ctx.state?.user;
  if (!user || (user.roles || [user.role]).indexOf('admin') === -1) {
    throw new TlevorError('Admin role required', 403, 'FORBIDDEN');
  }
}

/**
 * When an admin changes totalQuantity we re-derive `available` so it never
 * drifts out of sync with already-booked tickets. Runs inside the caller's
 * transaction context where used.
 */
function computeAvailable(current: any, updates: any): number {
  if (updates.totalQuantity === undefined) return current.available;
  const booked = current.totalQuantity - current.available;
  const next = updates.totalQuantity - booked;
  if (next < 0) throw new TlevorError('totalQuantity below booked count', 409, 'INVALID_QUANTITY');
  return next;
}

// Allow running directly: `tsx src/server.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const db = await createDb({ file: process.env.DB_FILE });
    await seed(db);
    const { app } = await buildApp(db);
    const port = Number(process.env.PORT || 3000);
    await app.listen(port);
    console.log(`Ticketing server on http://localhost:${port}`);
  })();
}
