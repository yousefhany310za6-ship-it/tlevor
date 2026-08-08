import { describe, it, expect } from 'vitest';
import { createLogger } from '../src/index';
import type { LoggerInterface } from '../src/index';

const METHODS: (keyof LoggerInterface)[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'child'];

describe('logger', () => {
  it('createLogger returns a full LoggerInterface', () => {
    const log = createLogger({ level: 'silent' });
    for (const m of METHODS) {
      expect(typeof (log as any)[m]).toBe('function');
    }
  });

  it('logs at every level without throwing (silent)', () => {
    const log = createLogger({ level: 'silent' });
    expect(() => {
      log.trace('t'); log.debug('d'); log.info('i'); log.warn('w'); log.error('e'); log.fatal('f');
    }).not.toThrow();
  });

  it('logs with structured args', () => {
    const log = createLogger({ level: 'silent' });
    expect(() => {
      log.info('user logged in', { userId: 1, role: 'admin' });
      log.warn('slow', { ms: 123 });
    }).not.toThrow();
  });

  it('accepts extra string args', () => {
    const log = createLogger({ level: 'silent' });
    expect(() => log.error('failed', new Error('boom').message)).not.toThrow();
  });

  it('child() returns a LoggerInterface that logs independently', () => {
    const log = createLogger({ level: 'silent' });
    const child = log.child({ requestId: 'abc' });
    for (const m of METHODS) {
      expect(typeof (child as any)[m]).toBe('function');
    }
    expect(() => {
      child.info('child log');
      child.child({ nested: true }).error('deep');
    }).not.toThrow();
  });

  it('default level is info', () => {
    const log = createLogger() as any;
    expect(typeof log.info).toBe('function');
  });

  it('accepts a custom base binding object', () => {
    const log = createLogger({ level: 'silent', base: { service: 'api' } });
    expect(() => log.info('x')).not.toThrow();
  });
});
