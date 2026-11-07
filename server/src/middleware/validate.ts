import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { ValidationError } from '../core/errors';

export interface RequestSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validates and coerces request input with Zod. Parsed values are written to
 * `req.valid` (Express 5 exposes `req.query` as a read-only getter), so handlers
 * must read from `req.valid`, never from the raw request.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    const valid: NonNullable<typeof req.valid> = {};
    const issues: { location: string; path: string; message: string }[] = [];

    for (const location of ['params', 'query', 'body'] as const) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = schema.safeParse(req[location] ?? {});
      if (result.success) {
        valid[location] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({ location, path: issue.path.join('.'), message: issue.message });
        }
      }
    }

    if (issues.length > 0) {
      next(new ValidationError(issues));
      return;
    }
    req.valid = valid;
    next();
  };
}
