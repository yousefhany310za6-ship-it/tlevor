import { describe, it, expect } from 'vitest';
import { SwaggerDoc, createSwagger } from '../src/index';

describe('SwaggerDoc', () => {
  it('should create with default options', () => {
    const doc = createSwagger();
    const spec = doc.generate();
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.info.title).toBe('Tlevor API');
    expect(spec.info.version).toBe('1.0.0');
  });

  it('should create with custom options', () => {
    const doc = createSwagger({
      title: 'My API',
      description: 'My custom API',
      version: '2.0.0',
      host: 'api.example.com',
    });
    const spec = doc.generate();
    expect(spec.info.title).toBe('My API');
    expect(spec.info.description).toBe('My custom API');
    expect(spec.info.version).toBe('2.0.0');
    expect(spec.servers[0].url).toBe('http://api.example.com/');
  });

  it('should add routes', () => {
    const doc = createSwagger();
    doc.addRoute({
      method: 'GET',
      path: '/users',
      summary: 'Get all users',
      tags: ['users'],
      responses: { '200': { description: 'A list of users' } },
    });
    const spec = doc.generate();
    expect(spec.paths['/users']).toBeDefined();
    expect(spec.paths['/users'].get).toBeDefined();
    expect(spec.paths['/users'].get.summary).toBe('Get all users');
  });

  it('should add routes with parameters', () => {
    const doc = createSwagger();
    doc.addRoute({
      method: 'GET',
      path: '/users/{id}',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'A user' } },
    });
    const spec = doc.generate();
    expect(spec.paths['/users/{id}'].get.parameters).toHaveLength(1);
    expect(spec.paths['/users/{id}'].get.parameters[0].name).toBe('id');
  });

  it('should add routes with request body', () => {
    const doc = createSwagger();
    doc.addRoute({
      method: 'POST',
      path: '/users',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                email: { type: 'string' },
              },
              required: ['name', 'email'],
            },
          },
        },
      },
      responses: { '201': { description: 'User created' } },
    });
    const spec = doc.generate();
    expect(spec.paths['/users'].post.requestBody).toBeDefined();
    expect(spec.paths['/users'].post.requestBody.required).toBe(true);
  });

  it('should handle multiple methods for same path', () => {
    const doc = createSwagger();
    doc.addRoute({
      method: ['GET', 'POST'],
      path: '/users',
      responses: { '200': { description: 'Success' } },
    });
    const spec = doc.generate();
    expect(spec.paths['/users'].get).toBeDefined();
    expect(spec.paths['/users'].post).toBeDefined();
  });

  it('should add tags', () => {
    const doc = createSwagger({ tags: [{ name: 'users', description: 'User operations' }] });
    const spec = doc.generate();
    expect(spec.tags).toHaveLength(1);
    expect(spec.tags[0].name).toBe('users');
  });

  it('should add security definitions', () => {
    const doc = createSwagger({
      securityDefinitions: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    });
    const spec = doc.generate();
    expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
    expect(spec.components.securitySchemes.bearerAuth.type).toBe('http');
  });

  it('should add route from Tlevor route config', () => {
    const doc = createSwagger();
    doc.addRouteFromTlevor({
      method: 'POST',
      path: '/users',
      summary: 'Create user',
      tags: ['users'],
      schema: {
        body: {
          type: 'object',
          required: ['name', 'email'],
          properties: {
            name: { type: 'string', minLength: 2 },
            email: { type: 'string' },
            age: { type: 'number', minimum: 0 },
          },
        },
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
        query: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['json', 'xml'] },
          },
        },
      },
    });
    const spec = doc.generate();
    const post = spec.paths['/users'].post;
    expect(post.summary).toBe('Create user');
    expect(post.requestBody).toBeDefined();
    expect(post.parameters).toHaveLength(2); // id (path) + format (query)
    expect(post.parameters[0].in).toBe('path');
    expect(post.parameters[1].in).toBe('query');
  });

  it('should mark deprecated routes', () => {
    const doc = createSwagger();
    doc.addRoute({
      method: 'GET',
      path: '/old-endpoint',
      deprecated: true,
      responses: { '200': { description: 'Success' } },
    });
    const spec = doc.generate();
    expect(spec.paths['/old-endpoint'].get.deprecated).toBe(true);
  });
});