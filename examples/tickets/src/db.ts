import { SqliteAdapter } from '@tlevor/orm';
import { PasswordManager } from '@tlevor/auth';

export interface DbConfig {
  file?: string;
  memory?: boolean;
}

/**
 * Opens a SQLite connection and ensures the ticketing schema exists.
 *
 * The schema is intentionally created with explicit UNIQUE constraints and
 * transactions so that concurrent writes (e.g. two users booking the same
 * last seat) are resolved atomically by SQLite rather than by application
 * logic that can race.
 */
export async function createDb(config: DbConfig = { memory: true }): Promise<SqliteAdapter> {
  const adapter = new SqliteAdapter(config);
  await adapter.connect();
  await migrate(adapter);
  return adapter;
}

async function migrate(adapter: SqliteAdapter): Promise<void> {
  await adapter.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      createdAt TEXT
    )
  `);

  await adapter.execute(`
    CREATE TABLE IF NOT EXISTS ticket_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      price REAL NOT NULL,
      totalQuantity INTEGER NOT NULL,
      available INTEGER NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);

  await adapter.execute(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      typeId INTEGER NOT NULL,
      userId INTEGER NOT NULL,
      seat TEXT,
      status TEXT NOT NULL DEFAULT 'booked',
      createdAt TEXT,
      FOREIGN KEY (typeId) REFERENCES ticket_types(id),
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `);

  await adapter.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_type ON tickets(typeId)`);
  await adapter.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(userId)`);
}

export const passwordManager = new PasswordManager();
