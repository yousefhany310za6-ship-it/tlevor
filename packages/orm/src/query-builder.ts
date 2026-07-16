import type { DatabaseAdapter } from './adapter';

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
        sql = `INSERT INTO ${this.table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${keys.filter(k => k !== 'id').map(k => `${k} = VALUES(${k})`).join(', ')}`;
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

  /** Execute this query against a DatabaseAdapter. */
  async execute(adapter: DatabaseAdapter): Promise<any> {
    const { sql, params } = this.toSQL();
    switch (this.operation) {
      case 'select':
      case 'count':
        return adapter.raw(sql, params);
      default:
        return adapter.execute(sql, params);
    }
  }
}
