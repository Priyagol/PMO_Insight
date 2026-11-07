import { Types } from 'mongoose';
import {
  availabilityQuerySchema,
  availabilitySchema,
  journalQuerySchema,
  journalSchema,
  timesheetQuerySchema,
  type AvailabilityDto,
  type AvailabilityInput,
  type JournalDto,
  type JournalInput,
  type PageMeta,
  type TimesheetDto,
  type UserRef,
  type WorkCategory,
  type WorkPassportDto,
  type WorkloadRowDto,
} from '@arihant/shared';
import { logger } from '../../config/logger';
import { eventBus } from '../../core/events';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../../core/errors';
import { toPageMeta } from '../../core/pagination';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { canSeePerson, peopleFilter, visiblePeople } from '../../core/rbac/work-access';
import { addDaysIso, orgToday, weekStartIso } from '../../core/time';
import { emailTemplatesPhase4, sendEmail } from '../../services/email';
import { recordAudit } from '../audit/audit.service';
import { getAssignmentConfig, horizonDays, loadCandidates } from '../assignment/workload.service';
import { Project } from '../projects/project.model';
import { getOrgSettings } from '../settings/settings.service';
import { Task } from '../tasks/task.model';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import {
  Availability,
  Journal,
  Timesheet,
  Worklog,
  type IAvailability,
  type ITimesheet,
} from './tracking.models';

const oid = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

async function refs(ids: (Types.ObjectId | null | undefined)[]): Promise<Map<string, UserRef>> {
  const list = [...new Set(ids.filter(Boolean).map(String))];
  const users = await User.find({ _id: { $in: list } })
    .select('name email employeeId designation')
    .lean();
  return new Map(users.map((u) => [u._id.toString(), toUserRef(u)]));
}

/* ============================ Timesheets ============================ */

/** Approver rule: timesheet:approve covering the person, never your own. */
async function canApproveFor(auth: AuthContext, userId: string): Promise<boolean> {
  if (userId === auth.userId || !auth.permissions['timesheet:approve']) return false;
  return canSeePerson(auth, 'timesheet:approve', userId);
}

async function buildWeek(
  auth: AuthContext,
  userId: Types.ObjectId,
  weekStart: string,
  sheet: ITimesheet | null,
): Promise<TimesheetDto> {
  const weekEnd = addDaysIso(weekStart, 6);
  const logs = await Worklog.find({ userId, date: { $gte: weekStart, $lte: weekEnd } })
    .select('date minutes projectId')
    .lean();
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDaysIso(weekStart, i);
    return {
      date,
      minutes: logs.filter((l) => l.date === date).reduce((s, l) => s + l.minutes, 0),
    };
  });
  const perProject = new Map<string, number>();
  logs.forEach((l) =>
    perProject.set(
      l.projectId.toString(),
      (perProject.get(l.projectId.toString()) ?? 0) + l.minutes,
    ),
  );
  const projects = await Project.find({ _id: { $in: [...perProject.keys()].map(oid) } })
    .select('key name')
    .lean();
  const users = await refs([userId, sheet?.decidedBy]);
  return {
    id: sheet?._id.toString() ?? null,
    user: users.get(userId.toString())!,
    weekStart,
    weekEnd,
    status: sheet?.status ?? 'draft',
    totalMinutes: days.reduce((s, d) => s + d.minutes, 0),
    days,
    byProject: projects
      .map((p) => ({
        project: { id: p._id.toString(), key: p.key, name: p.name },
        minutes: perProject.get(p._id.toString()) ?? 0,
      }))
      .sort((a, b) => b.minutes - a.minutes),
    submittedAt: sheet?.submittedAt?.toISOString(),
    decidedBy: sheet?.decidedBy ? (users.get(sheet.decidedBy.toString()) ?? null) : null,
    decidedAt: sheet?.decidedAt?.toISOString(),
    comment: sheet?.comment,
    canApprove: sheet?.status === 'submitted' && (await canApproveFor(auth, userId.toString())),
  };
}

export async function getTimesheetWeek(
  rc: RequestContext,
  weekStartInput: string,
  userIdInput?: string,
): Promise<TimesheetDto> {
  const auth = requireAuth(rc);
  const weekStart = weekStartIso(weekStartInput);
  const userId = userIdInput && userIdInput !== 'me' ? userIdInput : auth.userId;
  if (
    userId !== auth.userId &&
    !(await canSeePerson(auth, 'worklog:read', userId)) &&
    !(await canApproveFor(auth, userId))
  ) {
    throw new NotFoundError('Timesheet');
  }
  const sheet = await Timesheet.findOne({ userId: oid(userId), weekStart }).lean();
  return buildWeek(auth, oid(userId), weekStart, sheet);
}

export async function submitTimesheet(
  rc: RequestContext,
  weekStartInput: string,
): Promise<TimesheetDto> {
  const auth = requireAuth(rc);
  const weekStart = weekStartIso(weekStartInput);
  if (weekStart > orgToday()) throw new UnprocessableError('You cannot submit a future week');
  const existing = await Timesheet.findOne({ userId: auth.userObjectId, weekStart }).lean();
  if (existing && (existing.status === 'submitted' || existing.status === 'approved')) {
    throw new ConflictError(`This timesheet is already ${existing.status}`);
  }
  const [sum] = await Worklog.aggregate<{ m: number }>([
    {
      $match: {
        userId: auth.userObjectId,
        date: { $gte: weekStart, $lte: addDaysIso(weekStart, 6) },
      },
    },
    { $group: { _id: null, m: { $sum: '$minutes' } } },
  ]);
  if (!sum?.m) throw new UnprocessableError('Log some work for this week before submitting');
  const sheet = await Timesheet.findOneAndUpdate(
    { userId: auth.userObjectId, weekStart, status: { $in: ['draft', 'rejected'] } },
    {
      $set: {
        status: 'submitted',
        totalMinutes: sum.m,
        submittedAt: new Date(),
        decidedBy: null,
        decidedAt: null,
      },
      $push: { history: { status: 'submitted', by: auth.userObjectId, at: new Date() } },
    },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  eventBus.publish(
    'timesheet.submitted',
    { timesheetId: sheet!._id.toString(), userId: auth.userId },
    { actorId: auth.userId },
  );
  return buildWeek(auth, auth.userObjectId, weekStart, sheet);
}

export async function decideTimesheet(
  rc: RequestContext,
  id: string,
  decision: 'approved' | 'rejected',
  comment?: string,
): Promise<TimesheetDto> {
  const auth = requireAuth(rc);
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Timesheet');
  const sheet = await Timesheet.findById(id).lean();
  if (!sheet) throw new NotFoundError('Timesheet');
  if (sheet.userId.equals(auth.userObjectId))
    throw new ForbiddenError('You cannot approve your own timesheet');
  if (!(await canApproveFor(auth, sheet.userId.toString()))) throw new NotFoundError('Timesheet');
  const updated = await Timesheet.findOneAndUpdate(
    { _id: sheet._id, status: 'submitted' },
    {
      $set: { status: decision, decidedBy: auth.userObjectId, decidedAt: new Date(), comment },
      $push: { history: { status: decision, by: auth.userObjectId, at: new Date(), comment } },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw new ConflictError('Only submitted timesheets can be approved or rejected');
  const owner = await User.findById(sheet.userId).select('name').lean();
  await recordAudit(rc, {
    action: `timesheet.${decision}`,
    entityType: 'timesheet',
    entityId: sheet._id,
    summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} timesheet of ${owner?.name ?? 'employee'} for week ${sheet.weekStart}${comment ? `: ${comment}` : ''}`,
  });
  eventBus.publish(
    'timesheet.decided',
    {
      timesheetId: sheet._id.toString(),
      userId: sheet.userId.toString(),
      decision,
      weekStart: sheet.weekStart,
      comment,
    },
    { actorId: auth.userId },
  );
  return buildWeek(auth, sheet.userId, sheet.weekStart, updated);
}

export async function listTimesheets(
  rc: RequestContext,
  raw: unknown,
): Promise<{ items: TimesheetDto[]; meta: PageMeta }> {
  const auth = requireAuth(rc);
  const q = timesheetQuerySchema.parse(raw);
  const filter: Record<string, unknown> = {};
  if (q.scope === 'mine') {
    filter.userId = auth.userObjectId;
    if (q.status) filter.status = q.status;
  } else {
    if (!auth.permissions['timesheet:approve']) throw new ForbiddenError();
    const people = await visiblePeople(auth, 'timesheet:approve');
    filter.userId =
      people === 'all'
        ? { $ne: auth.userObjectId }
        : { $in: people.filter((p) => !p.equals(auth.userObjectId)) };
    filter.status = q.status ?? 'submitted';
  }
  const [docs, total] = await Promise.all([
    Timesheet.find(filter)
      .sort({ weekStart: -1, submittedAt: 1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Timesheet.countDocuments(filter),
  ]);
  const items = await Promise.all(docs.map((d) => buildWeek(auth, d.userId, d.weekStart, d)));
  return { items, meta: toPageMeta(q, total) };
}

/**
 * Weekly reminder (worker job): e-mails active employees with capacity who have not
 * submitted the given week. Returns how many reminders were queued.
 */
export async function sendTimesheetReminders(weekStart: string): Promise<number> {
  const submitted = await Timesheet.find({ weekStart, status: { $in: ['submitted', 'approved'] } })
    .select('userId')
    .lean();
  const users = await User.find({
    status: 'active',
    weeklyCapacityHours: { $gt: 0 },
    passwordHash: { $ne: null },
    _id: { $nin: submitted.map((s) => s.userId) },
  })
    .select('name email')
    .lean();
  let sent = 0;
  for (const u of users) {
    if (
      await sendEmail({ to: u.email, ...emailTemplatesPhase4.timesheetReminder(u.name, weekStart) })
    )
      sent += 1;
  }
  logger.info({ weekStart, sent }, 'Timesheet reminders queued');
  return sent;
}

/* ============================ Daily journal ============================ */

export async function upsertJournal(rc: RequestContext, raw: JournalInput): Promise<JournalDto> {
  const auth = requireAuth(rc);
  const input = journalSchema.parse(raw);
  const today = orgToday();
  if (input.date > today)
    throw new UnprocessableError('You cannot write a journal for a future date');
  if (input.date < addDaysIso(today, -7))
    throw new UnprocessableError('Journal entries older than a week cannot be changed');
  if (![input.completed, input.inProgress, input.blockers, input.tomorrow].some((v) => v.trim())) {
    throw new UnprocessableError('Fill in at least one section');
  }
  const doc = await Journal.findOneAndUpdate(
    { userId: auth.userObjectId, date: input.date },
    {
      $set: {
        completed: input.completed,
        inProgress: input.inProgress,
        blockers: input.blockers,
        tomorrow: input.tomorrow,
      },
    },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  if (input.blockers.trim()) {
    eventBus.publish(
      'journal.blocker_reported',
      { userId: auth.userId, date: input.date },
      { actorId: auth.userId },
    );
  }
  const users = await refs([doc!.userId]);
  return {
    id: doc!._id.toString(),
    user: users.get(auth.userId) ?? null,
    date: doc!.date,
    completed: doc!.completed,
    inProgress: doc!.inProgress,
    blockers: doc!.blockers,
    tomorrow: doc!.tomorrow,
    updatedAt: doc!.updatedAt.toISOString(),
  };
}

export async function listJournals(
  rc: RequestContext,
  raw: unknown,
): Promise<{ items: JournalDto[]; meta: PageMeta }> {
  const auth = requireAuth(rc);
  const q = journalQuerySchema.parse(raw);
  const filter: Record<string, unknown> = {};
  if (!q.userId || q.userId === 'me') filter.userId = auth.userObjectId;
  else {
    if (!(await canSeePerson(auth, 'worklog:read', q.userId))) throw new NotFoundError('Journal');
    filter.userId = oid(q.userId);
  }
  if (q.from || q.to)
    filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const [docs, total] = await Promise.all([
    Journal.find(filter)
      .sort({ date: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Journal.countDocuments(filter),
  ]);
  const users = await refs(docs.map((d) => d.userId));
  return {
    items: docs.map((d) => ({
      id: d._id.toString(),
      user: users.get(d.userId.toString()) ?? null,
      date: d.date,
      completed: d.completed,
      inProgress: d.inProgress,
      blockers: d.blockers,
      tomorrow: d.tomorrow,
      updatedAt: d.updatedAt.toISOString(),
    })),
    meta: toPageMeta(q, total),
  };
}

/* ============================ Availability / leave ============================ */

async function presentAvailability(
  auth: AuthContext,
  docs: IAvailability[],
): Promise<AvailabilityDto[]> {
  const users = await refs(docs.flatMap((d) => [d.userId, d.decidedBy]));
  return Promise.all(
    docs.map(async (d) => ({
      id: d._id.toString(),
      user: users.get(d.userId.toString()) ?? null,
      type: d.type,
      from: d.from,
      to: d.to,
      hoursPerDay: d.hoursPerDay ?? undefined,
      reason: d.reason,
      status: d.status,
      decidedBy: d.decidedBy ? (users.get(d.decidedBy.toString()) ?? null) : null,
      canDecide: d.status === 'pending' && (await canApproveFor(auth, d.userId.toString())),
      createdAt: d.createdAt.toISOString(),
    })),
  );
}

export async function requestAvailability(
  rc: RequestContext,
  raw: AvailabilityInput,
): Promise<AvailabilityDto> {
  const auth = requireAuth(rc);
  const input = availabilitySchema.parse(raw);
  const overlap = await Availability.exists({
    userId: auth.userObjectId,
    status: { $in: ['pending', 'approved'] },
    from: { $lte: input.to },
    to: { $gte: input.from },
  });
  if (overlap)
    throw new ConflictError('You already have leave or availability recorded for these dates');
  const doc = await Availability.create({ ...input, userId: auth.userObjectId, status: 'pending' });
  eventBus.publish(
    'availability.requested',
    {
      availabilityId: doc._id.toString(),
      userId: auth.userId,
      type: doc.type,
      from: doc.from,
      to: doc.to,
    },
    { actorId: auth.userId },
  );
  return (await presentAvailability(auth, [doc.toObject()]))[0]!;
}

export async function decideAvailability(
  rc: RequestContext,
  id: string,
  decision: 'approved' | 'rejected',
): Promise<AvailabilityDto> {
  const auth = requireAuth(rc);
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Request');
  const doc = await Availability.findById(id).lean();
  if (!doc) throw new NotFoundError('Request');
  if (!(await canApproveFor(auth, doc.userId.toString()))) throw new NotFoundError('Request');
  const updated = await Availability.findOneAndUpdate(
    { _id: doc._id, status: 'pending' },
    { $set: { status: decision, decidedBy: auth.userObjectId, decidedAt: new Date() } },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw new ConflictError('This request has already been decided');
  const owner = await User.findById(doc.userId).select('name').lean();
  await recordAudit(rc, {
    action: `availability.${decision}`,
    entityType: 'availability',
    entityId: doc._id,
    summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} ${doc.type} for ${owner?.name ?? 'employee'} (${doc.from} to ${doc.to})`,
  });
  eventBus.publish(
    'availability.decided',
    {
      availabilityId: doc._id.toString(),
      userId: doc.userId.toString(),
      decision,
      from: doc.from,
      to: doc.to,
    },
    { actorId: auth.userId },
  );
  if (decision === 'approved' && doc.type !== 'partial') {
    // Automations (Phase 7) and managers can react, e.g. by starting a reassignment review.
    eventBus.publish(
      'user.unavailable',
      { userId: doc.userId.toString(), from: doc.from, to: doc.to },
      { actorId: auth.userId },
    );
  }
  return (await presentAvailability(auth, [updated]))[0]!;
}

export async function cancelAvailability(rc: RequestContext, id: string): Promise<AvailabilityDto> {
  const auth = requireAuth(rc);
  const doc = Types.ObjectId.isValid(id) ? await Availability.findById(id).lean() : null;
  if (!doc || !doc.userId.equals(auth.userObjectId)) throw new NotFoundError('Request');
  if (doc.status === 'approved' && doc.from <= orgToday())
    throw new UnprocessableError('Leave that has started cannot be cancelled');
  const updated = await Availability.findOneAndUpdate(
    { _id: doc._id, status: { $in: ['pending', 'approved'] } },
    { $set: { status: 'cancelled' } },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw new ConflictError('This request can no longer be cancelled');
  return (await presentAvailability(auth, [updated]))[0]!;
}

export async function listAvailability(
  rc: RequestContext,
  raw: unknown,
): Promise<{ items: AvailabilityDto[]; meta: PageMeta }> {
  const auth = requireAuth(rc);
  const q = availabilityQuerySchema.parse(raw);
  const filter: Record<string, unknown> = {};
  if (q.scope === 'mine') filter.userId = auth.userObjectId;
  else {
    const perm = q.scope === 'approvals' ? 'timesheet:approve' : 'team:read';
    if (!auth.permissions[perm]) throw new ForbiddenError();
    const people = await visiblePeople(auth, perm);
    const others = people === 'all' ? null : people.filter((p) => !p.equals(auth.userObjectId));
    filter.userId = others === null ? { $ne: auth.userObjectId } : { $in: others };
    if (q.scope === 'approvals') filter.status = q.status ?? 'pending';
  }
  if (q.status && q.scope !== 'approvals') filter.status = q.status;
  const [docs, total] = await Promise.all([
    Availability.find(filter)
      .sort({ from: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Availability.countDocuments(filter),
  ]);
  return { items: await presentAvailability(auth, docs), meta: toPageMeta(q, total) };
}

/* ============================ Teams & resources ============================ */

/** Capacity vs load for everyone visible under team:read, with utilisation state. */
export async function teamWorkload(
  rc: RequestContext,
  departmentId?: string,
): Promise<WorkloadRowDto[]> {
  const auth = requireAuth(rc);
  if (!auth.permissions['team:read']) throw new ForbiddenError();
  const filter: Record<string, unknown> = {
    $and: [await peopleFilter(auth, auth.permissions['team:read']), { status: 'active' }],
  };
  if (departmentId) (filter.$and as object[]).push({ departmentId: oid(departmentId) });
  const users = await User.find(filter)
    .select('_id departmentId weeklyCapacityHours')
    .populate('departmentId', 'name')
    .lean();
  const ids = users.map((u) => u._id);
  const cfg = await getAssignmentConfig();
  const org = await getOrgSettings();
  const today = orgToday();
  const week = weekStartIso(today);
  const [candidates, taskStats, logged] = await Promise.all([
    loadCandidates(ids, cfg),
    Task.aggregate<{ _id: Types.ObjectId; open: number; inProgress: number; overdue: number }>([
      {
        $match: {
          assigneeId: { $in: ids },
          deletedAt: null,
          status: { $nin: ['done', 'cancelled', 'backlog'] },
        },
      },
      {
        $group: {
          _id: '$assigneeId',
          open: { $sum: 1 },
          inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
          overdue: {
            $sum: {
              $cond: [{ $and: [{ $ne: ['$dueDate', null] }, { $lt: ['$dueDate', today] }] }, 1, 0],
            },
          },
        },
      },
    ]),
    Worklog.aggregate<{ _id: Types.ObjectId; m: number }>([
      { $match: { userId: { $in: ids }, date: { $gte: week, $lte: addDaysIso(week, 6) } } },
      { $group: { _id: '$userId', m: { $sum: '$minutes' } } },
    ]),
  ]);
  const stats = new Map(taskStats.map((s) => [s._id.toString(), s]));
  const hours = new Map(logged.map((l) => [l._id.toString(), l.m / 60]));
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));
  const horizon = horizonDays(org, cfg.horizonDays).length;

  return candidates
    .map((c) => {
      const u = userMap.get(c.id)!;
      const s = stats.get(c.id);
      const utilization = c.capacityHours > 0 ? c.loadHours / c.capacityHours : 0;
      const state: WorkloadRowDto['state'] =
        c.capacityHours <= 0
          ? 'unavailable'
          : utilization > 1
            ? 'overloaded'
            : utilization < cfg.rebalanceLow
              ? 'underutilized'
              : 'balanced';
      return {
        user: {
          ...c.ref,
          department: (u.departmentId as unknown as { name?: string } | null)?.name ?? null,
        },
        weeklyCapacityHours: u.weeklyCapacityHours,
        capacityHours: c.capacityHours,
        loadHours: c.loadHours,
        utilization: Math.round(utilization * 1000) / 10,
        openTasks: s?.open ?? 0,
        inProgressTasks: s?.inProgress ?? 0,
        overdueTasks: s?.overdue ?? 0,
        loggedHoursThisWeek: Math.round((hours.get(c.id) ?? 0) * 100) / 100,
        leaveDaysInHorizon: Math.round((horizon - c.availableDays) * 10) / 10,
        state,
      };
    })
    .sort((a, b) => b.utilization - a.utilization);
}

/* ============================ Employee Work Passport ============================ */

/** Operational work history (not a performance score). Visible to the person and their manager chain. */
export async function workPassport(rc: RequestContext, userId: string): Promise<WorkPassportDto> {
  const auth = requireAuth(rc);
  if (userId !== auth.userId && !(await canSeePerson(auth, 'worklog:read', userId)))
    throw new NotFoundError('Work passport');
  const user = await User.findById(oid(userId))
    .select('name email employeeId designation skills')
    .lean();
  if (!user) throw new NotFoundError('Employee');
  const uid = user._id;
  const [byProject, completed, completedByProject, byCategory] = await Promise.all([
    Worklog.aggregate<{ _id: Types.ObjectId; m: number; last: string }>([
      { $match: { userId: uid } },
      { $group: { _id: '$projectId', m: { $sum: '$minutes' }, last: { $max: '$date' } } },
    ]),
    Task.find({ assigneeId: uid, status: 'done', deletedAt: null })
      .sort({ completedAt: -1 })
      .limit(15)
      .select('key title completedAt projectId')
      .lean(),
    Task.aggregate<{ _id: Types.ObjectId; n: number; last: Date }>([
      { $match: { assigneeId: uid, status: 'done', deletedAt: null } },
      { $group: { _id: '$projectId', n: { $sum: 1 }, last: { $max: '$completedAt' } } },
    ]),
    Worklog.aggregate<{ _id: WorkCategory; m: number }>([
      { $match: { userId: uid } },
      { $group: { _id: '$category', m: { $sum: '$minutes' } } },
    ]),
  ]);
  const projectIds = [
    ...new Set([
      ...byProject.map((p) => p._id.toString()),
      ...completedByProject.map((p) => p._id.toString()),
    ]),
  ];
  const projects = new Map(
    (
      await Project.find({ _id: { $in: projectIds.map(oid) } })
        .select('key name')
        .lean()
    ).map((p) => [p._id.toString(), p]),
  );
  const rows = projectIds
    .map((id) => {
      const p = projects.get(id);
      const h = byProject.find((x) => x._id.toString() === id);
      const c = completedByProject.find((x) => x._id.toString() === id);
      const last =
        [h?.last, c?.last?.toISOString().slice(0, 10)].filter(Boolean).sort().pop() ?? '';
      return p
        ? {
            project: { id, key: p.key, name: p.name },
            hours: Math.round(((h?.m ?? 0) / 60) * 10) / 10,
            tasksCompleted: c?.n ?? 0,
            lastActivity: last,
          }
        : null;
    })
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  return {
    user: toUserRef(user),
    skills: user.skills.map((s) => ({ name: s.name, level: s.level })),
    totals: {
      loggedHours: Math.round((byProject.reduce((s, p) => s + p.m, 0) / 60) * 10) / 10,
      tasksCompleted: completedByProject.reduce((s, p) => s + p.n, 0),
      projects: rows.length,
    },
    projects: rows,
    recentCompleted: completed.map((t) => ({
      id: t._id.toString(),
      key: t.key,
      title: t.title,
      completedAt: t.completedAt?.toISOString() ?? '',
      project: projects.get(t.projectId.toString())?.name ?? '',
    })),
    hoursByCategory: byCategory
      .map((c) => ({ category: c._id, hours: Math.round((c.m / 60) * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours),
  };
}
