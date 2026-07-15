import type { ValidationSchema } from '@tlevor/types';

// Validator function type
type ValidateFunction = (data: any) => { valid: boolean; errors: string[] };

// Pre-compiled validators cache
const compiledValidators = new Map<string, ValidateFunction>();

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
      for (const [key, propSchema] of Object.entries(schema.properties) as [string, Record<string, any>][] ) {
        const value = data[key];
        if (value === undefined || value === null) continue;

        // Type checking
        if (propSchema.type === 'string' && typeof value !== 'string') {
          errors.push(`"${key}" must be a string`);
        } else if (propSchema.type === 'number' && typeof value !== 'number') {
          errors.push(`"${key}" must be a number`);
        } else if (propSchema.type === 'boolean' && typeof value !== 'boolean') {
          errors.push(`"${key}" must be a boolean`);
        } else if (propSchema.type === 'object' && typeof value !== 'object') {
          errors.push(`"${key}" must be an object`);
        } else if (propSchema.type === 'array' && !Array.isArray(value)) {
          errors.push(`"${key}" must be an array`);
        }

        // String constraints
        if (propSchema.type === 'string' && typeof value === 'string') {
          if (propSchema.minLength !== undefined && value.length < propSchema.minLength) {
            errors.push(`"${key}" must be at least ${propSchema.minLength} characters`);
          }
          if (propSchema.maxLength !== undefined && value.length > propSchema.maxLength) {
            errors.push(`"${key}" must be at most ${propSchema.maxLength} characters`);
          }
          if (propSchema.pattern && !new RegExp(propSchema.pattern).test(value)) {
            errors.push(`"${key}" does not match pattern ${propSchema.pattern}`);
          }
        }

        // Number constraints
        if (propSchema.type === 'number' && typeof value === 'number') {
          if (propSchema.minimum !== undefined && value < propSchema.minimum) {
            errors.push(`"${key}" must be at least ${propSchema.minimum}`);
          }
          if (propSchema.maximum !== undefined && value > propSchema.maximum) {
            errors.push(`"${key}" must be at most ${propSchema.maximum}`);
          }
          if (propSchema.multipleOf !== undefined && value % propSchema.multipleOf !== 0) {
            errors.push(`"${key}" must be a multiple of ${propSchema.multipleOf}`);
          }
        }

        // Array constraints
        if (propSchema.type === 'array' && Array.isArray(value)) {
          if (propSchema.minItems !== undefined && value.length < propSchema.minItems) {
            errors.push(`"${key}" must have at least ${propSchema.minItems} items`);
          }
          if (propSchema.maxItems !== undefined && value.length > propSchema.maxItems) {
            errors.push(`"${key}" must have at most ${propSchema.maxItems} items`);
          }
          if (propSchema.items && typeof propSchema.items === 'object') {
            for (let i = 0; i < value.length; i++) {
              const itemErrors = compileSchema(propSchema.items)(value[i]).errors;
              errors.push(...itemErrors.map(e => `${key}[${i}]${e.slice(1)}`));
            }
          }
        }

        // Enum validation
        if (propSchema.enum && !propSchema.enum.includes(value)) {
          errors.push(`"${key}" must be one of: ${propSchema.enum.join(', ')}`);
        }

        // Nested object validation
        if (propSchema.type === 'object' && propSchema.properties && typeof value === 'object') {
          const nestedResult = compileSchema(propSchema)(value);
          errors.push(...nestedResult.errors.map(e => `${key}.${e}`));
        }
      }
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