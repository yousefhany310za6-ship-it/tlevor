import type { DatabaseAdapter } from './adapter';

export interface MigrationOptions {
  adapter: DatabaseAdapter;
  directory?: string;
}

export interface Migration {
  name: string;
  up: string[];
  down: string[];
}

export class MigrationManager {
  private adapter: DatabaseAdapter;
  private migrations: Migration[] = [];

  constructor(options: MigrationOptions) {
    this.adapter = options.adapter;
  }

  addMigration(migration: Migration): void { this.migrations.push(migration); }

  async up(): Promise<void> {
    for (const migration of this.migrations) {
      for (const sql of migration.up) await this.adapter.execute(sql);
    }
  }

  async down(): Promise<void> {
    for (const migration of this.migrations.reverse()) {
      for (const sql of migration.down) await this.adapter.execute(sql);
    }
  }

  getPendingMigrations(): Migration[] { return this.migrations; }
}
