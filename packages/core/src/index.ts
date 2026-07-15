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
} from '@tlevor/types';
import { Router } from '@tlevor/router';
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

export interface ValidationSchema { type?: string; properties?: Record<string, any>; required?: string[]; [key: string]: any; }

function validateData(data: any, schema: ValidationSchema): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (schema.required) { for (const field of schema.required) { if (data[field] === undefined || data[field] === null) errors.push(`"${field}" is required`); } }
  if (schema.properties) { for (const [key, propSchema] of Object.entries(schema.properties)) { const value = data[key]; if (value === undefined || value === null) continue; if (propSchema.type === 'string' && typeof value !== 'string') errors.push(`"${key}" must be a string`); if (propSchema.type === 'number' && typeof value !== 'number') errors.push(`"${key}" must be a number`); if (propSchema.type === 'boolean' && typeof value !== 'boolean') errors.push(`"${key}" must be a boolean`); if (propSchema.minLength && typeof value === 'string' && value.length < propSchema.minLength) errors.push(`"${key}" must be at least ${propSchema.minLength} characters`); if (propSchema.maxLength && typeof value === 'string' && value.length > propSchema.maxLength) errors.push(`"${key}" must be at most ${propSchema.maxLength} characters`); if (propSchema.minimum && typeof value === 'number' && value < propSchema.minimum) errors.push(`"${key}" must be at least ${propSchema.minimum}`); if (propSchema.maximum && typeof value === 'number' && value > propSchema.maximum) errors.push(`"${key}" must be at most ${propSchema.maximum}`); if (propSchema.enum && !propSchema.enum.includes(value)) errors.push(`"${key}" must be one of: ${propSchema.enum.join(', ')}`); } }
  return { valid: errors.length === 0, errors };
}

// ==================== Serialization ====================

function serialize(data: any, schema?: ValidationSchema): any {
  if (!schema || !schema.properties) return data;
  const result: any = {};
  for (const key of Object.keys(schema.properties)) { if (key in data) result[key] = data[key]; }
  return result;
}

// ==================== Request/Response ====================

class TlevorRequestImpl<Body = any, Query = any, Params = any> implements TlevorRequest<Body, Query, Params> {
  raw: IncomingMessage; method: HTTPMethod; url: string; path: string; headers: IncomingMessage['headers'];
  params: Params; body: Body; ip: string;
  private _query: Query | undefined;
  private _cookies: Record<string, string> | undefined;
  private _parsedCookies: boolean = false;
  private _parsedQuery: boolean = false;

  constructor(raw: IncomingMessage, url: string, path: string, params: Params, query: Query) {
    this.raw = raw; this.method = raw.method as HTTPMethod; this.url = url; this.path = path;
    this.headers = raw.headers; this.params = params; this._query = query; this.body = {} as Body;
    this.ip = raw.socket.remoteAddress || '127.0.0.1';
  }

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
  private routeSchemas: Map<string, any> = new Map();
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
    const { method, path, handler, schema } = options;
    this.router.addRoute(method, path, handler);
    if (schema) this.routeSchemas.set(`${Array.isArray(method) ? method.join(',') : method}:${path}`, schema);
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
      const mockRes = new (class extends (Object as any) {
        statusCode = 200; headers: Record<string, string> = {}; body = ''; headersSent = false;
        setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; }
        getHeader(name: string) { return this.headers[name.toLowerCase()]; }
        end(data?: string) { if (data) this.body = data; }
        writeHead(code: number, headers?: Record<string, string>) { this.statusCode = code; if (headers) for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v; }
      })();
      this.handleRequest(mockReq as IncomingMessage, mockRes as any).then(() => {
        resolve({ statusCode: mockRes.statusCode, headers: mockRes.headers, body: mockRes.body, json: <T = any>() => { try { return JSON.parse(mockRes.body) as T; } catch { return mockRes.body as T; } } });
      });
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

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
      if (this.bodyParserOptions && ['POST', 'PUT', 'PATCH'].includes(method)) {
        try { (ctx.req as any).body = await parseBody(req, this.bodyParserOptions); } catch (error) {
          if (error instanceof TlevorError) { ctx.res.status(error.statusCode).json({ error: error.message, code: error.code, statusCode: error.statusCode }); return; }
          throw error;
        }
      }

      const schemaKey = `${method}:${path}`;
      const schema = this.routeSchemas.get(schemaKey);

      const onReq = this.hooks.onRequest;
      const preP = this.hooks.preParsing;
      const preV = this.hooks.preValidation;
      const preH = this.hooks.preHandler;

      if (onReq.length > 0) { for (let i = 0; i < onReq.length; i++) { const r = await onReq[i](ctx); if (r === false || ctx.res.headersSent) return; } }
      if (preP.length > 0) { for (let i = 0; i < preP.length; i++) { const r = await preP[i](ctx); if (r === false || ctx.res.headersSent) return; } }

      if (schema?.body) { const { valid, errors } = validateData(ctx.req.body, schema.body); if (!valid) { ctx.res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', statusCode: 400, details: errors }); return; } }
      if (schema?.query) { const { valid, errors } = validateData(ctx.req.query, schema.query); if (!valid) { ctx.res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', statusCode: 400, details: errors }); return; } }
      if (schema?.params) { const { valid, errors } = validateData(ctx.req.params, schema.params); if (!valid) { ctx.res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', statusCode: 400, details: errors }); return; } }

      if (preV.length > 0) { for (let i = 0; i < preV.length; i++) { const r = await preV[i](ctx); if (r === false || ctx.res.headersSent) return; } }
      if (preH.length > 0) { for (let i = 0; i < preH.length; i++) { const r = await preH[i](ctx); if (r === false || ctx.res.headersSent) return; } }

      const result = await match.handler(ctx);
      if (!ctx.res.headersSent && result !== undefined) {
        if (typeof result === 'string') { res.setHeader('Content-Type', 'text/plain'); res.end(result); }
        else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); }
      }

      const postH = this.hooks.postHandler;
      const onRes = this.hooks.onResponse;
      if (postH.length > 0) { for (let i = 0; i < postH.length; i++) await postH[i](ctx); }
      if (onRes.length > 0) { for (let i = 0; i < onRes.length; i++) await onRes[i](ctx); }
    } catch (error) { this.handleError(error, ctx); }
  }

  private handleError(error: unknown, ctx: TlevorContext): void {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err instanceof TlevorError) { this.logger.warn(err.message, { code: err.code }); if (!ctx.res.headersSent) ctx.res.status(err.statusCode).json({ error: err.message, code: err.code, statusCode: err.statusCode, details: err.details }); return; }
    this.logger.error(err.message, { stack: err.stack });
    if (!ctx.res.headersSent) ctx.res.status(500).json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR', statusCode: 500 });
  }

  private parseQuery(url: string): Record<string, string> {
    const qi = url.indexOf('?'); if (qi === -1) return {};
    const query: Record<string, string> = {};
    const pairs = url.slice(qi + 1).split('&');
    for (let i = 0; i < pairs.length; i++) { const pair = pairs[i]; const eq = pair.indexOf('='); if (eq > 0) query[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1)); else if (pair) query[decodeURIComponent(pair)] = ''; }
    return query;
  }
}

export function createApp(options?: TlevorAppOptions): TlevorApp { return new TlevorApp(options); }
export { serveStatic, RateLimiter, parseCookies, SECURITY_HEADERS as getSecurityHeaders, validateData, serialize, parseQuery };
