import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryBuilder, Model, MemoryAdapter, SqliteAdapter, createAdapter, syncModel } from '../src/index';
import type { DatabaseAdapter } from '../src/index';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';

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

// ─── Adapters ────────────────────────────────────────────────────────────────

describe('MemoryAdapter', () => {
  let adapter: MemoryAdapter;
  beforeEach(async () => { adapter = new MemoryAdapter(); await adapter.connect(); });
  afterEach(async () => { await adapter.disconnect(); });

  it('creates and finds a record (auto id)', async () => {
    const created = await adapter.create('users', { name: 'Alice' });
    expect(created.id).toBeDefined();
    const found = await adapter.findOne('users', { id: created.id });
    expect(found?.name).toBe('Alice');
  });

  it('runs full CRUD', async () => {
    const created = await adapter.create('users', { name: 'Bob' });
    const updated = await adapter.update('users', created.id, { name: 'Bobby' });
    expect(updated.name).toBe('Bobby');
    expect(await adapter.count('users')).toBe(1);
    expect(await adapter.delete('users', created.id)).toBe(true);
    expect(await adapter.findOne('users', { id: created.id })).toBeNull();
  });

  it('filters/sorts/paginates via findMany', async () => {
    await adapter.create('users', { name: 'A', age: 30 });
    await adapter.create('users', { name: 'B', age: 20 });
    await adapter.create('users', { name: 'C', age: 25 });

    const adults = await adapter.findMany('users', { where: { age: 30 } });
    expect(adults.length).toBe(1);

    const sorted = await adapter.findMany('users', { orderBy: { age: 'asc' } });
    expect(sorted.map((u) => u.name)).toEqual(['B', 'C', 'A']);

    const paged = await adapter.findMany('users', { limit: 2, offset: 1 });
    expect(paged.length).toBe(2);
  });

  it('upserts existing records', async () => {
    const created = await adapter.create('users', { id: 'u1', name: 'X' });
    const upserted = await adapter.upsert('users', { id: 'u1', name: 'Y' });
    expect(upserted.name).toBe('Y');
    expect(created.id).toBe('u1');
  });
});

describe('createAdapter factory', () => {
  it('returns a MemoryAdapter for "memory"', () => {
    expect(createAdapter('memory')).toBeInstanceOf(MemoryAdapter);
  });
  it('returns a SqliteAdapter for "sqlite" (in-memory)', () => {
    expect(createAdapter('sqlite', { sqlite: { memory: true } })).toBeInstanceOf(SqliteAdapter);
  });
});

describe('SqliteAdapter', () => {
  let file: string;
  let adapter: SqliteAdapter;

  beforeEach(async () => {
    file = join(tmpdir(), `tlevor-orm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    adapter = new SqliteAdapter({ file });
    await adapter.connect();
  });

  afterEach(async () => {
    await adapter.disconnect();
    if (existsSync(file)) unlinkSync(file);
  });

  // Model metadata normally produced by @Table/@Column decorators; built
  // manually here to avoid requiring experimentalDecorators in the test runner.
  class Product {}
  (Product as any).__modelOptions = { tableName: 'products' };
  (Product as any).__columns = { name: { type: 'string' }, price: { type: 'number' } };

  it('syncs a table from decorators and runs full CRUD', async () => {
    await syncModel(Product, adapter);

    const model = new Model(adapter, { tableName: 'products' });
    const created = await model.create({ name: 'Book', price: 10 });
    expect(created.id).toBeDefined();
    expect(created.name).toBe('Book');

    const fetched = await model.findById(created.id);
    expect(fetched?.price).toBe(10);

    await model.update(created.id, { price: 12 });
    expect((await model.findById(created.id))?.price).toBe(12);

    expect(await model.count()).toBe(1);
    expect(await model.delete(created.id)).toBe(true);
    expect(await model.findById(created.id)).toBeNull();
  });

  it('supports transactions', async () => {
    await syncModel(Product, adapter);
    const model = new Model(adapter, { tableName: 'products' });
    await adapter.transaction(async (tx) => {
      const m = new Model(tx, { tableName: 'products' });
      await m.create({ name: 'T1', price: 1 });
      await m.create({ name: 'T2', price: 2 });
    });
    expect(await model.count()).toBe(2);
  });
});

// ─── QueryBuilder.execute (functional) ──────────────────────────────────────

describe('QueryBuilder.execute', () => {
  const adapters: Array<[string, () => Promise<DatabaseAdapter>]> = [
    ['MemoryAdapter', async () => { const a = new MemoryAdapter(); await a.connect(); return a; }],
    ['SqliteAdapter', async () => {
      const a = new SqliteAdapter({ memory: true });
      await a.connect();
      await a.sync({ tableName: 'people', primaryKey: 'id', columns: { name: { type: 'string' }, age: { type: 'number' } } });
      return a;
    }],
  ];

  for (const [name, make] of adapters) {
    describe(name, () => {
      let adapter: DatabaseAdapter;

      beforeEach(async () => { adapter = await make(); });
      afterEach(async () => { await adapter.disconnect(); });

      it('inserts and selects rows', async () => {
        await new QueryBuilder('people').insert({ name: 'Alice', age: 30 }).execute(adapter);
        await new QueryBuilder('people').insert({ name: 'Bob', age: 25 }).execute(adapter);

        const rows = await new QueryBuilder('people').select().orderBy('age', 'asc').execute(adapter);
        expect(rows.length).toBe(2);
        expect(rows.map((r: any) => r.name)).toEqual(['Bob', 'Alice']);
      });

      it('filters with WHERE', async () => {
        await new QueryBuilder('people').insert({ name: 'Alice', age: 30 }).execute(adapter);
        await new QueryBuilder('people').insert({ name: 'Bob', age: 25 }).execute(adapter);

        const adults = await new QueryBuilder('people').select().where('age', '>', 26).execute(adapter);
        expect(adults.length).toBe(1);
        expect(adults[0].name).toBe('Alice');
      });

      it('updates rows', async () => {
        const created = await new QueryBuilder('people').insert({ name: 'Alice', age: 30 }).execute(adapter);
        const id = created.insertId ?? created.lastID ?? created.rowid;

        const result = await new QueryBuilder('people').update({ age: 31 }).where('name', '=', 'Alice').execute(adapter);
        expect(result.changes).toBe(1);

        const found = await new QueryBuilder('people').select().where('name', '=', 'Alice').execute(adapter);
        const row = found[0];
        expect(row.age).toBe(31);
        expect(id).toBeDefined();
      });

      it('counts rows', async () => {
        await new QueryBuilder('people').insert({ name: 'Alice', age: 30 }).execute(adapter);
        await new QueryBuilder('people').insert({ name: 'Bob', age: 25 }).execute(adapter);

        const count = await new QueryBuilder('people').count().execute(adapter);
        const value = Array.isArray(count) ? Number(count[0]?.count ?? count[0]?.c ?? 0) : count;
        expect(value).toBe(2);
      });

      it('deletes rows', async () => {
        await new QueryBuilder('people').insert({ name: 'Alice', age: 30 }).execute(adapter);
        await new QueryBuilder('people').delete().where('name', '=', 'Alice').execute(adapter);

        const rows = await new QueryBuilder('people').select().execute(adapter);
        expect(rows.length).toBe(0);
      });
    });
  }
});