import { Types } from 'mongoose';
import {
  STATUS_LABELS,
  type BottlenecksDto,
  type PerformanceTrendsDto,
  type ProjectStatusDto,
  type ProjectStatusQuery,
  type ProjectStatusRowDto,
  type Rag,
  type TaskStatus,
  type TrendDirection,
  type WorkSummaryDto,
  type WorkSummaryPersonDto,
  type WorkSummaryQuery,
} from '@arihant/shared';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { addDaysIso, orgToday, startOfOrgDay, toOrgDate, weekStartIso } from '../../core/time';
import { Journal, Worklog } from '../tracking/tracking.models';
import { Risk } from '../risks/risk.model';
import { Task } from '../tasks/task.model';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { TaskTransition } from '../workflows/workflow.models';
import { resolveScope, type AnalyticsScope } from './analytics.service';
import { forecastProject } from './forecast.service';
import { computeHealth } from './health.service';

const r1 = (n: number) => Math.round(n * 10) / 10;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const names = (list: string[], max = 4) =>
  list.length <= max
    ? list.join(', ')
    : `${list.slice(0, max).join(', ')} and ${list.length - max} more`;
const MAX_PEOPLE = 300;
const OPEN: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'testing', 'blocked'];

/** People in the caller's analytics scope (only themselves for personal scope). */
async function scopePeople(s: AnalyticsScope, selfId: Types.ObjectId, departmentId?: string) {
  const filter: Record<string, unknown> = { status: 'active' };
  if (s.personal || s.people === null) filter._id = selfId;
  else if (s.people !== 'all') filter._id = { $in: s.people };
  if (departmentId && !s.personal) filter.departmentId = new Types.ObjectId(departmentId);
  return User.find(filter)
    .select('name email employeeId designation')
    .sort({ name: 1 })
    .limit(MAX_PEOPLE)
    .lean();
}

/* ============================ Work summary ============================ */

/** What each visible person did in the period: hours, finished work, hand-overs, blockers. */
export async function workSummary(
  rc: RequestContext,
  q: WorkSummaryQuery,
): Promise<WorkSummaryDto> {
  const auth = requireAuth(rc);
  const today = orgToday();
  const period = { from: q.from ?? today, to: q.to ?? q.from ?? today };
  const s = await resolveScope(auth, { ...period, departmentId: q.departmentId });
  const users = await scopePeople(s, auth.userObjectId, q.departmentId);
  const ids = users.map((u) => u._id);
  const start = startOfOrgDay(period.from);
  const end = startOfOrgDay(addDaysIso(period.to, 1));

  const [logged, completed, moves, overdue, journals] = await Promise.all([
    Worklog.aggregate<{ _id: Types.ObjectId; m: number }>([
      { $match: { userId: { $in: ids }, date: { $gte: period.from, $lte: period.to } } },
      { $group: { _id: '$userId', m: { $sum: '$minutes' } } },
    ]),
    Task.find({
      assigneeId: { $in: ids },
      status: 'done',
      deletedAt: null,
      completedAt: { $gte: start, $lt: end },
    })
      .select('assigneeId key title')
      .sort({ completedAt: 1 })
      .lean(),
    TaskTransition.find({
      actorId: { $in: ids },
      at: { $gte: start, $lt: end },
      to: { $in: ['in_progress', 'in_review', 'testing'] },
    })
      .select('actorId from to')
      .lean(),
    Task.aggregate<{ _id: Types.ObjectId; n: number }>([
      {
        $match: {
          assigneeId: { $in: ids },
          deletedAt: null,
          status: { $in: OPEN },
          dueDate: { $ne: null, $lt: today },
        },
      },
      { $group: { _id: '$assigneeId', n: { $sum: 1 } } },
    ]),
    Journal.find({
      userId: { $in: ids },
      date: { $gte: period.from, $lte: period.to },
      blockers: { $nin: [null, ''] },
    })
      .select('userId blockers date')
      .lean(),
  ]);

  const hours = new Map(logged.map((l) => [l._id.toString(), l.m / 60]));
  const late = new Map(overdue.map((o) => [o._id.toString(), o.n]));
  const people: WorkSummaryPersonDto[] = users.map((u) => {
    const id = u._id.toString();
    const mine = moves.filter((m) => m.actorId?.toString() === id);
    return {
      user: toUserRef(u),
      loggedHours: r1(hours.get(id) ?? 0),
      completed: completed
        .filter((t) => t.assigneeId?.toString() === id)
        .map((t) => ({ id: t._id.toString(), key: t.key, title: t.title })),
      handedOver: mine.filter((m) => m.to === 'in_review' || m.to === 'testing').length,
      started: mine.filter(
        (m) => m.to === 'in_progress' && (m.from === 'todo' || m.from === 'backlog'),
      ).length,
      overdue: late.get(id) ?? 0,
      blockers: journals
        .filter((j) => j.userId.toString() === id)
        .map((j) => j.blockers.trim())
        .filter(Boolean),
      noTimeLogged: !hours.get(id),
    };
  });
  const totals = {
    loggedHours: r1(people.reduce((a, p) => a + p.loggedHours, 0)),
    completed: people.reduce((a, p) => a + p.completed.length, 0),
    handedOver: people.reduce((a, p) => a + p.handedOver, 0),
    overdue: people.reduce((a, p) => a + p.overdue, 0),
  };

  const highlights: string[] = [];
  const span = period.from === period.to ? 'on this day' : 'in this period';
  const finishers = people.filter((p) => p.completed.length);
  highlights.push(
    totals.completed
      ? `${plural(totals.completed, 'task')} finished ${span} by ${plural(finishers.length, 'person', 'people')}; ${totals.loggedHours} h logged in total.`
      : `No tasks were finished ${span}; ${totals.loggedHours} h logged in total.`,
  );
  if (totals.handedOver)
    highlights.push(`${plural(totals.handedOver, 'task')} handed over for review or testing.`);
  const silent = people.filter((p) => p.noTimeLogged).map((p) => p.user.name);
  if (silent.length && people.length > 1) highlights.push(`No time logged by ${names(silent)}.`);
  if (totals.overdue) {
    const worst = [...people].sort((a, b) => b.overdue - a.overdue)[0]!;
    highlights.push(
      `${plural(totals.overdue, 'open task')} past due; the most are with ${worst.user.name} (${worst.overdue}).`,
    );
  }
  const blocked = people.filter((p) => p.blockers.length).map((p) => p.user.name);
  if (blocked.length) highlights.push(`Blockers reported in journals by ${names(blocked)}.`);
  return { period, people, totals, highlights };
}

/* ============================ Project status ============================ */

/** Red / amber / green status per project with the reasons behind it. */
export async function projectStatus(
  rc: RequestContext,
  q: ProjectStatusQuery,
): Promise<ProjectStatusDto> {
  const auth = requireAuth(rc);
  const today = orgToday();
  const period = { from: q.from ?? addDaysIso(today, -6), to: q.to ?? today };
  const s = await resolveScope(auth, { ...period, departmentId: q.departmentId });
  const projects = s.projects.filter((p) => p.status !== 'completed' && p.status !== 'cancelled');
  const ids = projects.map((p) => p._id);
  const start = startOfOrgDay(period.from);
  const end = startOfOrgDay(addDaysIso(period.to, 1));
  const [health, tasks, risks, managers] = await Promise.all([
    computeHealth(projects),
    Task.find({ projectId: { $in: ids }, deletedAt: null })
      .select(
        'projectId key title status estimatedHours completedAt dueDate assigneeId parentId createdAt',
      )
      .lean(),
    Risk.aggregate<{ _id: Types.ObjectId; n: number }>([
      {
        $match: {
          projectId: { $in: ids },
          deletedAt: null,
          severity: 'critical',
          status: { $in: ['open', 'mitigating'] },
        },
      },
      { $group: { _id: '$projectId', n: { $sum: 1 } } },
    ]),
    User.find({ _id: { $in: projects.map((p) => p.managerId) } })
      .select('name email employeeId designation')
      .lean(),
  ]);
  const healthOf = new Map(health.map((h) => [h.project.id, h]));
  const critical = new Map(risks.map((r) => [r._id.toString(), r.n]));
  const manager = new Map(managers.map((m) => [m._id.toString(), toUserRef(m)]));
  const byProject = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const k = t.projectId.toString();
    byProject.set(k, [...(byProject.get(k) ?? []), t]);
  }

  const rows: ProjectStatusRowDto[] = projects.map((p) => {
    const id = p._id.toString();
    const list = byProject.get(id) ?? [];
    const h = healthOf.get(id);
    const f = forecastProject(p, list, today);
    const open = list.filter((t) => OPEN.includes(t.status));
    const overdue = open.filter((t) => t.dueDate && t.dueDate < today).length;
    const blocked = open.filter((t) => t.status === 'blocked').length;
    const crit = critical.get(id) ?? 0;
    const completedInPeriod = list.filter(
      (t) => t.status === 'done' && t.completedAt && t.completedAt >= start && t.completedAt < end,
    ).length;
    const createdInPeriod = list.filter((t) => t.createdAt >= start && t.createdAt < end).length;
    const notes: string[] = [];
    let rag: Rag = 'green';
    const worse = (to: Rag) => {
      if (to === 'red' || (to === 'amber' && rag === 'green')) rag = to;
    };
    if (h?.band === 'at_risk') {
      worse('red');
      notes.push(`Health score ${h.score}/100 is in the at-risk band.`);
    } else if (h?.band === 'watch') {
      worse('amber');
      notes.push(`Health score ${h.score}/100 needs watching.`);
    }
    if (f.label === 'likely_late') {
      worse('red');
      notes.push(
        `At the current pace it finishes around ${f.forecastDate}${f.slipDays ? `, ${plural(f.slipDays, 'day')} after the end date` : ''}.`,
      );
    } else if (f.label === 'at_risk') {
      worse('amber');
      notes.push('The forecast finish is close to the end date.');
    }
    if (overdue) {
      worse(open.length && overdue / open.length > 0.25 ? 'red' : 'amber');
      notes.push(`${plural(overdue, 'open task')} past due.`);
    }
    if (blocked) {
      worse('amber');
      notes.push(`${plural(blocked, 'task')} blocked.`);
    }
    if (crit) {
      worse('red');
      notes.push(`${plural(crit, 'open critical risk')}.`);
    }
    if (!notes.length) notes.push('No overdue or blocked work and no critical risks.');
    return {
      project: { id, key: p.key, name: p.name, endDate: p.endDate ?? undefined },
      manager: manager.get(p.managerId.toString()) ?? null,
      rag,
      healthScore: h?.score ?? 0,
      progress: h?.progress ?? 0,
      completedInPeriod,
      createdInPeriod,
      overdue,
      blocked,
      openCriticalRisks: crit,
      forecastDate: f.forecastDate,
      slipDays: f.slipDays,
      notes,
    };
  });
  const rank: Record<Rag, number> = { red: 0, amber: 1, green: 2 };
  rows.sort((a, b) => rank[a.rag] - rank[b.rag] || a.healthScore - b.healthScore);
  const counts = { red: 0, amber: 0, green: 0 } as Record<Rag, number>;
  for (const r of rows) counts[r.rag] += 1;
  const highlights: string[] = [];
  if (!rows.length) highlights.push('No active projects in view.');
  else {
    highlights.push(
      `${plural(rows.length, 'active project')}: ${counts.red} red, ${counts.amber} amber, ${counts.green} green.`,
    );
    const done = rows.reduce((a, r) => a + r.completedInPeriod, 0);
    const added = rows.reduce((a, r) => a + r.createdInPeriod, 0);
    highlights.push(
      `${plural(done, 'task')} finished and ${plural(added, 'task')} added in the period.`,
    );
    const late = rows.filter((r) => r.slipDays && r.slipDays > 0).map((r) => r.project.key);
    if (late.length) highlights.push(`Forecast to finish after their end date: ${names(late, 6)}.`);
  }
  return { period, projects: rows, counts, highlights };
}

/* ============================ Performance trends ============================ */

/** The last 8 full weeks plus the current (unfinished) week. */
const WEEKS = 9;

/** Completed tasks per week for the last 8 weeks, and whether the pace is rising or falling. */
export async function performanceTrends(
  rc: RequestContext,
  q: { departmentId?: string } = {},
): Promise<PerformanceTrendsDto> {
  const auth = requireAuth(rc);
  const today = orgToday();
  const thisWeek = weekStartIso(today);
  const weeks = Array.from({ length: WEEKS }, (_, i) => addDaysIso(thisWeek, (i - WEEKS + 1) * 7));
  const s = await resolveScope(auth, { from: weeks[0], to: today, departmentId: q.departmentId });
  const users = await scopePeople(s, auth.userObjectId, q.departmentId);
  const done = await Task.find({
    assigneeId: { $in: users.map((u) => u._id) },
    status: 'done',
    deletedAt: null,
    completedAt: { $gte: startOfOrgDay(weeks[0]!) },
  })
    .select('assigneeId completedAt dueDate')
    .lean();

  const people = users.map((u) => {
    const id = u._id.toString();
    const completed = Array<number>(WEEKS).fill(0);
    const withDue = Array<number>(WEEKS).fill(0);
    const onTime = Array<number>(WEEKS).fill(0);
    for (const t of done) {
      if (t.assigneeId?.toString() !== id || !t.completedAt) continue;
      const dayDone = toOrgDate(t.completedAt);
      const w = weeks.indexOf(weekStartIso(dayDone));
      if (w < 0) continue;
      completed[w]! += 1;
      if (t.dueDate) {
        withDue[w]! += 1;
        if (dayDone <= t.dueDate) onTime[w]! += 1;
      }
    }
    const avg = (a: number[]) => r1(a.reduce((x, y) => x + y, 0) / a.length);
    // The current week is still running, so compare the last 4 full weeks with the 4 before.
    const recent = avg(completed.slice(4, 8));
    const previous = avg(completed.slice(0, 4));
    const total = completed.slice(0, 8).reduce((x, y) => x + y, 0);
    let direction: TrendDirection;
    if (total < 4) direction = 'not_enough_data';
    else if (previous === 0) direction = recent > 0 ? 'improving' : 'steady';
    else if (recent >= previous * 1.25) direction = 'improving';
    else if (recent <= previous * 0.75) direction = 'declining';
    else direction = 'steady';
    const explanation =
      direction === 'not_enough_data'
        ? `Only ${plural(total, 'task')} finished in 8 weeks — too few to call a trend.`
        : `${recent} tasks a week over the last 4 full weeks, against ${previous} in the 4 weeks before.`;
    return {
      user: toUserRef(u),
      completedPerWeek: completed,
      onTimePerWeek: withDue.map((n, i) => (n ? Math.round((onTime[i]! / n) * 100) : null)),
      recentAverage: recent,
      previousAverage: previous,
      direction,
      explanation,
    };
  });
  return { weeks, people };
}

/* ============================ Recurring bottlenecks ============================ */

/** Where work waits, where it bounces back, and what keeps getting stuck. */
export async function bottlenecks(
  rc: RequestContext,
  q: { from?: string; to?: string; departmentId?: string },
): Promise<BottlenecksDto> {
  const auth = requireAuth(rc);
  const today = orgToday();
  const period = { from: q.from ?? addDaysIso(today, -29), to: q.to ?? today };
  const s = await resolveScope(auth, { ...period, departmentId: q.departmentId });
  const ids = s.projectIds;
  const start = startOfOrgDay(period.from);
  const end = startOfOrgDay(addDaysIso(period.to, 1));
  const ref = new Map(
    s.projects.map((p) => [p._id.toString(), { id: p._id.toString(), key: p.key, name: p.name }]),
  );
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
  const [waits, sentBack, blocked, tags] = await Promise.all([
    TaskTransition.aggregate<{ _id: TaskStatus; ms: number; n: number }>([
      {
        $match: {
          projectId: { $in: ids },
          at: { $gte: start, $lt: end },
          durationMs: { $ne: null },
          from: { $in: ['todo', 'in_progress', 'in_review', 'testing', 'blocked'] },
        },
      },
      { $group: { _id: '$from', ms: { $avg: '$durationMs' }, n: { $sum: 1 } } },
    ]),
    TaskTransition.aggregate<{ _id: Types.ObjectId; n: number }>([
      {
        $match: {
          projectId: { $in: ids },
          at: { $gte: start, $lt: end },
          from: { $in: ['in_review', 'testing', 'done'] },
          to: { $in: ['backlog', 'todo', 'in_progress'] },
        },
      },
      { $group: { _id: '$projectId', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 8 },
    ]),
    Task.aggregate<{ _id: Types.ObjectId; n: number }>([
      {
        $match: {
          projectId: { $in: ids },
          deletedAt: null,
          status: 'blocked',
          blockedSince: { $lt: threeDaysAgo },
        },
      },
      { $group: { _id: '$projectId', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 8 },
    ]),
    Task.aggregate<{ _id: string; n: number }>([
      {
        $match: {
          projectId: { $in: ids },
          deletedAt: null,
          status: { $in: OPEN },
          $or: [{ status: 'blocked' }, { dueDate: { $ne: null, $lt: today } }],
        },
      },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', n: { $sum: 1 } } },
      { $match: { n: { $gte: 2 } } },
      { $sort: { n: -1 } },
      { $limit: 8 },
    ]),
  ]);
  const statusWaits = waits
    .map((w) => ({ status: w._id, averageHours: r1(w.ms / 3_600_000), moves: w.n }))
    .sort((a, b) => b.averageHours - a.averageHours);
  const rework = sentBack
    .filter((r) => ref.has(r._id.toString()))
    .map((r) => ({ project: ref.get(r._id.toString())!, sentBack: r.n }));
  const longBlocked = blocked
    .filter((r) => ref.has(r._id.toString()))
    .map((r) => ({ project: ref.get(r._id.toString())!, tasks: r.n }));
  const recurringTags = tags.map((t) => ({ tag: t._id, tasks: t.n }));

  const findings: string[] = [];
  const slowest = statusWaits.find((w) => w.moves >= 3);
  if (slowest)
    findings.push(
      `Work waits longest in “${STATUS_LABELS[slowest.status]}”: ${slowest.averageHours} h on average over ${plural(slowest.moves, 'move')}.`,
    );
  if (rework[0])
    findings.push(
      `${rework[0].project.key} had the most work sent back (${plural(rework[0].sentBack, 'time')}).`,
    );
  const stuck = longBlocked.reduce((a, b) => a + b.tasks, 0);
  if (stuck)
    findings.push(
      `${plural(stuck, 'task')} blocked for more than 3 days, across ${plural(longBlocked.length, 'project')}.`,
    );
  if (recurringTags[0])
    findings.push(
      `“${recurringTags[0].tag}” is tagged on ${plural(recurringTags[0].tasks, 'overdue or blocked task')}.`,
    );
  if (!findings.length) findings.push('No recurring bottleneck stands out in this period.');
  return { period, statusWaits, rework, longBlocked, recurringTags, findings };
}
