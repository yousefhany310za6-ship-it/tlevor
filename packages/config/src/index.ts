import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export interface ConfigOptions {
  envFile?: string;
  strict?: boolean;
  defaults?: Record<string, any>;
}

export class Config {
  private data: Record<string, any> = {};
  private readonly: boolean = false;

  constructor(options: ConfigOptions = {}) {
    // Load environment variables
    this.loadEnv();

    // Load .env file if specified
    if (options.envFile) {
      this.loadEnvFile(options.envFile);
    } else {
      // Try to load default .env file
      const envPath = resolve(process.cwd(), '.env');
      if (existsSync(envPath)) {
        this.loadEnvFile(envPath);
      }
    }

    // Apply defaults
    if (options.defaults) {
      for (const [key, value] of Object.entries(options.defaults)) {
        if (!(key in this.data)) {
          this.data[key] = value;
        }
      }
    }

    // Freeze in strict mode
    if (options.strict) {
      this.readonly = true;
    }
  }

  private loadEnv(): void {
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        this.data[key] = value;
      }
    }
  }

  private loadEnvFile(path: string): void {
    try {
      const content = readFileSync(path, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;

        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();

        // Remove quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        // Skip if already set by actual environment
        if (!(key in process.env)) {
          this.data[key] = value;
        }
      }
    } catch (error) {
      // Ignore file read errors
    }
  }

  get<T = any>(key: string, defaultValue?: T): T {
    const value = this.data[key];
    if (value === undefined) {
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      throw new Error(`Config key "${key}" is not defined`);
    }
    return value as T;
  }

  set(key: string, value: any): void {
    if (this.readonly) {
      throw new Error('Config is read-only');
    }
    this.data[key] = value;
  }

  has(key: string): boolean {
    return key in this.data;
  }

  keys(): string[] {
    return Object.keys(this.data);
  }

  all(): Record<string, any> {
    return { ...this.data };
  }

  freeze(): void {
    this.readonly = true;
  }
}

let globalConfig: Config | null = null;

export function createConfig(options?: ConfigOptions): Config {
  return new Config(options);
}

export function getConfig(): Config {
  if (!globalConfig) {
    globalConfig = new Config();
  }
  return globalConfig;
}

export function setConfig(config: Config): void {
  globalConfig = config;
}
