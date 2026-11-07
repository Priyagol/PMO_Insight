import { Worker } from 'bullmq';
import { logger } from '../../config/logger';
import { executePlan } from '../../modules/assignment/assignment.service';
import { bullConnection, getQueue, QUEUE_NAMES } from '../queues';

/** Producer used by the API: one job per plan, de-duplicated by the plan's idempotency key. */
export async function enqueuePlanExecution(planId: string, idempotencyKey: string): Promise<void> {
  await getQueue('assignment').add('execute-plan', { planId }, { jobId: `plan-${idempotencyKey}` });
}

export function startAssignmentWorker(): Worker<{ planId: string }> {
  // Concurrency 1: plans touching the same pool are also serialised by the pool lock.
  const worker = new Worker<{ planId: string }>(
    QUEUE_NAMES.assignment,
    async (job) => {
      await executePlan(job.data.planId);
    },
    { connection: bullConnection(), concurrency: 1 },
  );
  worker.on('failed', (job, err) =>
    logger.error({ err, planId: job?.data.planId }, 'Assignment job failed'),
  );
  return worker;
}
