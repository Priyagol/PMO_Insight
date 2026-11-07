import {
  DEFAULT_TASK_EFFORT_HOURS,
  type AnalyticsQuery,
  type ForecastLabel,
  type ProjectForecastDto,
} from '@arihant/shared';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { addDaysIso, daysBetweenIso, orgToday, startOfOrgDay } from '../../core/time';
import type { IProject } from '../projects/project.model';
import { Task, type ITask } from '../tasks/task.model';
import { resolveScope } from './analytics.service';

const WEEKS = 4;
const r1 = (n: number) => Math.round(n * 10) / 10;
const effort = (t: Pick<ITask, 'estimatedHours'>) => t.estimatedHours ?? DEFAULT_TASK_EFFORT_HOURS;

/**
 * Projects a completion date from recent throughput: remaining estimated effort divided by
 * the effort completed per week over the last four weeks. Deterministic and explainable;
 * it is a forecast, not a promise, and says so when there is too little history.
 */
export function forecastProject(
  project: Pick<IProject, '_id' | 'key' | 'name' | 'endDate' | 'status'>,
  tasks: Pick<
    ITask,
    | '_id'
    | 'key'
    | 'title'
    | 'status'
    | 'estimatedHours'
    | 'completedAt'
    | 'dueDate'
    | 'assigneeId'
    | 'parentId'
  >[],
  today: string,
): ProjectForecastDto {
  const ref = {
    id: project._id.toString(),
    key: project.key,
    name: project.name,
    endDate: project.endDate ?? undefined,
  };
  const top = tasks.filter((t) => !t.parentId && t.status !== 'cancelled');
  const open = top.filter((t) => t.status !== 'done');
  const remainingHours = r1(open.reduce((s, t) => s + effort(t), 0));

  // Weekly completed effort, oldest first; each "week" is a 7-day window ending today.
  const weeklyHistory = Array.from({ length: WEEKS }, (_, i) => {
    const end = addDaysIso(today, -7 * (WEEKS - 1 - i));
    const start = addDaysIso(end, -6);
    const from = startOfOrgDay(start).getTime();
    const to = startOfOrgDay(addDaysIso(end, 1)).getTime();
    const hours = top
      .filter(
        (t) =>
          t.status === 'done' &&
          t.completedAt &&
          t.completedAt.getTime() >= from &&
          t.completedAt.getTime() < to,
      )
      .reduce((s, t) => s + effort(t), 0);
    return { week: start, hours: r1(hours) };
  });
  const hoursPerWeek = r1(weeklyHistory.reduce((s, w) => s + w.hours, 0) / WEEKS);
  const nonZero = weeklyHistory.map((w) => w.hours).filter((h) => h > 0);

  const soon = addDaysIso(today, 7);
  const tasksAtRisk = open
    .filter((t) => t.dueDate && t.dueDate <= soon)
    .map((t) => {
      const reasons: string[] = [];
      if (t.dueDate! < today) reasons.push('already overdue');
      if (!t.assigneeId) reasons.push('no assignee');
      if (t.status === 'backlog' || t.status === 'todo') reasons.push('not started');
      if (t.status === 'blocked') reasons.push('blocked');
      return {
        id: t._id.toString(),
        key: t.key,
        title: t.title,
        dueDate: t.dueDate!,
        reason: reasons.join(', '),
      };
    })
    .filter((t) => t.reason)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 10);

  const base = {
    project: ref,
    remainingTasks: open.length,
    remainingHours,
    hoursPerWeek,
    weeklyHistory,
    tasksAtRisk,
  };
  if (project.status === 'completed' || project.status === 'cancelled' || open.length === 0) {
    return {
      ...base,
      label: 'done',
      forecastDate: open.length ? null : today,
      range: { optimistic: null, pessimistic: null },
      slipDays: null,
      explanation: open.length ? `The project is ${project.status}.` : 'No open work remains.',
    };
  }
  if (hoursPerWeek === 0) {
    return {
      ...base,
      label: 'insufficient_data',
      forecastDate: null,
      range: { optimistic: null, pessimistic: null },
      slipDays: null,
      explanation: `No work was completed in the last ${WEEKS} weeks, so there is no pace to project from. ${open.length} task(s) (${remainingHours} h) remain.`,
    };
  }
  const dateAt = (perWeek: number) => addDaysIso(today, Math.ceil((remainingHours / perWeek) * 7));
  const forecastDate = dateAt(hoursPerWeek);
  const optimistic = dateAt(Math.max(...nonZero));
  const pessimistic = nonZero.length === WEEKS ? dateAt(Math.min(...nonZero)) : null;
  const slipDays = project.endDate ? daysBetweenIso(project.endDate, forecastDate) : null;
  let label: ForecastLabel;
  if (slipDays === null) label = 'no_end_date';
  else if (slipDays > 14) label = 'likely_late';
  else if (slipDays > 0 || (pessimistic && project.endDate && pessimistic > project.endDate))
    label = 'at_risk';
  else label = 'on_track';
  const pace = `At the recent pace of ${hoursPerWeek} h of estimated work completed per week, the remaining ${remainingHours} h (${open.length} task(s)) finish around ${forecastDate}`;
  const versus =
    slipDays === null
      ? ' The project has no end date to compare with.'
      : slipDays > 0
        ? `, ${slipDays} day(s) after the end date (${project.endDate}).`
        : `, ${-slipDays} day(s) before the end date (${project.endDate}).`;
  return {
    ...base,
    label,
    forecastDate,
    range: { optimistic, pessimistic },
    slipDays,
    explanation: `${pace}${versus}${pessimistic ? '' : ' Some recent weeks had no completions, so the slowest-case date cannot be estimated.'}`,
  };
}

export async function projectForecasts(
  rc: RequestContext,
  raw: Partial<AnalyticsQuery>,
): Promise<ProjectForecastDto[]> {
  const auth = requireAuth(rc);
  const s = await resolveScope(auth, raw);
  const today = orgToday();
  const projects = s.projects.filter((p) => p.status !== 'completed' && p.status !== 'cancelled');
  if (!projects.length) return [];
  const tasks = await Task.find({ projectId: { $in: projects.map((p) => p._id) }, deletedAt: null })
    .select('projectId key title status estimatedHours completedAt dueDate assigneeId parentId')
    .lean();
  const byProject = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const k = t.projectId.toString();
    byProject.set(k, [...(byProject.get(k) ?? []), t]);
  }
  const order: Record<ForecastLabel, number> = {
    likely_late: 0,
    at_risk: 1,
    insufficient_data: 2,
    no_end_date: 3,
    on_track: 4,
    done: 5,
  };
  return projects
    .map((p) => forecastProject(p, byProject.get(p._id.toString()) ?? [], today))
    .sort((a, b) => order[a.label] - order[b.label]);
}
