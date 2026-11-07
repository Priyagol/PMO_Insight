import { Queue, type JobsOptions } from 'bullmq';
import { createRedis } from '../config/redis';

/**
 * Queue registry. Names are fixed so producers (API) and consumers (worker) agree.
 * Processors are registered in `jobs/workers/*` and started by `worker.ts`.
 */
export const QUEUE_NAMES = {
  email: 'email',
  notifications: 'notifications',
  assignment: 'assignment',
  automation: 'automation',
  scanners: 'scanners',
  exports: 'exports',
  ai: 'ai',
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

const queues = new Map<QueueName, Queue>();
let connection: ReturnType<typeof createRedis> | null = null;

export function bullConnection() {
  // BullMQ requires maxRetriesPerRequest: null on its connections.
  connection ??= createRedis('bullmq', { maxRetriesPerRequest: null, lazyConnect: false });
  return connection;
}

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: bullConnection(), defaultJobOptions });
    queues.set(name, queue);
  }
  return queue;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = null;
  }
}
