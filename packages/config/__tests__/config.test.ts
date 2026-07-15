import { describe, it, expect } from 'vitest';
import { createConfig } from '../src/index';

describe('Config', () => {
  it('should create a config instance', () => {
    const config = createConfig();
    expect(config).toBeDefined();
  });

  it('should load environment variables', () => {
    process.env.TEST_CONFIG_VAR = 'test-value';

    const config = createConfig();
    expect(config.get('TEST_CONFIG_VAR')).toBe('test-value');

    delete process.env.TEST_CONFIG_VAR;
  });

  it('should get values with defaults', () => {
    const config = createConfig();

    const value = config.get('NONEXISTENT', 'default-value');
    expect(value).toBe('default-value');
  });

  it('should throw for missing keys without defaults', () => {
    const config = createConfig();

    expect(() => config.get('NONEXISTENT')).toThrow('Config key "NONEXISTENT" is not defined');
  });

  it('should set and get values', () => {
    const config = createConfig();

    config.set('custom.key', 'custom-value');
    expect(config.get('custom.key')).toBe('custom-value');
  });

  it('should check if key exists', () => {
    const config = createConfig();

    expect(config.has('PATH')).toBe(true);
    expect(config.has('NONEXISTENT')).toBe(false);
  });

  it('should list all keys', () => {
    const config = createConfig();
    const keys = config.keys();

    expect(Array.isArray(keys)).toBe(true);
    expect(keys.length).toBeGreaterThan(0);
  });

  it('should return all values', () => {
    const config = createConfig();
    const all = config.all();

    expect(typeof all).toBe('object');
    expect(Object.keys(all).length).toBeGreaterThan(0);
  });

  it('should apply defaults', () => {
    const config = createConfig({
      defaults: {
        'app.port': '3000',
        'app.host': 'localhost',
      },
    });

    expect(config.get('app.port')).toBe('3000');
    expect(config.get('app.host')).toBe('localhost');
  });

  it('should not override existing values with defaults', () => {
    process.env.APP_PORT = '4000';

    const config = createConfig({
      defaults: {
        'APP_PORT': '3000',
      },
    });

    expect(config.get('APP_PORT')).toBe('4000');

    delete process.env.APP_PORT;
  });

  it('should freeze in strict mode', () => {
    const config = createConfig({ strict: true });

    expect(() => config.set('key', 'value')).toThrow('Config is read-only');
  });

  it('should freeze on demand', () => {
    const config = createConfig();

    config.set('key', 'value');
    config.freeze();

    expect(() => config.set('key2', 'value2')).toThrow('Config is read-only');
  });
});
