import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit';
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

/** Strict limit for credential endpoints (password reset, two-step setup, SSO). */
export const authLimiter = createLimiter('auth', {
  windowMs: 15 * 60_000,
  limit: env.AUTH_RATE_LIMIT_MAX,
});

const clientIp = (req: { ip?: string }) => ipKeyGenerator(req.ip ?? '');

/**
 * Sign-in attempts per person: the limit counts each e-mail address from each network
 * separately, so colleagues behind one office address do not use up each other's attempts.
 * Password guessing is also stopped by the per-account lockout after repeated failures.
 */
export const loginLimiter = createLimiter('login', {
  windowMs: 15 * 60_000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  keyGenerator: (req) => {
    const body = req.body as { email?: unknown } | undefined;
    const email =
      typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
    return `${clientIp(req)}:${email}`;
  },
});

/** Ceiling on sign-in attempts from one network address, across all accounts. */
export const loginNetworkLimiter = createLimiter('login-net', {
  windowMs: 15 * 60_000,
  limit: env.AUTH_RATE_LIMIT_MAX * 15,
  keyGenerator: clientIp,
});

/**
 * Session refresh happens on every page load and every 15 minutes per open tab, so it needs
 * room for a whole office on one address. The refresh token itself is single-use and rotated.
 */
export const refreshLimiter = createLimiter('refresh', {
  windowMs: 15 * 60_000,
  limit: env.AUTH_RATE_LIMIT_MAX * 50,
  keyGenerator: clientIp,
});

/** GitHub webhook deliveries (signed; generous because one push can carry many commits). */
export const webhookLimiter = createLimiter('webhook', { windowMs: 60_000, limit: 600 });
