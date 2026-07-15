import type { TlevorContext, HookHandler } from '@tlevor/types';

// ==================== Types ====================

export interface SwaggerOptions {
  title?: string;
  description?: string;
  version?: string;
  host?: string;
  basePath?: string;
  schemes?: string[];
  securityDefinitions?: Record<string, any>;
  tags?: Array<{ name: string; description?: string }>;
}

export interface RouteDoc {
  method: string | string[];
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses?: Record<string, ResponseObject>;
  security?: Record<string, string[]>[];
  deprecated?: boolean;
}

export interface ParameterObject {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  description?: string;
  required?: boolean;
  schema?: SchemaObject;
  example?: any;
}

export interface RequestBodyObject {
  description?: string;
  required?: boolean;
  content: Record<string, MediaTypeObject>;
}

export interface MediaTypeObject {
  schema?: SchemaObject;
  example?: any;
}

export interface ResponseObject {
  description: string;
  content?: Record<string, MediaTypeObject>;
}

export interface SchemaObject {
  type?: string;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  items?: SchemaObject;
  enum?: any[];
  example?: any;
  format?: string;
  description?: string;
}

// ==================== Swagger Builder ====================

export class SwaggerDoc {
  private options: Required<SwaggerOptions>;
  private routes: RouteDoc[] = [];

  constructor(options: SwaggerOptions = {}) {
    this.options = {
      title: options.title || 'Tlevor API',
      description: options.description || 'API Documentation',
      version: options.version || '1.0.0',
      host: options.host || 'localhost:3000',
      basePath: options.basePath || '/',
      schemes: options.schemes || ['http'],
      securityDefinitions: options.securityDefinitions || {},
      tags: options.tags || [],
    };
  }

  addRoute(doc: RouteDoc): void { this.routes.push(doc); }
  addRoutes(docs: RouteDoc[]): void { this.routes.push(...docs); }

  private generatePaths(): Record<string, any> {
    const paths: Record<string, any> = {};
    for (const route of this.routes) {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      if (!paths[route.path]) paths[route.path] = {};

      for (const method of methods) {
        const operation: any = {};
        if (route.summary) operation.summary = route.summary;
        if (route.description) operation.description = route.description;
        if (route.tags) operation.tags = route.tags;
        if (route.deprecated) operation.deprecated = true;
        if (route.security) operation.security = route.security;

        if (route.parameters) {
          operation.parameters = route.parameters.map(p => ({
            name: p.name,
            in: p.in,
            ...(p.description && { description: p.description }),
            ...(p.required !== undefined && { required: p.required }),
            ...(p.schema && { schema: p.schema }),
            ...(p.example !== undefined && { example: p.example }),
          }));
        }

        if (route.requestBody) {
          operation.requestBody = {
            ...(route.requestBody.description && { description: route.requestBody.description }),
            ...(route.requestBody.required !== undefined && { required: route.requestBody.required }),
            content: route.requestBody.content,
          };
        }

        operation.responses = route.responses || {
          '200': { description: 'Successful response' },
        };

        paths[route.path][method.toLowerCase()] = operation;
      }
    }
    return paths;
  }

  private generateSchemaFromValidation(schema: any): SchemaObject {
    if (!schema) return {};
    const result: SchemaObject = {};
    if (schema.type) result.type = schema.type;
    if (schema.properties) {
      result.properties = {};
      for (const [key, value] of Object.entries(schema.properties)) {
        result.properties[key] = this.generateSchemaFromValidation(value);
      }
    }
    if (schema.required) result.required = schema.required;
    if (schema.enum) result.enum = schema.enum;
    if (schema.minLength !== undefined) result.description = `Min length: ${schema.minLength}`;
    if (schema.minimum !== undefined) result.description = `Min value: ${schema.minimum}`;
    if (schema.format) result.format = schema.format;
    if (schema.example) result.example = schema.example;
    return result;
  }

  addRouteFromTlevor(route: { method: string | string[]; path: string; schema?: any; summary?: string; description?: string; tags?: string[] }): void {
    const doc: RouteDoc = {
      method: route.method,
      path: route.path,
      summary: route.summary,
      description: route.description,
      tags: route.tags,
      responses: { '200': { description: 'Successful response' } },
    };

    if (route.schema) {
      if (route.schema.body) {
        doc.requestBody = {
          required: true,
          content: {
            'application/json': {
              schema: this.generateSchemaFromValidation(route.schema.body),
            },
          },
        };
      }

      if (route.schema.params) {
        if (!doc.parameters) doc.parameters = [];
        const paramsSchema = route.schema.params;
        if (paramsSchema.properties) {
          for (const [key, value] of Object.entries(paramsSchema.properties)) {
            doc.parameters.push({
              name: key,
              in: 'path',
              schema: this.generateSchemaFromValidation(value),
              required: true,
            });
          }
        }
      }

      if (route.schema.query) {
        if (!doc.parameters) doc.parameters = [];
        const querySchema = route.schema.query;
        if (querySchema.properties) {
          for (const [key, value] of Object.entries(querySchema.properties)) {
            doc.parameters.push({
              name: key,
              in: 'query',
              schema: this.generateSchemaFromValidation(value),
              required: querySchema.required?.includes(key),
            });
          }
        }
      }

      if (route.schema.response) {
        doc.responses = {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: this.generateSchemaFromValidation(route.schema.response),
              },
            },
          },
        };
      }
    }

    this.addRoute(doc);
  }

  generate(): any {
    return {
      openapi: '3.0.0',
      info: {
        title: this.options.title,
        description: this.options.description,
        version: this.options.version,
      },
      servers: this.options.schemes.map(s => ({
        url: `${s}://${this.options.host}${this.options.basePath}`,
      })),
      paths: this.generatePaths(),
      ...(this.options.tags.length > 0 && { tags: this.options.tags }),
      ...(Object.keys(this.options.securityDefinitions).length > 0 && {
        components: { securitySchemes: this.options.securityDefinitions },
      }),
    };
  }
}

// ==================== Swagger UI ====================

export function swaggerUi(specUrl: string): HookHandler {
  return async (ctx: TlevorContext) => {
    if (ctx.req.path === '/swagger' || ctx.req.path === '/swagger/') {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Swagger UI</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '${specUrl}',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout: 'StandaloneLayout',
    });
  </script>
</body>
</html>`;
      ctx.res.header('Content-Type', 'text/html').send(html);
      return false;
    }
  };
}

// ==================== Middleware ====================

export function swaggerMiddleware(doc: SwaggerDoc, options: { path?: string; uiPath?: string } = {}): HookHandler {
  const specPath = options.path || '/swagger.json';
  const uiPath = options.uiPath || '/swagger';

  return async (ctx: TlevorContext) => {
    if (ctx.req.path === specPath && ctx.req.method === 'GET') {
      const spec = doc.generate();
      ctx.res.json(spec);
      return false;
    }

    if (ctx.req.path === uiPath || ctx.req.path === `${uiPath}/`) {
      return swaggerUi(specPath)(ctx);
    }
  };
}

// ==================== Factory ====================

export function createSwagger(options?: SwaggerOptions): SwaggerDoc {
  return new SwaggerDoc(options);
}