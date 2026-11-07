import type { RequestHandler } from 'express';
import { rateLimit, type Options } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { env, isTest } from '../config/env';
import { getRedis } from '../config/redis';
import { RateLimitError } from '../core/errors';

/**
 * Redis-backed limiter so limits hold across API replicas. Tests use the
 * in-memory store to avoid a Redis dependency.
 */
function createLimiter(prefix: string, options: Partial<Options>): RequestHandler {
  return rateLimit({
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(isTest
      ? {}
      : {
          store: new RedisStore({
            prefix: `rl:${prefix}:`,
            sendCommand: (command: string, ...args: string[]) =>
              getRedis().call(command, ...args) as Promise<RedisReply>,
          }),
        }),
    handler: (_req, _res, next) => next(new RateLimitError()),
    ...options,
  });
}

/** General API limit per client IP. */
export const apiLimiter = createLimiter('api', { windowMs: 60_000, limit: 300 });

/** Strict limit for credential endpoints (login, refresh, password reset). */
export const authLimiter = createLimiter('auth', {
  windowMs: 15 * 60_000,
  limit: env.AUTH_RATE_LIMIT_MAX,
});

/** GitHub webhook deliveries (signed; generous because one push can carry many commits). */
export const webhookLimiter = createLimiter('webhook', { windowMs: 60_000, limit: 600 });
