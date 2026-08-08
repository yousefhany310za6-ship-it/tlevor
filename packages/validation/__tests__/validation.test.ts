import { describe, it, expect } from 'vitest';
import { Validator, createValidator, compileSchema, compiledValidators } from '../src/index';

describe('validation', () => {
  const userSchema = {
    type: 'object',
    required: ['name', 'email'],
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 50 },
      email: { type: 'string', pattern: '^[^@]+@[^@]+\\.[^@]+$' },
      age: { type: 'number', minimum: 0, maximum: 120, multipleOf: 1 },
      tags: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
      role: { type: 'string', enum: ['admin', 'user', 'guest'] },
      address: {
        type: 'object',
        properties: {
          city: { type: 'string', minLength: 1 },
        },
      },
    },
  };

  describe('createValidator / Validator', () => {
    it('returns a Validator instance', () => {
      expect(createValidator()).toBeInstanceOf(Validator);
    });

    it('accepts valid data', () => {
      const v = createValidator();
      const res = v.validate(
        { name: 'Ahmed', email: 'a@b.com', age: 30, tags: ['x'], role: 'admin', address: { city: 'Cairo' } },
        userSchema,
      );
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual([]);
    });

    it('flags missing required fields', () => {
      const res = createValidator().validate({ email: 'a@b.com' }, userSchema);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('"name" is required');
    });

    it('flags wrong types', () => {
      const res = createValidator().validate({ name: 'A', email: 'a@b.com', age: 'old' }, userSchema);
      expect(res.errors).toContain('"age" must be a number');
    });

    it('validates string constraints', () => {
      const res = createValidator().validate({ name: 'A', email: 'a@b.com' }, userSchema);
      expect(res.errors).toContain('"name" must be at least 2 characters');
    });

    it('validates pattern mismatch', () => {
      const res = createValidator().validate({ name: 'Ahmed', email: 'not-an-email' }, userSchema);
      expect(res.errors.some((e) => e.includes('does not match pattern'))).toBe(true);
    });

    it('validates number constraints', () => {
      const res = createValidator().validate({ name: 'A', email: 'a@b.com', age: 150 }, userSchema);
      expect(res.errors).toContain('"age" must be at most 120');
    });

    it('validates multipleOf', () => {
      const res = createValidator().validate({ name: 'A', email: 'a@b.com', age: 3.5 }, userSchema);
      expect(res.errors).toContain('"age" must be a multiple of 1');
    });

    it('validates array constraints', () => {
      const res = createValidator().validate({ name: 'A', email: 'a@b.com', tags: [] }, userSchema);
      expect(res.errors).toContain('"tags" must have at least 1 items');
    });

    it('validates enum membership', () => {
      const res = createValidator().validate({ name: 'A', email: 'a@b.com', role: 'superuser' }, userSchema);
      expect(res.errors).toContain('"role" must be one of: admin, user, guest');
    });

    it('recursively validates nested objects', () => {
      const res = createValidator().validate({ name: 'Ahmed', email: 'a@b.com', address: { city: '' } }, userSchema);
      expect(res.errors.some((e) => e.startsWith('address.') && e.includes('city'))).toBe(true);
    });

    it('validates array items recursively', () => {
      const v = createValidator();
      const res = v.validate({ tags: [1, 'ok'] }, {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' } },
        },
      });
      expect(res.errors.some((e) => e.startsWith('tags[0]'))).toBe(true);
    });
  });

  describe('named schemas', () => {
    it('adds and retrieves schemas by name', () => {
      const v = createValidator();
      v.addSchema('user', userSchema);
      expect(v.getSchema('user')).toBe(userSchema);
      expect(v.getSchema('nope')).toBeUndefined();
    });

    it('validates against a named schema', () => {
      const v = createValidator();
      v.addSchema('user', userSchema);
      expect(v.validateNamed({ name: 'A', email: 'a@b.com' }, 'user').valid).toBe(false);
    });

    it('throws when the named schema is missing', () => {
      const v = createValidator();
      expect(() => v.validateNamed({}, 'missing')).toThrow('Schema "missing" not found');
    });
  });

  describe('serialize', () => {
    it('picks only the declared properties', () => {
      const v = createValidator();
      const out = v.serialize({ name: 'Ahmed', age: 30, secret: 'x' }, { properties: { name: { type: 'string' }, age: { type: 'number' } } });
      expect(out).toEqual({ name: 'Ahmed', age: 30 });
      expect('secret' in out).toBe(false);
    });

    it('returns the data untouched without a schema', () => {
      const v = createValidator();
      const data = { a: 1 };
      expect(v.serialize(data, undefined as any)).toBe(data);
    });
  });

  describe('compileSchema caching', () => {
    it('caches compiled validators by schema key', () => {
      compiledValidators.clear();
      const before = compiledValidators.size;
      compileSchema({ type: 'object', properties: { a: { type: 'string' } } });
      compileSchema({ type: 'object', properties: { a: { type: 'string' } } });
      expect(compiledValidators.size).toBe(before + 1);
    });
  });
});
