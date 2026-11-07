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

export const REPORT_KINDS = ['filter', 'snapshot'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
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
    /** 1–28 (monthly). */
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
  .refine((v) => (v.report === 'filter' ? v.format !== 'pdf' : v.format !== 'csv'), {
    message: 'Filters are sent as CSV or Excel; the snapshot as PDF or Excel',
    path: ['format'],
  });
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
  return `Monthly on day ${s.dayOfMonth} at ${at}`;
}
