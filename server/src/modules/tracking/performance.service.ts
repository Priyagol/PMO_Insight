import { Types } from 'mongoose';
import type {
  PerformanceCounts,
  PerformancePeriod,
  PerformanceRowDto,
  TaskStatus,
  TeamPerformanceDto,
  TeamPerformanceQuery,
} from '@arihant/shared';
import { ForbiddenError, NotFoundError } from '../../core/errors';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { peopleFilter } from '../../core/rbac/work-access';
import { addDaysIso, fiscalPeriodStart, orgToday, startOfOrgDay, toOrgDate } from '../../core/time';
import { getOrgSettings } from '../settings/settings.service';
import { Task } from '../tasks/task.model';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { TaskTransition } from '../workflows/workflow.models';
import { Team } from './team.service';
import { Worklog } from './tracking.models';

/** Statuses a task is "sent back" from, and the working statuses it is sent back to. */
const CHECKED: TaskStatus[] = ['in_review', 'testing', 'done'];
const WORKING: TaskStatus[] = ['backlog', 'todo', 'in_progress'];

/**
 * Period bounds in organisation days. Quarters and years follow the organisation's financial
 * year (April by default) and run up to today.
 */
export function performancePeriod(
  key: PerformancePeriod,
  today: string = orgToday(),
  fiscalYearStartMonth = 4,
): { from: string; to: string } {
  if (key === '30d') return { from: addDaysIso(today, -29), to: today };
  if (key === '90d') return { from: addDaysIso(today, -89), to: today };
  return { from: fiscalPeriodStart(today, key, fiscalYearStartMonth), to: today };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function emptyRow(): PerformanceCounts {
  return {
    assigned: 0,
    pending: 0,
    overdue: 0,
    completed: 0,
    completedWithDueDate: 0,
    completedOnTime: 0,
    onTimeRate: null,
    reworked: 0,
    qaRejections: 0,
    estimatedHours: 0,
    actualHours: 0,
    loggedHours: 0,
  };
}

/** Assigned / pending / overdue / completed, on-time and rework counts per visible person. */
export async function teamPerformance(
  rc: RequestContext,
  q: TeamPerformanceQuery,
): Promise<TeamPerformanceDto> {
  const auth = requireAuth(rc);
  if (!auth.permissions['team:read']) throw new ForbiddenError();
  const org = await getOrgSettings();
  const { from, to } = performancePeriod(q.period, orgToday(), org.fiscalYearStartMonth);
  const filter: Record<string, unknown> = {
    $and: [await peopleFilter(auth, auth.permissions['team:read']), { status: 'active' }],
  };
  const team = q.teamId ? await Team.findOne({ _id: q.teamId, archived: false }).lean() : null;
  if (q.teamId && !team) throw new NotFoundError('Team');
  if (team) (filter.$and as object[]).push({ _id: { $in: team.memberIds } });
  if (q.departmentId)
    (filter.$and as object[]).push({ departmentId: new Types.ObjectId(q.departmentId) });
  const users = await User.find(filter)
    .select('_id name email employeeId designation avatarKey departmentId')
    .populate('departmentId', 'name')
    .lean();
  const ids = users.map((u) => u._id);
  const today = orgToday();
  const start = startOfOrgDay(from);
  const end = startOfOrgDay(addDaysIso(to, 1));

  const [current, completed, sentBack, logged] = await Promise.all([
    Task.aggregate<{ _id: Types.ObjectId; assigned: number; pending: number; overdue: number }>([
      { $match: { assigneeId: { $in: ids }, deletedAt: null, status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: '$assigneeId',
          assigned: { $sum: 1 },
          pending: { $sum: { $cond: [{ $ne: ['$status', 'done'] }, 1, 0] } },
          overdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$status', 'done'] },
                    { $ne: ['$dueDate', null] },
                    { $lt: ['$dueDate', today] },
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
    Task.find({
      assigneeId: { $in: ids },
      deletedAt: null,
      status: 'done',
      completedAt: { $gte: start, $lt: end },
    })
      .select('assigneeId dueDate completedAt estimatedHours actualHours')
      .lean(),
    TaskTransition.find({
      at: { $gte: start, $lt: end },
      from: { $in: CHECKED },
      to: { $in: WORKING },
    })
      .select('taskId from')
      .lean(),
    Worklog.aggregate<{ _id: Types.ObjectId; m: number }>([
      { $match: { userId: { $in: ids }, date: { $gte: from, $lte: to } } },
      { $group: { _id: '$userId', m: { $sum: '$minutes' } } },
    ]),
  ]);

  const rows = new Map(ids.map((id) => [id.toString(), emptyRow()]));
  for (const c of current)
    Object.assign(rows.get(c._id.toString())!, {
      assigned: c.assigned,
      pending: c.pending,
      overdue: c.overdue,
    });
  for (const t of completed) {
    const r = rows.get(t.assigneeId!.toString())!;
    r.completed += 1;
    r.estimatedHours += t.estimatedHours ?? 0;
    r.actualHours += t.actualHours ?? 0;
    if (t.dueDate) {
      r.completedWithDueDate += 1;
      if (t.completedAt && toOrgDate(t.completedAt) <= t.dueDate) r.completedOnTime += 1;
    }
  }
  if (sentBack.length) {
    const owners = await Task.find({ _id: { $in: [...new Set(sentBack.map((s) => s.taskId))] } })
      .select('assigneeId')
      .lean();
    const ownerOf = new Map(owners.map((o) => [o._id.toString(), o.assigneeId?.toString()]));
    for (const s of sentBack) {
      const r = rows.get(ownerOf.get(s.taskId.toString()) ?? '');
      if (!r) continue;
      r.reworked += 1;
      if (s.from === 'testing') r.qaRejections += 1;
    }
  }
  for (const l of logged) rows.get(l._id.toString())!.loggedHours = l.m / 60;

  const out: PerformanceRowDto[] = users.map((u) => ({
    user: {
      ...toUserRef(u),
      department: (u.departmentId as unknown as { name?: string } | null)?.name ?? null,
    },
    ...finish(rows.get(u._id.toString())!),
  }));
  out.sort(
    (a, b) =>
      b.overdue - a.overdue || b.pending - a.pending || a.user.name.localeCompare(b.user.name),
  );

  // Team-wise view: each named team's visible members added up.
  const visible = new Map(out.map((r) => [r.user.id, r]));
  const teamDocs = await Team.find({ archived: false, memberIds: { $in: ids } })
    .select('name memberIds')
    .sort({ name: 1 })
    .lean();
  const teams = teamDocs
    .map((t) => {
      const members = t.memberIds.map((m) => visible.get(m.toString())).filter(Boolean);
      return {
        team: { id: t._id.toString(), name: t.name },
        members: members.length,
        totals: sumCounts(members as PerformanceRowDto[]),
      };
    })
    .filter((t) => t.members > 0);

  return { period: { key: q.period, from, to }, rows: out, totals: sumCounts(out), teams };
}

/** Rounds hours and works out the on-time rate. */
function finish(r: PerformanceCounts): PerformanceCounts {
  return {
    ...r,
    onTimeRate: r.completedWithDueDate
      ? Math.round((r.completedOnTime / r.completedWithDueDate) * 100)
      : null,
    estimatedHours: round1(r.estimatedHours),
    actualHours: round1(r.actualHours),
    loggedHours: round1(r.loggedHours),
  };
}

function sumCounts(list: PerformanceCounts[]): PerformanceCounts {
  const t = emptyRow();
  for (const r of list)
    for (const k of Object.keys(t) as (keyof PerformanceCounts)[])
      if (k !== 'onTimeRate') t[k] += r[k] as number;
  return finish(t);
}
