import { Types } from 'mongoose';
import {
  MAX_MINUTES_PER_DAY,
  createWorklogSchema,
  stopTimerSchema,
  updateWorklogSchema,
  worklogQuerySchema,
  type CreateWorklogInput,
  type PageMeta,
  type StartTimerInput,
  type TimerDto,
  type UpdateWorklogInput,
  type WorklogDto,
  type WorklogQuery,
} from '@arihant/shared';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../../core/errors';
import { toPageMeta } from '../../core/pagination';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { canSeePerson, isProjectParticipant } from '../../core/rbac/work-access';
import { orgDateTime, orgTimeOf, orgToday, toOrgDate, weekStartIso } from '../../core/time';
import { eventBus } from '../../core/events';
import { Project, type IProject } from '../projects/project.model';
import { Task } from '../tasks/task.model';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { Timer, Timesheet, Worklog, type ITimer, type IWorklog } from './tracking.models';

const oid = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

/* ---------- Shared rules ---------- */

/** Keeps Task.actualHours equal to the sum of its work logs. */
export async function recalcActualHours(
  taskIds: (Types.ObjectId | null | undefined)[],
): Promise<void> {
  const ids = [...new Set(taskIds.filter(Boolean).map(String))].map(oid);
  if (!ids.length) return;
  const sums = await Worklog.aggregate<{ _id: Types.ObjectId; minutes: number }>([
    { $match: { taskId: { $in: ids } } },
    { $group: { _id: '$taskId', minutes: { $sum: '$minutes' } } },
  ]);
  const byId = new Map(sums.map((s) => [s._id.toString(), s.minutes]));
  await Task.bulkWrite(
    ids.map((id) => ({
      updateOne: {
        filter: { _id: id },
        update: {
          $set: { actualHours: Math.round(((byId.get(id.toString()) ?? 0) / 60) * 100) / 100 },
        },
      },
    })),
  );
}

/** Work in a submitted or approved week is locked until the timesheet is rejected. */
async function assertWeekOpen(userId: Types.ObjectId, date: string): Promise<void> {
  const sheet = await Timesheet.findOne({ userId, weekStart: weekStartIso(date) })
    .select('status')
    .lean();
  if (sheet && (sheet.status === 'submitted' || sheet.status === 'approved')) {
    throw new UnprocessableError(
      `The timesheet for this week is ${sheet.status}; its work logs are locked`,
    );
  }
}

/** You can log work on projects you belong to, or on tasks assigned to you. */
async function assertLoggable(
  auth: AuthContext,
  projectId: string,
  taskId?: string | null,
): Promise<IProject> {
  const project = await Project.findById(oid(projectId)).lean();
  if (!project) throw new NotFoundError('Project');
  if (project.archived) throw new UnprocessableError('This project is archived');
  let assignedToMe = false;
  if (taskId) {
    const task = await Task.findOne({ _id: oid(taskId), deletedAt: null })
      .select('projectId assigneeId')
      .lean();
    if (!task || !task.projectId.equals(project._id))
      throw new UnprocessableError('The task does not belong to this project');
    assignedToMe = task.assigneeId?.toString() === auth.userId;
  }
  if (!assignedToMe && !isProjectParticipant(project, auth.userId)) {
    throw new ForbiddenError('You can only log work on your projects or tasks assigned to you');
  }
  return project;
}

async function assertCapacityAndOverlap(
  userId: Types.ObjectId,
  date: string,
  minutes: number,
  range: { start: Date; end: Date } | null,
  excludeId?: Types.ObjectId,
): Promise<void> {
  const notSelf = excludeId ? { _id: { $ne: excludeId } } : {};
  const [day] = await Worklog.aggregate<{ minutes: number }>([
    { $match: { userId, date, ...notSelf } },
    { $group: { _id: null, minutes: { $sum: '$minutes' } } },
  ]);
  if ((day?.minutes ?? 0) + minutes > MAX_MINUTES_PER_DAY) {
    throw new UnprocessableError('Total logged time for a day cannot exceed 24 hours');
  }
  if (range) {
    const overlap = await Worklog.findOne({
      userId,
      ...notSelf,
      startedAt: { $lt: range.end },
      endedAt: { $gt: range.start },
    })
      .select('startedAt endedAt')
      .lean();
    if (overlap) {
      throw new ConflictError(
        `This overlaps another entry (${orgTimeOf(overlap.startedAt!)}–${orgTimeOf(overlap.endedAt!)}). Adjust the times.`,
      );
    }
  }
}

function resolveDuration(
  date: string,
  input: { minutes?: number; startTime?: string; endTime?: string },
) {
  if (input.startTime && input.endTime) {
    const start = orgDateTime(date, input.startTime);
    const end = orgDateTime(date, input.endTime);
    return {
      minutes: Math.round((end.getTime() - start.getTime()) / 60_000),
      range: { start, end },
    };
  }
  return { minutes: input.minutes!, range: null };
}

/* ---------- Presentation ---------- */

async function present(docs: IWorklog[]): Promise<WorklogDto[]> {
  const [users, projects, tasks, sheets] = await Promise.all([
    User.find({ _id: { $in: docs.map((d) => d.userId) } })
      .select('name email employeeId designation')
      .lean(),
    Project.find({ _id: { $in: docs.map((d) => d.projectId) } })
      .select('key name')
      .lean(),
    Task.find({ _id: { $in: docs.map((d) => d.taskId).filter(Boolean) } })
      .select('key title')
      .lean(),
    Timesheet.find({
      userId: { $in: docs.map((d) => d.userId) },
      weekStart: { $in: [...new Set(docs.map((d) => weekStartIso(d.date)))] },
      status: { $in: ['submitted', 'approved'] },
    })
      .select('userId weekStart')
      .lean(),
  ]);
  const u = new Map(users.map((x) => [x._id.toString(), toUserRef(x)]));
  const p = new Map(
    projects.map((x) => [x._id.toString(), { id: x._id.toString(), key: x.key, name: x.name }]),
  );
  const t = new Map(
    tasks.map((x) => [x._id.toString(), { id: x._id.toString(), key: x.key, title: x.title }]),
  );
  const locked = new Set(sheets.map((s) => `${s.userId.toString()}:${s.weekStart}`));
  return docs.map((d) => ({
    id: d._id.toString(),
    user: u.get(d.userId.toString()) ?? null,
    date: d.date,
    project: p.get(d.projectId.toString()) ?? {
      id: d.projectId.toString(),
      key: '?',
      name: 'Unknown project',
    },
    task: d.taskId ? (t.get(d.taskId.toString()) ?? null) : null,
    description: d.description,
    category: d.category,
    minutes: d.minutes,
    startTime: d.startedAt ? orgTimeOf(d.startedAt) : undefined,
    endTime: d.endedAt ? orgTimeOf(d.endedAt) : undefined,
    source: d.source,
    locked: locked.has(`${d.userId.toString()}:${weekStartIso(d.date)}`),
    createdAt: d.createdAt.toISOString(),
  }));
}

/* ---------- Work logs ---------- */

export async function createWorklog(
  rc: RequestContext,
  raw: CreateWorklogInput,
): Promise<WorklogDto> {
  const auth = requireAuth(rc);
  const input = createWorklogSchema.parse(raw);
  if (input.date > orgToday())
    throw new UnprocessableError('You cannot log work for a future date');
  await assertLoggable(auth, input.projectId, input.taskId);
  await assertWeekOpen(auth.userObjectId, input.date);
  const { minutes, range } = resolveDuration(input.date, input);
  await assertCapacityAndOverlap(auth.userObjectId, input.date, minutes, range);
  const doc = await Worklog.create({
    userId: auth.userObjectId,
    projectId: oid(input.projectId),
    taskId: input.taskId ? oid(input.taskId) : null,
    date: input.date,
    description: input.description,
    category: input.category,
    minutes,
    startedAt: range?.start ?? null,
    endedAt: range?.end ?? null,
    source: 'manual',
  });
  await recalcActualHours([doc.taskId]);
  eventBus.publish(
    'worklog.created',
    { worklogId: doc._id.toString(), userId: auth.userId },
    { actorId: auth.userId },
  );
  return (await present([doc.toObject()]))[0]!;
}

async function loadOwnLog(auth: AuthContext, id: string): Promise<IWorklog> {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Work log');
  const log = await Worklog.findById(id).lean();
  if (!log || !log.userId.equals(auth.userObjectId)) throw new NotFoundError('Work log');
  await assertWeekOpen(log.userId, log.date);
  return log;
}

export async function updateWorklog(
  rc: RequestContext,
  id: string,
  raw: UpdateWorklogInput,
): Promise<WorklogDto> {
  const auth = requireAuth(rc);
  const input = updateWorklogSchema.parse(raw);
  const log = await loadOwnLog(auth, id);
  const date = input.date ?? log.date;
  if (date > orgToday()) throw new UnprocessableError('You cannot log work for a future date');
  if (input.date && input.date !== log.date) await assertWeekOpen(log.userId, input.date);
  const projectId = input.projectId ?? log.projectId.toString();
  const taskId = input.taskId !== undefined ? input.taskId : log.taskId?.toString();
  if (input.projectId || input.taskId !== undefined) await assertLoggable(auth, projectId, taskId);

  let minutes = input.minutes ?? log.minutes;
  let range = log.startedAt && log.endedAt ? { start: log.startedAt, end: log.endedAt } : null;
  if (input.startTime && input.endTime) ({ minutes, range } = resolveDuration(date, input));
  else if (input.minutes !== undefined) range = null;
  else if (input.date && range)
    ({ minutes, range } = resolveDuration(date, {
      startTime: orgTimeOf(range.start),
      endTime: orgTimeOf(range.end),
    }));
  await assertCapacityAndOverlap(log.userId, date, minutes, range, log._id);

  const updated = await Worklog.findByIdAndUpdate(
    log._id,
    {
      $set: {
        date,
        projectId: oid(projectId),
        taskId: taskId ? oid(taskId) : null,
        minutes,
        startedAt: range?.start ?? null,
        endedAt: range?.end ?? null,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
      },
    },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  await recalcActualHours([log.taskId, updated!.taskId]);
  return (await present([updated!]))[0]!;
}

export async function deleteWorklog(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  const log = await loadOwnLog(auth, id);
  await Worklog.deleteOne({ _id: log._id });
  await recalcActualHours([log.taskId]);
}

export async function listWorklogs(
  rc: RequestContext,
  raw: WorklogQuery,
): Promise<{ items: WorklogDto[]; meta: PageMeta; totalMinutes: number }> {
  const auth = requireAuth(rc);
  const q = worklogQuerySchema.parse(raw);
  const userId = !q.userId || q.userId === 'me' ? auth.userId : q.userId;
  if (userId !== auth.userId && !(await canSeePerson(auth, 'worklog:read', userId)))
    throw new NotFoundError('Work logs');
  const filter: Record<string, unknown> = { userId: oid(userId) };
  if (q.projectId) filter.projectId = oid(q.projectId);
  if (q.taskId) filter.taskId = oid(q.taskId);
  if (q.from || q.to)
    filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const [docs, total, sum] = await Promise.all([
    Worklog.find(filter)
      .sort({ date: -1, startedAt: -1, createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Worklog.countDocuments(filter),
    Worklog.aggregate<{ m: number }>([
      { $match: filter },
      { $group: { _id: null, m: { $sum: '$minutes' } } },
    ]),
  ]);
  return { items: await present(docs), meta: toPageMeta(q, total), totalMinutes: sum[0]?.m ?? 0 };
}

/* ---------- Timer ---------- */

async function presentTimer(t: ITimer): Promise<TimerDto> {
  const [project, task] = await Promise.all([
    Project.findById(t.projectId).select('key name').lean(),
    t.taskId ? Task.findById(t.taskId).select('key title').lean() : null,
  ]);
  return {
    project: {
      id: t.projectId.toString(),
      key: project?.key ?? '?',
      name: project?.name ?? 'Unknown project',
    },
    task: task ? { id: task._id.toString(), key: task.key, title: task.title } : null,
    description: t.description,
    category: t.category,
    running: Boolean(t.runningSince),
    startedAt: (t.runningSince ?? t.firstStartedAt).toISOString(),
    accumulatedMs: t.accumulatedMs,
    serverNow: new Date().toISOString(),
  };
}

export async function getTimer(rc: RequestContext): Promise<TimerDto | null> {
  const auth = requireAuth(rc);
  const t = await Timer.findOne({ userId: auth.userObjectId }).lean();
  return t ? presentTimer(t) : null;
}

/** One timer per person (unique index): a second start is rejected, never silently replaced. */
export async function startTimer(rc: RequestContext, input: StartTimerInput): Promise<TimerDto> {
  const auth = requireAuth(rc);
  await assertLoggable(auth, input.projectId, input.taskId);
  const now = new Date();
  try {
    const doc = await Timer.create({
      userId: auth.userObjectId,
      projectId: oid(input.projectId),
      taskId: input.taskId ? oid(input.taskId) : null,
      description: input.description,
      category: input.category ?? 'development',
      firstStartedAt: now,
      runningSince: now,
      accumulatedMs: 0,
    });
    return presentTimer(doc.toObject());
  } catch (err) {
    if ((err as { code?: number }).code === 11000)
      throw new ConflictError('A timer is already running. Stop it before starting another.');
    throw err;
  }
}

export async function pauseTimer(rc: RequestContext): Promise<TimerDto> {
  const auth = requireAuth(rc);
  const t = await Timer.findOne({ userId: auth.userObjectId }).lean();
  if (!t) throw new NotFoundError('Timer');
  if (!t.runningSince) return presentTimer(t);
  const elapsed = Date.now() - t.runningSince.getTime();
  const updated = await Timer.findOneAndUpdate(
    { _id: t._id, runningSince: t.runningSince },
    { $set: { runningSince: null }, $inc: { accumulatedMs: elapsed } },
    { returnDocument: 'after' },
  ).lean();
  return presentTimer(updated ?? t);
}

export async function resumeTimer(rc: RequestContext): Promise<TimerDto> {
  const auth = requireAuth(rc);
  const t = await Timer.findOneAndUpdate(
    { userId: auth.userObjectId, runningSince: null },
    { $set: { runningSince: new Date() } },
    { returnDocument: 'after' },
  ).lean();
  if (t) return presentTimer(t);
  const existing = await Timer.findOne({ userId: auth.userObjectId }).lean();
  if (!existing) throw new NotFoundError('Timer');
  return presentTimer(existing);
}

/** Stops the timer and turns the tracked time into a work log (or discards it). */
export async function stopTimer(
  rc: RequestContext,
  raw: unknown,
): Promise<{ worklog: WorklogDto | null }> {
  const auth = requireAuth(rc);
  const input = stopTimerSchema.parse(raw ?? {});
  const t = await Timer.findOneAndDelete({ userId: auth.userObjectId }).lean();
  if (!t) throw new NotFoundError('Timer');
  if (input.discard) return { worklog: null };

  const now = new Date();
  const totalMs = t.accumulatedMs + (t.runningSince ? now.getTime() - t.runningSince.getTime() : 0);
  const minutes = Math.min(Math.round(totalMs / 60_000), MAX_MINUTES_PER_DAY);
  const restore = () => Timer.create({ ...t, _id: t._id }).catch(() => undefined);
  if (minutes < 1) {
    await restore();
    throw new UnprocessableError(
      'Less than a minute was tracked. Keep the timer running or discard it.',
    );
  }
  const description = input.description ?? t.description;
  if (!description || description.trim().length < 3) {
    await restore();
    throw new UnprocessableError(
      'Describe the work (at least 3 characters) before stopping the timer',
    );
  }
  const date = toOrgDate(t.firstStartedAt);
  const range = {
    start: t.firstStartedAt,
    end: new Date(t.firstStartedAt.getTime() + minutes * 60_000),
  };
  try {
    await assertWeekOpen(auth.userObjectId, date);
    await assertCapacityAndOverlap(auth.userObjectId, date, minutes, range);
  } catch (err) {
    await restore();
    throw err;
  }
  const doc = await Worklog.create({
    userId: auth.userObjectId,
    projectId: t.projectId,
    taskId: t.taskId,
    date,
    description: description.trim(),
    category: t.category,
    minutes,
    startedAt: range.start,
    endedAt: range.end,
    source: 'timer',
  });
  await recalcActualHours([doc.taskId]);
  return { worklog: (await present([doc.toObject()]))[0]! };
}

export { present as presentWorklogs };
