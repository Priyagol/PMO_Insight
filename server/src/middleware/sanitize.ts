import type { RequestHandler } from 'express';

/**
 * NoSQL-injection guard: removes object keys that start with `$` or contain `.`
 * from the request body, so payloads like `{ "email": { "$gt": "" } }` can never
 * reach a Mongo query as operators. Query strings are covered by strict Zod
 * schemas in `validate()` (unknown keys and non-scalar values are rejected).
 */
export function stripMongoOperators(value: unknown, depth = 0): unknown {
  if (depth > 20) return undefined;
  if (Array.isArray(value)) return value.map((v) => stripMongoOperators(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const clean: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith('$') || key.includes('.')) continue;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      clean[key] = stripMongoOperators(v, depth + 1);
    }
    return clean;
  }
  return value;
}

export const sanitizeBody: RequestHandler = (req, _res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = stripMongoOperators(req.body);
  }
  next();
};
