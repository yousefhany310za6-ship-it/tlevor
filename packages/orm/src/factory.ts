import type { DatabaseAdapter } from './adapter';
import { MemoryAdapter } from './adapters/memory';
import { SqliteAdapter, SqliteAdapterOptions } from './adapters/sqlite';

export interface CreateAdapterOptions {
  memory?: MemoryAdapter;
  sqlite?: SqliteAdapterOptions;
}

export function createAdapter(
  type: 'memory' | 'sqlite',
  options: CreateAdapterOptions = {},
): DatabaseAdapter {
  switch (type) {
    case 'memory': return new MemoryAdapter();
    case 'sqlite': return new SqliteAdapter(options.sqlite || { memory: true });
    default: throw new Error(`Unknown adapter type: ${type}`);
  }
}
