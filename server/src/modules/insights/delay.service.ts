import type { Types } from 'mongoose';
import type {
  AnalyticsQuery,
  ProjectDelayDto,
  TimelineProjectDto,
  TimelineState,
  UserRef,
} from '@arihant/shared';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { daysBetweenIso, orgToday, toOrgDate } from '../../core/time';
import { Approval } from '../approvals/approval.model';
import { Activity } from '../collab/collab.models';
import { Milestone } from '../planning/planning.models';
import { Project, ProjectVersion, type IProject } from '../projects/project.model';
import { computeProgress } from '../projects/project.service';
import { Task } from '../tasks/task.model';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { TaskTransition } from '../workflows/workflow.models';
import { resolveScope } from './analytics.service';
import { forecastProject } from './forecast.service';

/*
 * Project timeline and delay analysis, built only from history the app already records:
 * project versions (end-date moves, with the reason asked for since this feature), task
 * status transitions (time blocked, time waiting in review / testing), task activity (due
 * dates moved), approval stages (decision time against their deadline) and project
 * dependencies. Nothing is a score: each row is a fact with its dates.
 */

const SLOW_HANDOFF_DAYS = 2;
const DAY_MS = 86_400_000;
const days = (ms: number) => Math.round((ms / DAY_MS) * 10) / 10;
const MAX_ROWS = 100;

interface Slip {
  at: Date;
  by: Types.ObjectId | null;
  from: string;
  to: string;
  reason: string | null;
}

/** End-date history per project: the baseline (first end date) and every move. */
async function endDateHistory(projects: IProject[]) {
  const versions = await ProjectVersion.find({
    projectId: { $in: projects.map((p) => p._id) },
    'changes.field': { $in: ['endDate', 'status'] },
  })
    .sort({ version: 1 })
    .lean();
  const out = new Map<
    string,
    { baseline: string | null; slips: Slip[]; completedAt: Date | null }
  >();
  for (const p of projects)
    out.set(p._id.toString(), { baseline: null, slips: [], completedAt: null });
  for (const v of versions) {
    const h = out.get(v.projectId.toString())!;
    for (const c of v.changes) {
      if (c.field === 'endDate') {
        const from = (c.from as string | null) ?? null;
        const to = (c.to as string | null) ?? null;
        if (h.baseline === null && from) h.baseline = from;
        if (from && to)
          h.slips.push({ at: v.createdAt, by: v.changedBy, from, to, reason: v.reason ?? null });
      }
      if (c.field === 'status') h.completedAt = c.to === 'completed' ? v.createdAt : null;
    }
  }
  for (const p of projects) {
    const h = out.get(p._id.toString())!;
    if (h.baseline === null) h.baseline = p.endDate ?? null;
  }
  return out;
}

async function buildTimeline(projects: IProject[]): Promise<TimelineProjectDto[]> {
  if (!projects.length) return [];
  const today = orgToday();
  const ids = projects.map((p) => p._id);
  const [history, progress, milestones, tasks, managers, upstream] = await Promise.all([
    endDateHistory(projects),
    computeProgress(ids),
    Milestone.find({ projectId: { $in: ids } })
      .sort({ dueDate: 1 })
      .lean(),
    Task.find({ projectId: { $in: ids }, deletedAt: null })
      .select('projectId key title status estimatedHours completedAt dueDate assigneeId parentId')
      .lean(),
    User.find({ _id: { $in: projects.map((p) => p.managerId) } })
      .select('name email employeeId designation')
      .lean(),
    Project.find({ _id: { $in: projects.flatMap((p) => p.dependsOn.map((d) => d.projectId)) } })
      .select('key')
      .lean(),
  ]);
  const managerOf = new Map(managers.map((u) => [u._id.toString(), toUserRef(u)]));
  const keyOf = new Map(upstream.map((p) => [p._id.toString(), p.key]));
  return projects.map((p) => {
    const id = p._id.toString();
    const h = history.get(id)!;
    const done = p.status === 'completed';
    const open = !done && p.status !== 'cancelled';
    const forecast = open
      ? forecastProject(
          p,
          tasks.filter((t) => t.projectId.equals(p._id)),
          today,
        ).forecastDate
      : null;
    const finishedOn = done ? toOrgDate(h.completedAt ?? p.updatedAt) : null;
    const baseline = h.baseline;
    const end = p.endDate ?? null;
    const slipDays = baseline && end ? daysBetweenIso(baseline, end) : 0;
    let lateDays = 0;
    if (baseline) {
      if (finishedOn) lateDays = Math.max(0, daysBetweenIso(baseline, finishedOn));
      else if (open) {
        const latest = [today > baseline ? today : null, forecast].filter(Boolean).sort().at(-1);
        lateDays = latest ? Math.max(0, daysBetweenIso(baseline, latest)) : 0;
      }
    }
    const pct = progress.get(id)?.percent ?? 0;
    let state: TimelineState;
    if (!end) state = 'no_dates';
    else if (done) state = lateDays > 0 ? 'done_late' : 'done_on_time';
    else if (end < today || (forecast && forecast > end)) state = 'late';
    else if (slipDays > 0 || p.status === 'at_risk') state = 'at_risk';
    else state = 'on_track';
    return {
      project: { id, key: p.key, name: p.name, status: p.status },
      manager: managerOf.get(p.managerId.toString()) ?? null,
      startDate: p.startDate ?? null,
      baselineEndDate: baseline,
      endDate: end,
      forecastDate: forecast,
      finishedOn,
      slipDays,
      slips: h.slips.filter((s) => s.to > s.from).length,
      lateDays,
      progress: pct,
      state,
      milestones: milestones
        .filter((m) => m.projectId.equals(p._id))
        .map((m) => ({
          name: m.name,
          dueDate: m.dueDate,
          status: m.status,
          late:
            m.status === 'completed'
              ? Boolean(m.completedAt && toOrgDate(m.completedAt) > m.dueDate)
              : m.dueDate < today,
        })),
      dependsOn: p.dependsOn.map((d) => ({
        id: d.projectId.toString(),
        key: keyOf.get(d.projectId.toString()) ?? '',
      })),
    };
  });
}

/** Every project in the caller's analytics scope, latest first by how late they are. */
export async function portfolioTimeline(
  rc: RequestContext,
  raw: Partial<AnalyticsQuery>,
): Promise<TimelineProjectDto[]> {
  const auth = requireAuth(rc);
  const s = await resolveScope(auth, { departmentId: raw.departmentId });
  const rows = await buildTimeline(s.projects.filter((p) => p.status !== 'cancelled'));
  const order: Record<TimelineState, number> = {
    late: 0,
    at_risk: 1,
    done_late: 2,
    on_track: 3,
    done_on_time: 4,
    no_dates: 5,
  };
  return rows.sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      b.lateDays - a.lateDays ||
      a.project.key.localeCompare(b.project.key),
  );
}

/** Where a project's time went, and (for managers) who was involved. */
export async function projectDelays(
  rc: RequestContext,
  projectId: string,
): Promise<ProjectDelayDto> {
  const auth = requireAuth(rc);
  const s = await resolveScope(auth, { projectId });
  const project = s.projects[0]!;
  const showPeople = !s.personal;
  const today = orgToday();
  const now = Date.now();
  const [timeline] = await buildTimeline([project]);
  const history = (await endDateHistory([project])).get(project._id.toString())!;

  const tasks = await Task.find({
    projectId: project._id,
    deletedAt: null,
    ...(s.personal ? { assigneeId: auth.userObjectId } : {}),
  })
    .select('key title status dueDate completedAt assigneeId blockedSince')
    .lean();
  const taskById = new Map(tasks.map((t) => [t._id.toString(), t]));
  const ref = (t: (typeof tasks)[number]) => ({
    id: t._id.toString(),
    key: t.key,
    title: t.title,
    status: t.status,
  });

  // Late tasks.
  const lateTasks = tasks
    .filter((t) => t.dueDate && t.status !== 'cancelled')
    .map((t) => {
      const finishedOn = t.completedAt ? toOrgDate(t.completedAt) : null;
      const until = t.status === 'done' ? finishedOn : today;
      const daysLate = until ? daysBetweenIso(t.dueDate!, until) : 0;
      return { t, finishedOn: t.status === 'done' ? finishedOn : null, daysLate };
    })
    .filter((x) => x.daysLate > 0)
    .sort((a, b) => b.daysLate - a.daysLate)
    .slice(0, MAX_ROWS);

  // Blocked periods and slow hand-offs, from the status history.
  const transitions = await TaskTransition.find({
    taskId: { $in: tasks.map((t) => t._id) },
    $or: [{ to: 'blocked' }, { from: { $in: ['blocked', 'in_review', 'testing'] } }],
  })
    .sort({ at: 1 })
    .lean();
  const blocked: {
    taskId: string;
    since: Date;
    ms: number;
    current: boolean;
    by: Types.ObjectId | null;
    comment: string | null;
  }[] = [];
  const openBlock = new Map<string, (typeof blocked)[number]>();
  const handoffs: { taskId: string; stage: 'in_review' | 'testing'; ms: number }[] = [];
  for (const tr of transitions) {
    const tid = tr.taskId.toString();
    if (tr.to === 'blocked') {
      const b = {
        taskId: tid,
        since: tr.at,
        ms: 0,
        current: true,
        by: tr.actorId,
        comment: tr.comment ?? null,
      };
      blocked.push(b);
      openBlock.set(tid, b);
    }
    if (tr.from === 'blocked') {
      const b = openBlock.get(tid);
      if (b) {
        b.ms = tr.durationMs ?? tr.at.getTime() - b.since.getTime();
        b.current = false;
        openBlock.delete(tid);
      }
    }
    if (
      (tr.from === 'in_review' || tr.from === 'testing') &&
      (tr.durationMs ?? 0) > SLOW_HANDOFF_DAYS * DAY_MS
    )
      handoffs.push({ taskId: tid, stage: tr.from, ms: tr.durationMs! });
  }
  for (const b of openBlock.values()) b.ms = now - b.since.getTime();

  // Approvals on this project that missed their deadline.
  const approvals = await Approval.find({
    projectId: project._id,
    'stages.startedAt': { $ne: null },
  })
    .select('key title stages')
    .lean();
  const approvalWaits = approvals
    .flatMap((a) =>
      a.stages
        .filter((st) => st.startedAt && st.dueAt && st.status !== 'skipped')
        .map((st) => {
          const end = st.decidedAt?.getTime() ?? (st.status === 'pending' ? now : null);
          if (end === null) return null;
          const overdue = end - st.dueAt!.getTime();
          if (overdue <= 0) return null;
          return {
            id: a._id.toString(),
            key: a.key,
            title: a.title,
            stage: st.name,
            waitedDays: days(end - st.startedAt!.getTime()),
            overdueDays: days(overdue),
            pending: !st.decidedAt,
            approverIds: st.decidedBy ? [st.decidedBy] : st.approverIds,
          };
        }),
    )
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.overdueDays - a.overdueDays)
    .slice(0, MAX_ROWS);

  // Task due dates moved later.
  const pushActs = await Activity.find({
    projectId: project._id,
    entityType: 'task',
    'changes.field': 'dueDate',
    ...(s.personal ? { entityId: { $in: tasks.map((t) => t._id) } } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  const pushes = pushActs
    .flatMap((a) =>
      (a.changes ?? [])
        .filter(
          (c) => c.field === 'dueDate' && c.from && c.to && (c.to as string) > (c.from as string),
        )
        .map((c) => ({ a, from: c.from as string, to: c.to as string })),
    )
    .filter((x) => taskById.has(x.a.entityId.toString()))
    .slice(0, MAX_ROWS);

  // Upstream projects that are late.
  const upstreamProjects = project.dependsOn.length
    ? await Project.find({ _id: { $in: project.dependsOn.map((d) => d.projectId) } })
        .select('key name endDate status')
        .lean()
    : [];
  const upstream = upstreamProjects
    .filter(
      (u) => u.status !== 'completed' && u.status !== 'cancelled' && u.endDate && u.endDate < today,
    )
    .map((u) => ({
      id: u._id.toString(),
      key: u.key,
      name: u.name,
      endDate: u.endDate ?? null,
      lateDays: daysBetweenIso(u.endDate!, today),
    }));

  // Names (managers only).
  const userIds = showPeople
    ? [
        ...tasks.map((t) => t.assigneeId),
        ...blocked.map((b) => b.by),
        ...approvalWaits.flatMap((a) => a.approverIds),
        ...pushes.map((p) => p.a.actorId),
        ...history.slips.map((sl) => sl.by),
      ].filter((x): x is Types.ObjectId => Boolean(x))
    : [];
  const users = new Map(
    (
      await User.find({ _id: { $in: userIds } })
        .select('name email employeeId designation')
        .lean()
    ).map((u) => [u._id.toString(), toUserRef(u)]),
  );
  const who = (id: Types.ObjectId | null | undefined): UserRef | null =>
    showPeople && id ? (users.get(id.toString()) ?? null) : null;

  // Totals per person.
  const people = new Map<string, ProjectDelayDto['people'][number]>();
  const person = (u: UserRef | null) => {
    if (!u) return null;
    if (!people.has(u.id))
      people.set(u.id, {
        user: u,
        lateTasks: 0,
        lateTaskDays: 0,
        approvalOverdueDays: 0,
        dueDatePushDays: 0,
      });
    return people.get(u.id)!;
  };
  const lateRows = lateTasks.map(({ t, finishedOn, daysLate }) => {
    const assignee = who(t.assigneeId);
    const pp = person(assignee);
    if (pp) {
      pp.lateTasks++;
      pp.lateTaskDays += daysLate;
    }
    return { ...ref(t), dueDate: t.dueDate!, finishedOn, daysLate, assignee };
  });
  const approvalRows = approvalWaits.map(({ approverIds, ...a }) => {
    const approvers = approverIds.map((id) => who(id)).filter((u): u is UserRef => u !== null);
    for (const u of approvers) person(u)!.approvalOverdueDays += a.overdueDays;
    return { ...a, approvers };
  });
  const pushRows = pushes.map(({ a, from, to }) => {
    const t = taskById.get(a.entityId.toString())!;
    const by = who(a.actorId);
    const d = daysBetweenIso(from, to);
    const pp = person(by);
    if (pp) pp.dueDatePushDays += d;
    return { ...ref(t), from, to, days: d, by, at: a.createdAt.toISOString() };
  });

  return {
    timeline: timeline!,
    showPeople,
    slipHistory: history.slips
      .filter((sl) => sl.to > sl.from)
      .reverse()
      .map((sl) => ({
        at: sl.at.toISOString(),
        by: who(sl.by),
        from: sl.from,
        to: sl.to,
        days: daysBetweenIso(sl.from, sl.to),
        reason: sl.reason,
      })),
    lateTasks: lateRows,
    blocked: blocked
      .filter((b) => taskById.has(b.taskId))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, MAX_ROWS)
      .map((b) => ({
        ...ref(taskById.get(b.taskId)!),
        since: b.since.toISOString(),
        days: days(b.ms),
        current: b.current,
        markedBy: who(b.by),
        comment: b.comment,
      })),
    slowHandoffs: handoffs
      .filter((x) => taskById.has(x.taskId))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, MAX_ROWS)
      .map((x) => {
        const t = taskById.get(x.taskId)!;
        return { ...ref(t), stage: x.stage, days: days(x.ms), assignee: who(t.assigneeId) };
      }),
    approvalWaits: approvalRows,
    dueDatePushes: pushRows,
    upstream,
    people: showPeople
      ? [...people.values()].sort(
          (a, b) =>
            b.lateTaskDays +
            b.approvalOverdueDays +
            b.dueDatePushDays -
            (a.lateTaskDays + a.approvalOverdueDays + a.dueDatePushDays),
        )
      : [],
  };
}
