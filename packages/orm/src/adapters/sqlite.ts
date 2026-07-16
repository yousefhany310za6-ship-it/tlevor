import type { DatabaseAdapter, FindOptions } from '../adapter';
import Database from 'better-sqlite3';

export interface SqliteAdapterOptions {
  file?: string;
  memory?: boolean;
  verbose?: boolean;
}

/**
 * SQLite adapter backed by better-sqlite3 (synchronous, wrapped in promises).
 * Call `adapter.sync(model)` (or the `syncModel` helper) to create tables from
 * decorator metadata before using a Model.
 */
function toSqlValue(v: any): any {
  return v instanceof Date ? v.toISOString() : v;
}

export class SqliteAdapter implements DatabaseAdapter {
  private db: any;
  private connected = false;

  constructor(options: SqliteAdapterOptions) {
    this.db = new Database(options.memory ? ':memory:' : options.file);
    this.db.pragma('journal_mode = WAL');
  }

  async connect(): Promise<void> { this.connected = true; }
  async disconnect(): Promise<void> { this.db.close(); this.connected = false; }
  isConnected(): boolean { return this.connected; }

  private whereClause(where?: Record<string, any>): { sql: string; params: any[] } {
    if (!where || Object.keys(where).length === 0) return { sql: '', params: [] };
    const params: any[] = [];
    const sql = ' WHERE ' + Object.keys(where).map((k) => {
      params.push(toSqlValue(where[k]));
      return `${k} = ?`;
    }).join(' AND ');
    return { sql, params };
  }

  async findOne(table: string, where: Record<string, any>): Promise<any | null> {
    const { sql, params } = this.whereClause(where);
    const row = this.db.prepare(`SELECT * FROM ${table}${sql} LIMIT 1`).get(...params);
    return row || null;
  }

  async findMany(table: string, options: FindOptions = {}): Promise<any[]> {
    const { sql: whereSql, params } = this.whereClause(options.where);
    let sql = `SELECT * FROM ${table}${whereSql}`;
    if (options.orderBy) {
      const [k, dir] = Object.entries(options.orderBy)[0];
      sql += ` ORDER BY ${k} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
    }
    if (options.limit) sql += ` LIMIT ${options.limit}`;
    if (options.offset) sql += ` OFFSET ${options.offset}`;
    return this.db.prepare(sql).all(...params);
  }

  async create(table: string, data: Record<string, any>): Promise<any> {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
    const info = this.db.prepare(sql).run(...keys.map((k) => toSqlValue(data[k])));
    const inserted = this.db.prepare(`SELECT * FROM ${table} WHERE rowid = ?`).get(info.lastInsertRowid);
    return inserted || { ...data, id: info.lastInsertRowid };
  }

  async update(table: string, id: any, data: Record<string, any>): Promise<any> {
    const keys = Object.keys(data);
    if (keys.length === 0) return this.findOne(table, { id });
    const assignments = keys.map((k) => `${k} = ?`).join(', ');
    this.db.prepare(`UPDATE ${table} SET ${assignments} WHERE id = ?`).run(...keys.map((k) => toSqlValue(data[k])), toSqlValue(id));
    return this.findOne(table, { id });
  }

  async delete(table: string, id: any): Promise<boolean> {
    const info = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    return info.changes > 0;
  }

  async count(table: string, where?: Record<string, any>): Promise<number> {
    const { sql, params } = this.whereClause(where);
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM ${table}${sql}`).get(...params);
    return Number(row?.c || 0);
  }

  async upsert(table: string, data: Record<string, any>): Promise<any> {
    if (data.id !== undefined) {
      const existing = await this.findOne(table, { id: data.id });
      if (existing) return this.update(table, data.id, data);
    }
    return this.create(table, data);
  }

  async transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    // better-sqlite3 transactions are synchronous; implement manually so we can
    // honour the async DatabaseAdapter contract.
    this.db.exec('BEGIN');
    try {
      const result = await fn(this);
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  async execute(sql: string, params: any[] = []): Promise<any> {
    const info = this.db.prepare(sql).run(...params);
    return { insertId: info.lastInsertRowid, lastID: info.lastInsertRowid, rowid: info.lastInsertRowid, changes: info.changes };
  }

  async raw(query: string, params: any[] = []): Promise<any> {
    return this.db.prepare(query).all(...params);
  }

  /** Create the table for a model from its column metadata (decorators). */
  async sync(spec: { tableName: string; primaryKey?: string; columns?: Record<string, any>; timestamps?: boolean }): Promise<void> {
    const pk = spec.primaryKey || 'id';
    const cols = spec.columns || {};
    const colDefs: string[] = [`${pk} INTEGER PRIMARY KEY AUTOINCREMENT`];
    for (const [name, opts] of Object.entries(cols)) {
      if (name === pk) continue;
      const type = (opts && (opts as any).type) || 'string';
      const sqlType = type === 'number' || type === 'auto' ? 'REAL' : type === 'boolean' ? 'INTEGER' : 'TEXT';
      colDefs.push(`${name} ${sqlType}`);
    }
    // Model always maintains createdAt/updatedAt when timestamps are enabled (the default)
    if (spec.timestamps !== false) {
      colDefs.push('createdAt TEXT');
      colDefs.push('updatedAt TEXT');
    }
    this.db.prepare(`CREATE TABLE IF NOT EXISTS ${spec.tableName} (${colDefs.join(', ')})`).run();
  }
}
