import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  PLUGIN_METADATA,
} from '../src/index';
import type {
  HTTPMethod,
  LoggerInterface,
  TlevorApp,
  TlevorRequest,
  TlevorResponse,
  TlevorContext,
  HookHandler,
  RouteOptions,
  RouteSchema,
  ValidationSchema,
  PluginHandler,
  PluginMetadata,
  RateLimitOptions,
  BodyParserOptions,
  CorsOptions,
  StaticFilesOptions,
  TlevorAppOptions,
  WebSocketConnection,
  WebSocketHandler,
  InjectOptions,
  InjectResult,
} from '../src/index';

describe('types runtime', () => {
  it('exports a stable PLUGIN_METADATA symbol', () => {
    expect(typeof PLUGIN_METADATA).toBe('symbol');
    expect(Symbol.for('tlevor.plugin')).toBe(PLUGIN_METADATA);
    expect(Symbol.for('tlevor.plugin')).not.toBe(Symbol('tlevor.plugin'));
  });
});

describe('types compile-time contracts', () => {
  it('HTTPMethod is the union of the seven methods', () => {
    expectTypeOf<HTTPMethod>().toEqualTypeOf<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'>();
  });

  it('LoggerInterface exposes the standard methods', () => {
    expectTypeOf<LoggerInterface>().toHaveProperty('trace');
    expectTypeOf<LoggerInterface>().toHaveProperty('debug');
    expectTypeOf<LoggerInterface>().toHaveProperty('info');
    expectTypeOf<LoggerInterface>().toHaveProperty('warn');
    expectTypeOf<LoggerInterface>().toHaveProperty('error');
    expectTypeOf<LoggerInterface>().toHaveProperty('fatal');
    expectTypeOf<LoggerInterface>().toHaveProperty('child');
  });

  it('HookHandler may return void or Promise<void | boolean>', () => {
    const sync: HookHandler = (ctx) => { void ctx; return false; };
    const async_: HookHandler = async (ctx) => { void ctx; };
    expectTypeOf(sync).toMatchTypeOf<HookHandler>();
    expectTypeOf(async_).toMatchTypeOf<HookHandler>();
  });

  it('TlevorRequest exposes ip and cookies', () => {
    expectTypeOf<TlevorRequest>().toHaveProperty('ip');
    expectTypeOf<TlevorRequest>().toHaveProperty('cookies');
    expectTypeOf<TlevorRequest>().toHaveProperty('query');
    expectTypeOf<TlevorRequest>().toHaveProperty('params');
  });

  it('TlevorResponse exposes the response DSL', () => {
    expectTypeOf<TlevorResponse>().toHaveProperty('status');
    expectTypeOf<TlevorResponse>().toHaveProperty('header');
    expectTypeOf<TlevorResponse>().toHaveProperty('send');
    expectTypeOf<TlevorResponse>().toHaveProperty('json');
    expectTypeOf<TlevorResponse>().toHaveProperty('text');
    expectTypeOf<TlevorResponse>().toHaveProperty('redirect');
    expectTypeOf<TlevorResponse>().toHaveProperty('cookie');
    expectTypeOf<TlevorResponse>().toHaveProperty('clearCookie');
  });

  it('TlevorContext composes request, response, state and logger', () => {
    expectTypeOf<TlevorContext>().toHaveProperty('req');
    expectTypeOf<TlevorContext>().toHaveProperty('res');
    expectTypeOf<TlevorContext>().toHaveProperty('state');
    expectTypeOf<TlevorContext>().toHaveProperty('logger');
  });

  it('TlevorApp exposes the full app API', () => {
    expectTypeOf<TlevorApp>().toHaveProperty('addRoute');
    expectTypeOf<TlevorApp>().toHaveProperty('addHook');
    expectTypeOf<TlevorApp>().toHaveProperty('use');
    expectTypeOf<TlevorApp>().toHaveProperty('registerPlugin');
    expectTypeOf<TlevorApp>().toHaveProperty('rateLimit');
    expectTypeOf<TlevorApp>().toHaveProperty('ws');
    expectTypeOf<TlevorApp>().toHaveProperty('inject');
    expectTypeOf<TlevorApp>().toHaveProperty('listen');
    expectTypeOf<TlevorApp>().toHaveProperty('close');
  });

  it('RouteOptions accepts single or array methods', () => {
    const single: RouteOptions = { method: 'GET', path: '/', handler: async () => ({}) };
    const multi: RouteOptions = { method: ['GET', 'POST'], path: '/', handler: async () => ({}) };
    expectTypeOf(single).toMatchTypeOf<RouteOptions>();
    expectTypeOf(multi).toMatchTypeOf<RouteOptions>();
  });

  it('RouteSchema supports body/query/params/response', () => {
    expectTypeOf<RouteSchema>().toHaveProperty('body');
    expectTypeOf<RouteSchema>().toHaveProperty('query');
    expectTypeOf<RouteSchema>().toHaveProperty('params');
    expectTypeOf<RouteSchema>().toHaveProperty('response');
  });

  it('ValidationSchema supports common keywords', () => {
    expectTypeOf<ValidationSchema>().toHaveProperty('type');
    expectTypeOf<ValidationSchema>().toHaveProperty('properties');
    expectTypeOf<ValidationSchema>().toHaveProperty('required');
    expectTypeOf<ValidationSchema>().toHaveProperty('minLength');
    expectTypeOf<ValidationSchema>().toHaveProperty('enum');
  });

  it('PluginHandler receives the app and options', () => {
    const plugin: PluginHandler<{ verbose?: boolean }> = (app, opts) => { void app; void opts; };
    expectTypeOf(plugin).toMatchTypeOf<PluginHandler>();
  });

  it('PluginMetadata declares name and optional dependencies', () => {
    expectTypeOf<PluginMetadata>().toHaveProperty('name');
    expectTypeOf<PluginMetadata>().toHaveProperty('dependencies');
  });

  it('option interfaces are well-formed', () => {
    expectTypeOf<RateLimitOptions>().toHaveProperty('max');
    expectTypeOf<RateLimitOptions>().toHaveProperty('keyGenerator');
    expectTypeOf<BodyParserOptions>().toHaveProperty('jsonLimit');
    expectTypeOf<CorsOptions>().toHaveProperty('origin');
    expectTypeOf<CorsOptions>().toHaveProperty('credentials');
    expectTypeOf<StaticFilesOptions>().toHaveProperty('root');
    expectTypeOf<TlevorAppOptions>().toHaveProperty('trustProxy');
    expectTypeOf<TlevorAppOptions>().toHaveProperty('logger');
  });

  it('WebSocket contracts expose connection details', () => {
    expectTypeOf<WebSocketConnection>().toHaveProperty('id');
    expectTypeOf<WebSocketConnection>().toHaveProperty('remoteAddress');
    expectTypeOf<WebSocketConnection>().toHaveProperty('send');
    expectTypeOf<WebSocketHandler>().toHaveProperty('onMessage');
  });

  it('InjectOptions and InjectResult describe light-weight testing', () => {
    expectTypeOf<InjectOptions>().toHaveProperty('method');
    expectTypeOf<InjectOptions>().toHaveProperty('url');
    expectTypeOf<InjectOptions>().toHaveProperty('query');
    expectTypeOf<InjectResult>().toHaveProperty('statusCode');
    expectTypeOf<InjectResult>().toHaveProperty('body');
    expectTypeOf<InjectResult>().toHaveProperty('json');
  });
});
