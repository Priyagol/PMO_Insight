import { Worker } from 'bullmq';
import { logger } from '../../config/logger';
import { addDaysIso, orgToday, weekStartIso } from '../../core/time';
import { captureSnapshots } from '../../modules/insights/analytics.service';
import { sendApprovalReminders } from '../../modules/approvals/approval.service';
import { runScheduledRules } from '../../modules/automations/automation.engine';
import { sendDueReminders } from '../../modules/notifications/notification.subscribers';
import { sendTimesheetReminders } from '../../modules/tracking/people.service';
import { bullConnection, getQueue, QUEUE_NAMES } from '../queues';
import { runDueSubscriptions } from '../../modules/reporting/reporting.service';
import { scanSlas } from '../../modules/servicedesk/servicedesk.service';

/**
 * Scheduled scanners. Phase 4: Monday 11:00 (organisation timezone) reminder for last
 * week's missing timesheets. Overdue / blocked / SLA scanners are added in Phase 7.
 */
export async function scheduleScanners(timeZone: string): Promise<void> {
  await getQueue('scanners').upsertJobScheduler(
    'timesheet-reminders',
    { pattern: '0 11 * * 1', tz: timeZone },
    { name: 'timesheet-reminders', data: {} },
  );
  // Nightly per-project snapshot (cumulative flow and history), 23:30 organisation time.
  await getQueue('scanners').upsertJobScheduler(
    'daily-snapshots',
    { pattern: '30 23 * * *', tz: timeZone },
    { name: 'daily-snapshots', data: {} },
  );
  // Phase 6: due-date reminders at 09:00 and approval deadline reminders every hour.
  await getQueue('scanners').upsertJobScheduler(
    'due-reminders',
    { pattern: '0 9 * * *', tz: timeZone },
    { name: 'due-reminders', data: {} },
  );
  await getQueue('scanners').upsertJobScheduler(
    'approval-reminders',
    { pattern: '15 * * * *', tz: timeZone },
    { name: 'approval-reminders', data: {} },
  );
  // Phase 7B: scheduled automation rules, checked a few minutes past every hour.
  await getQueue('scanners').upsertJobScheduler(
    'automation-schedules',
    { pattern: '2 * * * *', tz: timeZone },
    { name: 'automation-schedules', data: {} },
  );
  // Phase 9H: scheduled report e-mails, checked every 15 minutes.
  await getQueue('scanners').upsertJobScheduler(
    'report-subscriptions',
    { pattern: '*/15 * * * *', tz: timeZone },
    { name: 'report-subscriptions', data: {} },
  );
  // Phase 9G: service desk SLA warnings and escalations.
  await getQueue('scanners').upsertJobScheduler(
    'service-desk-slas',
    { pattern: '*/15 * * * *', tz: timeZone },
    { name: 'service-desk-slas', data: {} },
  );
}

export function startScannerWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAMES.scanners,
    async (job) => {
      if (job.name === 'timesheet-reminders') {
        const lastWeek = addDaysIso(weekStartIso(orgToday()), -7);
        return { sent: await sendTimesheetReminders(lastWeek) };
      }
      if (job.name === 'daily-snapshots') return { projects: await captureSnapshots() };
      if (job.name === 'due-reminders') return { sent: await sendDueReminders() };
      if (job.name === 'approval-reminders') return { sent: await sendApprovalReminders() };
      if (job.name === 'automation-schedules') return await runScheduledRules();
      if (job.name === 'report-subscriptions') return { sent: await runDueSubscriptions() };
      if (job.name === 'service-desk-slas') return { alerts: await scanSlas() };
      return null;
    },
    { connection: bullConnection(), concurrency: 1 },
  );
  worker.on('failed', (job, err) => logger.error({ err, job: job?.name }, 'Scanner job failed'));
  return worker;
}
