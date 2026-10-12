import Ajv from 'ajv';

const ajv = new Ajv({
  allErrors: true,
  verbose: true,
  strict: false,
});

export interface ContractValidationResult {
  status: 'VALID' | 'VIOLATED' | 'NONE';
  errors: string[];
}

/**
 * Validates a parsed webhook JSON payload against a JSON Schema or OpenAPI Schema
 */
export function validateContract(
  schemaDefinition: string | null | undefined,
  payload: any
): ContractValidationResult {
  if (!schemaDefinition || !schemaDefinition.trim()) {
    return { status: 'NONE', errors: [] };
  }

  let schemaObj: any;
  try {
    schemaObj = JSON.parse(schemaDefinition);
  } catch (err: any) {
    return {
      status: 'VIOLATED',
      errors: [`Schema JSON Parse Error: ${err.message}`],
    };
  }

  // If user pasted an OpenAPI 3.x spec, extract the first component schema or requestBody
  if (schemaObj.openapi || schemaObj.swagger) {
    if (schemaObj.components?.schemas) {
      const firstSchemaKey = Object.keys(schemaObj.components.schemas)[0];
      if (firstSchemaKey) {
        schemaObj = schemaObj.components.schemas[firstSchemaKey];
      }
    }
  }

  try {
    const validate = ajv.compile(schemaObj);
    const valid = validate(payload);

    if (valid) {
      return { status: 'VALID', errors: [] };
    }

    const formattedErrors: string[] = (validate.errors || []).map((err) => {
      const path = err.instancePath || '/';
      const param = err.params ? JSON.stringify(err.params) : '';
      return `${path}: ${err.message}${param && param !== '{}' ? ` (${param})` : ''}`;
    });

    return {
      status: 'VIOLATED',
      errors: formattedErrors.length > 0 ? formattedErrors : ['Payload violated contract schema'],
    };
  } catch (err: any) {
    return {
      status: 'VIOLATED',
      errors: [`Contract Compilation Error: ${err.message}`],
    };
  }
}
