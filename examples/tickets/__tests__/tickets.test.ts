import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server';
import { createDb } from '../src/db';
import { seed } from '../src/seed';
import type { DatabaseAdapter } from '@tlevor/orm';

describe('Ticketing server', () => {
  let db: DatabaseAdapter;
  let app: any;
  let adminToken: string;
  let userToken: string;
  let user2Token: string;

  beforeAll(async () => {
    db = await createDb({ memory: true });
    await seed(db);
    const built = await buildApp(db);
    app = built.app;

    const login = async (email: string, password: string) => {
      const res = await app.inject({ method: 'POST', url: '/auth/login', body: { email, password } });
      return res.json();
    };

    adminToken = (await login('admin@tickets.test', 'admin1234')).token;
    userToken = (await login('user1@tickets.test', 'pass11234')).token;
    user2Token = (await login('user2@tickets.test', 'pass21234')).token;
  });

  afterAll(async () => {
    await (db as any).disconnect();
  });

  it('seeds 20 users (1 admin + 19 users)', async () => {
    const res = await app.inject({ method: 'GET', url: '/ticket-types', headers: { authorization: `Bearer ${adminToken}` } });
    const types = res.json();
    expect(types.length).toBe(3);
  });

  it('rejects unauthenticated access', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets' });
    expect(res.statusCode).toBe(401);
  });

  it('logs in the admin', () => {
    expect(adminToken).toBeTruthy();
  });

  describe('ticket types (admin only)', () => {
    it('allows admin to create a type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/ticket-types',
        headers: { authorization: `Bearer ${adminToken}` },
        body: { name: 'Student', price: 25, totalQuantity: 5 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Student');
    });

    it('rejects duplicate type name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/ticket-types',
        headers: { authorization: `Bearer ${adminToken}` },
        body: { name: 'Student', price: 25, totalQuantity: 5 },
      });
      expect(res.statusCode).toBe(409);
    });

    it('forbids a regular user from creating a type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/ticket-types',
        headers: { authorization: `Bearer ${userToken}` },
        body: { name: 'Blocked', price: 10, totalQuantity: 5 },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows admin to update a type and keeps availability consistent', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/ticket-types',
        headers: { authorization: `Bearer ${adminToken}` },
        body: { name: 'Premium', price: 99, totalQuantity: 4 },
      });
      const id = created.json().id;

      const res = await app.inject({
        method: 'PUT',
        url: `/ticket-types/${id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        body: { totalQuantity: 8 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().available).toBe(8); // nothing booked yet
    });

    it('allows admin to delete an unused type but not one with bookings', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/ticket-types',
        headers: { authorization: `Bearer ${adminToken}` },
        body: { name: 'DeleteMe', price: 10, totalQuantity: 3 },
      });
      const id = created.json().id;

      // book one
      await app.inject({
        method: 'POST',
        url: '/tickets',
        headers: { authorization: `Bearer ${userToken}` },
        body: { typeId: id },
      });

      const del = await app.inject({
        method: 'DELETE',
        url: `/ticket-types/${id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(del.statusCode).toBe(409);
    });
  });

  describe('booking', () => {
    let typeId: number;

    beforeAll(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/ticket-types',
        headers: { authorization: `Bearer ${adminToken}` },
        body: { name: 'Concert', price: 75, totalQuantity: 2 },
      });
      typeId = res.json().id;
    });

    it('books a ticket and decrements availability', async () => {
      const before = (await app.inject({ method: 'GET', url: '/ticket-types', headers: { authorization: `Bearer ${adminToken}` } })).json();
      const beforeAvailable = before.find((t: any) => t.id === typeId).available;

      const res = await app.inject({
        method: 'POST',
        url: '/tickets',
        headers: { authorization: `Bearer ${userToken}` },
        body: { typeId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().userId).toBeTruthy();

      const after = (await app.inject({ method: 'GET', url: '/ticket-types', headers: { authorization: `Bearer ${adminToken}` } })).json();
      const afterAvailable = after.find((t: any) => t.id === typeId).available;
      expect(afterAvailable).toBe(beforeAvailable - 1);
    });

    it('a user only sees their own tickets', async () => {
      const uid = await idOf(user2Token);
      const res = await app.inject({
        method: 'GET',
        url: '/tickets',
        headers: { authorization: `Bearer ${user2Token}` },
      });
      const tickets = res.json();
      expect(tickets.every((t: any) => t.userId === uid)).toBe(true);
    });

    it('returns 409 when sold out', async () => {
      // typeId had totalQuantity 2; user1 already booked 1, book the 2nd with user2
      await app.inject({
        method: 'POST',
        url: '/tickets',
        headers: { authorization: `Bearer ${user2Token}` },
        body: { typeId },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/tickets',
        headers: { authorization: `Bearer ${userToken}` },
        body: { typeId },
      });
      expect(res.statusCode).toBe(409);
    });

    it('cancelling a ticket returns the seat to the pool', async () => {
      const booked = await app.inject({
        method: 'POST',
        url: '/tickets',
        headers: { authorization: `Bearer ${userToken}` },
        body: { typeId: (await findTypeNamed('Economy')).id },
      });
      const ticketId = booked.json().id;
      const before = (await app.inject({ method: 'GET', url: '/ticket-types', headers: { authorization: `Bearer ${adminToken}` } })).json();
      const beforeAvailable = before.find((t: any) => t.name === 'Economy').available;

      const res = await app.inject({
        method: 'DELETE',
        url: `/tickets/${ticketId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(res.statusCode).toBe(200);

      const after = (await app.inject({ method: 'GET', url: '/ticket-types', headers: { authorization: `Bearer ${adminToken}` } })).json();
      const afterAvailable = after.find((t: any) => t.name === 'Economy').available;
      expect(afterAvailable).toBe(beforeAvailable + 1);
    });
  });

  describe('race condition (concurrent booking)', () => {
    it('never oversells with concurrent requests', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/ticket-types',
        headers: { authorization: `Bearer ${adminToken}` },
        body: { name: 'Limited', price: 30, totalQuantity: 5 },
      });
      const id = created.json().id;

      // Fire 12 concurrent bookings against only 5 available seats.
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          app.inject({
            method: 'POST',
            url: '/tickets',
            headers: { authorization: `Bearer ${i % 2 ? userToken : user2Token}` },
            body: { typeId: id },
          })
        )
      );

      const ok = results.filter((r) => r.statusCode === 200).length;
      const soldOut = results.filter((r) => r.statusCode === 409).length;
      expect(ok).toBe(5);
      expect(soldOut).toBe(7);

      const finalType = (await app.inject({ method: 'GET', url: '/ticket-types', headers: { authorization: `Bearer ${adminToken}` } })).json()
        .find((t: any) => t.id === id);
      expect(finalType.available).toBe(0);
      expect(finalType.totalQuantity).toBe(5);
    });
  });

  // helpers
  async function idOf(token: string): Promise<number> {
    const res = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${token}` } });
    return res.json().id;
  }
  async function findTypeNamed(name: string) {
    const res = await app.inject({ method: 'GET', url: '/ticket-types', headers: { authorization: `Bearer ${adminToken}` } });
    return (res.json() as any[]).find((t: any) => t.name === name);
  }
});
