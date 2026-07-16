import type { DatabaseAdapter } from './adapter';
import { MemoryAdapter } from './adapters/memory';
import { SqliteAdapter, SqliteAdapterOptions } from './adapters/sqlite';
import { PrismaAdapter } from './adapters/prisma';
import { DrizzleAdapter } from './adapters/drizzle';

export interface CreateAdapterOptions {
  memory?: MemoryAdapter;
  sqlite?: SqliteAdapterOptions;
  prisma?: any;
  drizzle?: any;
}

export function createAdapter(
  type: 'memory' | 'sqlite' | 'prisma' | 'drizzle',
  options: CreateAdapterOptions = {},
): DatabaseAdapter {
  switch (type) {
    case 'memory': return new MemoryAdapter();
    case 'sqlite': return new SqliteAdapter(options.sqlite || { memory: true });
    case 'prisma': return new PrismaAdapter(options.prisma);
    case 'drizzle': return new DrizzleAdapter(options.drizzle);
    default: throw new Error(`Unknown adapter type: ${type}`);
  }
}
