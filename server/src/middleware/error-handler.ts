import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import type { ApiFailure } from '@arihant/shared';
import { isProduction } from '../config/env';
import { logger } from '../config/logger';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../core/errors';

export const notFound: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
};

/** Maps known library errors onto AppErrors so clients get consistent codes. */
function normalize(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  // Schema checks inside services (not only in validate()) are client errors, not 500s.
  if (err instanceof ZodError) {
    return new ValidationError(
      err.issues.map((i) => ({ location: 'body', path: i.path.join('.'), message: i.message })),
    );
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return new ValidationError(
      Object.values(err.errors).map((e) => ({
        location: 'body',
        path: e.path,
        message: e.message,
      })),
    );
  }
  if (err instanceof mongoose.Error.CastError) {
    return new ValidationError([{ location: 'params', path: err.path, message: 'Invalid value' }]);
  }
  if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000) {
    const keys = Object.keys((err as { keyValue?: object }).keyValue ?? {});
    return new ConflictError('A record with the same unique value already exists', {
      fields: keys,
    });
  }
  // body-parser errors (malformed JSON, payload too large)
  if (typeof err === 'object' && err !== null && 'type' in err && 'status' in err) {
    const status = Number((err as { status: number }).status);
    if (status === 413) return new AppError(413, 'BAD_REQUEST', 'Request payload is too large');
    if (status === 400) return new AppError(400, 'BAD_REQUEST', 'Malformed request body');
  }
  return null;
}

// Express identifies error handlers by arity, so all four parameters are required.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const known = normalize(err);
  const status = known?.statusCode ?? 500;

  if (status >= 500) {
    logger.error({ err, requestId: req.id }, 'Unhandled error');
  }

  const body: ApiFailure = {
    success: false,
    error: {
      code: known?.code ?? 'INTERNAL_ERROR',
      // Never leak internal messages or stack traces for unexpected errors in production.
      message:
        known?.message ??
        (isProduction ? 'An unexpected error occurred' : String((err as Error)?.message ?? err)),
      details: known?.details,
      requestId: req.id,
    },
  };
  if (!known && !isProduction && err instanceof Error) {
    body.error.details = { stack: err.stack?.split('\n').slice(0, 8) };
  }
  res.status(status).json(body);
};
