import { describe, it, expect } from 'vitest';
import { GraphQLSchemaBuilder, graphqlHandler, parseSDL } from '../src/index';

describe('GraphQLSchemaBuilder', () => {
  it('should build a schema with queries', () => {
    const schema = new GraphQLSchemaBuilder()
      .type('User', 'id: ID! name: String email: String')
      .query('users', '[User]', () => [{ id: '1', name: 'John' }])
      .query('user', 'User', ({ id }: any) => ({ id, name: 'John' }));

    const sdl = schema.build();
    expect(sdl).toContain('type User {');
    expect(sdl).toContain('type Query {');
    expect(sdl).toContain('users: [User]');
    expect(sdl).toContain('user: User');
  });

  it('should build a schema with mutations', () => {
    const schema = new GraphQLSchemaBuilder()
      .type('User', 'id: ID! name: String')
      .mutation('createUser', { name: 'String!' }, 'User', ({ name }: any) => ({ id: '1', name }));

    const sdl = schema.build();
    expect(sdl).toContain('type Mutation {');
    expect(sdl).toContain('createUser(name: String!): User');
  });

  it('should get resolver for a query', () => {
    const resolver = () => ({ id: '1', name: 'John' });
    const schema = new GraphQLSchemaBuilder().query('user', 'User', resolver);
    expect(schema.getResolver('query', 'user')).toBe(resolver);
  });

  it('should return undefined for non-existent resolver', () => {
    const schema = new GraphQLSchemaBuilder();
    expect(schema.getResolver('query', 'nonexistent')).toBeUndefined();
  });
});

describe('parseSDL', () => {
  it('should parse SDL types', () => {
    const sdl = `type User { id: ID! name: String email: String }`;
    const types = parseSDL(sdl);
    expect(types).toHaveLength(1);
    expect(types[0].name).toBe('User');
    expect(types[0].kind).toBe('type');
    expect(types[0].fields).toHaveLength(3);
    expect(types[0].fields[0].name).toBe('id');
    expect(types[0].fields[0].isRequired).toBe(true);
  });

  it('should parse input types', () => {
    const sdl = `input CreateUserInput { name: String! email: String! }`;
    const types = parseSDL(sdl);
    expect(types[0].kind).toBe('input');
  });
});

describe('graphqlHandler', () => {
  it('should create handler with schema', () => {
    const schema = new GraphQLSchemaBuilder()
      .query('hello', 'String', () => 'world');

    const handler = graphqlHandler({ schema });
    expect(typeof handler).toBe('function');
  });
});