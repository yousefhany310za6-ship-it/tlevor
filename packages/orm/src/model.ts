import type { DatabaseAdapter, FindOptions } from './adapter';
import { QueryBuilder } from './query-builder';

export interface ModelOptions {
  tableName: string;
  primaryKey?: string;
  timestamps?: boolean;
  createdAt?: string;
  updatedAt?: string;
  /**
   * Explicitly declare which timestamp columns exist on the table. When
   * provided, the Model only writes timestamps to these columns. When omitted,
   * the Model infers available columns from `sync()`; if neither is available
   * it skips timestamp injection entirely (instead of failing on a missing
   * column).
   */
  timestampColumns?: string[];
}

export class Model {
  private options: Required<ModelOptions>;
  private adapter: DatabaseAdapter;
  /**
   * Tracks the columns known to exist on the table. Populated by `sync()` or
   * by the explicit `timestampColumns` option. Used to inject timestamps only
   * where the column actually exists.
   */
  private knownColumns: Set<string> | null = null;

  constructor(adapter: DatabaseAdapter, options: ModelOptions) {
    this.adapter = adapter;
    this.options = {
      tableName: options.tableName,
      primaryKey: options.primaryKey || 'id',
      timestamps: options.timestamps !== false,
      createdAt: options.createdAt || 'createdAt',
      updatedAt: options.updatedAt || 'updatedAt',
      timestampColumns: options.timestampColumns,
    };
    if (options.timestampColumns) {
      this.knownColumns = new Set(options.timestampColumns);
    }
  }

  get tableName(): string { return this.options.tableName; }
  get primaryKey(): string { return this.options.primaryKey; }

  query(): QueryBuilder { return new QueryBuilder(this.options.tableName); }

  async findById(id: any): Promise<any | null> {
    return this.adapter.findOne(this.options.tableName, { [this.options.primaryKey]: id });
  }

  async findMany(options: FindOptions = {}): Promise<any[]> {
    return this.adapter.findMany(this.options.tableName, options);
  }

  async findOne(options: FindOptions = {}): Promise<any | null> {
    return this.adapter.findOne(this.options.tableName, options.where || {});
  }

  async create(data: Record<string, any>): Promise<any> {
    if (this.shouldStamp(this.options.createdAt)) data[this.options.createdAt] = new Date().toISOString();
    if (this.shouldStamp(this.options.updatedAt)) data[this.options.updatedAt] = new Date().toISOString();
    return this.adapter.create(this.options.tableName, data);
  }

  async update(id: any, data: Record<string, any>): Promise<any> {
    if (this.shouldStamp(this.options.updatedAt)) data[this.options.updatedAt] = new Date().toISOString();
    return this.adapter.update(this.options.tableName, id, data);
  }

  async delete(id: any): Promise<boolean> {
    return this.adapter.delete(this.options.tableName, id);
  }

  async count(where?: Record<string, any>): Promise<number> {
    return this.adapter.count(this.options.tableName, where);
  }

  async upsert(data: Record<string, any>): Promise<any> {
    return this.adapter.upsert(this.options.tableName, data);
  }

  async transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    return this.adapter.transaction(fn);
  }

  /**
   * Decide whether a timestamp column should be written.
   * Returns false (skip safely) unless timestamps are enabled AND the column
   * is known to exist on the table.
   */
  private shouldStamp(column: string): boolean {
    if (!this.options.timestamps) return false;
    if (!this.knownColumns) return false; // unknown schema → don't guess
    return this.knownColumns.has(column);
  }

  /** Create the underlying table (adapters that support DDL, e.g. SQLite). */
  async sync(columns?: Record<string, any>): Promise<void> {
    const cols = new Set<string>(Object.keys(columns || {}));
    if (this.options.timestamps) {
      cols.add(this.options.createdAt);
      cols.add(this.options.updatedAt);
    }
    this.knownColumns = cols;
    if (typeof (this.adapter as any).sync === 'function') {
      return (this.adapter as any).sync({
        tableName: this.options.tableName,
        primaryKey: this.options.primaryKey,
        columns: columns || {},
        timestamps: this.options.timestamps,
      });
    }
  }
}

export function createModel(adapter: DatabaseAdapter, options: ModelOptions): Model {
  return new Model(adapter, options);
}
