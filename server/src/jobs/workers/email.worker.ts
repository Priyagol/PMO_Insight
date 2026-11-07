import { Worker } from 'bullmq';
import { logger } from '../../config/logger';
import { sendMail, type MailMessage } from '../../config/mail';
import { bullConnection, QUEUE_NAMES } from '../queues';

/** Sends queued e-mails. Producers call `getQueue('email').add('send', message)`. */
export function startEmailWorker(): Worker<MailMessage> {
  const worker = new Worker<MailMessage>(
    QUEUE_NAMES.email,
    async (job) => {
      await sendMail(job.data);
      return { sentTo: job.data.to };
    },
    { connection: bullConnection(), concurrency: 5 },
  );
  worker.on('failed', (job, err) =>
    logger.warn({ err, jobId: job?.id, attempts: job?.attemptsMade }, 'Email job failed'),
  );
  return worker;
}
