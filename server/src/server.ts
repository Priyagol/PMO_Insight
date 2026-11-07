import { createServer } from 'node:http';
import { createApp } from './app';
import { env, isProduction } from './config/env';
import { connectMongo, disconnectMongo, pingMongo } from './config/db';
import { logger } from './config/logger';
import { connectRedis, disconnectRedis, pingRedis } from './config/redis';
import { ensureBucket, isStorageConfigured, pingStorage } from './config/storage';
import { closeQueues } from './jobs/queues';
import { enqueuePlanExecution } from './jobs/workers/assignment.worker';
import { registerAutoAssignment, setPlanDispatcher } from './modules/assignment/assignment.service';
import { registerAutomationSubscribers } from './modules/automations/automation.engine';
import { registerNotificationSubscribers } from './modules/notifications/notification.subscribers';
import { registerOutboundSubscribers } from './modules/outbound/outbound.service';
import { registerServiceDeskSubscribers } from './modules/servicedesk/servicedesk.service';
import { ensureSystemRoles } from './modules/roles/role.service';
import { attachSockets, closeSockets } from './sockets/io';

async function main(): Promise<void> {
  await connectMongo(env.MONGO_URI);
  await connectRedis();
  await ensureSystemRoles();
  // Approved assignment plans run in the worker; new tasks may be auto-assigned.
  setPlanDispatcher(enqueuePlanExecution);
  registerAutoAssignment();
  registerNotificationSubscribers();
  registerAutomationSubscribers();
  registerOutboundSubscribers();
  registerServiceDeskSubscribers();

  if (isStorageConfigured() && !isProduction) {
    try {
      const result = await ensureBucket();
      logger.info({ bucket: env.S3_BUCKET, result }, 'Object storage ready');
    } catch (err) {
      // Not fatal: /ready reports storage as degraded until it is reachable.
      logger.warn({ err }, 'Object storage not reachable');
    }
  }

  const app = createApp({
    readinessChecks: {
      mongo: pingMongo,
      redis: pingRedis,
      ...(isStorageConfigured() ? { storage: pingStorage } : {}),
    },
  });

  const httpServer = createServer(app);
  await attachSockets(httpServer);

  httpServer.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down API');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    httpServer.close();
    await closeSockets();
    await closeQueues();
    await disconnectRedis();
    await disconnectMongo();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'API failed to start');
  process.exit(1);
});
