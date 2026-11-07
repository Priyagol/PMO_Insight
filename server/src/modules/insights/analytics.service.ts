import { Types, type QueryFilter } from 'mongoose';
import {
  DEFAULT_TASK_EFFORT_HOURS,
  OPEN_RISK_STATUSES,
  TASK_STATUSES,
  analyticsQuerySchema,
  hoursQuerySchema,
  WORK_CATEGORY_LABELS,
  type AnalyticsQuery,
  type HoursRowDto,
  type OverviewDto,
  type ProjectAnalyticsDto,
  type TaskStatus,
  type UserRef,
  type WorkCategory,
} from '@arihant/shared';
import { ForbiddenError, NotFoundError } from '../../core/errors';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { peopleFilter, projectScopeFilter } from '../../core/rbac/work-access';
import {
  addDaysIso,
  daysBetweenIso,
  orgToday,
  toOrgDate,
  weekStartIso,
  ORG_TZ,
} from '../../core/time';
import { getAssignmentConfig, loadCandidates } from '../assignment/workload.service';
import { Activity, AssignmentHistory } from '../collab/collab.models';
import { Department } from '../departments/department.model';
import { Project, type IProject } from '../projects/project.model';
import { DailySnapshot, Risk } from '../risks/risk.model';
import { Task, type ITask } from '../tasks/task.model';
import { Worklog } from '../tracking/tracking.models';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { computeHealth } from './health.service';

const oid = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);
const r1 = (n: number) => Math.round(n * 10) / 10;

/* ---------- Scope ---------- */

export interface AnalyticsScope {
  label: OverviewDto['scope'];
  projects: IProject[];
  projectIds: Types.ObjectId[];
  /** Personal scope: only the caller's own tasks and hours. */
  personal: boolean;
  /** People whose workload/contributions may be shown ('all', a list, or none). */
  people: Types.ObjectId[] | 'all' | null;
  period: { from: string; to: string };
}

/**
 * Everything analytics shows is cut to the caller's analytics:view scope, so reports and
 * exports never exceed what the person can already see elsewhere.
 */
export async function resolveScope(
  auth: AuthContext,
  raw: Partial<AnalyticsQuery>,
): Promise<AnalyticsScope> {
  // Only the shared filter keys; callers may pass extra keys (groupBy, format) of their own.
  const q = analyticsQuerySchema.parse({
    from: raw.from,
    to: raw.to,
    departmentId: raw.departmentId,
    projectId: raw.projectId,
  });
  const scope = auth.permissions['analytics:view'];
  if (!scope) throw new ForbiddenError();
  const today = orgToday();
  const period = { from: q.from ?? addDaysIso(today, -29), to: q.to ?? today };
  if (period.from > period.to)
    throw new ForbiddenError('The start of the period must be before the end');

  const filters: QueryFilter<IProject>[] = [
    { archived: false },
    await projectScopeFilter(auth, scope === 'own' ? 'project' : scope),
  ];
  if (q.projectId) filters.push({ _id: oid(q.projectId) });
  if (q.departmentId) filters.push({ departmentId: oid(q.departmentId) });
  const projects = await Project.find({ $and: filters }).lean();
  if (q.projectId && projects.length === 0) throw new NotFoundError('Project');

  let people: AnalyticsScope['people'] = null;
  if (scope !== 'own') {
    if (scope === 'org' && !q.departmentId) people = 'all';
    else {
      const pf = await peopleFilter(auth, scope);
      const users = await User.find({
        $and: [
          pf,
          { status: 'active' },
          ...(q.departmentId ? [{ departmentId: oid(q.departmentId) }] : []),
        ],
      })
        .select('_id')
        .lean();
      people = users.map((u) => u._id);
    }
  }
  const label: OverviewDto['scope'] =
    scope === 'org'
      ? 'organisation'
      : scope === 'department'
        ? 'department'
        : scope === 'own'
          ? 'personal'
          : 'projects';
  return {
    label,
    projects,
    projectIds: projects.map((p) => p._id),
    personal: scope === 'own',
    people,
    period,
  };
}

function taskFilter(s: AnalyticsScope, auth: AuthContext): QueryFilter<ITask> {
  return {
    projectId: { $in: s.projectIds },
    deletedAt: null,
    ...(s.personal ? { assigneeId: auth.userObjectId } : {}),
  };
}

function logFilter(s: AnalyticsScope, auth: AuthContext): Record<string, unknown> {
  return { projectId: { $in: s.projectIds }, ...(s.personal ? { userId: auth.userObjectId } : {}) };
}

/** Org-calendar day of a stored instant, inside an aggregation. */
const orgDay = (field: string) => ({
  $dateToString: { date: field, format: '%Y-%m-%d', timezone: ORG_TZ },
});

function weekBuckets(from: string, to: string): string[] {
  const weeks: string[] = [];
  for (let w = weekStartIso(from); w <= to; w = addDaysIso(w, 7)) weeks.push(w);
  return weeks;
}

/* ---------- Executive overview ---------- */

export async function overview(
  rc: RequestContext,
  raw: Partial<AnalyticsQuery>,
): Promise<OverviewDto> {
  const auth = requireAuth(rc);
  const s = await resolveScope(auth, raw);
  const today = orgToday();
  const tf = taskFilter(s, auth);
  const lf = logFilter(s, auth);
  const { from, to } = s.period;
  const toEnd = addDaysIso(to, 1);

  const [
    health,
    statusRows,
    taskTotals,
    completedRows,
    createdRows,
    loggedRows,
    perProjectLogged,
    perDeptTasks,
    methods,
    upcomingTasks,
    departments,
  ] = await Promise.all([
    computeHealth(s.projects),
    Task.aggregate<{ _id: TaskStatus; n: number }>([
      { $match: tf },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    Task.aggregate<{ open: number; overdue: number; blocked: number; estOpen: number }>([
      { $match: { ...tf, status: { $nin: ['done', 'cancelled'] } } },
      {
        $group: {
          _id: null,
          open: { $sum: 1 },
          overdue: {
            $sum: {
              $cond: [{ $and: [{ $ne: ['$dueDate', null] }, { $lt: ['$dueDate', today] }] }, 1, 0],
            },
          },
          blocked: { $sum: { $cond: [{ $eq: ['$status', 'blocked'] }, 1, 0] } },
          estOpen: { $sum: { $ifNull: ['$estimatedHours', DEFAULT_TASK_EFFORT_HOURS] } },
        },
      },
    ]),
    Task.aggregate<{ _id: string; n: number; projectId: Types.ObjectId }>([
      { $match: { ...tf, status: 'done', completedAt: { $ne: null } } },
      { $project: { day: orgDay('$completedAt'), projectId: 1 } },
      { $match: { day: { $gte: from, $lte: to } } },
      { $group: { _id: '$day', n: { $sum: 1 } } },
    ]),
    Task.aggregate<{ _id: string; n: number }>([
      {
        $match: {
          ...tf,
          createdAt: {
            $gte: new Date(`${addDaysIso(from, -1)}T00:00:00Z`),
            $lt: new Date(`${addDaysIso(toEnd, 1)}T00:00:00Z`),
          },
        },
      },
      { $project: { day: orgDay('$createdAt') } },
      { $match: { day: { $gte: from, $lte: to } } },
      { $group: { _id: '$day', n: { $sum: 1 } } },
    ]),
    Worklog.aggregate<{ m: number }>([
      { $match: { ...lf, date: { $gte: from, $lte: to } } },
      { $group: { _id: null, m: { $sum: '$minutes' } } },
    ]),
    Worklog.aggregate<{ _id: Types.ObjectId; m: number; mPeriod: number }>([
      { $match: lf },
      {
        $group: {
          _id: '$projectId',
          m: { $sum: '$minutes' },
          mPeriod: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ['$date', from] }, { $lte: ['$date', to] }] },
                '$minutes',
                0,
              ],
            },
          },
        },
      },
    ]),
    Task.aggregate<{
      _id: Types.ObjectId;
      open: number;
      overdue: number;
      completed: number;
      est: number;
    }>([
      { $match: tf },
      {
        $group: {
          _id: '$projectId',
          open: { $sum: { $cond: [{ $in: ['$status', ['done', 'cancelled']] }, 0, 1] } },
          overdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $not: [{ $in: ['$status', ['done', 'cancelled']] }] },
                    { $ne: ['$dueDate', null] },
                    { $lt: ['$dueDate', today] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          completed: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'done'] },
                    { $gte: ['$completedAt', new Date(`${from}T00:00:00Z`)] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          est: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$parentId', null] }, { $ne: ['$status', 'cancelled'] }] },
                { $ifNull: ['$estimatedHours', 0] },
                0,
              ],
            },
          },
        },
      },
    ]),
    AssignmentHistory.aggregate<{ _id: string; n: number }>([
      {
        $match: {
          projectId: { $in: s.projectIds },
          createdAt: { $gte: new Date(`${from}T00:00:00Z`), $lt: new Date(`${toEnd}T00:00:00Z`) },
          ...(s.personal ? { toUserId: auth.userObjectId } : {}),
        },
      },
      { $group: { _id: '$method', n: { $sum: 1 } } },
    ]),
    Task.find({
      ...tf,
      status: { $nin: ['done', 'cancelled'] },
      dueDate: { $gte: today, $lte: addDaysIso(today, 7) },
    })
      .sort({ dueDate: 1, priorityOrder: 1 })
      .limit(8)
      .select('key title dueDate priority assigneeId')
      .lean(),
    Department.find({ archived: false }).select('name').lean(),
  ]);

  /* Projects */
  const bandCounts = { healthy: 0, watch: 0, at_risk: 0 };
  health.forEach((h) => (bandCounts[h.band] += 1));
  const inactive = new Set(['completed', 'cancelled']);
  const projects = {
    total: s.projects.length,
    active: s.projects.filter((p) => !inactive.has(p.status) && p.status !== 'on_hold').length,
    completed: s.projects.filter((p) => p.status === 'completed').length,
    onHold: s.projects.filter((p) => p.status === 'on_hold').length,
    delayed: s.projects.filter((p) => !inactive.has(p.status) && p.endDate && p.endDate < today)
      .length,
    atRisk: health.filter(
      (h) =>
        !inactive.has(h.project.status) && (h.band === 'at_risk' || h.project.status === 'at_risk'),
    ).length,
  };

  /* Tasks */
  const totals = taskTotals[0] ?? { open: 0, overdue: 0, blocked: 0, estOpen: 0 };
  const statusMap = new Map(statusRows.map((r) => [r._id, r.n]));
  const sumMap = (rows: { _id: string; n: number }[]) => rows.reduce((a, r) => a + r.n, 0);

  /* Trend by week */
  const weeks = weekBuckets(from, to);
  const completedByWeek = new Map<string, number>();
  completedRows.forEach((r) =>
    completedByWeek.set(weekStartIso(r._id), (completedByWeek.get(weekStartIso(r._id)) ?? 0) + r.n),
  );
  const createdByWeek = new Map<string, number>();
  createdRows.forEach((r) =>
    createdByWeek.set(weekStartIso(r._id), (createdByWeek.get(weekStartIso(r._id)) ?? 0) + r.n),
  );

  /* Departments */
  const deptName = new Map(departments.map((d) => [d._id.toString(), d.name]));
  const taskByProject = new Map(perDeptTasks.map((r) => [r._id.toString(), r]));
  const logByProject = new Map(perProjectLogged.map((r) => [r._id.toString(), r]));
  const deptRows = new Map<string, OverviewDto['departments'][number]>();
  for (const p of s.projects) {
    const key = p.departmentId?.toString() ?? 'none';
    const row = deptRows.get(key) ?? {
      id: p.departmentId?.toString() ?? null,
      name: p.departmentId ? (deptName.get(key) ?? 'Unknown') : 'No department',
      projects: 0,
      openTasks: 0,
      overdue: 0,
      completed: 0,
      loggedHours: 0,
    };
    const t = taskByProject.get(p._id.toString());
    row.projects += 1;
    row.openTasks += t?.open ?? 0;
    row.overdue += t?.overdue ?? 0;
    row.completed += t?.completed ?? 0;
    row.loggedHours = r1(row.loggedHours + (logByProject.get(p._id.toString())?.mPeriod ?? 0) / 60);
    deptRows.set(key, row);
  }

  /* Planned vs actual (top 10 by estimate) */
  const plannedVsActual = s.projects
    .map((p) => ({
      project: { id: p._id.toString(), key: p.key, name: p.name },
      estimated: r1(p.estimatedHours ?? taskByProject.get(p._id.toString())?.est ?? 0),
      actual: r1((logByProject.get(p._id.toString())?.m ?? 0) / 60),
    }))
    .filter((r) => r.estimated > 0 || r.actual > 0)
    .sort((a, b) => b.estimated - a.estimated)
    .slice(0, 10);

  /* People & workload */
  let people: OverviewDto['people'] = null;
  let workload: OverviewDto['workload'] = [];
  if (s.people !== null) {
    const ids =
      s.people === 'all'
        ? (await User.find({ status: 'active' }).select('_id').limit(1000).lean()).map((u) => u._id)
        : s.people;
    const cfg = await getAssignmentConfig();
    const candidates = await loadCandidates(ids, cfg);
    const withCapacity = candidates.filter((c) => c.capacityHours > 0);
    const utils = withCapacity.map((c) => c.loadHours / c.capacityHours);
    people = {
      total: candidates.length,
      avgUtilization: utils.length
        ? Math.round((utils.reduce((a, b) => a + b, 0) / utils.length) * 1000) / 10
        : null,
      overloaded: utils.filter((u) => u > 1).length,
      onLeave: candidates.length - withCapacity.length,
    };
    workload = withCapacity
      .map((c) => ({
        user: c.ref,
        utilization: Math.round((c.loadHours / c.capacityHours) * 1000) / 10,
        loadHours: c.loadHours,
        capacityHours: c.capacityHours,
      }))
      .sort((a, b) => b.utilization - a.utilization)
      .slice(0, 10);
  }

  /* Upcoming */
  const assignees = new Map<string, UserRef>(
    (
      await User.find({ _id: { $in: upcomingTasks.map((t) => t.assigneeId).filter(Boolean) } })
        .select('name email employeeId designation')
        .lean()
    ).map((u) => [u._id.toString(), toUserRef(u)]),
  );
  const healthMap = new Map(health.map((h) => [h.project.id, h]));

  return {
    period: s.period,
    scope: s.label,
    projects,
    tasks: {
      total: [...statusMap.values()].reduce((a, b) => a + b, 0),
      open: totals.open,
      overdue: totals.overdue,
      blocked: totals.blocked,
      completedInPeriod: sumMap(completedRows),
      createdInPeriod: sumMap(createdRows),
    },
    people,
    hours: { loggedInPeriod: r1((loggedRows[0]?.m ?? 0) / 60), estimatedOpen: r1(totals.estOpen) },
    taskStatus: TASK_STATUSES.map((status) => ({ status, count: statusMap.get(status) ?? 0 })),
    completionTrend: weeks.map((week) => ({
      week,
      completed: completedByWeek.get(week) ?? 0,
      created: createdByWeek.get(week) ?? 0,
    })),
    departments: [...deptRows.values()].sort((a, b) => b.openTasks - a.openTasks),
    plannedVsActual,
    workload,
    assignmentMethods: methods
      .map((m) => ({ method: m._id, count: m.n }))
      .sort((a, b) => b.count - a.count),
    upcoming: {
      projects: s.projects
        .filter(
          (p) =>
            !inactive.has(p.status) &&
            p.endDate &&
            p.endDate >= today &&
            p.endDate <= addDaysIso(today, 30),
        )
        .sort((a, b) => a.endDate!.localeCompare(b.endDate!))
        .slice(0, 6)
        .map((p) => ({
          id: p._id.toString(),
          key: p.key,
          name: p.name,
          endDate: p.endDate!,
          progress: healthMap.get(p._id.toString())?.progress ?? 0,
        })),
      tasks: upcomingTasks.map((t) => ({
        id: t._id.toString(),
        key: t.key,
        title: t.title,
        dueDate: t.dueDate!,
        priority: t.priority,
        assignee: t.assigneeId ? (assignees.get(t.assigneeId.toString()) ?? null) : null,
      })),
    },
    health: bandCounts,
  };
}

/** Recent activity across the projects in scope (for the dashboard feed). */
export async function recentActivity(rc: RequestContext, limit = 12) {
  const auth = requireAuth(rc);
  const s = await resolveScope(auth, {});
  const docs = await Activity.find({ projectId: { $in: s.projectIds } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  const users = new Map(
    (
      await User.find({ _id: { $in: docs.map((d) => d.actorId).filter(Boolean) } })
        .select('name email employeeId designation')
        .lean()
    ).map((u) => [u._id.toString(), toUserRef(u)]),
  );
  return docs.map((d) => ({
    id: d._id.toString(),
    actor: d.actorId ? (users.get(d.actorId.toString()) ?? null) : null,
    entityType: d.entityType,
    entity: { id: d.entityId.toString(), label: d.entityLabel },
    verb: d.verb,
    summary: d.summary,
    changes: [],
    createdAt: d.createdAt.toISOString(),
  }));
}

/* ---------- Project health list ---------- */

export async function projectHealthList(rc: RequestContext, raw: Partial<AnalyticsQuery>) {
  const auth = requireAuth(rc);
  const s = await resolveScope(auth, raw);
  const active = s.projects.filter((p) => p.status !== 'completed' && p.status !== 'cancelled');
  return (await computeHealth(active)).sort((a, b) => a.score - b.score);
}

/* ---------- Daily snapshots (cumulative flow, history) ---------- */

/** Records today's per-project status counts. Idempotent per project and day. */
export async function captureSnapshots(
  projectIds?: Types.ObjectId[],
  date = orgToday(),
): Promise<number> {
  const projects = await Project.find({
    archived: false,
    ...(projectIds ? { _id: { $in: projectIds } } : {}),
  }).lean();
  if (!projects.length) return 0;
  const ids = projects.map((p) => p._id);
  const [rows, risks, health] = await Promise.all([
    Task.aggregate<{
      _id: { p: Types.ObjectId; s: TaskStatus };
      n: number;
      effort: number;
      overdue: number;
    }>([
      { $match: { projectId: { $in: ids }, deletedAt: null, parentId: null } },
      {
        $group: {
          _id: { p: '$projectId', s: '$status' },
          n: { $sum: 1 },
          effort: { $sum: { $ifNull: ['$estimatedHours', DEFAULT_TASK_EFFORT_HOURS] } },
          overdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$dueDate', null] },
                    { $lt: ['$dueDate', date] },
                    { $not: [{ $in: ['$status', ['done', 'cancelled']] }] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    Risk.aggregate<{ _id: Types.ObjectId; n: number }>([
      {
        $match: {
          projectId: { $in: ids },
          deletedAt: null,
          status: { $in: [...OPEN_RISK_STATUSES] },
        },
      },
      { $group: { _id: '$projectId', n: { $sum: 1 } } },
    ]),
    computeHealth(projects),
  ]);
  const ops = projects.map((p) => {
    const mine = rows.filter((r) => r._id.p.equals(p._id));
    const byStatus = Object.fromEntries(mine.map((r) => [r._id.s, r.n]));
    const live = mine.filter((r) => r._id.s !== 'cancelled');
    return {
      updateOne: {
        filter: { projectId: p._id, date },
        update: {
          $set: {
            byStatus,
            totalEffort: live.reduce((a, r) => a + r.effort, 0),
            doneEffort: live.filter((r) => r._id.s === 'done').reduce((a, r) => a + r.effort, 0),
            overdue: mine.reduce((a, r) => a + r.overdue, 0),
            openRisks: risks.find((r) => r._id.equals(p._id))?.n ?? 0,
            healthScore: health.find((h) => h.project.id === p._id.toString())?.score ?? null,
          },
        },
        upsert: true,
      },
    };
  });
  await DailySnapshot.bulkWrite(ops, { ordered: false });
  return ops.length;
}

/* ---------- Per-project analytics ---------- */

export async function projectAnalytics(
  rc: RequestContext,
  projectId: string,
): Promise<ProjectAnalyticsDto> {
  const auth = requireAuth(rc);
  const s = await resolveScope(auth, { projectId });
  const project = s.projects[0]!;
  const today = orgToday();
  await captureSnapshots([project._id], today);

  const tasks = await Task.find({
    projectId: project._id,
    deletedAt: null,
    parentId: null,
    status: { $ne: 'cancelled' },
  })
    .select('createdAt completedAt status estimatedHours dueDate')
    .lean();
  const effort = (t: (typeof tasks)[number]) => t.estimatedHours ?? DEFAULT_TASK_EFFORT_HOURS;
  const firstDay =
    project.startDate ??
    (tasks.length
      ? toOrgDate(tasks.reduce((m, t) => (t.createdAt < m ? t.createdAt : m), tasks[0]!.createdAt))
      : today);
  const lastDay = today;
  const span = Math.max(daysBetweenIso(firstDay, lastDay), 0);
  const step = span > 120 ? 7 : 1;

  // Burndown reconstructed from task creation and completion times (works retroactively).
  const created = tasks.map((t) => ({
    day: toOrgDate(t.createdAt),
    done: t.status === 'done' && t.completedAt ? toOrgDate(t.completedAt) : null,
    effort: effort(t),
  }));
  const startRemaining = created
    .filter((t) => t.day <= firstDay && (!t.done || t.done > firstDay))
    .reduce((a, t) => a + t.effort, 0);
  const totalDays =
    project.startDate && project.endDate
      ? Math.max(daysBetweenIso(project.startDate, project.endDate), 1)
      : null;
  const burndown: ProjectAnalyticsDto['burndown'] = [];
  for (let i = 0; i <= span; i += step) {
    const day = addDaysIso(firstDay, i);
    const remaining = created
      .filter((t) => t.day <= day && (!t.done || t.done > day))
      .reduce((a, t) => a + t.effort, 0);
    const ideal =
      totalDays !== null
        ? Math.max(startRemaining * (1 - daysBetweenIso(project.startDate!, day) / totalDays), 0)
        : null;
    burndown.push({
      date: day,
      remaining: r1(remaining),
      ideal: ideal === null ? null : r1(ideal),
    });
  }

  // Weekly throughput, last 12 weeks.
  const weeks = weekBuckets(addDaysIso(today, -7 * 11), today);
  const done = tasks.filter((t) => t.status === 'done' && t.completedAt);
  const throughput = weeks.map((week) => {
    const inWeek = done.filter((t) => weekStartIso(toOrgDate(t.completedAt!)) === week);
    return {
      week,
      completed: inWeek.length,
      effort: r1(inWeek.reduce((a, t) => a + effort(t), 0)),
    };
  });

  const snaps = await DailySnapshot.find({
    projectId: project._id,
    date: { $gte: addDaysIso(today, -59) },
  })
    .sort({ date: 1 })
    .lean();
  const onTime = { completed: done.length, onTime: 0, late: 0, noDueDate: 0 };
  let cycleTotal = 0;
  for (const t of done) {
    const day = toOrgDate(t.completedAt!);
    if (!t.dueDate) onTime.noDueDate += 1;
    else if (day <= t.dueDate) onTime.onTime += 1;
    else onTime.late += 1;
    cycleTotal += (t.completedAt!.getTime() - t.createdAt.getTime()) / 86_400_000;
  }
  const [health] = await computeHealth([project]);
  return {
    burndown,
    throughput,
    flow: snaps.map((sn) => ({
      date: sn.date,
      counts: sn.byStatus as Partial<Record<TaskStatus, number>>,
    })),
    onTime,
    avgCycleDays: done.length ? r1(cycleTotal / done.length) : null,
    health: health!,
  };
}

/* ---------- Hours ---------- */

export async function hoursBreakdown(rc: RequestContext, raw: unknown): Promise<HoursRowDto[]> {
  const auth = requireAuth(rc);
  const q = hoursQuerySchema.parse(raw);
  const s = await resolveScope(auth, q);
  const match: Record<string, unknown> = {
    ...logFilter(s, auth),
    date: { $gte: s.period.from, $lte: s.period.to },
  };
  if (!s.personal && s.people !== null && s.people !== 'all' && q.groupBy === 'user')
    match.userId = { $in: s.people };
  const groupKey =
    q.groupBy === 'project'
      ? '$projectId'
      : q.groupBy === 'user'
        ? '$userId'
        : q.groupBy === 'category'
          ? '$category'
          : '$date';
  const rows = await Worklog.aggregate<{ _id: unknown; m: number; n: number }>([
    { $match: match },
    { $group: { _id: groupKey, m: { $sum: '$minutes' }, n: { $sum: 1 } } },
  ]);
  let out: HoursRowDto[];
  if (q.groupBy === 'week') {
    const byWeek = new Map<string, { m: number; n: number }>();
    for (const r of rows) {
      const w = weekStartIso(r._id as string);
      const cur = byWeek.get(w) ?? { m: 0, n: 0 };
      byWeek.set(w, { m: cur.m + r.m, n: cur.n + r.n });
    }
    out = weekBuckets(s.period.from, s.period.to).map((w) => ({
      key: w,
      label: w,
      hours: r1((byWeek.get(w)?.m ?? 0) / 60),
      entries: byWeek.get(w)?.n ?? 0,
    }));
    return out;
  }
  if (q.groupBy === 'category') {
    out = rows.map((r) => ({
      key: String(r._id),
      label: WORK_CATEGORY_LABELS[r._id as WorkCategory] ?? String(r._id),
      hours: r1(r.m / 60),
      entries: r.n,
    }));
  } else {
    const ids = rows.map((r) => r._id as Types.ObjectId);
    const names =
      q.groupBy === 'project'
        ? new Map(
            (
              await Project.find({ _id: { $in: ids } })
                .select('key name')
                .lean()
            ).map((p) => [p._id.toString(), `${p.key} · ${p.name}`]),
          )
        : new Map(
            (
              await User.find({ _id: { $in: ids } })
                .select('name')
                .lean()
            ).map((u) => [u._id.toString(), u.name]),
          );
    out = rows.map((r) => ({
      key: String(r._id),
      label: names.get(String(r._id)) ?? 'Unknown',
      hours: r1(r.m / 60),
      entries: r.n,
    }));
  }
  return out.sort((a, b) => b.hours - a.hours);
}
