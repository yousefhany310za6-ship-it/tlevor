import type { TlevorContext, HookHandler } from '@tlevor/types';

// ==================== Schema Builder ====================

export class GraphQLSchemaBuilder {
  private queries: Map<string, { type: string; resolver: Function }> = new Map();
  private mutations: Map<string, { type: string; args: Record<string, any>; resolver: Function }> = new Map();
  private subscriptions: Map<string, { type: string; resolver: Function }> = new Map();
  private types: Map<string, string> = new Map();

  private builtSchema: string = '';

  type(name: string, definition: string): this { this.types.set(name, definition); return this; }

  query(name: string, returnType: string, resolver: Function): this {
    this.queries.set(name, { type: returnType, resolver });
    return this;
  }

  mutation(name: string, args: Record<string, any>, returnType: string, resolver: Function): this {
    this.mutations.set(name, { type: returnType, args, resolver });
    return this;
  }

  subscription(name: string, returnType: string, resolver: Function): this {
    this.subscriptions.set(name, { type: returnType, resolver });
    return this;
  }

  build(): string {
    const lines: string[] = [];

    for (const [name, definition] of this.types) {
      lines.push(`type ${name} { ${definition} }`);
    }

    if (this.queries.size > 0) {
      lines.push('type Query {');
      for (const [name, q] of this.queries) {
        lines.push(`  ${name}: ${q.type}`);
      }
      lines.push('}');
    }

    if (this.mutations.size > 0) {
      lines.push('type Mutation {');
      for (const [name, m] of this.mutations) {
        const argsStr = Object.entries(m.args).map(([k, v]) => `${k}: ${v}`).join(', ');
        lines.push(`  ${name}(${argsStr}): ${m.type}`);
      }
      lines.push('}');
    }

    if (this.subscriptions.size > 0) {
      lines.push('type Subscription {');
      for (const [name, s] of this.subscriptions) {
        lines.push(`  ${name}: ${s.type}`);
      }
      lines.push('}');
    }

    this.builtSchema = lines.join('\n');
    return this.builtSchema;
  }

  getResolver(type: 'query' | 'mutation' | 'subscription', name: string): Function | undefined {
    const map = type === 'query' ? this.queries : type === 'mutation' ? this.mutations : this.subscriptions;
    return map.get(name)?.resolver;
  }

  getSchema(): string { return this.builtSchema || this.build(); }
}

// ==================== SDL Parser ====================

export interface ParsedField {
  name: string;
  type: string;
  args: Record<string, string>;
  isRequired: boolean;
  isList: boolean;
}

export interface ParsedType {
  name: string;
  kind: 'type' | 'input' | 'enum' | 'interface';
  fields: ParsedField[];
}

export function parseSDL(sdl: string): ParsedType[] {
  const types: ParsedType[] = [];
  const typeRegex = /(?:type|input|enum|interface)\s+(\w+)(?:\s+implements\s+\w+)?\s*\{([^}]*)\}/g;
  let match;

  while ((match = typeRegex.exec(sdl)) !== null) {
    const [, name, body] = match;
    const kind = match[0].startsWith('input') ? 'input' : match[0].startsWith('enum') ? 'enum' : match[0].startsWith('interface') ? 'interface' : 'type';
    const fields: ParsedField[] = [];

    for (const line of body.replace(/\s+(\w+\s*:)/g, '\n$1').split('\n').map(l => l.trim()).filter(Boolean)) {
      if (line.startsWith('#') || line.startsWith('enum')) continue;
      const fieldMatch = line.match(/^(\w+)(?:\(([^)]*)\))?\s*:\s*(.+)/);
      if (fieldMatch) {
        const [, fname, argsStr, typeStr] = fieldMatch;
        const args: Record<string, string> = {};
        if (argsStr) {
          for (const arg of argsStr.split(',')) {
            const [aName, aType] = arg.split(':').map(s => s.trim());
            args[aName] = aType;
          }
        }
        const isRequired = typeStr.includes('!');
        const isList = typeStr.includes('[');
        const cleanType = typeStr.replace(/[!\[\]]/g, '').trim();
        fields.push({ name: fname, type: cleanType, args, isRequired, isList });
      }
    }

    types.push({ name, kind, fields });
  }

  return types;
}

// ==================== HTTP Handler ====================

export interface GraphQLHandlerOptions {
  schema: GraphQLSchemaBuilder;
  context?: (ctx: TlevorContext) => Record<string, any>;
  graphiql?: boolean;
}

interface GraphQLRequest {
  query: string;
  variables?: Record<string, any>;
  operationName?: string;
}

function parseQuery(query: string): { operationType: string; operationName: string; fields: string[]; variables: Record<string, any> } {
  const operationType = query.trim().startsWith('mutation') ? 'mutation' : query.trim().startsWith('subscription') ? 'subscription' : 'query';
  const nameMatch = query.match(/(?:query|mutation|subscription)\s+(\w+)/);
  const operationName = nameMatch ? nameMatch[1] : 'anonymous';
  const fields: string[] = [];
  const fieldRegex = /(\w+)(?:\(([^)]*)\))?/g;
  let m;
  const body = query.replace(/^(query|mutation|subscription)\s+\w*\s*{/, '').replace(/}$/, '');
  while ((m = fieldRegex.exec(body)) !== null) {
    if (!['query', 'mutation', 'subscription', 'fragment', 'on'].includes(m[1])) {
      fields.push(m[1]);
    }
  }
  return { operationType, operationName, fields, variables: {} };
}

function resolveField(fieldName: string, args: Record<string, any>, resolverMap: Map<string, { type: string; resolver: Function }>): any {
  const entry = resolverMap.get(fieldName);
  if (!entry) return null;
  return entry.resolver(args);
}

function executeQuery(query: string, variables: Record<string, any> | undefined, schema: GraphQLSchemaBuilder, context: Record<string, any>): any {
  const parsed = parseQuery(query);
  const resolverMap = parsed.operationType === 'mutation'
    ? new Map(Array.from(schema['mutations'].entries()).map(([k, v]) => [k, v]))
    : new Map(Array.from(schema['queries'].entries()).map(([k, v]) => [k, v]));

  const result: Record<string, any> = {};
  for (const field of parsed.fields) {
    const resolver = resolverMap.get(field);
    if (resolver) {
      result[field] = resolver.resolver({ ...context, variables });
    }
  }
  return result;
}

const GRAPHIQL_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>GraphiQL</title>
  <link href="https://unpkg.com/graphiql/graphiql.min.css" rel="stylesheet" />
</head>
<body style="margin:0;">
  <div id="graphiql" style="height:100vh;"></div>
  <script crossorigin src="https://unpkg.com/react/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom/umd/react-dom.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/graphiql/graphiql.min.js"></script>
  <script>
    const fetcher = GraphiQL.createFetcher({ url: '/graphql' });
    ReactDOM.render(
      React.createElement(GraphiQL, { fetcher }),
      document.getElementById('graphiql'),
    );
  </script>
</body>
</html>`;

export function graphqlHandler(options: GraphQLHandlerOptions): HookHandler {
  const { schema, context, graphiql = true } = options;

  return async (ctx: TlevorContext) => {
    const path = ctx.req.path;

    if (graphiql && path === '/graphql' && ctx.req.method === 'GET') {
      ctx.res.header('Content-Type', 'text/html').send(GRAPHIQL_HTML);
      return false;
    }

    if (path !== '/graphql') return;

    let body: GraphQLRequest;
    try {
      if (ctx.req.method === 'GET') {
        const query = (ctx.req.query as any).query || (ctx.req.query as any).q;
        const variables = (ctx.req.query as any).variables ? JSON.parse((ctx.req.query as any).variables) : undefined;
        body = { query, variables };
      } else {
        body = ctx.req.body;
      }
    } catch {
      ctx.res.status(400).json({ errors: [{ message: 'Invalid request body' }] });
      return false;
    }

    if (!body || !body.query) {
      ctx.res.status(400).json({ errors: [{ message: 'Query is required' }] });
      return false;
    }

    const ctxData = context ? context(ctx) : {};
    try {
      const result = executeQuery(body.query, body.variables, schema, ctxData);
      ctx.res.json({ data: result });
    } catch (error: any) {
      ctx.res.status(500).json({ errors: [{ message: error.message || 'Internal server error' }] });
    }

    return false;
  };
}

// ==================== Schema to SDL ====================

export function schemaToSDL(builder: GraphQLSchemaBuilder): string {
  return builder.build();
}

// ==================== Factory ====================

export function createGraphQL(options: GraphQLHandlerOptions): { handler: HookHandler; schema: GraphQLSchemaBuilder } {
  return {
    handler: graphqlHandler(options),
    schema: options.schema,
  };
}