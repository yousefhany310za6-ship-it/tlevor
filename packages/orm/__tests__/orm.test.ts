import { describe, it, expect } from 'vitest';
import { QueryBuilder, Model, MemorySessionStore } from '../src/index';

describe('QueryBuilder', () => {
  it('should build SELECT query', () => {
    const q = new QueryBuilder('users').select('id', 'name', 'email');
    const { sql, params } = q.toSQL();
    expect(sql).toBe('SELECT id, name, email FROM users');
    expect(params).toEqual([]);
  });

  it('should build SELECT with WHERE', () => {
    const { sql, params } = new QueryBuilder('users')
      .select()
      .where('age', '>', 18)
      .where('active', '=', true)
      .toSQL();
    expect(sql).toBe('SELECT * FROM users WHERE age > ? AND active = ?');
    expect(params).toEqual([18, true]);
  });

  it('should build INSERT query', () => {
    const { sql, params } = new QueryBuilder('users')
      .insert({ name: 'John', email: 'john@test.com' })
      .toSQL();
    expect(sql).toContain('INSERT INTO users');
    expect(sql).toContain('VALUES (?, ?)');
    expect(params).toEqual(['John', 'john@test.com']);
  });

  it('should build UPDATE query', () => {
    const { sql, params } = new QueryBuilder('users')
      .update({ name: 'Jane' })
      .where('id', '=', 1)
      .toSQL();
    expect(sql).toContain('UPDATE users SET name = ?');
    expect(sql).toContain('WHERE id = ?');
    expect(params).toEqual(['Jane', 1]);
  });

  it('should build DELETE query', () => {
    const { sql, params } = new QueryBuilder('users')
      .delete()
      .where('id', '=', 1)
      .toSQL();
    expect(sql).toBe('DELETE FROM users WHERE id = ?');
    expect(params).toEqual([1]);
  });

  it('should build COUNT query', () => {
    const { sql } = new QueryBuilder('users').count().toSQL();
    expect(sql).toBe('SELECT COUNT(*) as count FROM users');
  });

  it('should build query with ORDER BY and LIMIT', () => {
    const { sql, params } = new QueryBuilder('users')
      .select()
      .orderBy('name', 'desc')
      .limit(10)
      .offset(20)
      .toSQL();
    expect(sql).toContain('ORDER BY name desc');
    expect(sql).toContain('LIMIT ?');
    expect(sql).toContain('OFFSET ?');
    expect(params).toEqual([10, 20]);
  });

  it('should build query with IN clause', () => {
    const { sql, params } = new QueryBuilder('users')
      .select()
      .in('id', [1, 2, 3])
      .toSQL();
    expect(sql).toContain('id IN (?, ?, ?)');
    expect(params).toEqual([1, 2, 3]);
  });

  it('should build query with LIKE', () => {
    const { sql, params } = new QueryBuilder('users')
      .select()
      .like('name', '%John%')
      .toSQL();
    expect(sql).toContain('name LIKE ?');
    expect(params).toEqual(['%John%']);
  });

  it('should build query with BETWEEN', () => {
    const { sql, params } = new QueryBuilder('users')
      .select()
      .between('age', 18, 65)
      .toSQL();
    expect(sql).toContain('age BETWEEN ? AND ?');
    expect(params).toEqual([18, 65]);
  });

  it('should build query with IS NULL', () => {
    const { sql } = new QueryBuilder('users')
      .select()
      .isNull('deletedAt')
      .toSQL();
    expect(sql).toContain('deletedAt IS NULL');
  });

  it('should build query with JOIN', () => {
    const { sql } = new QueryBuilder('users')
      .select('users.*', 'posts.title')
      .join('posts', 'users.id = posts.userId')
      .toSQL();
    expect(sql).toContain('INNER JOIN posts ON users.id = posts.userId');
  });

  it('should build query with LEFT JOIN', () => {
    const { sql } = new QueryBuilder('users')
      .select()
      .leftJoin('posts', 'users.id = posts.userId')
      .toSQL();
    expect(sql).toContain('LEFT JOIN posts ON users.id = posts.userId');
  });

  it('should build INSERT with RETURNING', () => {
    const { sql, params } = new QueryBuilder('users')
      .insert({ name: 'John' })
      .returning('id', 'name')
      .toSQL();
    expect(sql).toContain('RETURNING id, name');
    expect(params).toEqual(['John']);
  });
});

describe('Model', () => {
  it('should create model with default options', () => {
    const model = new Model(null as any, { tableName: 'users' });
    expect(model.tableName).toBe('users');
    expect(model.primaryKey).toBe('id');
  });

  it('should create model with custom primary key', () => {
    const model = new Model(null as any, { tableName: 'users', primaryKey: 'userId' });
    expect(model.primaryKey).toBe('userId');
  });

  it('should create query builder', () => {
    const model = new Model(null as any, { tableName: 'users' });
    const q = model.query();
    expect(q).toBeInstanceOf(QueryBuilder);
  });
});