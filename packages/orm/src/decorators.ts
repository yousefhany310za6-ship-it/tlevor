import type { DatabaseAdapter } from './adapter';
import type { ModelOptions } from './model';

export function Table(options: ModelOptions): ClassDecorator {
  return (target: any) => { target.__modelOptions = options; };
}

export function Column(options?: { type?: string; nullable?: boolean; default?: any }): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    if (!target.__columns) target.__columns = {};
    target.__columns[propertyKey] = options || {};
  };
}

export function PrimaryKey(): PropertyDecorator { return Column({ type: 'id' }); }
export function AutoIncrement(): PropertyDecorator { return Column({ type: 'auto' }); }

/** Create tables for a decorator-defined model class on the given adapter. */
export async function syncModel(modelClass: any, adapter: DatabaseAdapter): Promise<void> {
  const options = modelClass.__modelOptions;
  const columns = modelClass.__columns || {};
  if (typeof (adapter as any).sync === 'function') {
    await (adapter as any).sync({
      tableName: options.tableName,
      primaryKey: options.primaryKey,
      columns,
      timestamps: options.timestamps,
    });
  }
}
