import type { DatabaseAdapter, FindOptions } from '../adapter';

/**
 * Zero-dependency in-memory adapter. Great for tests, prototyping, and small
 * apps. Tables are created lazily on first write.
 */
export class MemoryAdapter implements DatabaseAdapter {
  private tables: Map<string, Map<any, any>> = new Map();
  private counters: Map<string, number> = new Map();
  private connected = false;

  async connect(): Promise<void> { this.connected = true; }
  async disconnect(): Promise<void> { this.connected = false; }
  isConnected(): boolean { return this.connected; }

  private table(name: string): Map<any, any> {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }

  private nextId(name: string): any {
    const n = (this.counters.get(name) || 0) + 1;
    this.counters.set(name, n);
    return `rec_${n}`;
  }

  private static compareValues(a: any, b: any): number {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b));
  }

  async findOne(table: string, where: Record<string, any>): Promise<any | null> {
    for (const row of this.table(table).values()) {
      if (Object.entries(where).every(([k, v]) => row[k] == v)) return row;
    }
    return null;
  }

  async findMany(table: string, options: FindOptions = {}): Promise<any[]> {
    let rows = Array.from(this.table(table).values());
    if (options.where) rows = rows.filter((r) => Object.entries(options.where!).every(([k, v]) => r[k] == v));
    if (options.orderBy) {
      for (const [k, dir] of Object.entries(options.orderBy)) {
        rows = rows.slice().sort((a: any, b: any) => {
          const cmp = MemoryAdapter.compareValues(a[k], b[k]);
          return dir === 'desc' ? -cmp : cmp;
        });
      }
    }
    if (options.offset) rows = rows.slice(options.offset);
    if (options.limit) rows = rows.slice(0, options.limit);
    return rows;
  }

  async create(table: string, data: Record<string, any>, primaryKey: string = 'id'): Promise<any> {
    const row = { ...data };
    if (row[primaryKey] === undefined) row[primaryKey] = this.nextId(table);
    this.table(table).set(row[primaryKey], row);
    return row;
  }

  async update(table: string, id: any, data: Record<string, any>, primaryKey: string = 'id'): Promise<any> {
    const row = this.table(table).get(id);
    if (!row) return null;
    const merged = { ...row, ...data };
    this.table(table).set(merged[primaryKey], merged);
    return merged;
  }

  async delete(table: string, id: any, _primaryKey: string = 'id'): Promise<boolean> {
    return this.table(table).delete(id);
  }

  async count(table: string, where?: Record<string, any>): Promise<number> {
    return (await this.findMany(table, { where })).length;
  }

  async upsert(table: string, data: Record<string, any>, primaryKey: string = 'id'): Promise<any> {
    if (data[primaryKey] !== undefined && this.table(table).has(data[primaryKey])) return this.update(table, data[primaryKey], data, primaryKey);
    return this.create(table, data, primaryKey);
  }

  async transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async execute(sql: string, params: any[] = []): Promise<any> {
    const result = this.execSQL(sql, params);
    return result ?? null;
  }

  async raw(sql: string, params: any[] = []): Promise<any> {
    return (await this.execSQL(sql, params)) ?? [];
  }

  /**
   * Minimal SQL interpreter so the QueryBuilder can target the in-memory store
   * the same way it targets SQLite. Supports the statements the QueryBuilder
   * emits: SELECT / INSERT / UPDATE / DELETE / COUNT.
   */
  private async execSQL(sql: string, params: any[]): Promise<any> {
    const stmt = sql.trim().replace(/\s+/g, ' ');

    if (/^SELECT COUNT\(\*\)/i.test(stmt)) {
      const where = this.parseWhere(stmt, params);
      const table = this.tableNameFrom(stmt);
      const rows = this.matchWhere(table, where);
      return [{ count: rows.length, c: rows.length }];
    }

    if (/^SELECT/i.test(stmt)) {
      const table = this.tableNameFrom(stmt);
      const where = this.parseWhere(stmt, params);
      let rows = this.matchWhere(table, where);
      const orderMatch = stmt.match(/ORDER BY (\w+) (asc|desc)/i);
      if (orderMatch) {
        const k = orderMatch[1];
        const desc = orderMatch[2].toLowerCase() === 'desc';
        rows = rows.slice().sort((a: any, b: any) => {
          const cmp = MemoryAdapter.compareValues(a[k], b[k]);
          return desc ? -cmp : cmp;
        });
      }
      const limitIdx = stmt.indexOf('LIMIT ?');
      if (limitIdx >= 0) {
        const limit = params[this.countPlaceholdersBefore(stmt, limitIdx)];
        const offsetIdx = stmt.indexOf('OFFSET ?');
        if (offsetIdx >= 0) {
          const offset = params[this.countPlaceholdersBefore(stmt, offsetIdx)];
          rows = rows.slice(Number(offset) || 0);
        }
        rows = rows.slice(0, Number(limit) || 0);
      }
      return rows;
    }

    if (/^INSERT INTO/i.test(stmt)) {
      const m = stmt.match(/^INSERT INTO (\w+) \((.+?)\) VALUES \((.+?)\)$/i);
      if (!m) return null;
      const table = m[1];
      const cols = m[2].split(',').map((c) => c.trim());
      const data: Record<string, any> = {};
      cols.forEach((c, i) => { data[c] = params[i]; });
      const created = await this.create(table, data);
      return { insertId: created.id, rowid: created.id, lastID: created.id, changes: 1 };
    }

    if (/^UPDATE/i.test(stmt)) {
      const m = stmt.match(/^UPDATE (\w+) SET (.+?) WHERE (.+)$/i);
      if (!m) return { changes: 0 };
      const table = m[1];
      const setPairs = m[2].split(',').map((p) => p.trim());
      const whereSql = m[3];
      const data: Record<string, any> = {};
      setPairs.forEach((p, i) => {
        const [k] = p.split(' = ');
        data[k.trim()] = params[i];
      });
      // Conditions come after the SET placeholders in the params array.
      const { conditions } = this.parseConditions(whereSql, params, setPairs.length);
      const matched = this.matchWhere(table, conditions);
      let changes = 0;
      for (const row of matched) {
        this.update(table, row.id, data);
        changes++;
      }
      return { changes };
    }

    if (/^DELETE FROM/i.test(stmt)) {
      const table = this.tableNameFrom(stmt);
      const where = this.parseWhere(stmt, params);
      const matched = this.matchWhere(table, where);
      for (const row of matched) this.delete(table, row.id);
      return { changes: matched.length };
    }

    return null;
  }

  private countPlaceholdersBefore(stmt: string, index: number): number {
    let count = 0;
    for (let i = 0; i < index; i++) {
      if (stmt[i] === '?') count++;
    }
    return count;
  }

  private tableNameFrom(stmt: string): string {
    const m = stmt.match(/FROM (\w+)/i) || stmt.match(/INTO (\w+)/i) || stmt.match(/UPDATE (\w+)/i) || stmt.match(/DELETE FROM (\w+)/i);
    return m ? m[1] : '';
  }

  private parseWhere(stmt: string, params: any[]): Array<{ field: string; op: string; value: any }> {
    const idx = stmt.indexOf(' WHERE ');
    if (idx === -1) return [];
    const { conditions } = this.parseConditions(stmt.slice(idx + 7), params, 0);
    return conditions;
  }

  private parseConditions(sql: string, params: any[], offset: number): { conditions: Array<{ field: string; op: string; value: any }>; consumed: number } {
    const conditions: Array<{ field: string; op: string; value: any }> = [];
    let consumed = offset;
    for (const part of sql.split(' AND ')) {
      const m = part.trim().match(/(\w+) (=|!=|<|>|<=|>=) \?/);
      if (m) { conditions.push({ field: m[1], op: m[2], value: params[consumed++] }); }
    }
    return { conditions, consumed };
  }

  private matchWhere(table: string, conditions: Array<{ field: string; op: string; value: any }>): any[] {
    let rows = Array.from(this.table(table).values());
    for (const cond of conditions) {
      rows = rows.filter((r: any) => {
        switch (cond.op) {
          case '=': return r[cond.field] == cond.value;
          case '!=': return r[cond.field] != cond.value;
          case '<': return r[cond.field] < cond.value;
          case '>': return r[cond.field] > cond.value;
          case '<=': return r[cond.field] <= cond.value;
          case '>=': return r[cond.field] >= cond.value;
          default: return true;
        }
      });
    }
    return rows;
  }
}
