import { describe, it, expect } from 'vitest';
import { createContainer, Container } from '../src/index';

describe('Container', () => {
  it('should create a container', () => {
    const container = createContainer();
    expect(container).toBeDefined();
  });

  it('should register and resolve instances', () => {
    const container = createContainer();
    const instance = { name: 'test' };

    container.registerInstance('test', instance);
    const resolved = container.resolve('test');

    expect(resolved).toBe(instance);
  });

  it('should register and resolve factories', () => {
    const container = createContainer();

    container.registerFactory('counter', () => {
      let count = 0;
      return {
        increment: () => ++count,
        getCount: () => count,
      };
    });

    const counter1 = container.resolve('counter');
    const counter2 = container.resolve('counter');

    // Same instance for singleton
    expect(counter1).toBe(counter2);

    counter1.increment();
    expect(counter2.getCount()).toBe(1);
  });

  it('should register and resolve classes', () => {
    const container = createContainer();

    class UserService {
      name = 'UserService';
    }

    container.registerClass('userService', UserService);
    const service = container.resolve('userService');

    expect(service).toBeInstanceOf(UserService);
    expect(service.name).toBe('UserService');
  });

  it('should throw for unregistered services', () => {
    const container = createContainer();

    expect(() => container.resolve('nonexistent')).toThrow('Service "nonexistent" is not registered');
  });

  it('should detect circular dependencies', () => {
    const container = createContainer();

    container.registerFactory('a', (c) => {
      c.resolve('b');
      return 'a';
    });

    container.registerFactory('b', (c) => {
      c.resolve('a');
      return 'b';
    });

    expect(() => container.resolve('a')).toThrow('Circular dependency');
  });

  it('should check if service is registered', () => {
    const container = createContainer();

    expect(container.has('test')).toBe(false);

    container.registerInstance('test', {});

    expect(container.has('test')).toBe(true);
  });

  it('should clear all services', () => {
    const container = createContainer();

    container.registerInstance('test', {});
    expect(container.has('test')).toBe(true);

    container.clear();
    expect(container.has('test')).toBe(false);
  });
});
