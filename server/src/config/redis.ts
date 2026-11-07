import { Redis, type RedisOptions } from 'ioredis';
import { env } from './env';
import { logger } from './logger';

/**
 * Creates a Redis connection. BullMQ workers require `maxRetriesPerRequest: null`,
 * so callers pass options as needed. Each consumer (app cache, BullMQ, Socket.IO
 * pub/sub) gets its own connection.
 */
export function createRedis(name: string, options: RedisOptions = {}): Redis {
  const client = new Redis(env.REDIS_URL, { lazyConnect: true, ...options });
  client.on('error', (err) => logger.error({ err, redis: name }, 'Redis error'));
  return client;
}

let shared: Redis | null = null;

/** Shared general-purpose client (cache, locks, rate limits). */
export function getRedis(): Redis {
  shared ??= createRedis('shared', { maxRetriesPerRequest: 2 });
  return shared;
}

export async function connectRedis(): Promise<Redis> {
  const client = getRedis();
  if (client.status === 'wait') await client.connect();
  logger.info('Redis connected');
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (shared) {
    await shared.quit().catch(() => undefined);
    shared = null;
  }
}

export async function pingRedis(): Promise<void> {
  const reply = await getRedis().ping();
  if (reply !== 'PONG') throw new Error(`Unexpected Redis reply: ${reply}`);
}
