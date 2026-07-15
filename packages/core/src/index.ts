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

export class TlevorApp {
  private router: Router;
  private hooks: TlevorHooks;
  private plugins: Array<{ handler: PluginHandler; opts: any }>;
  private logger: LoggerInterface;
  private server: any;
  private isRunning: boolean = false;

  constructor() {
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
    this.logger = new DefaultLogger();
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

  async inject(opts: { method: HTTPMethod; url: string; headers?: Record<string, string>; body?: any; query?: Record<string, string> }): Promise<{ statusCode: number; headers: Record<string, string>; body: string; json<T = any>(): T }> {
    return new Promise((resolve) => {
      const mockReq = {
        method: opts.method,
        url: opts.url,
        headers: opts.headers || {},
        socket: { remoteAddress: '127.0.0.1' },
        on: () => {},
        once: () => {},
        emit: () => {},
        removeListener: () => {},
      } as unknown as IncomingMessage;

      const mockRes = new (class extends (Object as any) {
        statusCode = 200;
        headers: Record<string, string> = {};
        body = '';
        headersSent = false;
        setHeader(name: string, value: string) {
          this.headers[name] = value;
        }
        getHeader(name: string) {
          return this.headers[name];
        }
        end(data?: string) {
          if (data) this.body = data;
        }
        writeHead(code: number, headers?: Record<string, string>) {
          this.statusCode = code;
          if (headers) Object.assign(this.headers, headers);
        }
      })();

      this.handleRequest(mockReq as IncomingMessage, mockRes as any).then(() => {
        resolve({
          statusCode: mockRes.statusCode,
          headers: mockRes.headers,
          body: mockRes.body,
          json: <T = any>() => JSON.parse(mockRes.body) as T,
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

    const match = this.router.findRoute(method, path);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    const query = this.parseQuery(url);
    const ctx: TlevorContext = {
      req: new TlevorRequestImpl(req, url, path, match.params, query),
      res: new TlevorResponseImpl(res),
      state: {},
      logger: this.logger,
    };

    try {
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
    this.logger.error(err.message, { stack: err.stack });

    if (!ctx.res.headersSent) {
      ctx.res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  private parseQuery(url: string): Record<string, string> {
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) return {};

    const queryString = url.slice(queryIndex + 1);
    const query: Record<string, string> = {};

    for (const pair of queryString.split('&')) {
      const [key, value] = pair.split('=');
      query[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }

    return query;
  }
}

export function createApp(): TlevorApp {
  return new TlevorApp();
}
