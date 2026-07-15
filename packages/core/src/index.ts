import type {
  TlevorRequest,
  TlevorResponse,
  TlevorContext,
  HookHandler,
  HookName,
  TlevorHooks,
  RouteOptions,
  PluginHandler,
  LoggerInterface,
  HTTPMethod,
} from '@tlevor/types';
import { Router } from '@tlevor/router';
import { IncomingMessage, ServerResponse, createServer } from 'http';

// ==================== Logger ====================

class DefaultLogger implements LoggerInterface {
  private bindings: Record<string, any>;

  constructor(bindings: Record<string, any> = {}) {
    this.bindings = bindings;
  }

  trace(msg: string, ...args: any[]): void {
    console.trace(`[TRACE] ${msg}`, ...args);
  }

  debug(msg: string, ...args: any[]): void {
    console.debug(`[DEBUG] ${msg}`, ...args);
  }

  info(msg: string, ...args: any[]): void {
    console.info(`[INFO] ${msg}`, ...args);
  }

  warn(msg: string, ...args: any[]): void {
    console.warn(`[WARN] ${msg}`, ...args);
  }

  error(msg: string, ...args: any[]): void {
    console.error(`[ERROR] ${msg}`, ...args);
  }

  fatal(msg: string, ...args: any[]): void {
    console.error(`[FATAL] ${msg}`, ...args);
    process.exit(1);
  }

  child(bindings: Record<string, any>): LoggerInterface {
    return new DefaultLogger({ ...this.bindings, ...bindings });
  }
}

// ==================== Errors ====================

export class TlevorError extends Error {
  public statusCode: number;
  public code: string;
  public details?: any;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR', details?: any) {
    super(message);
    this.name = 'TlevorError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends TlevorError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends TlevorError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends TlevorError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends TlevorError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends TlevorError {
  constructor(message: string = 'Conflict') {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

export class PayloadTooLargeError extends TlevorError {
  constructor(maxSize: number) {
    super(`Payload too large. Maximum size is ${maxSize} bytes`, 413, 'PAYLOAD_TOO_LARGE');
    this.name = 'PayloadTooLargeError';
  }
}

// ==================== Body Parser ====================

export interface BodyParserOptions {
  jsonLimit?: number;
  urlEncodedLimit?: number;
}

function readBody(req: IncomingMessage, limit: number = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        reject(new PayloadTooLargeError(limit));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });

    req.on('error', reject);
  });
}

async function parseBody(req: IncomingMessage, options: BodyParserOptions = {}): Promise<any> {
  const contentType = req.headers['content-type'] || '';
  const rawBody = await readBody(req, options.jsonLimit || options.urlEncodedLimit || 1024 * 1024);

  if (!rawBody) return {};

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawBody);
    } catch {
      throw new ValidationError('Invalid JSON');
    }
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(rawBody);
    const result: Record<string, string> = {};
    params.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  if (contentType.includes('text/plain')) {
    return rawBody;
  }

  return rawBody;
}

// ==================== CORS ====================

export interface CorsOptions {
  origin?: string | string[] | ((origin: string) => boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

function getCorsHeaders(options: CorsOptions, requestOrigin?: string): Record<string, string> {
  const headers: Record<string, string> = {};

  const origin = options.origin || '*';
  let allowOrigin = '*';

  if (origin === '*') {
    allowOrigin = '*';
  } else if (typeof origin === 'string') {
    allowOrigin = origin;
  } else if (Array.isArray(origin)) {
    if (requestOrigin && origin.includes(requestOrigin)) {
      allowOrigin = requestOrigin;
    }
  } else if (typeof origin === 'function') {
    if (requestOrigin && origin(requestOrigin)) {
      allowOrigin = requestOrigin;
    }
  }

  headers['Access-Control-Allow-Origin'] = allowOrigin;
  headers['Access-Control-Allow-Methods'] = (options.methods || ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']).join(', ');
  headers['Access-Control-Allow-Headers'] = (options.allowedHeaders || ['Content-Type', 'Authorization']).join(', ');

  if (options.exposedHeaders) {
    headers['Access-Control-Expose-Headers'] = options.exposedHeaders.join(', ');
  }

  if (options.credentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  if (options.maxAge) {
    headers['Access-Control-Max-Age'] = String(options.maxAge);
  }

  return headers;
}

// ==================== Request/Response ====================

class TlevorRequestImpl<Body = any, Query = any, Params = any> implements TlevorRequest<Body, Query, Params> {
  raw: IncomingMessage;
  method: HTTPMethod;
  url: string;
  path: string;
  headers: IncomingMessage['headers'];
  params: Params;
  query: Query;
  body: Body;
  ip: string;

  constructor(raw: IncomingMessage, url: string, path: string, params: Params, query: Query) {
    this.raw = raw;
    this.method = raw.method as HTTPMethod;
    this.url = url;
    this.path = path;
    this.headers = raw.headers;
    this.params = params;
    this.query = query;
    this.body = {} as Body;
    this.ip = raw.socket.remoteAddress || '127.0.0.1';
  }
}

class TlevorResponseImpl implements TlevorResponse {
  raw: ServerResponse;
  statusCode: number = 200;
  headersSent: boolean = false;

  constructor(raw: ServerResponse) {
    this.raw = raw;
  }

  status(code: number): this {
    this.statusCode = code;
    this.raw.statusCode = code;
    return this;
  }

  header(name: string, value: string | string[]): this {
    if (this.headersSent) return this;
    this.raw.setHeader(name, value);
    return this;
  }

  send(payload: any): void {
    if (this.headersSent) return;
    this.headersSent = true;
    this.raw.end(payload);
  }

  json(payload: any): void {
    if (this.headersSent) return;
    this.headersSent = true;
    this.raw.setHeader('Content-Type', 'application/json');
    this.raw.end(JSON.stringify(payload));
  }

  text(payload: string): void {
    if (this.headersSent) return;
    this.headersSent = true;
    this.raw.setHeader('Content-Type', 'text/plain');
    this.raw.end(payload);
  }

  redirect(url: string, code: number = 302): void {
    if (this.headersSent) return;
    this.headersSent = true;
    this.raw.writeHead(code, { Location: url });
    this.raw.end();
  }
}

// ==================== App ====================

export interface TlevorAppOptions {
  logger?: LoggerInterface;
  cors?: CorsOptions | boolean;
  bodyParser?: BodyParserOptions | boolean;
  trustProxy?: boolean;
}

export class TlevorApp {
  private router: Router;
  private hooks: TlevorHooks;
  private plugins: Array<{ handler: PluginHandler; opts: any }>;
  private logger: LoggerInterface;
  private server: any;
  private isRunning: boolean = false;
  private options: TlevorAppOptions;
  private corsOptions: CorsOptions | false;
  private bodyParserOptions: BodyParserOptions | false;

  constructor(options: TlevorAppOptions = {}) {
    this.router = new Router();
    this.hooks = {
      onRequest: [],
      preParsing: [],
      preValidation: [],
      preHandler: [],
      postHandler: [],
      onResponse: [],
    };
    this.plugins = [];
    this.options = options;
    this.logger = options.logger || new DefaultLogger();
    this.corsOptions = options.cors === false ? false : (options.cors === true ? {} : options.cors || {});
    this.bodyParserOptions = options.bodyParser === false ? false : (options.bodyParser === true ? {} : options.bodyParser || {});
  }

  addRoute(options: RouteOptions): void {
    const { method, path, handler } = options;
    this.router.addRoute(method, path, handler);
  }

  addHook(name: HookName, handler: HookHandler): void {
    if (!this.hooks[name]) {
      throw new Error(`Unknown hook: ${name}`);
    }
    this.hooks[name].push(handler);
  }

  registerPlugin(plugin: PluginHandler, opts: any = {}): void {
    this.plugins.push({ handler: plugin, opts });
    plugin(this, opts);
  }

  async inject(opts: {
    method: HTTPMethod;
    url: string;
    headers?: Record<string, string>;
    body?: any;
    query?: Record<string, string>;
  }): Promise<{
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    json<T = any>(): T;
  }> {
    return new Promise((resolve) => {
      const bodyStr = opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : '';

      const mockReq = {
        method: opts.method,
        url: opts.url,
        headers: {
          ...opts.headers,
          ...(bodyStr ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(bodyStr) } : {}),
        },
        socket: { remoteAddress: '127.0.0.1' },
        on: (event: string, cb: any) => {
          if (event === 'data' && bodyStr) {
            setTimeout(() => cb(Buffer.from(bodyStr)), 0);
          }
          if (event === 'end') {
            setTimeout(() => cb(), bodyStr ? 10 : 0);
          }
        },
        once: () => {},
        emit: () => {},
        removeListener: () => {},
        destroy: () => {},
      } as unknown as IncomingMessage;

      const mockRes = new (class extends (Object as any) {
        statusCode = 200;
        headers: Record<string, string> = {};
        body = '';
        headersSent = false;
        setHeader(name: string, value: string) {
          this.headers[name.toLowerCase()] = value;
        }
        getHeader(name: string) {
          return this.headers[name.toLowerCase()];
        }
        end(data?: string) {
          if (data) this.body = data;
        }
        writeHead(code: number, headers?: Record<string, string>) {
          this.statusCode = code;
          if (headers) {
            for (const [key, value] of Object.entries(headers)) {
              this.headers[key.toLowerCase()] = value;
            }
          }
        }
      })();

      this.handleRequest(mockReq as IncomingMessage, mockRes as any).then(() => {
        resolve({
          statusCode: mockRes.statusCode,
          headers: mockRes.headers,
          body: mockRes.body,
          json: <T = any>() => {
            try {
              return JSON.parse(mockRes.body) as T;
            } catch {
              return mockRes.body as T;
            }
          },
        });
      });
    });
  }

  async listen(port: number, host: string = '0.0.0.0'): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(port, host, () => {
        this.isRunning = true;
        this.logger.info(`Tlevor server listening on ${host}:${port}`);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err: any) => {
          if (err) reject(err);
          else {
            this.isRunning = false;
            this.logger.info('Tlevor server closed');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || '/';
    const path = url.split('?')[0];
    const method = (req.method || 'GET') as HTTPMethod;

    // Handle CORS preflight
    if (this.corsOptions && method === 'OPTIONS') {
      const origin = req.headers['origin'];
      const corsHeaders = getCorsHeaders(this.corsOptions, origin);
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    const match = this.router.findRouteByMethod(method, path);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found', statusCode: 404 }));
      return;
    }

    // Apply CORS headers
    if (this.corsOptions) {
      const origin = req.headers['origin'];
      const corsHeaders = getCorsHeaders(this.corsOptions, origin);
      for (const [key, value] of Object.entries(corsHeaders)) {
        res.setHeader(key, value);
      }
    }

    const query = this.parseQuery(url);
    const ctx: TlevorContext = {
      req: new TlevorRequestImpl(req, url, path, match.params, query),
      res: new TlevorResponseImpl(res),
      state: {},
      logger: this.logger,
    };

    try {
      // Parse body for POST/PUT/PATCH
      if (this.bodyParserOptions && ['POST', 'PUT', 'PATCH'].includes(method)) {
        try {
          (ctx.req as any).body = await parseBody(req, this.bodyParserOptions);
        } catch (error) {
          if (error instanceof TlevorError) {
            ctx.res.status(error.statusCode).json({
              error: error.message,
              code: error.code,
              statusCode: error.statusCode,
            });
            return;
          }
          throw error;
        }
      }

      for (const hook of this.hooks.onRequest) {
        const result = await hook(ctx);
        if (result === false || ctx.res.headersSent) return;
      }

      for (const hook of this.hooks.preParsing) {
        const result = await hook(ctx);
        if (result === false || ctx.res.headersSent) return;
      }

      for (const hook of this.hooks.preValidation) {
        const result = await hook(ctx);
        if (result === false || ctx.res.headersSent) return;
      }

      for (const hook of this.hooks.preHandler) {
        const result = await hook(ctx);
        if (result === false || ctx.res.headersSent) return;
      }

      const result = await match.handler(ctx);

      if (!ctx.res.headersSent && result !== undefined) {
        if (typeof result === 'string') {
          ctx.res.text(result);
        } else {
          ctx.res.json(result);
        }
      }

      for (const hook of this.hooks.postHandler) {
        await hook(ctx);
      }

      for (const hook of this.hooks.onResponse) {
        await hook(ctx);
      }
    } catch (error) {
      this.handleError(error, ctx);
    }
  }

  private handleError(error: unknown, ctx: TlevorContext): void {
    const err = error instanceof Error ? error : new Error(String(error));

    if (err instanceof TlevorError) {
      this.logger.warn(err.message, { code: err.code, statusCode: err.statusCode });
      if (!ctx.res.headersSent) {
        ctx.res.status(err.statusCode).json({
          error: err.message,
          code: err.code,
          statusCode: err.statusCode,
          details: err.details,
        });
      }
      return;
    }

    this.logger.error(err.message, { stack: err.stack });
    if (!ctx.res.headersSent) {
      ctx.res.status(500).json({
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        statusCode: 500,
      });
    }
  }

  private parseQuery(url: string): Record<string, string> {
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) return {};

    const queryString = url.slice(queryIndex + 1);
    const query: Record<string, string> = {};

    for (const pair of queryString.split('&')) {
      const [key, value] = pair.split('=');
      if (key) {
        query[decodeURIComponent(key)] = decodeURIComponent(value || '');
      }
    }

    return query;
  }
}

export function createApp(options?: TlevorAppOptions): TlevorApp {
  return new TlevorApp(options);
}
