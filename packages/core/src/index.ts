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
  WebSocketHandler as IWebSocketHandler,
  WebSocketConnection as IWebSocketConnection,
  ValidationSchema,
} from '@tlevor/types';
import { Router } from '@tlevor/router';
import { createValidator } from '@tlevor/validation';
import { IncomingMessage, ServerResponse, createServer } from 'http';
import { readFileSync, statSync, existsSync } from 'fs';
import { resolve, extname, join } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';

// ==================== Logger ====================

class DefaultLogger implements LoggerInterface {
  private bindings: Record<string, any>;

  constructor(bindings: Record<string, any> = {}) {
    this.bindings = bindings;
  }

  trace(msg: string, ...args: any[]): void { console.trace(`[TRACE] ${msg}`, ...args); }
  debug(msg: string, ...args: any[]): void { console.debug(`[DEBUG] ${msg}`, ...args); }
  info(msg: string, ...args: any[]): void { console.info(`[INFO] ${msg}`, ...args); }
  warn(msg: string, ...args: any[]): void { console.warn(`[WARN] ${msg}`, ...args); }
  error(msg: string, ...args: any[]): void { console.error(`[ERROR] ${msg}`, ...args); }
  fatal(msg: string, ...args: any[]): void { console.error(`[FATAL] ${msg}`, ...args); process.exit(1); }
  child(bindings: Record<string, any>): LoggerInterface { return new DefaultLogger({ ...this.bindings, ...bindings }); }
}

// ==================== Errors ====================

export class TlevorError extends Error {
  public statusCode: number;
  public code: string;
  public details?: any;
  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR', details?: any) {
    super(message); this.name = 'TlevorError'; this.statusCode = statusCode; this.code = code; this.details = details;
  }
}

export class ValidationError extends TlevorError {
  constructor(message: string, details?: any) { super(message, 400, 'VALIDATION_ERROR', details); this.name = 'ValidationError'; }
}

export class NotFoundError extends TlevorError {
  constructor(resource: string = 'Resource') { super(`${resource} not found`, 404, 'NOT_FOUND'); this.name = 'NotFoundError'; }
}

export class UnauthorizedError extends TlevorError {
  constructor(message: string = 'Unauthorized') { super(message, 401, 'UNAUTHORIZED'); this.name = 'UnauthorizedError'; }
}

export class ForbiddenError extends TlevorError {
  constructor(message: string = 'Forbidden') { super(message, 403, 'FORBIDDEN'); this.name = 'ForbiddenError'; }
}

export class ConflictError extends TlevorError {
  constructor(message: string = 'Conflict') { super(message, 409, 'CONFLICT'); this.name = 'ConflictError'; }
}

export class PayloadTooLargeError extends TlevorError {
  constructor(maxSize: number) { super(`Payload too large. Max: ${maxSize} bytes`, 413, 'PAYLOAD_TOO_LARGE'); this.name = 'PayloadTooLargeError'; }
}

// ==================== Body Parser ====================

export interface BodyParserOptions { jsonLimit?: number; urlEncodedLimit?: number; }

function readBody(req: IncomingMessage, limit: number = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > limit) { req.destroy(); reject(new PayloadTooLargeError(limit)); return; } chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

async function parseBody(req: IncomingMessage, options: BodyParserOptions = {}): Promise<any> {
  const contentType = req.headers['content-type'] || '';
  const rawBody = await readBody(req, options.jsonLimit || options.urlEncodedLimit || 1024 * 1024);
  if (!rawBody) return {};
  if (contentType.includes('application/json')) { try { return JSON.parse(rawBody); } catch { throw new ValidationError('Invalid JSON'); } }
  if (contentType.includes('application/x-www-form-urlencoded')) { const params = new URLSearchParams(rawBody); const result: Record<string, string> = {}; params.forEach((v, k) => { result[k] = v; }); return result; }
  return rawBody;
}

// ==================== CORS ====================

export interface CorsOptions { origin?: string | string[] | ((origin: string) => boolean); methods?: string[]; allowedHeaders?: string[]; exposedHeaders?: string[]; credentials?: boolean; maxAge?: number; }

function getCorsHeaders(options: CorsOptions, requestOrigin?: string): Record<string, string> {
  const headers: Record<string, string> = {}; const origin = options.origin || '*'; let allowOrigin = '*';
  if (origin === '*') allowOrigin = '*';
  else if (typeof origin === 'string') allowOrigin = origin;
  else if (Array.isArray(origin)) { if (requestOrigin && origin.includes(requestOrigin)) allowOrigin = requestOrigin; }
  else if (typeof origin === 'function') { if (requestOrigin && origin(requestOrigin)) allowOrigin = requestOrigin; }
  headers['Access-Control-Allow-Origin'] = allowOrigin;
  headers['Access-Control-Allow-Methods'] = (options.methods || ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']).join(', ');
  headers['Access-Control-Allow-Headers'] = (options.allowedHeaders || ['Content-Type', 'Authorization']).join(', ');
  if (options.exposedHeaders) headers['Access-Control-Expose-Headers'] = options.exposedHeaders.join(', ');
  if (options.credentials) headers['Access-Control-Allow-Credentials'] = 'true';
  if (options.maxAge) headers['Access-Control-Max-Age'] = String(options.maxAge);
  return headers;
}

// ==================== Cookies ====================

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const [key, ...rest] = pair.split('=');
    if (key) cookies[key.trim()] = decodeURIComponent(rest.join('=').trim());
  }
  return cookies;
}

// ==================== Security Headers ====================

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-DNS-Prefetch-Control': 'on',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

// ==================== Rate Limiter ====================

export interface RateLimitOptions { max?: number; window?: number; message?: string; keyGenerator?: (req: IncomingMessage) => string; }

class RateLimiter {
  private hits: Map<string, { count: number; resetTime: number }> = new Map();
  private options: Required<RateLimitOptions>;

  constructor(options: RateLimitOptions = {}) {
    this.options = {
      max: options.max || 100,
      window: options.window || 60000,
      message: options.message || 'Too many requests',
      keyGenerator: options.keyGenerator || ((req) => req.socket.remoteAddress || '127.0.0.1'),
    };
  }

  check(req: IncomingMessage): { allowed: boolean; remaining: number; resetTime: number } {
    const key = this.options.keyGenerator(req);
    const now = Date.now();
    const hit = this.hits.get(key);

    if (!hit || now > hit.resetTime) {
      this.hits.set(key, { count: 1, resetTime: now + this.options.window });
      return { allowed: true, remaining: this.options.max - 1, resetTime: now + this.options.window };
    }

    if (hit.count >= this.options.max) {
      return { allowed: false, remaining: 0, resetTime: hit.resetTime };
    }

    hit.count++;
    return { allowed: true, remaining: this.options.max - hit.count, resetTime: hit.resetTime };
  }
}

// ==================== WebSocket ====================

class WebSocketConnectionImpl implements IWebSocketConnection {
  id: string;
  private ws: WebSocket;
  private req: IncomingMessage;

  constructor(ws: WebSocket, req: IncomingMessage) {
    this.id = randomUUID();
    this.ws = ws;
    this.req = req;
  }

  send(data: string | Buffer): void { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data); }
  close(code?: number, reason?: string): void { this.ws.close(code, reason); }
  on(event: string, handler: (...args: any[]) => void): void { this.ws.on(event as any, handler as any); }

  get remoteAddress(): string { return this.req.socket.remoteAddress || '127.0.0.1'; }
  get request(): IncomingMessage { return this.req; }
}

// ==================== Static Files ====================

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.txt': 'text/plain', '.pdf': 'application/pdf',
};

export interface StaticFilesOptions { root: string; prefix?: string; index?: string; fallthrough?: boolean; }

function serveStatic(options: StaticFilesOptions) {
  const { root, prefix = '/', index = 'index.html', fallthrough = true } = options;
  return async (ctx: TlevorContext) => {
    let filePath = ctx.req.path;
    if (prefix !== '/' && filePath.startsWith(prefix)) filePath = filePath.slice(prefix.length) || '/';
    if (filePath === '/') filePath = `/${index}`;
    const fullPath = resolve(root, filePath.slice(1));
    if (!fullPath.startsWith(root)) { if (!fallthrough) ctx.res.status(403).json({ error: 'Forbidden' }); return false; }
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) { if (!fallthrough) ctx.res.status(404).json({ error: 'Not Found' }); return false; }
    const ext = extname(fullPath); const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = readFileSync(fullPath);
    ctx.res.header('Content-Type', contentType).header('Content-Length', String(content.length)).send(content);
    return false;
  };
}

// ==================== Validation ====================

// Core re-uses the shared @tlevor/validation engine instead of a duplicate implementation.
export type { ValidationSchema } from '@tlevor/types';

const _validator = createValidator();

function validateData(data: any, schema: ValidationSchema): { valid: boolean; errors: string[] } {
  return _validator.validate(data, schema);
}

// ==================== Serialization ====================

function serialize(data: any, schema?: ValidationSchema): any {
  if (!schema) return data;
  return _validator.serialize(data, schema);
}

// ==================== Request/Response ====================

class TlevorRequestImpl<Body = any, Query = any, Params = any> implements TlevorRequest<Body, Query, Params> {
  raw: IncomingMessage; method: HTTPMethod; url: string; path: string; headers: IncomingMessage['headers'];
  params: Params; body: Body;
  private _query: Query | undefined;
  private _cookies: Record<string, string> | undefined;
  private _parsedCookies: boolean = false;
  private _parsedQuery: boolean = false;

  constructor(raw: IncomingMessage, url: string, path: string, params: Params, query: Query) {
    this.raw = raw; this.method = raw.method as HTTPMethod; this.url = url; this.path = path;
    this.headers = raw.headers; this.params = params; this._query = query; this.body = {} as Body;
  }

  get ip(): string { return this.raw.socket.remoteAddress || '127.0.0.1'; }

  get query(): Query {
    if (!this._parsedQuery) { this._parsedQuery = true; if (!this._query) this._query = parseQuery(this.url) as Query; }
    return this._query!;
  }

  get cookies(): Record<string, string> {
    if (!this._parsedCookies) { this._parsedCookies = true; this._cookies = parseCookies(this.raw.headers.cookie); }
    return this._cookies!;
  }

  set query(v: Query) { this._query = v; this._parsedQuery = true; }
  set cookies(v: Record<string, string>) { this._cookies = v; this._parsedCookies = true; }
}

class TlevorResponseImpl implements TlevorResponse {
  raw: ServerResponse; statusCode: number = 200; headersSent: boolean = false;

  constructor(raw: ServerResponse) { this.raw = raw; }

  status(code: number): this { this.statusCode = code; this.raw.statusCode = code; return this; }
  header(name: string, value: string | string[]): this { if (!this.headersSent) this.raw.setHeader(name, value); return this; }
  send(payload: any): void { if (this.headersSent) return; this.headersSent = true; this.raw.end(payload); }
  json(payload: any): void { if (this.headersSent) return; this.headersSent = true; this.raw.setHeader('Content-Type', 'application/json'); this.raw.end(JSON.stringify(payload)); }
  text(payload: string): void { if (this.headersSent) return; this.headersSent = true; this.raw.setHeader('Content-Type', 'text/plain'); this.raw.end(payload); }
  redirect(url: string, code: number = 302): void { if (this.headersSent) return; this.headersSent = true; this.raw.writeHead(code, { Location: url }); this.raw.end(); }

  cookie(name: string, value: string, options?: { httpOnly?: boolean; secure?: boolean; maxAge?: number; path?: string; sameSite?: 'strict' | 'lax' | 'none' }): this {
    if (this.headersSent) return this;
    let cookieStr = `${name}=${encodeURIComponent(value)}`;
    if (options?.httpOnly) cookieStr += '; HttpOnly';
    if (options?.secure) cookieStr += '; Secure';
    if (options?.maxAge) cookieStr += `; Max-Age=${options.maxAge}`;
    if (options?.path) cookieStr += `; Path=${options.path}`;
    if (options?.sameSite) cookieStr += `; SameSite=${options.sameSite}`;
    const existing = this.raw.getHeader('Set-Cookie');
    if (existing) { const cookies = Array.isArray(existing) ? existing.map(String) : [String(existing)]; this.raw.setHeader('Set-Cookie', [...cookies, cookieStr]); }
    else this.raw.setHeader('Set-Cookie', cookieStr);
    return this;
  }

  clearCookie(name: string): this { return this.cookie(name, '', { maxAge: 0 }); }
}

// ==================== Query Parser ====================

function parseQuery(url: string): Record<string, string> {
  const qi = url.indexOf('?'); if (qi === -1) return {};
  const query: Record<string, string> = {};
  const pairs = url.slice(qi + 1).split('&');
  for (let i = 0; i < pairs.length; i++) { const pair = pairs[i]; const eq = pair.indexOf('='); if (eq > 0) query[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1)); else if (pair) query[decodeURIComponent(pair)] = ''; }
  return query;
}

// ==================== Body Method Check ====================

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// ==================== App ====================

export interface TlevorAppOptions {
  logger?: LoggerInterface;
  cors?: CorsOptions | boolean;
  bodyParser?: BodyParserOptions | boolean;
  security?: boolean;
  trustProxy?: boolean;
}

export interface RouteConfig extends RouteOptions {
  schema?: { body?: ValidationSchema; query?: ValidationSchema; params?: ValidationSchema; response?: ValidationSchema };
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
  private securityHeaders: boolean;
  private rateLimiter: RateLimiter | null = null;
  private routeSchemas: Map<any, any> = new Map();
  private routeHooks: Map<any, Partial<TlevorHooks>> = new Map();
  private wsHandlers: Map<string, IWebSocketHandler> = new Map();
  private wss: WebSocketServer | null = null;
  private wsConnections: Map<string, WebSocketConnectionImpl> = new Map();

  constructor(options: TlevorAppOptions = {}) {
    this.router = new Router();
    this.hooks = { onRequest: [], preParsing: [], preValidation: [], preHandler: [], postHandler: [], onResponse: [] };
    this.plugins = []; this.options = options;
    this.logger = options.logger || new DefaultLogger();
    this.corsOptions = options.cors === false ? false : (options.cors === true ? {} : options.cors || {});
    this.bodyParserOptions = options.bodyParser === false ? false : (options.bodyParser === true ? {} : options.bodyParser || {});
    this.securityHeaders = options.security === true;
  }

  addRoute(options: RouteConfig): void {
    const { method, path, handler, schema, hooks } = options;
    this.router.addRoute(method, path, handler);
    if (schema) this.routeSchemas.set(handler, schema);
    if (hooks) this.routeHooks.set(handler, normalizeHooks(hooks));
  }

  addHook(name: HookName, handler: HookHandler): void {
    if (!this.hooks[name]) throw new Error(`Unknown hook: ${name}`);
    this.hooks[name].push(handler);
  }

  use(middleware: HookHandler): void { this.hooks.onRequest.push(middleware); }

  registerPlugin(plugin: PluginHandler, opts: any = {}): void { this.plugins.push({ handler: plugin, opts }); plugin(this, opts); }

  rateLimit(options: RateLimitOptions): void { this.rateLimiter = new RateLimiter(options); }

  ws(path: string, handler: IWebSocketHandler): void { this.wsHandlers.set(path, handler); }

  async inject(opts: { method: HTTPMethod; url: string; headers?: Record<string, string>; body?: any; query?: Record<string, string> }): Promise<{ statusCode: number; headers: Record<string, string>; body: string; json<T = any>(): T }> {
    return new Promise((resolve) => {
      const bodyStr = opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : '';
      const mockReq = {
        method: opts.method, url: opts.url,
        headers: { ...(bodyStr ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(bodyStr)) } : {}), ...opts.headers },
        socket: { remoteAddress: '127.0.0.1' },
        on: (event: string, cb: any) => { if (event === 'data' && bodyStr) setTimeout(() => cb(Buffer.from(bodyStr)), 0); if (event === 'end') setTimeout(() => cb(), bodyStr ? 10 : 0); },
        once: () => {}, emit: () => {}, removeListener: () => {}, destroy: () => {},
      } as unknown as IncomingMessage;
      let finished = false;
      const finish = (data: { statusCode: number; headers: Record<string, string>; body: string }) => { if (!finished) { finished = true; resolve({ ...data, json: <T = any>() => { try { return JSON.parse(data.body) as T; } catch { return data.body as T; } } }); } };
      const mockRes = new (class extends (Object as any) {
        statusCode = 200; headers: Record<string, string> = {}; body = ''; headersSent = false;
        setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; }
        getHeader(name: string) { return this.headers[name.toLowerCase()]; }
        end(data?: string) { if (data) this.body = data; finish({ statusCode: this.statusCode, headers: this.headers, body: this.body }); }
        writeHead(code: number, headers?: Record<string, string>) { this.statusCode = code; if (headers) for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v; }
      })();
      this.handleRequest(mockReq as IncomingMessage, mockRes as any);
    });
  }

  async listen(port: number, host: string = '0.0.0.0'): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.wss = new WebSocketServer({ server: this.server });
      this.wss.on('connection', (ws, req) => this.handleWebSocketConnection(ws, req));
      this.server.listen(port, host, () => { this.isRunning = true; this.logger.info(`Tlevor server listening on ${host}:${port}`); resolve(); });
    });
  }

  private handleWebSocketConnection(ws: WebSocket, req: IncomingMessage): void {
    const conn = new WebSocketConnectionImpl(ws, req);
    this.wsConnections.set(conn.id, conn);

    const url = req.url?.split('?')[0] || '/';
    const handler = this.wsHandlers.get(url);

    if (!handler) { ws.close(1008, 'No handler for path'); return; }

    if (handler.onConnection) handler.onConnection(conn, req);
    if (handler.onMessage) ws.on('message', (data) => handler.onMessage!(conn, data));
    if (handler.onClose) ws.on('close', (code, reason) => handler.onClose!(conn, code, reason.toString()));
    if (handler.onError) ws.on('error', (error) => handler.onError!(conn, error));

    ws.on('close', () => { this.wsConnections.delete(conn.id); });
  }

  getWebSocketConnections(): Map<string, IWebSocketConnection> { return this.wsConnections; }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.wss) { this.wss.close(); this.wss = null; }
      this.wsConnections.clear();
      if (this.server) this.server.close((err: any) => { if (err) reject(err); else { this.isRunning = false; this.server = null; this.logger.info('Tlevor server closed'); resolve(); } });
      else resolve();
    });
  }

  getServer() { return this.server; }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || '/'; const path = url.split('?')[0]; const method = (req.method || 'GET') as HTTPMethod;

    if (this.corsOptions && method === 'OPTIONS') { const origin = req.headers['origin']; res.writeHead(204, getCorsHeaders(this.corsOptions, origin)); res.end(); return; }

    const match = this.router.findRouteByMethod(method, path);
    if (!match) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not Found', statusCode: 404 })); return; }

    if (this.corsOptions) { const origin = req.headers['origin']; const ch = getCorsHeaders(this.corsOptions, origin); for (const [k, v] of Object.entries(ch)) res.setHeader(k, v); }
    if (this.securityHeaders) { for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v); }

    if (this.rateLimiter) {
      const result = this.rateLimiter.check(req);
      res.setHeader('X-RateLimit-Limit', String(this.rateLimiter['options'].max));
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetTime / 1000)));
      if (!result.allowed) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Too many requests', statusCode: 429 })); return; }
    }

    const ctx: TlevorContext = { req: new TlevorRequestImpl(req, url, path, match.params, undefined) as any, res: new TlevorResponseImpl(res), state: {}, logger: this.logger };

    try {
      if (this.bodyParserOptions && BODY_METHODS.has(method)) {
        const bodyPromise = parseBody(req, this.bodyParserOptions);
        if (bodyPromise != null && typeof (bodyPromise as any).then === 'function') {
          (bodyPromise as any).then(
            (body: any) => { (ctx.req as any).body = body; this._dispatchHandler(ctx, res, match); },
            (error: any) => {
              if (error instanceof TlevorError) { ctx.res.status(error.statusCode).json({ error: error.message, code: error.code, statusCode: error.statusCode }); return; }
              this.handleError(error, ctx);
            }
          );
          return;
        }
      }

      this._dispatchHandler(ctx, res, match);
    } catch (error) { this.handleError(error, ctx); }
  }

  private _dispatchHandler(ctx: TlevorContext, res: ServerResponse, match: { handler: HookHandler; method: HTTPMethod; params: Record<string, string> }): void {
    try {
      // Global hooks run first, then any route-scoped hooks.
      const onReq = this.mergedHooks(match.handler, 'onRequest');
      const preP = this.mergedHooks(match.handler, 'preParsing');
      if (onReq.length > 0 || preP.length > 0) {
        this._runHooksChain(onReq, ctx, 0, () => {
          this._runHooksChain(preP, ctx, 0, () => { this._runHandler(ctx, res, match); });
        });
        return;
      }
      this._runHandler(ctx, res, match);
    } catch (error) { this.handleError(error, ctx); }
  }

  /** Concatenate the global hook list with the route-scoped one (global first). */
  private mergedHooks(handler: HookHandler, name: HookName): HookHandler[] {
    const global = this.hooks[name];
    const route = this.routeHooks.get(handler)?.[name];
    if (!route || route.length === 0) return global;
    return global.concat(route);
  }

  private _runHandler(ctx: TlevorContext, res: ServerResponse, match: { handler: HookHandler; method: HTTPMethod; params: Record<string, string> }): void {
    try {
      const schema = this.routeSchemas.get(match.handler);

      if (schema?.body) { const { valid, errors } = validateData(ctx.req.body, schema.body); if (!valid) { ctx.res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', statusCode: 400, details: errors }); return; } }
      if (schema?.query) { const { valid, errors } = validateData(ctx.req.query, schema.query); if (!valid) { ctx.res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', statusCode: 400, details: errors }); return; } }
      if (schema?.params) { const { valid, errors } = validateData(ctx.req.params, schema.params); if (!valid) { ctx.res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', statusCode: 400, details: errors }); return; } }

      const preV = this.mergedHooks(match.handler, 'preValidation');
      const preH = this.mergedHooks(match.handler, 'preHandler');
      if (preV.length > 0 || preH.length > 0) {
        this._runHooksChain(preV, ctx, 0, () => {
          this._runHooksChain(preH, ctx, 0, () => { this._callHandler(ctx, res, match); });
        });
        return;
      }

      this._callHandler(ctx, res, match);
    } catch (error) { this.handleError(error, ctx); }
  }

  private _callHandler(ctx: TlevorContext, res: ServerResponse, match: { handler: HookHandler; method: HTTPMethod; params: Record<string, string> }): void {
    try {
      const result = match.handler(ctx);

      if (result != null && typeof (result as any).then === 'function') {
        (result as any).then(
          (resolved: any) => {
            this._writeResponse(ctx, res, resolved);
            this._runPostHooks(ctx, match.handler);
          },
          (error: any) => { this.handleError(error, ctx); }
        );
      } else {
        this._writeResponse(ctx, res, result);
        this._runPostHooks(ctx, match.handler);
      }
    } catch (error) { this.handleError(error, ctx); }
  }

  private _writeResponse(ctx: TlevorContext, res: ServerResponse, result: any): void {
    if (!ctx.res.headersSent && result !== undefined) {
      if (typeof result === 'string') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(result);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      }
    }
  }

  private _runPostHooks(ctx: TlevorContext, handler?: HookHandler): void {
    const postH = this.mergedHooks(handler as HookHandler, 'postHandler');
    const onRes = this.mergedHooks(handler as HookHandler, 'onResponse');
    if (postH.length > 0 || onRes.length > 0) {
      this._runHooksChain(postH, ctx, 0, () => {
        this._runHooksChain(onRes, ctx, 0, () => {});
      });
    }
  }

  private _runHooksChain(hooks: HookHandler[], ctx: TlevorContext, index: number, done: () => void): void {
    if (index >= hooks.length) { done(); return; }
    try {
      const result = hooks[index](ctx);
      if (result != null && typeof (result as any).then === 'function') {
        (result as any).then(
          (r: any) => { if (r === false || ctx.res.headersSent) return; this._runHooksChain(hooks, ctx, index + 1, done); },
          (err: any) => { this.handleError(err, ctx); }
        );
      } else {
        if ((result as any) === false || ctx.res.headersSent) return;
        this._runHooksChain(hooks, ctx, index + 1, done);
      }
    } catch (err) { this.handleError(err, ctx); }
  }

  private handleError(error: unknown, ctx: TlevorContext): void {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err instanceof TlevorError) { this.logger.warn(err.message, { code: err.code }); if (!ctx.res.headersSent) ctx.res.status(err.statusCode).json({ error: err.message, code: err.code, statusCode: err.statusCode, details: err.details }); return; }
    this.logger.error(err.message, { stack: err.stack });
    if (!ctx.res.headersSent) ctx.res.status(500).json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR', statusCode: 500 });
  }

}

export function createApp(options?: TlevorAppOptions): TlevorApp { return new TlevorApp(options); }
export { serveStatic, RateLimiter, parseCookies, SECURITY_HEADERS as getSecurityHeaders, validateData, serialize, parseQuery };

function normalizeHooks(hooks: Partial<Record<HookName, HookHandler | HookHandler[]>>): Partial<TlevorHooks> {
  const out: Partial<TlevorHooks> = {};
  (Object.keys(hooks) as HookName[]).forEach((name) => {
    const value = hooks[name];
    out[name] = Array.isArray(value) ? value : value ? [value] : [];
  });
  return out;
}
