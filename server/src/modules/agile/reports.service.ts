import { Types } from 'mongoose';
import {
  BUG_SEVERITIES,
  ISSUE_TYPES,
  median,
  round1,
  type BugSeverity,
  type CycleTimeDto,
  type DefectReportDto,
  type IssueType,
  type SprintChartDto,
  type VelocityDto,
} from '@arihant/shared';
import { NotFoundError, UnprocessableError } from '../../core/errors';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { taskReadFilter } from '../../core/rbac/work-access';
import { addDaysIso, daysBetweenIso, orgToday, toOrgDate, weekStartIso } from '../../core/time';
import { loadReadableProject } from '../projects/project.service';
import { Task } from '../tasks/task.model';
import { Sprint } from './sprint.model';

const DAY = 86_400_000;
const oid = (id: string) => new Types.ObjectId(id);
const mean = (xs: number[]) =>
  xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

/** Committed vs completed points of the last six completed sprints. */
export async function velocity(rc: RequestContext, projectId: string): Promise<VelocityDto> {
  const auth = requireAuth(rc);
  const project = await loadReadableProject(auth, projectId);
  const sprints = await Sprint.find({
    projectId: project._id,
    status: 'completed',
    deletedAt: null,
  })
    .sort({ completedAt: -1 })
    .limit(6)
    .lean();
  sprints.reverse();
  return {
    sprints: sprints.map((s) => ({
      id: s._id.toString(),
      name: s.name,
      committed: s.committedPoints ?? 0,
      completed: s.completedPoints ?? 0,
    })),
    average: mean(sprints.map((s) => s.completedPoints ?? 0)),
  };
}

/**
 * Burndown / burnup data for one sprint, by organisation day. Scope is what was committed at the
 * start plus tasks added later (counted from their creation day, or the start if created before it).
 */
export async function sprintChart(rc: RequestContext, sprintId: string): Promise<SprintChartDto> {
  const auth = requireAuth(rc);
  if (!Types.ObjectId.isValid(sprintId)) throw new NotFoundError('Sprint');
  const sprint = await Sprint.findOne({ _id: oid(sprintId), deletedAt: null }).lean();
  if (!sprint) throw new NotFoundError('Sprint');
  await loadReadableProject(auth, sprint.projectId.toString());
  if (sprint.status === 'planned' || !sprint.startDate || !sprint.endDate)
    throw new UnprocessableError('The chart is available once the sprint has started');

  const ids = new Set(
    [...sprint.committedTaskIds, ...sprint.completedTaskIds, ...sprint.carriedOverTaskIds].map(
      String,
    ),
  );
  if (sprint.status === 'active') {
    const current = await Task.find({ sprintId: sprint._id, parentId: null, deletedAt: null })
      .select('_id')
      .lean();
    current.forEach((t) => ids.add(t._id.toString()));
  }
  const tasks = await Task.find({ _id: { $in: [...ids].map(oid) }, deletedAt: null })
    .select('storyPoints status completedAt createdAt')
    .lean();
  const committed = new Set(sprint.committedTaskIds.map(String));
  const completedSet =
    sprint.status === 'completed' ? new Set(sprint.completedTaskIds.map(String)) : null;

  const start = sprint.startDate;
  const end = sprint.endDate;
  const last = sprint.status === 'active' ? (orgToday() < end ? orgToday() : end) : end;
  const totalDays = Math.max(1, daysBetweenIso(start, end));
  const committedPoints = sprint.committedPoints ?? 0;
  const days: SprintChartDto['days'] = [];
  for (let d = start, i = 0; d <= last && i < 400; d = addDaysIso(d, 1), i++) {
    let scope = 0;
    let completed = 0;
    for (const t of tasks) {
      const p = t.storyPoints ?? 0;
      const id = t._id.toString();
      const joined = committed.has(id)
        ? start
        : toOrgDate(t.createdAt) > start
          ? toOrgDate(t.createdAt)
          : start;
      if (joined > d) continue;
      scope += p;
      const isDone = completedSet ? completedSet.has(id) : t.status === 'done';
      if (isDone && t.completedAt && toOrgDate(t.completedAt) <= d) completed += p;
    }
    days.push({
      date: d,
      scope: round1(scope),
      completed: round1(completed),
      remaining: round1(scope - completed),
      ideal: round1(Math.max(0, committedPoints * (1 - i / totalDays))),
    });
  }
  const unestimated = tasks.filter((t) => t.storyPoints == null).length;
  const notes: string[] = [];
  if (unestimated) notes.push(`${unestimated} task(s) have no story points and count as 0.`);
  notes.push(
    'Tasks added after the start count from the later of the start date and their creation date.',
  );
  return {
    sprint: {
      id: sprint._id.toString(),
      name: sprint.name,
      startDate: start,
      endDate: end,
      status: sprint.status,
    },
    days,
    committed: committedPoints,
    notes,
  };
}

/** Cycle time (work started → done) and lead time (created → done) for recently finished work. */
export async function cycleTime(
  rc: RequestContext,
  projectId: string,
  days: number,
): Promise<CycleTimeDto> {
  const auth = requireAuth(rc);
  const project = await loadReadableProject(auth, projectId);
  const since = new Date(Date.now() - days * DAY);
  const docs = await Task.find({
    $and: [
      await taskReadFilter(auth),
      {
        projectId: project._id,
        status: 'done',
        completedAt: { $gte: since },
        deletedAt: null,
        type: { $ne: 'epic' },
      },
    ],
  })
    .select('key title type startedAt completedAt createdAt')
    .sort({ completedAt: -1 })
    .limit(500)
    .lean();
  const items = docs.map((t) => ({
    id: t._id.toString(),
    key: t.key,
    title: t.title,
    type: (t.type ?? 'task') as IssueType,
    cycleDays: t.startedAt
      ? round1(Math.max(0, t.completedAt!.getTime() - t.startedAt.getTime()) / DAY)
      : null,
    leadDays: round1(Math.max(0, t.completedAt!.getTime() - t.createdAt.getTime()) / DAY),
  }));
  const cyc = items.map((i) => i.cycleDays).filter((x): x is number => x != null);
  const lead = items.map((i) => i.leadDays);
  return {
    cycle: { median: median(cyc), average: mean(cyc), count: cyc.length },
    lead: { median: median(lead), average: mean(lead), count: lead.length },
    byType: ISSUE_TYPES.filter((t) => t !== 'epic').map((type) => {
      const xs = items
        .filter((i) => i.type === type && i.cycleDays != null)
        .map((i) => i.cycleDays!);
      return { type, median: median(xs), count: xs.length };
    }),
    items: items.slice(0, 50),
    days,
  };
}

/** Open bugs by severity, weekly created vs resolved and average resolution time. */
export async function defectReport(
  rc: RequestContext,
  projectId: string,
  days: number,
): Promise<DefectReportDto> {
  const auth = requireAuth(rc);
  const project = await loadReadableProject(auth, projectId);
  const read = await taskReadFilter(auth);
  const bugs = await Task.find({
    $and: [read, { projectId: project._id, type: 'bug', deletedAt: null }],
  })
    .select('key title status bug createdAt completedAt')
    .lean();
  const isOpen = (s: string) => s !== 'done' && s !== 'cancelled';
  const open = bugs.filter((b) => isOpen(b.status));
  const openBySeverity = Object.fromEntries(BUG_SEVERITIES.map((s) => [s, 0])) as Record<
    BugSeverity,
    number
  >;
  open.forEach((b) => (openBySeverity[b.bug?.severity ?? 'major'] += 1));

  const today = orgToday();
  const weeksBack = Math.min(26, Math.max(1, Math.ceil(days / 7)));
  const firstWeek = weekStartIso(addDaysIso(today, -7 * (weeksBack - 1)));
  const weeks: DefectReportDto['weeks'] = [];
  for (let w = firstWeek; w <= today; w = addDaysIso(w, 7))
    weeks.push({ weekStart: w, created: 0, resolved: 0 });
  const slot = (d: Date) => weeks.find((x) => x.weekStart === weekStartIso(toOrgDate(d)));
  for (const b of bugs) {
    const c = slot(b.createdAt);
    if (c) c.created += 1;
    if (b.status === 'done' && b.completedAt) {
      const r = slot(b.completedAt);
      if (r) r.resolved += 1;
    }
  }
  const since = Date.now() - days * DAY;
  const resolution = bugs
    .filter((b) => b.status === 'done' && b.completedAt && b.completedAt.getTime() >= since)
    .map((b) => (b.completedAt!.getTime() - b.createdAt.getTime()) / DAY);
  const now = Date.now();
  return {
    open: open.length,
    openBySeverity,
    regressionsOpen: open.filter((b) => b.bug?.regression).length,
    weeks,
    averageResolutionDays: mean(resolution),
    oldestOpen: open
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, 5)
      .map((b) => ({
        id: b._id.toString(),
        key: b.key,
        title: b.title,
        severity: b.bug?.severity ?? 'major',
        ageDays: Math.floor((now - b.createdAt.getTime()) / DAY),
      })),
  };
}
