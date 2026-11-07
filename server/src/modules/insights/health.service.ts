import { type Types } from 'mongoose';
import {
  DEFAULT_TASK_EFFORT_HOURS,
  OPEN_RISK_STATUSES,
  healthBand,
  type EarlyWarningDto,
  type HealthFactor,
  type ProjectHealthDto,
  type UserRef,
} from '@arihant/shared';
import { addDaysIso, daysBetweenIso, orgToday } from '../../core/time';
import { computeProgress } from '../projects/project.service';
import { Milestone } from '../planning/planning.models';
import { Project } from '../projects/project.model';
import { Risk } from '../risks/risk.model';
import { Task } from '../tasks/task.model';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import type { IProject } from '../projects/project.model';

const BLOCKED_LIMIT_MS = 48 * 3600_000;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

interface ProjectStats {
  open: number;
  overdue: number;
  blockedLong: { id: string; key: string; title: string; since: Date }[];
  estimated: number;
  actual: number;
  overrunTasks: { id: string; key: string; title: string; estimated: number; actual: number }[];
  delayedDeps: { id: string; key: string; title: string; depKey: string }[];
}

/**
 * Health score 0..100 = Σ weight × factor (each 0..1), explainable factor by factor:
 *   schedule 40% · effort 20% · overdue 20% · serious risks 10% · long blocks 10%.
 */
export function scoreHealth(
  project: Pick<IProject, 'startDate' | 'endDate' | 'estimatedHours' | 'status'>,
  progressPct: number,
  stats: Pick<ProjectStats, 'open' | 'overdue' | 'blockedLong' | 'estimated' | 'actual'>,
  seriousRisks: number,
  today: string,
): { score: number; factors: HealthFactor[] } {
  const progress = progressPct / 100;
  const factors: HealthFactor[] = [];

  // Schedule: elapsed time vs progress.
  let schedule = 1;
  let scheduleDetail = 'No start/end dates set';
  if (project.startDate && project.endDate && project.endDate >= project.startDate) {
    const total = Math.max(daysBetweenIso(project.startDate, project.endDate), 1);
    const elapsed = clamp01(daysBetweenIso(project.startDate, today) / total);
    if (today > project.endDate && progress < 1) {
      schedule = 0;
      scheduleDetail = `Past the end date (${project.endDate}) at ${progressPct}% complete`;
    } else {
      const gap = Math.max(elapsed - progress, 0);
      schedule = 1 - clamp01(gap / 0.5);
      scheduleDetail = `${Math.round(elapsed * 100)}% of time elapsed, ${progressPct}% of work done`;
    }
  }
  factors.push({
    key: 'schedule',
    label: 'Schedule',
    weight: 0.4,
    value: round(schedule),
    detail: scheduleDetail,
  });

  // Effort: projected total effort vs estimate.
  const estimate = project.estimatedHours ?? stats.estimated;
  let effort = 1;
  let effortDetail = 'No effort estimate yet';
  if (estimate > 0) {
    const projected = progress > 0.05 ? stats.actual / progress : stats.actual;
    const overrun = projected / estimate - 1;
    effort = 1 - clamp01(overrun / 0.5);
    effortDetail =
      `${round(stats.actual, 1)} h logged of ${round(estimate, 1)} h estimated` +
      (overrun > 0.05 ? `; projected ${Math.round(overrun * 100)}% over` : '');
  }
  factors.push({
    key: 'effort',
    label: 'Effort',
    weight: 0.2,
    value: round(effort),
    detail: effortDetail,
  });

  const overdueRatio = stats.open ? stats.overdue / stats.open : 0;
  factors.push({
    key: 'overdue',
    label: 'Overdue work',
    weight: 0.2,
    value: round(1 - clamp01(overdueRatio * 2)),
    detail: `${stats.overdue} of ${stats.open} open task(s) overdue`,
  });
  factors.push({
    key: 'risks',
    label: 'Serious risks',
    weight: 0.1,
    value: round(1 - clamp01(seriousRisks / 3)),
    detail: `${seriousRisks} open high/critical risk(s) or issue(s)`,
  });
  factors.push({
    key: 'blocked',
    label: 'Blocked work',
    weight: 0.1,
    value: round(1 - clamp01(stats.blockedLong.length / 3)),
    detail: `${stats.blockedLong.length} task(s) blocked for more than 48 hours`,
  });

  const score =
    project.status === 'completed'
      ? 100
      : Math.round(factors.reduce((s, f) => s + f.weight * f.value, 0) * 100);
  return { score, factors };
}

async function collectStats(
  projectIds: Types.ObjectId[],
  today: string,
): Promise<Map<string, ProjectStats>> {
  const tasks = await Task.find({
    projectId: { $in: projectIds },
    deletedAt: null,
    status: { $ne: 'cancelled' },
  })
    .select(
      'projectId key title status dueDate estimatedHours actualHours blockedSince dependencyIds parentId',
    )
    .lean();
  const byId = new Map(tasks.map((t) => [t._id.toString(), t]));
  const stats = new Map<string, ProjectStats>();
  const now = Date.now();
  for (const t of tasks) {
    const k = t.projectId.toString();
    const s = stats.get(k) ?? {
      open: 0,
      overdue: 0,
      blockedLong: [],
      estimated: 0,
      actual: 0,
      overrunTasks: [],
      delayedDeps: [],
    };
    const open = t.status !== 'done';
    if (!t.parentId) s.estimated += t.estimatedHours ?? DEFAULT_TASK_EFFORT_HOURS;
    s.actual += t.actualHours ?? 0;
    if (open) {
      s.open += 1;
      if (t.dueDate && t.dueDate < today) s.overdue += 1;
      if (
        t.status === 'blocked' &&
        t.blockedSince &&
        now - t.blockedSince.getTime() > BLOCKED_LIMIT_MS
      ) {
        s.blockedLong.push({
          id: t._id.toString(),
          key: t.key,
          title: t.title,
          since: t.blockedSince,
        });
      }
      for (const d of t.dependencyIds) {
        const dep = byId.get(d.toString());
        if (dep && dep.status !== 'done' && dep.dueDate && dep.dueDate < today) {
          s.delayedDeps.push({ id: t._id.toString(), key: t.key, title: t.title, depKey: dep.key });
        }
      }
    }
    if (t.estimatedHours && t.actualHours > t.estimatedHours * 1.2) {
      s.overrunTasks.push({
        id: t._id.toString(),
        key: t.key,
        title: t.title,
        estimated: t.estimatedHours,
        actual: t.actualHours,
      });
    }
    stats.set(k, s);
  }
  return stats;
}

/** Health and early warnings for a batch of projects (a fixed number of queries). */
export async function computeHealth(projects: IProject[]): Promise<ProjectHealthDto[]> {
  if (!projects.length) return [];
  const today = orgToday();
  const ids = projects.map((p) => p._id);
  const upstreamIds = projects.flatMap((p) => (p.dependsOn ?? []).map((d) => d.projectId));
  const [progress, stats, risks, managers, overdueMilestones, upstream] = await Promise.all([
    computeProgress(ids),
    collectStats(ids, today),
    Risk.find({
      projectId: { $in: ids },
      deletedAt: null,
      status: { $in: [...OPEN_RISK_STATUSES] },
      severity: { $in: ['high', 'critical'] },
    })
      .select('projectId key title severity type')
      .lean(),
    User.find({ _id: { $in: projects.map((p) => p.managerId) } })
      .select('name email employeeId designation')
      .lean(),
    Milestone.find({ projectId: { $in: ids }, status: 'open', dueDate: { $lt: today } })
      .select('projectId name dueDate')
      .lean(),
    upstreamIds.length
      ? Project.find({ _id: { $in: upstreamIds } })
          .select('key name status endDate')
          .lean()
      : Promise.resolve([]),
  ]);
  const upstreamMap = new Map(upstream.map((u) => [u._id.toString(), u]));
  // Upstream names are shown only when that project is part of the same (already scoped) list.
  const listed = new Set(ids.map(String));
  const managerMap = new Map<string, UserRef>(
    managers.map((m) => [m._id.toString(), toUserRef(m)]),
  );

  return projects.map((p) => {
    const k = p._id.toString();
    const s = stats.get(k) ?? {
      open: 0,
      overdue: 0,
      blockedLong: [],
      estimated: 0,
      actual: 0,
      overrunTasks: [],
      delayedDeps: [],
    };
    const pct = progress.get(k)?.percent ?? 0;
    const projectRisks = risks.filter((r) => r.projectId.equals(p._id));
    const { score, factors } = scoreHealth(p, pct, s, projectRisks.length, today);
    const ref = { id: k, key: p.key, name: p.name };
    const warnings: EarlyWarningDto[] = [];
    const active = p.status !== 'completed' && p.status !== 'cancelled';

    if (active && p.endDate) {
      if (p.endDate < today && pct < 100) {
        warnings.push({
          type: 'project_overdue',
          severity: 'critical',
          project: ref,
          message: `End date ${p.endDate} has passed at ${pct}% complete`,
        });
      } else if (p.endDate <= addDaysIso(today, 14) && pct < 80) {
        warnings.push({
          type: 'deadline_approaching',
          severity: 'serious',
          project: ref,
          message: `Due ${p.endDate} (${daysBetweenIso(today, p.endDate)} days) with ${pct}% complete and ${s.open} open task(s)`,
        });
      }
    }
    for (const b of s.blockedLong) {
      const days = Math.floor((Date.now() - b.since.getTime()) / 86_400_000);
      warnings.push({
        type: 'blocked_too_long',
        severity: days >= 5 ? 'serious' : 'warning',
        project: ref,
        entity: { kind: 'task', id: b.id, label: `${b.key} ${b.title}` },
        message: `Blocked for ${days} day(s)`,
      });
    }
    const estimate = p.estimatedHours ?? s.estimated;
    if (active && estimate > 0 && s.actual > estimate) {
      warnings.push({
        type: 'effort_overrun',
        severity: 'serious',
        project: ref,
        message: `${round(s.actual, 1)} h logged exceeds the ${round(estimate, 1)} h estimate`,
      });
    }
    for (const o of s.overrunTasks.slice(0, 5)) {
      warnings.push({
        type: 'effort_overrun',
        severity: 'warning',
        project: ref,
        entity: { kind: 'task', id: o.id, label: `${o.key} ${o.title}` },
        message: `${o.actual} h logged vs ${o.estimated} h estimated`,
      });
    }
    for (const d of s.delayedDeps.slice(0, 5)) {
      warnings.push({
        type: 'dependency_delayed',
        severity: 'warning',
        project: ref,
        entity: { kind: 'task', id: d.id, label: `${d.key} ${d.title}` },
        message: `Waiting on overdue ${d.depKey}`,
      });
    }
    for (const r of projectRisks.filter((x) => x.severity === 'critical')) {
      warnings.push({
        type: 'critical_risk',
        severity: 'critical',
        project: ref,
        entity: { kind: 'risk', id: r._id.toString(), label: `${r.key} ${r.title}` },
        message: `Critical open ${r.type}`,
      });
    }
    for (const m of overdueMilestones.filter((x) => x.projectId.equals(p._id)).slice(0, 5)) {
      warnings.push({
        type: 'milestone_overdue',
        severity: 'serious',
        project: ref,
        message: `Milestone "${m.name}" was due ${m.dueDate} and is not completed`,
      });
    }
    for (const d of active ? (p.dependsOn ?? []) : []) {
      const u = upstreamMap.get(d.projectId.toString());
      if (!u || u.status === 'completed' || u.status === 'cancelled') continue;
      const late = u.endDate && u.endDate < today;
      const overlaps = u.endDate && p.startDate && u.endDate >= p.startDate;
      if (!late && !overlaps && u.status !== 'at_risk') continue;
      const name = listed.has(u._id.toString()) ? u.key : 'an upstream project';
      const why = late
        ? `passed its end date (${u.endDate})`
        : overlaps
          ? `ends ${u.endDate}, on or after this project starts`
          : 'is at risk';
      warnings.push({
        type: 'upstream_project_delayed',
        severity: late ? 'serious' : 'warning',
        project: ref,
        message: `Depends on ${name}, which ${why}`,
      });
    }
    const order = { critical: 0, serious: 1, warning: 2 };
    warnings.sort((a, b) => order[a.severity] - order[b.severity]);

    return {
      project: {
        id: k,
        key: p.key,
        name: p.name,
        status: p.status,
        endDate: p.endDate ?? undefined,
      },
      manager: managerMap.get(p.managerId.toString()) ?? null,
      score,
      band: healthBand(score),
      factors,
      progress: pct,
      warnings,
    };
  });
}
