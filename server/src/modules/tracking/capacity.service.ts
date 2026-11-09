import { Types } from 'mongoose';
import {
  OPEN_TASK_STATUSES,
  type CapacityPlanDto,
  type CapacityPlanQuery,
  type CapacityRowDto,
} from '@arihant/shared';
import { ForbiddenError, NotFoundError } from '../../core/errors';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { peopleFilter, readableProjectIds } from '../../core/rbac/work-access';
import { addDaysIso, dayOfWeekIso, orgToday, weekStartIso } from '../../core/time';
import { getAssignmentConfig, remainingEffort } from '../assignment/workload.service';
import { getOrgSettings } from '../settings/settings.service';
import { Task } from '../tasks/task.model';
import { User } from '../users/user.model';
import { Team } from './team.service';
import { Availability } from './tracking.models';

const r1 = (n: number) => Math.round(n * 10) / 10;
const UNASSIGNED = 'unassigned';

type Bucket = { capacity: number[]; demand: number[]; unscheduled: number; overdue: number };
const bucket = (n: number): Bucket => ({
  capacity: Array<number>(n).fill(0),
  demand: Array<number>(n).fill(0),
  unscheduled: 0,
  overdue: 0,
});
const toRow = (
  id: string,
  label: string,
  people: number,
  b: Bucket,
  sublabel?: string,
): CapacityRowDto => ({
  id,
  label,
  sublabel,
  people,
  weeks: b.capacity.map((c, i) => ({ capacity: r1(c), demand: r1(b.demand[i]!) })),
  unscheduled: r1(b.unscheduled),
  overdue: r1(b.overdue),
});
const addInto = (to: Bucket, from: Bucket) => {
  from.capacity.forEach((v, i) => (to.capacity[i]! += v));
  from.demand.forEach((v, i) => (to.demand[i]! += v));
  to.unscheduled += from.unscheduled;
  to.overdue += from.overdue;
};

/**
 * Hours available against work already planned, week by week, for the coming weeks.
 * Capacity: weekly hours spread over working days, less approved leave. Demand: each open
 * task's remaining estimate spread evenly over the working days from its start (or today)
 * to its due date.
 */
export async function capacityPlan(
  rc: RequestContext,
  q: CapacityPlanQuery,
): Promise<CapacityPlanDto> {
  const auth = requireAuth(rc);
  if (!auth.permissions['team:read']) throw new ForbiddenError();
  const [org, cfg] = await Promise.all([getOrgSettings(), getAssignmentConfig()]);
  const today = orgToday();
  const first = weekStartIso(today);
  const weeks = Array.from({ length: q.weeks }, (_, i) => addDaysIso(first, i * 7));
  const end = addDaysIso(first, q.weeks * 7 - 1);
  const weekOf = (day: string) => weeks.indexOf(weekStartIso(day));
  const working = (day: string) => org.workingDays.includes(dayOfWeekIso(day));

  const filter: Record<string, unknown>[] = [
    await peopleFilter(auth, auth.permissions['team:read']),
    { status: 'active' },
  ];
  if (q.departmentId) filter.push({ departmentId: new Types.ObjectId(q.departmentId) });
  const team = q.teamId ? await Team.findOne({ _id: q.teamId, archived: false }).lean() : null;
  if (q.teamId && !team) throw new NotFoundError('Team');
  if (team) filter.push({ _id: { $in: team.memberIds } });
  const users = await User.find({ $and: filter })
    .select('name designation departmentId weeklyCapacityHours skills')
    .populate('departmentId', 'name')
    .sort({ name: 1 })
    .limit(500)
    .lean();
  const ids = users.map((u) => u._id);

  // Unassigned work counts only on the plain views (not when narrowed to a team).
  const projects = await readableProjectIds(auth);
  const unassignedFilter =
    team === null
      ? {
          assigneeId: null,
          ...(projects === 'all' ? {} : { projectId: { $in: projects } }),
        }
      : null;
  const [tasks, leaves] = await Promise.all([
    Task.find({
      deletedAt: null,
      status: { $in: OPEN_TASK_STATUSES },
      $or: [{ assigneeId: { $in: ids } }, ...(unassignedFilter ? [unassignedFilter] : [])],
    })
      .select('assigneeId estimatedHours actualHours status startDate dueDate requiredSkills')
      .limit(20_000)
      .lean(),
    Availability.find({
      userId: { $in: ids },
      status: 'approved',
      from: { $lte: end },
      to: { $gte: today },
    }).lean(),
  ]);

  /* ---------- Capacity per person per week ---------- */
  const perPerson = new Map<string, Bucket>();
  for (const u of users) {
    const b = bucket(q.weeks);
    const daily = org.workingDays.length ? u.weeklyCapacityHours / org.workingDays.length : 0;
    const mine = leaves.filter((l) => l.userId.equals(u._id));
    for (let d = today; d <= end; d = addDaysIso(d, 1)) {
      if (!working(d)) continue;
      let fraction = 1;
      for (const l of mine) {
        if (l.from > d || l.to < d) continue;
        const f =
          l.type === 'partial' && l.hoursPerDay != null && daily > 0
            ? Math.min(l.hoursPerDay / daily, 1)
            : 0;
        fraction = Math.min(fraction, f);
      }
      b.capacity[weekOf(d)]! += daily * fraction;
    }
    perPerson.set(u._id.toString(), b);
  }
  perPerson.set(UNASSIGNED, bucket(q.weeks));

  /* ---------- Demand: spread each task over its working days ---------- */
  const spread = (b: Bucket, t: (typeof tasks)[number], hours: number) => {
    if (!t.dueDate) {
      b.unscheduled += hours;
      return;
    }
    if (t.dueDate < today) {
      b.overdue += hours;
      b.demand[0]! += hours;
      return;
    }
    const from = t.startDate && t.startDate > today ? t.startDate : today;
    const to = t.dueDate < from ? from : t.dueDate;
    const days: string[] = [];
    for (let d = from; d <= to; d = addDaysIso(d, 1)) if (working(d)) days.push(d);
    if (!days.length) days.push(to);
    const each = hours / days.length;
    for (const d of days) {
      const w = weekOf(d);
      if (w >= 0) b.demand[w]! += each;
    }
  };
  const skillDemand = new Map<string, Bucket>();
  for (const t of tasks) {
    const hours = remainingEffort(t, cfg.defaultEffortHours);
    spread(perPerson.get(t.assigneeId?.toString() ?? UNASSIGNED)!, t, hours);
    for (const s of t.requiredSkills ?? []) {
      const k = s.name.toLowerCase();
      if (!skillDemand.has(k)) skillDemand.set(k, bucket(q.weeks));
      spread(skillDemand.get(k)!, t, hours);
    }
  }

  /* ---------- Group ---------- */
  const rows: CapacityRowDto[] = [];
  const unassigned = perPerson.get(UNASSIGNED)!;
  const hasUnassigned =
    unassigned.demand.some((v) => v > 0) || unassigned.unscheduled > 0 || unassigned.overdue > 0;
  if (q.groupBy === 'person') {
    for (const u of users)
      rows.push(
        toRow(
          u._id.toString(),
          u.name,
          1,
          perPerson.get(u._id.toString())!,
          u.designation ?? undefined,
        ),
      );
    if (hasUnassigned) rows.push(toRow(UNASSIGNED, 'Unassigned work', 0, unassigned));
  } else if (q.groupBy === 'department') {
    const groups = new Map<string, { label: string; people: number; b: Bucket }>();
    for (const u of users) {
      const dept = u.departmentId as unknown as { _id: Types.ObjectId; name: string } | null;
      const k = dept?._id.toString() ?? 'none';
      const g = groups.get(k) ?? {
        label: dept?.name ?? 'No department',
        people: 0,
        b: bucket(q.weeks),
      };
      g.people += 1;
      addInto(g.b, perPerson.get(u._id.toString())!);
      groups.set(k, g);
    }
    for (const [k, g] of groups) rows.push(toRow(k, g.label, g.people, g.b));
    if (hasUnassigned) rows.push(toRow(UNASSIGNED, 'Unassigned work', 0, unassigned));
  } else if (q.groupBy === 'team') {
    const visible = new Set(ids.map(String));
    const teams = await Team.find({ archived: false, memberIds: { $in: ids } })
      .select('name memberIds')
      .sort({ name: 1 })
      .lean();
    for (const t of teams) {
      const b = bucket(q.weeks);
      const members = t.memberIds.map(String).filter((m) => visible.has(m));
      for (const m of members) addInto(b, perPerson.get(m)!);
      rows.push(toRow(t._id.toString(), t.name, members.length, b));
    }
  } else {
    // Skill: capacity of everyone who has the skill; demand of tasks that require it.
    const names = new Map<string, string>();
    const capacity = new Map<string, { people: number; b: Bucket }>();
    for (const u of users)
      for (const s of u.skills ?? []) {
        const k = s.name.toLowerCase();
        names.set(k, names.get(k) ?? s.name);
        const g = capacity.get(k) ?? { people: 0, b: bucket(q.weeks) };
        g.people += 1;
        addInto(g.b, {
          ...perPerson.get(u._id.toString())!,
          demand: [],
          unscheduled: 0,
          overdue: 0,
        });
        capacity.set(k, g);
      }
    for (const k of skillDemand.keys()) if (!names.has(k)) names.set(k, k);
    for (const [k, label] of [...names].sort((a, b) => a[1].localeCompare(b[1]))) {
      const b = capacity.get(k)?.b ?? bucket(q.weeks);
      const d = skillDemand.get(k);
      if (d) {
        b.demand = d.demand;
        b.unscheduled = d.unscheduled;
        b.overdue = d.overdue;
      }
      rows.push(toRow(k, label, capacity.get(k)?.people ?? 0, b));
    }
  }

  const total = bucket(q.weeks);
  for (const [k, b] of perPerson) if (k !== UNASSIGNED || hasUnassigned) addInto(total, b);
  const shortfalls = rows
    .flatMap((r) =>
      r.weeks.map((w, i) => ({ row: r.label, week: weeks[i]!, gap: r1(w.demand - w.capacity) })),
    )
    .filter((s) => s.gap > 0.5)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 15);

  return {
    weeks,
    groupBy: q.groupBy,
    rows,
    totals: toRow('total', 'Total', users.length, total),
    shortfalls,
    assumptions: [
      `Capacity is each person's weekly hours spread over working days (${org.workingDays.length} a week), less approved leave; the current week counts from today.`,
      `Planned work is each open task's remaining estimate (${cfg.defaultEffortHours} h when no estimate is set), spread evenly over the working days from its start date or today up to its due date.`,
      'Work already past its due date is placed in the first week; work without a due date is shown separately as unscheduled.',
      q.groupBy === 'skill'
        ? 'Skill rows count everyone who has the skill, so a person with several skills appears in several rows; demand comes from the skills a task requires.'
        : 'Unassigned work is the open, unassigned work in projects you can see.',
    ],
  };
}
