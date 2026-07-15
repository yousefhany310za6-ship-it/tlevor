import pino, { Logger, LoggerOptions } from 'pino';
import type { LoggerInterface } from '@tlevor/types';

export interface TlevorLoggerOptions {
  level?: string;
  prettyPrint?: boolean;
  base?: Record<string, any>;
}

class PinoLogger implements LoggerInterface {
  private logger: Logger;

  constructor(options: TlevorLoggerOptions = {}) {
    const opts: LoggerOptions = {
      level: options.level || 'info',
      base: options.base || {},
    };

    if (options.prettyPrint) {
      opts.transport = {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      };
    }

    this.logger = pino(opts);
  }

  trace(msg: string, ...args: any[]): void {
    this.logger.trace(msg, ...args);
  }

  debug(msg: string, ...args: any[]): void {
    this.logger.debug(msg, ...args);
  }

  info(msg: string, ...args: any[]): void {
    this.logger.info(msg, ...args);
  }

  warn(msg: string, ...args: any[]): void {
    this.logger.warn(msg, ...args);
  }

  error(msg: string, ...args: any[]): void {
    this.logger.error(msg, ...args);
  }

  fatal(msg: string, ...args: any[]): void {
    this.logger.fatal(msg, ...args);
  }

  child(bindings: Record<string, any>): LoggerInterface {
    return new PinoLoggerChild(this.logger.child(bindings));
  }
}

class PinoLoggerChild implements LoggerInterface {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  trace(msg: string, ...args: any[]): void {
    this.logger.trace(msg, ...args);
  }

  debug(msg: string, ...args: any[]): void {
    this.logger.debug(msg, ...args);
  }

  info(msg: string, ...args: any[]): void {
    this.logger.info(msg, ...args);
  }

  warn(msg: string, ...args: any[]): void {
    this.logger.warn(msg, ...args);
  }

  error(msg: string, ...args: any[]): void {
    this.logger.error(msg, ...args);
  }

  fatal(msg: string, ...args: any[]): void {
    this.logger.fatal(msg, ...args);
  }

  child(bindings: Record<string, any>): LoggerInterface {
    return new PinoLoggerChild(this.logger.child(bindings));
  }
}

export function createLogger(options: TlevorLoggerOptions = {}): LoggerInterface {
  return new PinoLogger(options);
}

export type { LoggerInterface };
