export interface FindOptions {
  where?: Record<string, any>;
  orderBy?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
  include?: Record<string, boolean>;
  select?: string[];
}

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
