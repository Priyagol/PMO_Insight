import mongoose, { Schema, Types } from 'mongoose';
import {
  REPORT_FORMATS,
  REPORT_FREQUENCIES,
  REPORT_KINDS,
  createdResolvedQuerySchema,
  describeReportSchedule,
  reportSubscriptionSchema,
  type CreatedResolvedDto,
  type ReportFormat,
  type ReportFrequency,
  type ReportKind,
  type ReportSubscriptionDto,
  type ReportSubscriptionInput,
} from '@arihant/shared';
import { logger } from '../../config/logger';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../../core/errors';
import { can } from '../../core/rbac/policy';
import {
  loadAuthContext,
  requireAuth,
  type AuthContext,
  type RequestContext,
} from '../../core/rbac/context';
import {
  ORG_TZ,
  addDaysIso,
  dayOfWeekIso,
  orgDateTime,
  orgToday,
  weekStartIso,
} from '../../core/time';
import { readableProjectIds } from '../../core/rbac/work-access';
import { recordAudit } from '../audit/audit.service';
import { buildSnapshot, renderSnapshotPdf, renderSnapshotXlsx } from '../insights/report.service';
import { aqlTaskFilter, exportSearch } from '../search/search.service';
import { SavedFilter } from '../search/search.models';
import { Task } from '../tasks/task.model';
import { User } from '../users/user.model';
import { sendEmail } from '../../services/email';

/* ============================ Created vs resolved ============================ */

const orgDay = (field: string) => ({
  $dateToString: { date: field, format: '%Y-%m-%d', timezone: ORG_TZ },
});

/** Tasks created and resolved per day or week, for a query (or everything visible). */
export async function createdVsResolved(
  rc: RequestContext,
  raw: unknown,
): Promise<CreatedResolvedDto> {
  const auth = requireAuth(rc);
  const q = createdResolvedQuerySchema.parse(raw ?? {});
  const to = q.to ?? orgToday();
  const from = q.from ?? addDaysIso(to, -((q.days ?? 30) - 1));
  if (from > to) throw new UnprocessableError('The start date must be before the end date');
  if (addDaysIso(from, 366) < to) throw new UnprocessableError('Choose at most one year');
  const { filter } = await aqlTaskFilter(auth, q.aql);
  const start = orgDateTime(from, '00:00');
  const end = orgDateTime(addDaysIso(to, 1), '00:00');
  const count = (field: 'createdAt' | 'completedAt') =>
    Task.aggregate<{ _id: string; n: number }>([
      { $match: { $and: [filter, { [field]: { $gte: start, $lt: end } }] } },
      { $group: { _id: orgDay(`$${field}`), n: { $sum: 1 } } },
    ]);
  const [created, resolved] = await Promise.all([count('createdAt'), count('completedAt')]);
  const bucketOf = (day: string) => (q.interval === 'week' ? weekStartIso(day) : day);
  const buckets: string[] = [];
  for (let d = bucketOf(from); d <= to; d = addDaysIso(d, q.interval === 'week' ? 7 : 1))
    buckets.push(d);
  const sum = (rows: { _id: string; n: number }[], b: string) =>
    rows.filter((r) => bucketOf(r._id) === b).reduce((s, r) => s + r.n, 0);
  let running = 0;
  const points = buckets.map((b) => {
    const c = sum(created, b);
    const r = sum(resolved, b);
    running += c - r;
    return { bucket: b, created: c, resolved: r, openChange: running };
  });
  return {
    period: { from, to },
    interval: q.interval,
    points,
    totals: {
      created: created.reduce((s, r) => s + r.n, 0),
      resolved: resolved.reduce((s, r) => s + r.n, 0),
    },
  };
}

/* ============================ Scheduled report e-mails ============================ */

interface IReportSubscription {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  report: ReportKind;
  filterId: Types.ObjectId | null;
  format: ReportFormat;
  frequency: ReportFrequency;
  dayOfWeek: number;
  dayOfMonth: number;
  hour: number;
  recipientIds: Types.ObjectId[];
  active: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastResult: string | null;
  createdAt: Date;
}
const subscriptionSchema = new Schema<IReportSubscription>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: 80 },
    report: { type: String, enum: REPORT_KINDS, required: true },
    filterId: { type: Schema.Types.ObjectId, ref: 'SavedFilter', default: null },
    format: { type: String, enum: REPORT_FORMATS, required: true },
    frequency: { type: String, enum: REPORT_FREQUENCIES, required: true },
    dayOfWeek: { type: Number, default: 1 },
    dayOfMonth: { type: Number, default: 1 },
    hour: { type: Number, default: 9 },
    recipientIds: { type: [Schema.Types.ObjectId], default: [] },
    active: { type: Boolean, default: true },
    nextRunAt: { type: Date, default: null },
    lastRunAt: { type: Date, default: null },
    lastResult: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'reportSubscriptions' },
);
subscriptionSchema.index({ active: 1, nextRunAt: 1 });
subscriptionSchema.index({ ownerId: 1 });
export const ReportSubscription =
  (mongoose.models.ReportSubscription as mongoose.Model<IReportSubscription> | undefined) ??
  mongoose.model<IReportSubscription>('ReportSubscription', subscriptionSchema);

const MAX_PER_OWNER = 20;

/** Next run strictly after `now`, at the chosen hour in the organisation's time zone. */
export function nextRun(
  s: Pick<IReportSubscription, 'frequency' | 'dayOfWeek' | 'dayOfMonth' | 'hour'>,
  now = new Date(),
): Date {
  const time = `${String(s.hour).padStart(2, '0')}:00`;
  let day = orgToday(0, now);
  for (let i = 0; i < 400; i++, day = addDaysIso(day, 1)) {
    const iso = dayOfWeekIso(day) === 0 ? 7 : dayOfWeekIso(day);
    const ok =
      s.frequency === 'daily' ||
      (s.frequency === 'weekly' && iso === s.dayOfWeek) ||
      (s.frequency === 'monthly' && Number(day.slice(8, 10)) === s.dayOfMonth);
    const at = orgDateTime(day, time);
    if (ok && at > now) return at;
  }
  throw new Error('No next run found');
}

async function present(
  auth: AuthContext,
  rows: IReportSubscription[],
): Promise<ReportSubscriptionDto[]> {
  const [filters, users] = await Promise.all([
    SavedFilter.find({ _id: { $in: rows.map((r) => r.filterId).filter(Boolean) } })
      .select('name')
      .lean(),
    User.find({ _id: { $in: rows.flatMap((r) => r.recipientIds) } })
      .select('name')
      .lean(),
  ]);
  return rows.map((r) => {
    const f = r.filterId ? filters.find((x) => x._id.equals(r.filterId!)) : null;
    return {
      id: r._id.toString(),
      name: r.name,
      report: r.report,
      filter: f ? { id: f._id.toString(), name: f.name } : null,
      format: r.format,
      frequency: r.frequency,
      dayOfWeek: r.dayOfWeek,
      dayOfMonth: r.dayOfMonth,
      hour: r.hour,
      recipients: r.recipientIds
        .map((id) => users.find((u) => u._id.equals(id)))
        .filter((u): u is NonNullable<typeof u> => Boolean(u))
        .map((u) => ({ id: u._id.toString(), name: u.name })),
      active: r.active,
      nextRunAt: r.nextRunAt?.toISOString() ?? null,
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
      lastResult: r.lastResult,
      canEdit: r.ownerId.equals(auth.userObjectId) || can(auth, 'settings:manage', 'org'),
    };
  });
}

export async function listSubscriptions(rc: RequestContext): Promise<ReportSubscriptionDto[]> {
  const auth = requireAuth(rc);
  const rows = await ReportSubscription.find({ ownerId: auth.userObjectId })
    .sort({ name: 1 })
    .lean();
  return present(auth, rows);
}

async function validateInput(
  auth: AuthContext,
  input: ReturnType<typeof reportSubscriptionSchema.parse>,
) {
  if (input.report === 'snapshot' && !can(auth, 'analytics:view'))
    throw new ForbiddenError('You cannot send the management snapshot');
  if (input.report === 'filter') {
    // The owner must be able to see the filter (recipients are checked when it is sent).
    const visible = await SavedFilter.findOne({
      _id: new Types.ObjectId(input.filterId!),
      $or: [{ ownerId: auth.userObjectId }, { sharing: { $in: ['org', 'project'] } }],
    }).lean();
    if (!visible) throw new NotFoundError('Filter');
  }
  const ids = [...new Set(input.recipientIds)].map((id) => new Types.ObjectId(id));
  const active = await User.countDocuments({ _id: { $in: ids }, status: 'active' });
  if (active !== ids.length) throw new UnprocessableError('Recipients must be active colleagues');
  return ids;
}

export async function createSubscription(
  rc: RequestContext,
  raw: ReportSubscriptionInput,
): Promise<ReportSubscriptionDto> {
  const auth = requireAuth(rc);
  const input = reportSubscriptionSchema.parse(raw);
  if ((await ReportSubscription.countDocuments({ ownerId: auth.userObjectId })) >= MAX_PER_OWNER)
    throw new UnprocessableError(`You can schedule up to ${MAX_PER_OWNER} reports`);
  const recipientIds = await validateInput(auth, input);
  const doc = await ReportSubscription.create({
    ownerId: auth.userObjectId,
    name: input.name,
    report: input.report,
    filterId: input.report === 'filter' ? new Types.ObjectId(input.filterId!) : null,
    format: input.format,
    frequency: input.frequency,
    dayOfWeek: input.dayOfWeek,
    dayOfMonth: input.dayOfMonth,
    hour: input.hour,
    recipientIds,
    active: input.active,
    nextRunAt: input.active ? nextRun(input) : null,
  });
  await recordAudit(rc, {
    action: 'report.subscription_created',
    entityType: 'report_subscription',
    entityId: doc._id,
    summary: `Scheduled “${input.name}” (${describeReportSchedule(input)}) to ${recipientIds.length} recipient(s)`,
  });
  return (await present(auth, [doc.toObject()]))[0]!;
}

async function loadOwned(auth: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Schedule');
  const s = await ReportSubscription.findById(id).lean();
  if (!s || (!s.ownerId.equals(auth.userObjectId) && !can(auth, 'settings:manage', 'org')))
    throw new NotFoundError('Schedule');
  return s;
}

export async function updateSubscription(
  rc: RequestContext,
  id: string,
  raw: ReportSubscriptionInput,
): Promise<ReportSubscriptionDto> {
  const auth = requireAuth(rc);
  const s = await loadOwned(auth, id);
  const input = reportSubscriptionSchema.parse(raw);
  const recipientIds = await validateInput(auth, input);
  const next = await ReportSubscription.findByIdAndUpdate(
    s._id,
    {
      $set: {
        name: input.name,
        report: input.report,
        filterId: input.report === 'filter' ? new Types.ObjectId(input.filterId!) : null,
        format: input.format,
        frequency: input.frequency,
        dayOfWeek: input.dayOfWeek,
        dayOfMonth: input.dayOfMonth,
        hour: input.hour,
        recipientIds,
        active: input.active,
        nextRunAt: input.active ? nextRun(input) : null,
      },
    },
    { returnDocument: 'after' },
  ).lean();
  return (await present(auth, [next!]))[0]!;
}

export async function deleteSubscription(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  const s = await loadOwned(auth, id);
  await ReportSubscription.deleteOne({ _id: s._id });
}

/** Period the report covers: yesterday (daily), last week (weekly) or last month (monthly). */
function periodFor(frequency: ReportFrequency, now: Date): { from: string; to: string } {
  const today = orgToday(0, now);
  if (frequency === 'daily') return { from: addDaysIso(today, -1), to: addDaysIso(today, -1) };
  if (frequency === 'weekly') return { from: addDaysIso(today, -7), to: addDaysIso(today, -1) };
  return { from: addDaysIso(today, -30), to: addDaysIso(today, -1) };
}

/** Builds and e-mails one report to each recipient, with the recipient's own access. */
async function send(s: IReportSubscription, now: Date): Promise<string> {
  const recipients = await User.find({ _id: { $in: s.recipientIds }, status: 'active' })
    .select('email name tokenVersion')
    .lean();
  const filter = s.filterId ? await SavedFilter.findById(s.filterId).lean() : null;
  if (s.report === 'filter' && !filter) return 'skipped: the filter was deleted';
  let sent = 0;
  const skipped: string[] = [];
  for (const r of recipients) {
    try {
      const auth = await loadAuthContext(r._id.toString(), r.tokenVersion);
      const rc: RequestContext = { auth, userAgent: 'Scheduled report' };
      let file: { body: Buffer | string; contentType: string; fileName: string };
      let summary: string;
      if (s.report === 'filter') {
        // The filter must be visible to this recipient (own, project-shared or organisation-wide).
        const projects = filter!.sharing === 'project' ? await readableProjectIds(auth) : [];
        const sharedOk =
          filter!.ownerId.equals(r._id) ||
          filter!.sharing === 'org' ||
          (filter!.sharing === 'project' &&
            (projects === 'all' || projects.some((p) => filter!.projectId?.equals(p))));
        if (!sharedOk) {
          skipped.push(r.name);
          continue;
        }
        const out = await exportSearch(rc, { aql: filter!.aql, format: s.format });
        file = out;
        summary = `${out.count} task(s) match “${filter!.name}”.`;
      } else {
        if (!can(auth, 'analytics:view')) {
          skipped.push(r.name);
          continue;
        }
        const snap = await buildSnapshot(rc, periodFor(s.frequency, now));
        const body =
          s.format === 'pdf' ? await renderSnapshotPdf(snap) : await renderSnapshotXlsx(snap);
        file = {
          body,
          contentType:
            s.format === 'pdf'
              ? 'application/pdf'
              : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          fileName: `management-snapshot_${snap.period.from}_${snap.period.to}.${s.format}`,
        };
        summary = `Management snapshot for ${snap.period.from} to ${snap.period.to}.`;
      }
      await sendEmail({
        to: r.email,
        subject: `${s.name} (Arihant Workspace)`,
        text: [
          `Hello ${r.name},`,
          '',
          summary,
          'The report is attached. It contains only work you are allowed to see.',
          '',
          `Schedule: ${describeReportSchedule(s)}. To stop it, ask the person who set it up.`,
        ].join('\n'),
        attachments: [
          {
            filename: file.fileName,
            contentType: file.contentType,
            contentBase64: Buffer.from(file.body).toString('base64'),
          },
        ],
      });
      sent += 1;
    } catch (err) {
      logger.error(
        { err, subscription: s._id.toString() },
        'Scheduled report failed for a recipient',
      );
      skipped.push(r.name);
    }
  }
  return `sent to ${sent}${skipped.length ? `; skipped (no access): ${skipped.join(', ')}` : ''}`;
}

/** Sends every report that is due (the worker calls this every 15 minutes). */
export async function runDueSubscriptions(now = new Date()): Promise<number> {
  const due = await ReportSubscription.find({ active: true, nextRunAt: { $ne: null, $lte: now } })
    .limit(100)
    .lean();
  for (const s of due) {
    // Claim it first so two workers cannot send the same report twice.
    const claimed = await ReportSubscription.updateOne(
      { _id: s._id, nextRunAt: s.nextRunAt },
      { $set: { nextRunAt: nextRun(s, now) } },
    );
    if (!claimed.modifiedCount) continue;
    const result = await send(s, now);
    await ReportSubscription.updateOne(
      { _id: s._id },
      { $set: { lastRunAt: now, lastResult: result } },
    );
  }
  return due.length;
}

/** "Send now" for the owner, without changing the schedule. */
export async function sendNow(rc: RequestContext, id: string): Promise<ReportSubscriptionDto> {
  const auth = requireAuth(rc);
  const s = await loadOwned(auth, id);
  const now = new Date();
  const result = await send(s, now);
  const next = await ReportSubscription.findByIdAndUpdate(
    s._id,
    { $set: { lastRunAt: now, lastResult: result } },
    { returnDocument: 'after' },
  ).lean();
  return (await present(auth, [next!]))[0]!;
}
