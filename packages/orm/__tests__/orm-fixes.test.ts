import { describe, it, expect } from 'vitest';
import { QueryBuilder, Model, MemoryAdapter, SqliteAdapter, MigrationManager } from '../src/index';

describe('ORM regressions', () => {
  describe('custom primary keys', () => {
    it('MemoryAdapter honors a custom primary key for create/update/delete', async () => {
      const adapter = new MemoryAdapter();
      await adapter.connect();
      const model = new Model(adapter, { tableName: 'users', primaryKey: 'userId' });

      const created = await model.create({ userId: 'u1', name: 'A' });
      expect(created.userId).toBe('u1');

      const updated = await model.update('u1', { name: 'B' });
      expect(updated.name).toBe('B');

      expect(await model.findById('u1')).toMatchObject({ name: 'B' });
      expect(await model.delete('u1')).toBe(true);
      expect(await model.findById('u1')).toBeNull();
      await adapter.disconnect();
    });

    it('SqliteAdapter honors a custom primary key for update/delete', async () => {
      const adapter = new SqliteAdapter({ memory: true });
      await adapter.connect();
      await adapter.sync({ tableName: 'users', primaryKey: 'userId', columns: { name: { type: 'string' } }, timestamps: false });
      const model = new Model(adapter, { tableName: 'users', primaryKey: 'userId', timestamps: false });

      const created = await model.create({ userId: 7, name: 'A' });
      expect(created.userId).toBe(7);

      await model.update(7, { name: 'C' });
      expect((await model.findById(7))?.name).toBe('C');

      expect(await model.delete(7)).toBe(true);
      expect(await model.findById(7)).toBeNull();
      await adapter.disconnect();
    });
  });

  describe('migration manager', () => {
    it('down() does not corrupt the up() order', async () => {
      const base = new MemoryAdapter();
      await base.connect();
      const executed: string[] = [];
      const adapter: MemoryAdapter = Object.assign(Object.create(Object.getPrototypeOf(base)), base) as MemoryAdapter;
      adapter.execute = async (sql: string) => { executed.push(sql); return null; };

      const m = new MigrationManager({ adapter });
      m.addMigration({ name: 'one', up: ['CREATE TABLE one (id INTEGER)'], down: ['DROP TABLE one'] });
      m.addMigration({ name: 'two', up: ['CREATE TABLE two (id INTEGER)'], down: ['DROP TABLE two'] });

      await m.up();
      await m.down();
      // The next up() must run in original order again.
      await m.up();
      expect(executed.join(',')).toBe(
        'CREATE TABLE one (id INTEGER),CREATE TABLE two (id INTEGER),' +
        'DROP TABLE two,DROP TABLE one,' +
        'CREATE TABLE one (id INTEGER),CREATE TABLE two (id INTEGER)',
      );
      await base.disconnect();
    });

    it('tracks applied migrations and reports pending ones', async () => {
      const adapter = new MemoryAdapter();
      await adapter.connect();
      const m = new MigrationManager({ adapter });
      m.addMigration({ name: 'a', up: ['x'], down: ['y'] });
      m.addMigration({ name: 'b', up: ['x'], down: ['y'] });
      expect(m.getPendingMigrations().map((x) => x.name)).toEqual(['a', 'b']);
      await m.up();
      expect(m.getPendingMigrations()).toEqual([]);
      await m.down();
      expect(m.getPendingMigrations().map((x) => x.name)).toEqual(['a', 'b']);
      await adapter.disconnect();
    });
  });

  describe('query builder OR semantics', () => {
    it('emits OR groups correctly', () => {
      const { sql, params } = new QueryBuilder('users')
        .where('age', '>', 18)
        .or('role', '=', 'admin')
        .or('role', '=', 'owner')
        .toSQL();
      expect(sql).toBe('SELECT * FROM users WHERE (age > ?) OR (role = ?) OR (role = ?)');
      expect(params).toEqual([18, 'admin', 'owner']);
    });

    it('combines AND and OR groups', () => {
      const { sql, params } = new QueryBuilder('users')
        .where('active', '=', true)
        .where('age', '>', 18)
        .or('name', 'LIKE', '%x%')
        .toSQL();
      expect(sql).toBe('SELECT * FROM users WHERE (active = ? AND age > ?) OR (name LIKE ?)');
      expect(params).toEqual([true, 18, '%x%']);
    });
  });

  describe('query builder upsert with custom primary key', () => {
    it('targets the given primary key on conflict', () => {
      const { sql } = new QueryBuilder('users').upsert({ code: 'X', name: 'N' }, 'code').toSQL();
      expect(sql).toContain('ON CONFLICT(code) DO UPDATE SET name = VALUES(name)');
    });
  });

  describe('execSQL LIMIT + OFFSET', () => {
    it('applies LIMIT and OFFSET to the correct params', async () => {
      const adapter = new MemoryAdapter();
      await adapter.connect();
      for (let i = 1; i <= 5; i++) await adapter.create('nums', { v: i });
      const { sql, params } = new QueryBuilder('nums').select().orderBy('v', 'asc').limit(2).offset(1).toSQL();
      const rows = await adapter.raw(sql, params);
      expect(rows.map((r: any) => r.v)).toEqual([2, 3]);
      await adapter.disconnect();
    });
  });

  describe('memory sort with mixed/string values', () => {
    it('sorts strings without NaN comparisons', async () => {
      const adapter = new MemoryAdapter();
      await adapter.connect();
      await adapter.create('w', { k: 'b' });
      await adapter.create('w', { k: 'a' });
      await adapter.create('w', { k: 'c' });
      const rows = await adapter.findMany('w', { orderBy: { k: 'asc' } });
      expect(rows.map((r: any) => r.k)).toEqual(['a', 'b', 'c']);
      await adapter.disconnect();
    });
  });
});
