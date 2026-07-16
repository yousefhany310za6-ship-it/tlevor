import type { DatabaseAdapter, FindOptions } from '../adapter';

export interface PrismaAdapterOptions {
  client: any;
}

/**
 * Adapter for Prisma clients. Note: this adapter is not exercised by the test
 * suite (it requires a live Prisma client) and is provided as a drop-in
 * implementation of the DatabaseAdapter contract.
 */
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
