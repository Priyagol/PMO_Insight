import { z } from 'zod';
import { objectIdSchema } from './api';

/* ============================ Created vs resolved ============================ */

export const createdResolvedQuerySchema = z.strictObject({
  /** Optional query (AQL) narrowing the tasks. */
  aql: z.string().trim().max(2000).default(''),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Length of the period ending today (organisation time), when from is not given. */
  days: z.coerce.number().int().min(1).max(366).optional(),
  interval: z.enum(['day', 'week']).default('day'),
});
export type CreatedResolvedQuery = z.input<typeof createdResolvedQuerySchema>;

export interface CreatedResolvedDto {
  period: { from: string; to: string };
  interval: 'day' | 'week';
  points: { bucket: string; created: number; resolved: number; openChange: number }[];
  totals: { created: number; resolved: number };
}

/* ============================ Scheduled report e-mails ============================ */

export const REPORT_KINDS = ['filter', 'snapshot', 'work_summary', 'project_status'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
/** The summaries arrive in the e-mail body, with the detail attached as CSV. */
export const SUMMARY_REPORTS: readonly ReportKind[] = ['work_summary', 'project_status'];
export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  filter: 'Saved filter results',
  snapshot: 'Management snapshot',
  work_summary: 'Work summary (who did what)',
  project_status: 'Project status (red / amber / green)',
};
export const REPORT_FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly'] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];
export const REPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const reportSubscriptionSchema = z
  .strictObject({
    name: z.string().trim().min(1, 'Name it').max(80),
    /** A saved filter's results, or the management snapshot. */
    report: z.enum(REPORT_KINDS),
    filterId: objectIdSchema.nullable().optional(),
    format: z.enum(REPORT_FORMATS),
    frequency: z.enum(REPORT_FREQUENCIES),
    /** 1 = Monday … 7 = Sunday (weekly). */
    dayOfWeek: z.number().int().min(1).max(7).default(1),
    /** 1–28 (monthly; quarterly runs on this day of each quarter's first month). */
    dayOfMonth: z.number().int().min(1).max(28).default(1),
    /** Hour of the day in the organisation's time zone. */
    hour: z.number().int().min(0).max(23).default(9),
    /** Colleagues who receive it; each gets results computed with their own access. */
    recipientIds: z.array(objectIdSchema).min(1, 'Choose at least one recipient').max(25),
    active: z.boolean().default(true),
  })
  .refine((v) => v.report !== 'filter' || Boolean(v.filterId), {
    message: 'Choose the saved filter to send',
    path: ['filterId'],
  })
  .refine(
    (v) =>
      v.report === 'filter'
        ? v.format !== 'pdf'
        : v.report === 'snapshot'
          ? v.format !== 'csv'
          : v.format === 'csv',
    {
      message:
        'Filters are sent as CSV or Excel, the snapshot as PDF or Excel, and summaries as CSV',
      path: ['format'],
    },
  );
export type ReportSubscriptionInput = z.input<typeof reportSubscriptionSchema>;

export interface ReportSubscriptionDto {
  id: string;
  name: string;
  report: ReportKind;
  filter: { id: string; name: string } | null;
  format: ReportFormat;
  frequency: ReportFrequency;
  dayOfWeek: number;
  dayOfMonth: number;
  hour: number;
  recipients: { id: string; name: string }[];
  active: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
  canEdit: boolean;
}

/** Human description, e.g. "Every Monday at 09:00". */
export function describeReportSchedule(s: {
  frequency: ReportFrequency;
  dayOfWeek: number;
  dayOfMonth: number;
  hour: number;
}): string {
  const at = `${String(s.hour).padStart(2, '0')}:00`;
  const days = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  if (s.frequency === 'daily') return `Every day at ${at}`;
  if (s.frequency === 'weekly') return `Every ${days[s.dayOfWeek]} at ${at}`;
  if (s.frequency === 'quarterly')
    return `Quarterly on day ${s.dayOfMonth} of the new quarter at ${at}`;
  return `Monthly on day ${s.dayOfMonth} at ${at}`;
}

/**
 * First day of the financial quarter or year containing `date`. The financial year starts on
 * the 1st of `fiscalYearStartMonth` (April in India); quarters are three-month blocks from it.
 */
export function fiscalPeriodStart(
  date: string,
  period: 'quarter' | 'year',
  fiscalYearStartMonth = 4,
): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const sinceYearStart = (m - fiscalYearStartMonth + 12) % 12;
  const back = period === 'year' ? sinceYearStart : sinceYearStart % 3;
  const startMonth = ((m - 1 - back + 12) % 12) + 1;
  const startYear = startMonth > m ? y - 1 : y;
  return `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
}
