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
  private applied: Set<string> = new Set();

  constructor(options: MigrationOptions) {
    this.adapter = options.adapter;
  }

  addMigration(migration: Migration): void {
    this.migrations.push(migration);
    this.applied.delete(migration.name);
  }

  async up(): Promise<void> {
    for (const migration of this.migrations) {
      if (this.applied.has(migration.name)) continue;
      for (const sql of migration.up) await this.adapter.execute(sql);
      this.applied.add(migration.name);
    }
  }

  async down(): Promise<void> {
    for (const migration of [...this.migrations].reverse()) {
      if (!this.applied.has(migration.name)) continue;
      for (const sql of migration.down) await this.adapter.execute(sql);
      this.applied.delete(migration.name);
    }
  }

  getPendingMigrations(): Migration[] {
    return this.migrations.filter((m) => !this.applied.has(m.name));
  }
}
