import type {
  TlevorRequest,
  TlevorResponse,
  TlevorContext,
  HookHandler,
  HookName,
  TlevorHooks,
  RouteOptions,
  RouteSchema,
  PluginHandler,
  PluginMetadata,
  LoggerInterface,
  HTTPMethod,
  WebSocketHandler as IWebSocketHandler,
  WebSocketConnection as IWebSocketConnection,
  ValidationSchema,
  BodyParserOptions,
  CorsOptions,
  StaticFilesOptions,
  RateLimitOptions,
  TlevorAppOptions,
  TlevorApp as ITlevorApp,
  InjectOptions,
  InjectResult,
} from '@tlevor/types';
import { PLUGIN_METADATA } from '@tlevor/types';
import { Router } from '@tlevor/router';
import { createValidator } from '@tlevor/validation';
import { IncomingMessage, ServerResponse, createServer } from 'http';
import { readFileSync, statSync, existsSync } from 'fs';
import { resolve, extname } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';

export type {
  TlevorRequest,
  TlevorResponse,
  TlevorContext,
  HookHandler,
  HookName,
  TlevorHooks,
  RouteSchema,
  ValidationSchema,
  BodyParserOptions,
  CorsOptions,
  StaticFilesOptions,
  RateLimitOptions,
  TlevorAppOptions,
  InjectOptions,
  InjectResult,
} from '@tlevor/types';

// ==================== Logger ====================

export class NoopLogger implements LoggerInterface {
  trace(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  fatal(): void {}
  child(): LoggerInterface { return this; }
}

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
  fatal(msg: string, ...args: any[]): void { console.error(`[FATAL] ${msg}`, ...args); }
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

const DEFAULT_BODY_LIMIT = 1024 * 1024;

function readBody(req: IncomingMessage, limit: number = DEFAULT_BODY_LIMIT): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { req.destroy(); reject(new PayloadTooLargeError(limit)); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

async function parseBody(req: IncomingMessage, options: BodyParserOptions = {}): Promise<any> {
  const contentType = req.headers['content-type'] || '';
  const rawBody = await readBody(req, options.jsonLimit ?? options.urlEncodedLimit ?? DEFAULT_BODY_LIMIT);
  if (!rawBody) return {};
  if (contentType.includes('application/json')) { try { return JSON.parse(rawBody); } catch { throw new ValidationError('Invalid JSON'); } }
  if (contentType.includes('application/x-www-form-urlencoded')) { const params = new URLSearchParams(rawBody); const result: Record<string, string> = {}; params.forEach((v, k) => { result[k] = v; }); return result; }
  return rawBody;
}

// ==================== CORS ====================

function getCorsHeaders(options: CorsOptions, requestOrigin?: string): Record<string, string> {
  const headers: Record<string, string> = {}; const origin = options.origin || '*'; let allowOrigin = '*';
  if (origin === '*') allowOrigin = '*';
  else if (typeof origin === 'string') allowOrigin = origin;
  else if (Array.isArray(origin)) { if (requestOrigin && origin.includes(requestOrigin)) allowOrigin = requestOrigin; }
  else if (typeof origin === 'function') { if (requestOrigin && origin(requestOrigin)) allowOrigin = requestOrigin; }
  if (options.credentials && allowOrigin === '*' && requestOrigin) allowOrigin = requestOrigin;
  headers['Access-Control-Allow-Origin'] = allowOrigin;
  headers['Access-Control-Allow-Methods'] = (options.methods || ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']).join(', ');
  headers['Access-Control-Allow-Headers'] = (options.allowedHeaders || ['Content-Type', 'Authorization']).join(', ');
  if (options.exposedHeaders) headers['Access-Control-Expose-Headers'] = options.exposedHeaders.join(', ');
  if (options.credentials) headers['Access-Control-Allow-Credentials'] = 'true';
  if (options.maxAge) headers['Access-Control-Max-Age'] = String(options.maxAge);
  return headers;
}

// ==================== Cookies ====================

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const [key, ...rest] = pair.split('=');
    if (key) cookies[key.trim()] = safeDecode(rest.join('=').trim());
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

export class RateLimiter {
  private hits: Map<string, { count: number; resetTime: number }> = new Map();
  private options: Required<RateLimitOptions>;
  private lastPrune: number = 0;

  constructor(options: RateLimitOptions = {}) {
    this.options = {
      max: options.max ?? 100,
      window: options.window ?? 60000,
      message: options.message ?? 'Too many requests',
      keyGenerator: options.keyGenerator ?? ((req) => req.socket.remoteAddress || '127.0.0.1'),
    };
  }

  get limit(): number { return this.options.max; }

  private prune(now: number): void {
    if (now - this.lastPrune < this.options.window) return;
    this.lastPrune = now;
    for (const [key, hit] of this.hits) {
      if (now > hit.resetTime) this.hits.delete(key);
    }
  }

  check(req: IncomingMessage): { allowed: boolean; remaining: number; resetTime: number } {
    const key = this.options.keyGenerator(req);
    const now = Date.now();
    this.prune(now);
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

export function serveStatic(options: StaticFilesOptions) {
  const { root, prefix = '/', index = 'index.html', fallthrough = true } = options;
  const rootPath = resolve(root);

  return (ctx: TlevorContext) => {
    let filePath = ctx.req.path;
    if (prefix !== '/' && filePath.startsWith(prefix)) filePath = filePath.slice(prefix.length) || '/';
    if (filePath === '/') filePath = `/${index}`;

    const fullPath = resolve(rootPath, '.' + filePath);
    if (fullPath !== rootPath && !fullPath.startsWith(rootPath + '/')) {
      if (!fallthrough) { ctx.res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN', statusCode: 403 }); return true; }
      return false;
    }
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      if (!fallthrough) { ctx.res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND', statusCode: 404 }); return true; }
      return false;
    }
    const ext = extname(fullPath); const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = readFileSync(fullPath);
    ctx.res.header('Content-Type', contentType).header('Content-Length', String(content.length)).send(content);
    return true;
  };
}

// ==================== Validation ====================

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
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]; const eq = pair.indexOf('=');
    if (eq > 0) query[safeDecode(pair.slice(0, eq))] = safeDecode(pair.slice(eq + 1));
    else if (pair) query[safeDecode(pair)] = '';
  }
  return query;
}

// ==================== Body Method Check ====================

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// ==================== App ====================

export interface RouteConfig extends RouteOptions {
  schema?: RouteSchema;
}

interface RouteMatch {
  handler: any;
  method: HTTPMethod;
  params: Record<string, string>;
  path: string;
}

export class TlevorApp implements ITlevorApp {
  private router: Router;
  private hooks: TlevorHooks;
  private plugins: Array<{ handler: PluginHandler; opts: any }>;
  private registeredPlugins: Set<string> = new Set();
  private logger: LoggerInterface;
  private server: any;
  private isRunning: boolean = false;
  private options: TlevorAppOptions;
  private corsOptions: CorsOptions | false;
  private bodyParserOptions: BodyParserOptions | false;
  private securityHeaders: boolean;
  private rateLimiter: RateLimiter | null = null;
  private routeSchemas: Map<string, RouteSchema> = new Map();
  private routeHooks: Map<string, Partial<TlevorHooks>> = new Map();
  private wsHandlers: Map<string, IWebSocketHandler> = new Map();
  private wss: WebSocketServer | null = null;
  private wsConnections: Map<string, WebSocketConnectionImpl> = new Map();

  constructor(options: TlevorAppOptions = {}) {
    this.router = new Router();
    this.hooks = { onRequest: [], preParsing: [], preValidation: [], preHandler: [], postHandler: [], onResponse: [] };
    this.plugins = []; this.options = options;
    this.logger = options.logger === false ? new NoopLogger() : (options.logger || new DefaultLogger());
    this.corsOptions = options.cors === false ? false : (options.cors === true ? {} : options.cors ?? false);
    this.bodyParserOptions = options.bodyParser === false ? false : (options.bodyParser === true ? {} : options.bodyParser ?? {});
    this.securityHeaders = options.security === true;
  }

  addRoute(options: RouteConfig): void {
    const { method, path, handler, schema, hooks } = options;
    const methods = Array.isArray(method) ? method : [method];
    this.router.addRoute(method, path, handler);
    const key = this.routeKey(methods[0], path);
    if (schema) this.routeSchemas.set(key, schema);
    if (hooks) this.routeHooks.set(key, normalizeHooks(hooks));
  }

  private routeKey(method: HTTPMethod, path: string): string {
    return `${method} ${this.normalizePath(path)}`;
  }

  private normalizePath(path: string): string {
    return path === '/' ? '/' : path.endsWith('/') ? path.slice(0, -1) : path;
  }

  addHook(name: HookName, handler: HookHandler): void {
    if (!this.hooks[name]) throw new Error(`Unknown hook: ${name}`);
    this.hooks[name].push(handler);
  }

  use(middleware: HookHandler): void { this.hooks.onRequest.push(middleware); }

  registerPlugin(plugin: PluginHandler, opts: any = {}): void | Promise<void> {
    const metadata: PluginMetadata | undefined = (plugin as any)[PLUGIN_METADATA];
    if (metadata?.name) {
      if (this.registeredPlugins.has(metadata.name)) throw new Error(`Plugin "${metadata.name}" already registered`);
      for (const dep of metadata.dependencies || []) {
        if (!this.registeredPlugins.has(dep)) throw new Error(`Plugin "${metadata.name}" requires plugin "${dep}" to be registered first`);
      }
    }
    this.plugins.push({ handler: plugin, opts });
    const result = plugin(this, opts);
    if (metadata?.name) this.registeredPlugins.add(metadata.name);
    return result;
  }

  rateLimit(options: RateLimitOptions): void { this.rateLimiter = new RateLimiter(options); }

  ws(path: string, handler: IWebSocketHandler): void { this.wsHandlers.set(path, handler); }

  async inject(opts: InjectOptions): Promise<InjectResult> {
    return new Promise((resolve) => {
      const url = this.buildInjectUrl(opts.url, opts.query);
      const bodyStr = opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : '';
      const mockReq = {
        method: opts.method, url,
        headers: { ...(bodyStr ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(bodyStr)) } : {}), ...opts.headers },
        socket: { remoteAddress: '127.0.0.1' },
        on: (event: string, cb: any) => { if (event === 'data' && bodyStr) setTimeout(() => cb(Buffer.from(bodyStr)), 0); if (event === 'end') setTimeout(() => cb(), bodyStr ? 10 : 0); },
        once: () => {}, emit: () => {}, removeListener: () => {}, destroy: () => {},
      } as unknown as IncomingMessage;
      let finished = false;
      const finish = (data: { statusCode: number; headers: Record<string, string | string[]>; body: string }) => { if (!finished) { finished = true; resolve({ ...data, json: <T = any>() => { try { return JSON.parse(data.body) as T; } catch { return data.body as T; } } }); } };
      const mockRes = new (class extends (Object as any) {
        statusCode = 200; headers: Record<string, string | string[]> = {}; body = ''; headersSent = false;
        setHeader(name: string, value: string | string[]) { this.headers[name.toLowerCase()] = value; }
        getHeader(name: string) { return this.headers[name.toLowerCase()]; }
        end(data?: any) { if (data) this.body = typeof data === 'string' ? data : data.toString(); finish({ statusCode: this.statusCode, headers: this.headers, body: this.body }); }
        writeHead(code: number, headers?: Record<string, string>) { this.statusCode = code; if (headers) for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v; }
      })();
      this.handleRequest(mockReq as IncomingMessage, mockRes as any);
    });
  }

  private buildInjectUrl(url: string, query?: Record<string, string>): string {
    if (!query) return url;
    const qs = new URLSearchParams(query).toString();
    if (!qs) return url;
    return url + (url.includes('?') ? '&' : '?') + qs;
  }

  async listen(port: number, host: string = '0.0.0.0'): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handleRequest(req, res));
      const onError = (err: Error) => {
        server.removeListener('listening', onListening);
        if (this.server === server) this.server = null;
        if (this.wss) { this.wss.close(); this.wss = null; }
        reject(err);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        this.isRunning = true;
        this.logger.info(`Tlevor server listening on ${host}:${port}`);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      this.server = server;
      this.wss = new WebSocketServer({ server });
      this.wss.on('connection', (ws, req) => this.handleWebSocketConnection(ws, req));
      server.listen(port, host);
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
      for (const conn of this.wsConnections.values()) {
        try { conn.close(1001, 'Server shutting down'); } catch { /* ignore */ }
      }
      this.wsConnections.clear();
      if (this.wss) { this.wss.close(); this.wss = null; }
      if (this.server) this.server.close((err: any) => { if (err) reject(err); else { this.isRunning = false; this.server = null; this.logger.info('Tlevor server closed'); resolve(); } });
      else resolve();
    });
  }

  getServer() { return this.server; }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || '/'; const path = url.split('?')[0]; const method = (req.method || 'GET') as HTTPMethod;

    if (this.corsOptions && method === 'OPTIONS') {
      const origin = req.headers['origin'];
      res.writeHead(204, getCorsHeaders(this.corsOptions, origin));
      res.end();
      return;
    }

    if (this.corsOptions) { const origin = req.headers['origin']; const ch = getCorsHeaders(this.corsOptions, origin); for (const [k, v] of Object.entries(ch)) res.setHeader(k, v); }
    if (this.securityHeaders) { for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v); }

    if (this.rateLimiter) {
      const result = this.rateLimiter.check(req);
      res.setHeader('X-RateLimit-Limit', String(this.rateLimiter.limit));
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetTime / 1000)));
      if (!result.allowed) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Too many requests', statusCode: 429 })); return; }
    }

    const match = this.router.findRouteByMethod(method, path);
    if (!match) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not Found', statusCode: 404 })); return; }

    const ctx: TlevorContext = {
      req: new TlevorRequestImpl(req, url, path, match.params, undefined),
      res: new TlevorResponseImpl(res),
      state: {},
      logger: this.logger,
    };
    const routeMatch: RouteMatch = { handler: match.handler, method: match.method, params: match.params, path: match.path || this.normalizePath(path) };

    this._runPipeline(ctx, res, routeMatch).catch((error) => this.handleError(error, ctx));
  }

  private async _runPipeline(ctx: TlevorContext, res: ServerResponse, match: RouteMatch): Promise<void> {
    try {
      const onReq = await this._runHooksChain(this.mergedHooks(match, 'onRequest'), ctx);
      if (!onReq) return;
      const preP = await this._runHooksChain(this.mergedHooks(match, 'preParsing'), ctx);
      if (!preP) return;

      if (this.bodyParserOptions && BODY_METHODS.has(match.method)) {
        ctx.req.body = await parseBody(ctx.req.raw, this.bodyParserOptions);
      }

      const preV = await this._runHooksChain(this.mergedHooks(match, 'preValidation'), ctx);
      if (!preV) return;

      const schema = this.getRouteSchema(match);
      if (schema?.body && !this.assertValid(ctx.req.body, schema.body, ctx)) return;
      if (schema?.query && !this.assertValid(ctx.req.query, schema.query, ctx)) return;
      if (schema?.params && !this.assertValid(ctx.req.params, schema.params, ctx)) return;

      const preH = await this._runHooksChain(this.mergedHooks(match, 'preHandler'), ctx);
      if (!preH) return;

      let result = await match.handler(ctx);

      if (schema?.response) {
        const { valid, errors } = validateData(result, schema.response);
        if (!valid) throw new TlevorError('Response validation failed', 500, 'RESPONSE_VALIDATION_ERROR', errors);
        result = serialize(result, schema.response);
      }

      this._writeResponse(ctx, result);

      await this._runHooksChain(this.mergedHooks(match, 'postHandler'), ctx);
    } catch (error) {
      this.handleError(error, ctx);
    } finally {
      await this._runHooksChain(this.mergedHooks(match, 'onResponse'), ctx);
    }
  }

  private getRouteSchema(match: RouteMatch): RouteSchema | undefined {
    return this.routeSchemas.get(this.routeKey(match.method, match.path));
  }

  private assertValid(data: any, schema: ValidationSchema, ctx: TlevorContext): boolean {
    const { valid, errors } = validateData(data, schema);
    if (valid) return true;
    ctx.res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', statusCode: 400, details: errors });
    return false;
  }

  /** Concatenate the global hook list with the route-scoped one (global first). */
  private mergedHooks(match: RouteMatch, name: HookName): HookHandler[] {
    const global = this.hooks[name];
    const route = this.routeHooks.get(this.routeKey(match.method, match.path))?.[name];
    if (!route || route.length === 0) return global;
    return global.concat(route);
  }

  private _writeResponse(ctx: TlevorContext, result: any): void {
    if (ctx.res.headersSent) return;
    const raw = ctx.res.raw;

    // Sentinel: the route declared it did not handle the request — fall through to a 404.
    if (result === false) {
      raw.writeHead(404, { 'Content-Type': 'application/json' });
      raw.end(JSON.stringify({ error: 'Not Found', statusCode: 404 }));
      return;
    }

    if (result !== undefined) {
      if (typeof result === 'string') {
        raw.writeHead(ctx.res.statusCode, { 'Content-Type': 'text/plain' });
        raw.end(result);
      } else {
        raw.writeHead(ctx.res.statusCode, { 'Content-Type': 'application/json' });
        raw.end(JSON.stringify(result));
      }
      return;
    }

    // Handler wrote nothing and returned nothing: end the response so the
    // connection never hangs (e.g. a 204 No Content handler).
    raw.writeHead(ctx.res.statusCode);
    raw.end();
  }

  /**
   * Runs a chain of hooks.
   *
   * A hook that returns `false` signals "I did not complete the request — fall
   * through to the next hook/handler". A hook that has written a response
   * (`ctx.res.headersSent === true`) halts the chain. Returns `true` when the
   * chain should continue, `false` when it was halted.
   */
  private async _runHooksChain(hooks: HookHandler[], ctx: TlevorContext): Promise<boolean> {
    for (const hook of hooks) {
      await hook(ctx);
      if (ctx.res.headersSent) return false;
    }
    return true;
  }

  private handleError(error: unknown, ctx: TlevorContext): void {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err instanceof TlevorError) {
      this.logger.warn(err.message, { code: err.code });
      if (!ctx.res.headersSent) ctx.res.status(err.statusCode).json({ error: err.message, code: err.code, statusCode: err.statusCode, details: err.details });
      return;
    }
    this.logger.error(err.message, { stack: err.stack });
    if (!ctx.res.headersSent) ctx.res.status(500).json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR', statusCode: 500 });
  }
}

export function createApp(options?: TlevorAppOptions): TlevorApp { return new TlevorApp(options); }
export { parseCookies, SECURITY_HEADERS as securityHeaders, SECURITY_HEADERS as getSecurityHeaders, validateData, serialize, parseQuery };

function normalizeHooks(hooks: Partial<Record<HookName, HookHandler | HookHandler[]>>): Partial<TlevorHooks> {
  const out: Partial<TlevorHooks> = {};
  (Object.keys(hooks) as HookName[]).forEach((name) => {
    const value = hooks[name];
    out[name] = Array.isArray(value) ? value : value ? [value] : [];
  });
  return out;
}
