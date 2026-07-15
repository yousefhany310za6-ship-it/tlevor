export type ServiceFactory<T = any> = (container: Container) => T;
export type ServiceClass<T = any> = new (...args: any[]) => T;

export interface ServiceDefinition<T = any> {
  factory?: ServiceFactory<T>;
  class?: ServiceClass<T>;
  singleton?: boolean;
  instance?: T;
}

export class Container {
  private services: Map<string, ServiceDefinition> = new Map();
  private resolving: Set<string> = new Set();

  register<T>(name: string, definition: ServiceDefinition<T>): void {
    this.services.set(name, definition);
  }

  registerFactory<T>(name: string, factory: ServiceFactory<T>, singleton: boolean = true): void {
    this.register(name, { factory, singleton });
  }

  registerClass<T>(name: string, cls: ServiceClass<T>, singleton: boolean = true): void {
    this.register(name, { class: cls, singleton });
  }

  registerInstance<T>(name: string, instance: T): void {
    this.register(name, { instance, singleton: true });
  }

  resolve<T = any>(name: string): T {
    const definition = this.services.get(name);
    if (!definition) {
      throw new Error(`Service "${name}" is not registered`);
    }

    // Return existing singleton instance
    if (definition.singleton && definition.instance !== undefined) {
      return definition.instance as T;
    }

    // Check for circular dependencies
    if (this.resolving.has(name)) {
      throw new Error(`Circular dependency detected for service "${name}"`);
    }

    this.resolving.add(name);

    try {
      let instance: T;

      if (definition.factory) {
        instance = definition.factory(this);
      } else if (definition.class) {
        instance = new definition.class();
      } else {
        throw new Error(`Service "${name}" has no factory or class`);
      }

      // Store singleton instance
      if (definition.singleton) {
        definition.instance = instance;
      }

      return instance;
    } finally {
      this.resolving.delete(name);
    }
  }

  has(name: string): boolean {
    return this.services.has(name);
  }

  clear(): void {
    this.services.clear();
    this.resolving.clear();
  }
}

let globalContainer: Container | null = null;

export function createContainer(): Container {
  return new Container();
}

export function getContainer(): Container {
  if (!globalContainer) {
    globalContainer = new Container();
  }
  return globalContainer;
}

export function setContainer(container: Container): void {
  globalContainer = container;
}
