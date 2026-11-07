import { type Types } from 'mongoose';
import {
  DEFAULT_ASSIGNMENT_CONFIG,
  OPEN_TASK_STATUSES,
  assignmentConfigSchema,
  type AssignmentConfig,
  type OrgSettingsDto,
} from '@arihant/shared';
import { addDaysIso, dayOfWeekIso, orgToday } from '../../core/time';
import { AssignmentHistory } from '../collab/collab.models';
import { Setting } from '../settings/settings.model';
import { getOrgSettings } from '../settings/settings.service';
import { Task, type ITask } from '../tasks/task.model';
import { Availability } from '../tracking/tracking.models';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import type { EngineCandidate, EngineTask } from './engine';

const CONFIG_KEY = 'assignment';

export async function getAssignmentConfig(): Promise<AssignmentConfig> {
  const doc = await Setting.findOne({ key: CONFIG_KEY }).lean();
  const parsed = assignmentConfigSchema.safeParse({
    ...DEFAULT_ASSIGNMENT_CONFIG,
    ...((doc?.value as object) ?? {}),
  });
  return parsed.success ? parsed.data : DEFAULT_ASSIGNMENT_CONFIG;
}

/** Effort still to do on a task. Started work counts its remaining estimate (at least 25%). */
export function remainingEffort(
  t: Pick<ITask, 'estimatedHours' | 'actualHours' | 'status'>,
  defaultHours: number,
): number {
  const est = t.estimatedHours ?? defaultHours;
  if (t.status === 'in_progress' || t.status === 'in_review' || t.status === 'testing') {
    return Math.max(est - (t.actualHours ?? 0), 0.25 * est);
  }
  return est;
}

export function toEngineTask(t: ITask, cfg: AssignmentConfig): EngineTask {
  return {
    id: t._id.toString(),
    key: t.key,
    title: t.title,
    priority: t.priority,
    complexity: t.complexity ?? null,
    requiredSkills: t.requiredSkills.map((s) => ({ name: s.name, minLevel: s.minLevel ?? 1 })),
    effortHours: remainingEffort(t, cfg.defaultEffortHours),
    dueDate: t.dueDate ?? null,
  };
}

/** The next `n` working days starting today (organisation calendar and working-day setting). */
export function horizonDays(org: OrgSettingsDto, n: number, today = orgToday()): string[] {
  const days: string[] = [];
  for (let d = today; days.length < n; d = addDaysIso(d, 1)) {
    if (org.workingDays.includes(dayOfWeekIso(d))) days.push(d);
  }
  return days;
}

/**
 * Builds engine candidates: capacity over the horizon after approved leave / partial
 * availability, current open workload across ALL projects, and last assignment time.
 */
export async function loadCandidates(
  userIds: Types.ObjectId[],
  cfg: AssignmentConfig,
): Promise<EngineCandidate[]> {
  if (userIds.length === 0) return [];
  const org = await getOrgSettings();
  const days = horizonDays(org, cfg.horizonDays);
  const first = days[0]!;
  const last = days[days.length - 1]!;

  const [users, tasks, leaves, lastAssigned] = await Promise.all([
    User.find({ _id: { $in: userIds }, status: 'active' })
      .select('name email employeeId designation skills weeklyCapacityHours')
      .lean(),
    Task.find({
      assigneeId: { $in: userIds },
      deletedAt: null,
      status: { $in: OPEN_TASK_STATUSES },
    })
      .select('assigneeId estimatedHours actualHours status')
      .lean(),
    Availability.find({
      userId: { $in: userIds },
      status: 'approved',
      from: { $lte: last },
      to: { $gte: first },
    }).lean(),
    AssignmentHistory.aggregate<{ _id: Types.ObjectId; at: Date }>([
      { $match: { toUserId: { $in: userIds } } },
      { $group: { _id: '$toUserId', at: { $max: '$createdAt' } } },
    ]),
  ]);

  const load = new Map<string, { hours: number; count: number }>();
  for (const t of tasks) {
    const key = t.assigneeId!.toString();
    const cur = load.get(key) ?? { hours: 0, count: 0 };
    cur.hours += remainingEffort(t, cfg.defaultEffortHours);
    cur.count += 1;
    load.set(key, cur);
  }
  const lastMap = new Map(lastAssigned.map((r) => [r._id.toString(), r.at.getTime()]));

  return users.map((u) => {
    const dailyHours = org.workingDays.length ? u.weeklyCapacityHours / org.workingDays.length : 0;
    // Fraction of each horizon day still available after approved leave.
    let availableDays = 0;
    for (const d of days) {
      const blocks = leaves.filter((l) => l.userId.equals(u._id) && l.from <= d && l.to >= d);
      let fraction = 1;
      for (const b of blocks) {
        const f =
          b.type === 'partial' && b.hoursPerDay != null && dailyHours > 0
            ? Math.min(b.hoursPerDay / dailyHours, 1)
            : 0;
        fraction = Math.min(fraction, f);
      }
      availableDays += fraction;
    }
    const l = load.get(u._id.toString()) ?? { hours: 0, count: 0 };
    return {
      id: u._id.toString(),
      ref: toUserRef(u),
      skills: new Map(u.skills.map((s) => [s.name.toLowerCase(), s.level])),
      capacityHours: Math.round(dailyHours * availableDays * 100) / 100,
      loadHours: Math.round(l.hours * 100) / 100,
      availableDays,
      horizonDays: days.length,
      openTasks: l.count,
      lastAssignedAt: lastMap.get(u._id.toString()) ?? 0,
    };
  });
}
