import type { ValidationSchema } from '@tlevor/types';

// Validator function type
type ValidateFunction = (data: any) => { valid: boolean; errors: string[] };

// Pre-compiled validators cache
const compiledValidators = new Map<string, ValidateFunction>();

function validateValue(data: any, schema: ValidationSchema, key: string): string[] {
  const errors: string[] = [];
  const label = key ? `"${key}" ` : '';

  // Type checking
  if (schema.type === 'string' && typeof data !== 'string') {
    errors.push(`${label}must be a string`);
  } else if (schema.type === 'number' && typeof data !== 'number') {
    errors.push(`${label}must be a number`);
  } else if (schema.type === 'boolean' && typeof data !== 'boolean') {
    errors.push(`${label}must be a boolean`);
  } else if (schema.type === 'object' && (data === null || typeof data !== 'object')) {
    errors.push(`${label}must be an object`);
  } else if (schema.type === 'array' && !Array.isArray(data)) {
    errors.push(`${label}must be an array`);
  }

  // String constraints
  if (schema.type === 'string' && typeof data === 'string') {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push(`${label}must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push(`${label}must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
      errors.push(`${label}does not match pattern ${schema.pattern}`);
    }
  }

  // Number constraints
  if (schema.type === 'number' && typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push(`${label}must be at least ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push(`${label}must be at most ${schema.maximum}`);
    }
    if (schema.multipleOf !== undefined && data % schema.multipleOf !== 0) {
      errors.push(`${label}must be a multiple of ${schema.multipleOf}`);
    }
  }

  // Array constraints
  if (schema.type === 'array' && Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push(`${label}must have at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push(`${label}must have at most ${schema.maxItems} items`);
    }
    if (schema.items && typeof schema.items === 'object') {
      for (let i = 0; i < data.length; i++) {
        const itemErrors = validateValue(data[i], schema.items, '');
        errors.push(...itemErrors.map((e) => `${key}[${i}] ${e}`));
      }
    }
  }

  // Enum validation
  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${label}must be one of: ${schema.enum.join(', ')}`);
  }

  // Nested object validation
  if (schema.type === 'object' && schema.properties && typeof data === 'object') {
    const nestedResult = compileSchema(schema)(data);
    errors.push(...nestedResult.errors.map((e) => `${key}.${e}`));
  }

  return errors;
}

// Schema compilation
function compileSchema(schema: ValidationSchema): ValidateFunction {
  const key = JSON.stringify(schema);
  const cached = compiledValidators.get(key);
  if (cached) return cached;

  const validate = (data: any): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (data[field] === undefined || data[field] === null) {
          errors.push(`"${field}" is required`);
        }
      }
    }

    // Check properties
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties) as [string, Record<string, any>][]) {
        const value = data[key];
        if (value === undefined || value === null) continue;
        errors.push(...validateValue(value, propSchema, key));
      }
    } else {
      // Leaf schema (e.g. an array item or a standalone value schema):
      // validate the data itself against the schema.
      errors.push(...validateValue(data, schema, ''));
    }

    return { valid: errors.length === 0, errors };
  };

  compiledValidators.set(key, validate);
  return validate;
}

export class Validator {
  private schemas: Map<string, ValidationSchema> = new Map();

  addSchema(name: string, schema: ValidationSchema): void {
    this.schemas.set(name, schema);
  }

  getSchema(name: string): ValidationSchema | undefined {
    return this.schemas.get(name);
  }

  validate(data: any, schema: ValidationSchema): { valid: boolean; errors: string[] } {
    const validate = compileSchema(schema);
    return validate(data);
  }

  validateNamed(data: any, schemaName: string): { valid: boolean; errors: string[] } {
    const schema = this.schemas.get(schemaName);
    if (!schema) throw new Error(`Schema "${schemaName}" not found`);
    return this.validate(data, schema);
  }

  serialize(data: any, schema: ValidationSchema): any {
    if (!schema || !schema.properties) return data;
    const result: any = {};
    for (const key of Object.keys(schema.properties)) {
      if (key in data) result[key] = data[key];
    }
    return result;
  }
}

export function createValidator(): Validator {
  return new Validator();
}

export { compileSchema, compiledValidators };