import type { SqliteAdapter } from '@tlevor/orm';
import { Model } from '@tlevor/orm';
import { PasswordManager } from '@tlevor/auth';

export interface SeedResult {
  adminEmail: string;
  adminPassword: string;
  userCount: number;
  ticketTypeCount: number;
}

/**
 * Idempotent seed: creates 20 demo users (1 admin + 19 regular users) and a
 * few ticket types. Uses a transaction so a partial failure never leaves the
 * database half-seeded.
 */
export async function seed(db: SqliteAdapter): Promise<SeedResult> {
  const users = new Model(db, { tableName: 'users', timestamps: false });
  const types = new Model(db, { tableName: 'ticket_types', timestamps: false });

  const adminPassword = 'admin1234';
  const adminEmail = 'admin@tickets.test';

  await db.transaction(async (tx) => {
    const u = new Model(tx, { tableName: 'users', timestamps: false });
    const t = new Model(tx, { tableName: 'ticket_types', timestamps: false });
    const pm = new PasswordManager();

    if (!(await u.findOne({ where: { email: adminEmail } }))) {
      await u.create({
        email: adminEmail,
        password: await pm.hash(adminPassword),
        name: 'Site Admin',
        role: 'admin',
      });
    }

    for (let i = 1; i <= 19; i++) {
      const email = `user${i}@tickets.test`;
      if (!(await u.findOne({ where: { email } }))) {
        await u.create({
          email,
          password: await pm.hash(`pass${i}1234`),
          name: `Demo User ${i}`,
          role: 'user',
        });
      }
    }

    const starterTypes = [
      { name: 'Economy', price: 50, totalQuantity: 100, available: 100 },
      { name: 'Business', price: 150, totalQuantity: 30, available: 30 },
      { name: 'VIP', price: 400, totalQuantity: 10, available: 10 },
    ];
    for (const tt of starterTypes) {
      if (!(await t.findOne({ where: { name: tt.name } }))) {
        await t.create({ ...tt });
      }
    }
  });

  const userCount = await users.count();
  const ticketTypeCount = await types.count();

  return { adminEmail, adminPassword, userCount, ticketTypeCount };
}
