import Ajv, { ValidateFunction, ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { Type, Static, TSchema } from '@sinclair/typebox';

export interface ValidationResult<T = any> {
  success: boolean;
  data?: T;
  errors?: ErrorObject[];
}

export interface Validator<T extends TSchema = TSchema> {
  schema: T;
  validate: (data: unknown) => ValidationResult<Static<T>>;
}

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const validatorCache = new Map<string, ValidateFunction>();

function createValidator<T extends TSchema>(schema: T): Validator<T> {
  const schemaKey = JSON.stringify(schema);

  let validateFn = validatorCache.get(schemaKey);
  if (!validateFn) {
    validateFn = ajv.compile(schema);
    validatorCache.set(schemaKey, validateFn);
  }

  return {
    schema,
    validate: (data: unknown): ValidationResult<Static<T>> => {
      const valid = validateFn(data);
      if (valid) {
        return { success: true, data: data as Static<T> };
      }
      return { success: false, errors: validateFn.errors || [] };
    },
  };
}

export function createBodyValidator<T extends TSchema>(schema: T): Validator<T> {
  return createValidator(schema);
}

export function createQueryValidator<T extends TSchema>(schema: T): Validator<T> {
  return createValidator(schema);
}

export function createParamsValidator<T extends TSchema>(schema: T): Validator<T> {
  return createValidator(schema);
}

export function validate<T extends TSchema>(schema: T, data: unknown): ValidationResult<Static<T>> {
  const validator = createValidator(schema);
  return validator.validate(data);
}

export { Type };
export type { Static, TSchema };
