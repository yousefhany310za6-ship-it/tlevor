import type { TlevorContext } from '@tlevor/types';

// ==================== Query Builder ====================

export class QueryBuilder {
  private table: string;
  private operation: 'select' | 'insert' | 'update' | 'delete' | 'count' | 'upsert' = 'select';
  private columns: string[] = ['*'];
  private conditions: Array<{ field: string; op: string; value: any }> = [];
  private orderByClause: Array<{ field: string; direction: 'asc' | 'desc' }> = [];
  private limitValue?: number;
  private offsetValue?: number;
  private joins: Array<{ table: string; on: string; type: 'inner' | 'left' | 'right' }> = [];
  private data: Record<string, any> = {};
  private returningCols: string[] = [];

  constructor(table: string) { this.table = table; }

  select(...columns: string[]): this { this.operation = 'select'; if (columns.length) this.columns = columns; return this; }
  insert(data: Record<string, any>): this { this.operation = 'insert'; this.data = data; return this; }
  update(data: Record<string, any>): this { this.operation = 'update'; this.data = data; return this; }
  delete(): this { this.operation = 'delete'; return this; }
  count(): this { this.operation = 'count'; return this; }
  upsert(data: Record<string, any>): this { this.operation = 'upsert'; this.data = data; return this; }

  where(field: string, op: string, value: any): this { this.conditions.push({ field, op, value }); return this; }
  and(field: string, op: string, value: any): this { return this.where(field, op, value); }
  or(field: string, op: string, value: any): this { this.conditions.push({ field, op: '__or__', value }); return this; }
  in(field: string, values: any[]): this { this.conditions.push({ field, op: 'in', value: values }); return this; }
  notIn(field: string, values: any[]): this { this.conditions.push({ field, op: 'notIn', value: values }); return this; }
  like(field: string, pattern: string): this { this.conditions.push({ field, op: 'like', value: pattern }); return this; }
  between(field: string, min: any, max: any): this { this.conditions.push({ field, op: 'between', value: [min, max] }); return this; }
  isNull(field: string): this { this.conditions.push({ field, op: 'isNull', value: null }); return this; }
  isNotNull(field: string): this { this.conditions.push({ field, op: 'isNotNull', value: null }); return this; }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): this { this.orderByClause.push({ field, direction }); return this; }
  limit(n: number): this { this.limitValue = n; return this; }
  offset(n: number): this { this.offsetValue = n; return this; }

  join(table: string, on: string, type: 'inner' | 'left' | 'right' = 'inner'): this { this.joins.push({ table, on, type }); return this; }
  leftJoin(table: string, on: string): this { return this.join(table, on, 'left'); }
  rightJoin(table: string, on: string): this { return this.join(table, on, 'right'); }

  returning(...columns: string[]): this { this.returningCols = columns.length ? columns : ['*']; return this; }

  toSQL(): { sql: string; params: any[] } {
    const params: any[] = [];
    let sql = '';

    switch (this.operation) {
      case 'select': {
        sql = `SELECT ${this.columns.join(', ')} FROM ${this.table}`;
        break;
      }
      case 'insert': {
        const keys = Object.keys(this.data);
        sql = `INSERT INTO ${this.table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
        params.push(...Object.values(this.data));
        break;
      }
      case 'update': {
        const keys = Object.keys(this.data);
        sql = `UPDATE ${this.table} SET ${keys.map(k => `${k} = ?`).join(', ')}`;
        params.push(...Object.values(this.data));
        break;
      }
      case 'delete':
        sql = `DELETE FROM ${this.table}`;
        break;
      case 'count':
        sql = `SELECT COUNT(*) as count FROM ${this.table}`;
        break;
      case 'upsert': {
        const keys = Object.keys(this.data);
        sql = `INSERT INTO ${this.table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) ON DUPLICATE KEY UPDATE ${keys.map(k => `${k} = VALUES(${k})`).join(', ')}`;
        params.push(...Object.values(this.data));
        break;
      }
    }

    for (const join of this.joins) {
      const type = join.type.toUpperCase();
      sql += ` ${type} JOIN ${join.table} ON ${join.on}`;
    }

    if (this.conditions.length > 0) {
      const whereClauses: string[] = [];
      for (const cond of this.conditions) {
        switch (cond.op) {
          case '=': case '!=': case '<': case '>': case '<=': case '>=':
            whereClauses.push(`${cond.field} ${cond.op} ?`); params.push(cond.value); break;
          case 'in':
            whereClauses.push(`${cond.field} IN (${cond.value.map(() => '?').join(', ')})`); params.push(...cond.value); break;
          case 'notIn':
            whereClauses.push(`${cond.field} NOT IN (${cond.value.map(() => '?').join(', ')})`); params.push(...cond.value); break;
          case 'like':
            whereClauses.push(`${cond.field} LIKE ?`); params.push(cond.value); break;
          case 'between':
            whereClauses.push(`${cond.field} BETWEEN ? AND ?`); params.push(cond.value[0], cond.value[1]); break;
          case 'isNull':
            whereClauses.push(`${cond.field} IS NULL`); break;
          case 'isNotNull':
            whereClauses.push(`${cond.field} IS NOT NULL`); break;
          case '__or__':
            whereClauses.push(`${cond.field} = ?`); params.push(cond.value); break;
        }
      }
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    if (this.orderByClause.length > 0) {
      sql += ` ORDER BY ${this.orderByClause.map(o => `${o.field} ${o.direction}`).join(', ')}`;
    }
    if (this.limitValue !== undefined) { sql += ` LIMIT ?`; params.push(this.limitValue); }
    if (this.offsetValue !== undefined) { sql += ` OFFSET ?`; params.push(this.offsetValue); }

    if (this.returningCols.length > 0 && this.operation !== 'select') {
      sql += ` RETURNING ${this.returningCols.join(', ')}`;
    }

    return { sql, params };
  }
}

// ==================== Model ====================

export interface ModelOptions {
  tableName: string;
  primaryKey?: string;
  timestamps?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface FindOptions {
  where?: Record<string, any>;
  orderBy?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
  include?: Record<string, boolean>;
  select?: string[];
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
      data[this.options.createdAt] = new Date();
      data[this.options.updatedAt] = new Date();
    }
    return this.adapter.create(this.options.tableName, data);
  }

  async update(id: any, data: Record<string, any>): Promise<any> {
    if (this.options.timestamps) data[this.options.updatedAt] = new Date();
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
}

// ==================== Database Adapter ====================

export interface DatabaseAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  findOne(table: string, where: Record<string, any>): Promise<any | null>;
  findMany(table: string, options: FindOptions): Promise<any[]>;
  create(table: string, data: Record<string, any>): Promise<any>;
  update(table: string, id: any, data: Record<string, any>): Promise<any>;
  delete(table: string, id: any): Promise<boolean>;
  count(table: string, where?: Record<string, any>): Promise<number>;
  upsert(table: string, data: Record<string, any>): Promise<any>;
  transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T>;
  execute(sql: string, params?: any[]): Promise<any>;
  raw(query: string, params?: any[]): Promise<any>;
}

// ==================== Prisma Adapter ====================

export interface PrismaAdapterOptions {
  client: any;
}

export class PrismaAdapter implements DatabaseAdapter {
  private client: any;
  private connected: boolean = false;

  constructor(options: PrismaAdapterOptions) { this.client = options.client; }

  async connect(): Promise<void> { await this.client.$connect(); this.connected = true; }
  async disconnect(): Promise<void> { await this.client.$disconnect(); this.connected = false; }
  isConnected(): boolean { return this.connected; }

  async findOne(table: string, where: Record<string, any>): Promise<any | null> {
    return this.client[table].findUnique({ where });
  }

  async findMany(table: string, options: FindOptions): Promise<any[]> {
    const prismaOptions: any = {};
    if (options.where) prismaOptions.where = options.where;
    if (options.orderBy) prismaOptions.orderBy = options.orderBy;
    if (options.limit) prismaOptions.take = options.limit;
    if (options.offset) prismaOptions.skip = options.offset;
    if (options.select) prismaOptions.select = options.select.reduce((a, c) => ({ ...a, [c]: true }), {});
    if (options.include) prismaOptions.include = options.include;
    return this.client[table].findMany(prismaOptions);
  }

  async create(table: string, data: Record<string, any>): Promise<any> {
    return this.client[table].create({ data });
  }

  async update(table: string, id: any, data: Record<string, any>): Promise<any> {
    return this.client[table].update({ where: { id }, data });
  }

  async delete(table: string, id: any): Promise<boolean> {
    await this.client[table].delete({ where: { id } });
    return true;
  }

  async count(table: string, where?: Record<string, any>): Promise<number> {
    return this.client[table].count({ where });
  }

  async upsert(table: string, data: Record<string, any>): Promise<any> {
    return this.client[table].upsert({ where: { id: data.id }, create: data, update: data });
  }

  async transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    return this.client.$transaction((tx: any) => fn(new PrismaAdapter({ client: tx })));
  }

  async execute(sql: string, params?: any[]): Promise<any> {
    return this.client.$queryRawUnsafe(sql, ...(params || []));
  }

  async raw(query: string, params?: any[]): Promise<any> {
    return this.client.$queryRawUnsafe(query, ...(params || []));
  }
}

// ==================== Drizzle Adapter ====================

export interface DrizzleAdapterOptions {
  db: any;
}

export class DrizzleAdapter implements DatabaseAdapter {
  private db: any;
  private connected: boolean = false;

  constructor(options: DrizzleAdapterOptions) { this.db = options.db; }

  async connect(): Promise<void> { this.connected = true; }
  async disconnect(): Promise<void> { this.connected = false; }
  isConnected(): boolean { return this.connected; }

  async findOne(table: string, where: Record<string, any>): Promise<any | null> {
    const result = await this.db.select().from(table).where(where).limit(1);
    return result[0] || null;
  }

  async findMany(table: string, options: FindOptions): Promise<any[]> {
    let query = this.db.select().from(table);
    if (options.where) query = query.where(options.where);
    if (options.limit) query = query.limit(options.limit);
    if (options.offset) query = query.offset(options.offset);
    return query;
  }

  async create(table: string, data: Record<string, any>): Promise<any> {
    const result = await this.db.insert(table).values(data).returning();
    return result[0];
  }

  async update(table: string, id: any, data: Record<string, any>): Promise<any> {
    const result = await this.db.update(table).set(data).where({ id }).returning();
    return result[0];
  }

  async delete(table: string, id: any): Promise<boolean> {
    await this.db.delete(table).where({ id });
    return true;
  }

  async count(table: string, where?: Record<string, any>): Promise<number> {
    const result = await this.db.select({ count: sql`count(*)` }).from(table).where(where);
    return Number(result[0]?.count || 0);
  }

  async upsert(table: string, data: Record<string, any>): Promise<any> {
    const result = await this.db.insert(table).values(data).onConflictDoUpdate({ target: 'id', set: data }).returning();
    return result[0];
  }

  async transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx: any) => fn(new DrizzleAdapter({ db: tx })));
  }

  async execute(sql: string, params?: any[]): Promise<any> {
    return this.db.execute(sql, params || []);
  }

  async raw(query: string, params?: any[]): Promise<any> {
    return this.db.execute(query, params || []);
  }
}

function sql(strings: TemplateStringsArray, ...values: any[]): any {
  return { sql: strings.join('?'), values };
}

// ==================== Migration ====================

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

// ==================== Decorators ====================

export function Table(options: ModelOptions): ClassDecorator {
  return (target: any) => { target.__modelOptions = options; };
}

export function Column(options?: { type?: string; nullable?: boolean; default?: any }): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    if (!target.__columns) target.__columns = {};
    target.__columns[propertyKey] = options || {};
  };
}

export function PrimaryKey(): PropertyDecorator { return Column({ type: 'id' }); }
export function AutoIncrement(): PropertyDecorator { return Column({ type: 'auto' }); }

// ==================== Factory ====================

export function createModel(adapter: DatabaseAdapter, options: ModelOptions): Model {
  return new Model(adapter, options);
}

export { QueryBuilder as Query };