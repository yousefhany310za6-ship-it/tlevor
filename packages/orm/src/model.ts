import type { DatabaseAdapter, FindOptions } from './adapter';
import { QueryBuilder } from './query-builder';

export interface ModelOptions {
  tableName: string;
  primaryKey?: string;
  timestamps?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export class Model {
  private options: Required<ModelOptions>;
  private adapter: DatabaseAdapter;

  constructor(adapter: DatabaseAdapter, options: ModelOptions) {
    this.adapter = adapter;
    this.options = {
      tableName: options.tableName,
      primaryKey: options.primaryKey || 'id',
      timestamps: options.timestamps !== false,
      createdAt: options.createdAt || 'createdAt',
      updatedAt: options.updatedAt || 'updatedAt',
    };
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
    if (this.options.timestamps) {
      const now = new Date().toISOString();
      data[this.options.createdAt] = now;
      data[this.options.updatedAt] = now;
    }
    return this.adapter.create(this.options.tableName, data);
  }

  async update(id: any, data: Record<string, any>): Promise<any> {
    if (this.options.timestamps) data[this.options.updatedAt] = new Date().toISOString();
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

  /** Create the underlying table (adapters that support DDL, e.g. SQLite). */
  async sync(columns?: Record<string, any>): Promise<void> {
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
