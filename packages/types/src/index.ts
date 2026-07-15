import { IncomingMessage, ServerResponse } from 'http';

export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export interface TlevorRequest<Body = any, Query = any, Params = any> {
  raw: IncomingMessage;
  method: HTTPMethod;
  url: string;
  path: string;
  headers: IncomingMessage['headers'];
  params: Params;
  query: Query;
  body: Body;
  ip: string;
  cookies: Record<string, string>;
}

export interface TlevorResponse {
  raw: ServerResponse;
  statusCode: number;
  headersSent: boolean;
  status(code: number): this;
  header(name: string, value: string | string[]): this;
  send(payload: any): void;
  json(payload: any): void;
  text(payload: string): void;
  redirect(url: string, code?: number): void;
  cookie(name: string, value: string, options?: { httpOnly?: boolean; secure?: boolean; maxAge?: number; path?: string; sameSite?: 'strict' | 'lax' | 'none' }): this;
  clearCookie(name: string): this;
}

export interface TlevorContext<Body = any, Query = any, Params = any, State = Record<string, any>> {
  req: TlevorRequest<Body, Query, Params>;
  res: TlevorResponse;
  state: State;
  logger: LoggerInterface;
}

export interface LoggerInterface {
  trace(msg: string, ...args: any[]): void;
  debug(msg: string, ...args: any[]): void;
  info(msg: string, ...args: any[]): void;
  warn(msg: string, ...args: any[]): void;
  error(msg: string, ...args: any[]): void;
  fatal(msg: string, ...args: any[]): void;
  child(bindings: Record<string, any>): LoggerInterface;
}

export type HookHandler<TContext extends TlevorContext = TlevorContext> = (
  ctx: TContext
) => void | Promise<void | boolean>;

export interface TlevorHooks<TContext extends TlevorContext = TlevorContext> {
  onRequest: HookHandler<TContext>[];
  preParsing: HookHandler<TContext>[];
  preValidation: HookHandler<TContext>[];
  preHandler: HookHandler<TContext>[];
  postHandler: HookHandler<TContext>[];
  onResponse: HookHandler<TContext>[];
}

export type HookName = keyof TlevorHooks;

export type RouteHandler<
  Body = any,
  Query = any,
  Params = any,
  State = Record<string, any>,
  TContext extends TlevorContext<Body, Query, Params, State> = TlevorContext<Body, Query, Params, State>
> = (ctx: TContext) => any | Promise<any>;

export interface ValidationSchema {
  type?: string;
  properties?: Record<string, any>;
  required?: string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: any[];
  [key: string]: any;
}

export interface RouteSchema {
  body?: ValidationSchema;
  query?: ValidationSchema;
  params?: ValidationSchema;
  response?: ValidationSchema;
}

export interface RouteOptions {
  method: HTTPMethod | HTTPMethod[];
  path: string;
  schema?: RouteSchema;
  handler: RouteHandler;
  hooks?: Partial<Record<HookName, HookHandler | HookHandler[]>>;
}

export type PluginHandler<Options = any> = (
  app: TlevorApp,
  opts: Options
) => void | Promise<void>;

export interface PluginMetadata {
  name: string;
  dependencies?: string[];
}

export interface RateLimitOptions {
  max?: number;
  window?: number;
  message?: string;
}

export interface WebSocketOptions {
  path?: string;
}

export interface WebSocketConnection {
  id: string;
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
  on(event: string, handler: (...args: any[]) => void): void;
  readonly remoteAddress: string;
  readonly request: IncomingMessage;
}

export interface WebSocketHandler {
  onConnection?: (conn: WebSocketConnection, req: IncomingMessage) => void;
  onMessage?: (conn: WebSocketConnection, data: any) => void;
  onClose?: (conn: WebSocketConnection, code: number, reason: string) => void;
  onError?: (conn: WebSocketConnection, error: Error) => void;
}

export interface TlevorApp {
  addRoute(options: RouteOptions): void;
  addHook(name: HookName, handler: HookHandler): void;
  use(middleware: HookHandler): void;
  registerPlugin(plugin: PluginHandler, opts?: any): void;
  rateLimit(options: RateLimitOptions): void;
  ws(path: string, handler: WebSocketHandler): void;
  inject(opts: InjectOptions): Promise<InjectResult>;
  listen(port: number, host?: string): Promise<void>;
  close(): Promise<void>;
}

export interface InjectOptions {
  method: HTTPMethod;
  url: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, string>;
}

export interface InjectResult {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
  json<T = any>(): T;
}

export const PLUGIN_METADATA = Symbol.for('tlevor.plugin');
