import type { DatabaseAdapter, FindOptions } from '../adapter';

export interface DrizzleAdapterOptions {
  db: any;
}

/**
 * Adapter for Drizzle ORM instances. Note: this adapter is not exercised by the
 * test suite (it requires a live Drizzle db) and is provided as a drop-in
 * implementation of the DatabaseAdapter contract.
 */
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
