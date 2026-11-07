import type { Worker } from 'bullmq';
import { env } from './config/env';
import { connectMongo, disconnectMongo } from './config/db';
import { logger } from './config/logger';
import { closeQueues } from './jobs/queues';
import { startAssignmentWorker } from './jobs/workers/assignment.worker';
import { startEmailWorker } from './jobs/workers/email.worker';
import { scheduleScanners, startScannerWorker } from './jobs/workers/scanner.worker';
import { registerAutomationSubscribers } from './modules/automations/automation.engine';
import { registerNotificationSubscribers } from './modules/notifications/notification.subscribers';
import {
  registerOutboundSubscribers,
  retryDueDeliveries,
} from './modules/outbound/outbound.service';
import { registerServiceDeskSubscribers } from './modules/servicedesk/servicedesk.service';

/**
 * Background worker process: consumes BullMQ queues (email, assignment plans, scheduled
 * scanners; automations, exports and AI jobs are added in their phases).
 */
async function main(): Promise<void> {
  await connectMongo(env.MONGO_URI);
  // Events raised inside the worker (e.g. executed assignment plans) also notify people.
  registerNotificationSubscribers();
  // task.overdue is raised by the daily scanner in this process.
  registerAutomationSubscribers();
  registerOutboundSubscribers();
  registerServiceDeskSubscribers();
  // Failed outgoing webhook / Slack / Teams deliveries are retried with back-off.
  const retryTimer = setInterval(() => {
    retryDueDeliveries().catch((err: unknown) => logger.error({ err }, 'Webhook retry failed'));
  }, 60_000);

  const workers: Worker[] = [startEmailWorker(), startAssignmentWorker(), startScannerWorker()];
  await scheduleScanners(env.ORG_TIMEZONE);
  logger.info({ queues: workers.map((w) => w.name) }, 'Worker started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down worker');
    clearInterval(retryTimer);
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    await disconnectMongo();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
