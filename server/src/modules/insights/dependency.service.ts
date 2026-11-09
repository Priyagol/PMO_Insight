import { Types } from 'mongoose';
import type {
  BlockedTaskDto,
  DependencyLinkDto,
  DependencyMapDto,
  DependencyQuery,
  ProjectLinkDto,
  TaskBriefDto,
  TaskStatus,
} from '@arihant/shared';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { orgToday } from '../../core/time';
import { Project } from '../projects/project.model';
import { Task, type ITask } from '../tasks/task.model';
import { User } from '../users/user.model';
import { TaskTransition } from '../workflows/workflow.models';
import { resolveScope } from './analytics.service';

const OPEN: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'testing', 'blocked'];
const FINISHED: TaskStatus[] = ['done', 'cancelled'];
const MAX_TASKS = 2000;
const MAX_LINKS = 300;
const DAY = 86_400_000;

type TaskRow = Pick<
  ITask,
  | '_id'
  | 'key'
  | 'title'
  | 'status'
  | 'dueDate'
  | 'assigneeId'
  | 'projectId'
  | 'dependencyIds'
  | 'blockedSince'
>;

/**
 * Every open task dependency, blocked task and project-to-project dependency in the viewer's
 * scope, with which ones put delivery dates at risk. Tasks in projects the viewer cannot open
 * are shown only as "a task in another project".
 */
export async function dependencyMap(
  rc: RequestContext,
  q: DependencyQuery,
): Promise<DependencyMapDto> {
  const auth = requireAuth(rc);
  const today = orgToday();
  const s = await resolveScope(auth, { departmentId: q.departmentId, projectId: q.projectId });
  const visible = new Map(s.projects.map((p) => [p._id.toString(), p]));
  const fields = 'key title status dueDate assigneeId projectId dependencyIds blockedSince';

  // Open tasks that wait on something, and blocked tasks.
  const tasks = await Task.find({
    projectId: { $in: s.projectIds },
    deletedAt: null,
    status: { $in: OPEN },
    $or: [{ 'dependencyIds.0': { $exists: true } }, { status: 'blocked' }],
  })
    .select(fields)
    .limit(MAX_TASKS)
    .lean<TaskRow[]>();
  const depIds = [...new Set(tasks.flatMap((t) => t.dependencyIds.map(String)))];
  const [deps, dependents] = await Promise.all([
    Task.find({ _id: { $in: depIds.map((id) => new Types.ObjectId(id)) }, deletedAt: null })
      .select(fields)
      .lean<TaskRow[]>(),
    // Who waits on each blocked or upstream task (open dependents only).
    Task.aggregate<{ _id: Types.ObjectId; n: number }>([
      {
        $match: {
          projectId: { $in: s.projectIds },
          deletedAt: null,
          status: { $in: OPEN },
          'dependencyIds.0': { $exists: true },
        },
      },
      { $unwind: '$dependencyIds' },
      { $group: { _id: '$dependencyIds', n: { $sum: 1 } } },
    ]),
  ]);
  const depById = new Map(deps.map((d) => [d._id.toString(), d]));
  const waiting = new Map(dependents.map((d) => [d._id.toString(), d.n]));

  const people = await User.find({
    _id: { $in: [...tasks, ...deps].map((t) => t.assigneeId).filter(Boolean) },
  })
    .select('name')
    .lean();
  const nameOf = new Map(people.map((p) => [p._id.toString(), p.name]));
  const brief = (t: TaskRow): TaskBriefDto => {
    const p = visible.get(t.projectId.toString())!;
    return {
      id: t._id.toString(),
      key: t.key,
      title: t.title,
      status: t.status,
      dueDate: t.dueDate ?? null,
      assignee: t.assigneeId ? (nameOf.get(t.assigneeId.toString()) ?? null) : null,
      project: { id: p._id.toString(), key: p.key, name: p.name },
    };
  };

  /* ---------- Task → task links ---------- */
  const links: DependencyLinkDto[] = [];
  for (const t of tasks) {
    for (const id of t.dependencyIds.map(String)) {
      const d = depById.get(id);
      if (!d) continue; // deleted
      const canSee = visible.has(d.projectId.toString());
      let state: DependencyLinkDto['state'];
      let reason: string;
      if (FINISHED.includes(d.status)) {
        state = 'ready';
        reason = `${d.key} is finished`;
      } else if (d.dueDate && d.dueDate < today) {
        state = 'late';
        reason = `${canSee ? d.key : 'The task it waits for'} was due ${d.dueDate} and is still open`;
      } else if (d.dueDate && t.dueDate && d.dueDate > t.dueDate) {
        state = 'at_risk';
        reason = `${canSee ? d.key : 'The task it waits for'} is due ${d.dueDate}, after this task's due date ${t.dueDate}`;
      } else {
        state = 'waiting';
        reason = d.dueDate ? `Waiting; due ${d.dueDate}` : 'Waiting; no due date set';
      }
      links.push({
        task: brief(t),
        dependsOn: canSee ? brief(d) : null,
        state,
        reason,
        crossProject: !d.projectId.equals(t.projectId),
      });
    }
  }
  const rank = { late: 0, at_risk: 1, waiting: 2, ready: 3 } as const;
  links.sort(
    (a, b) =>
      rank[a.state] - rank[b.state] || (a.task.dueDate ?? '9').localeCompare(b.task.dueDate ?? '9'),
  );

  /* ---------- Blocked tasks with their note ---------- */
  const blockedTasks = tasks.filter((t) => t.status === 'blocked');
  const notes = await TaskTransition.aggregate<{
    _id: Types.ObjectId;
    comment: string | null;
    actorId: Types.ObjectId | null;
    at: Date;
  }>([
    { $match: { taskId: { $in: blockedTasks.map((t) => t._id) }, to: 'blocked' } },
    { $sort: { at: -1 } },
    {
      $group: {
        _id: '$taskId',
        comment: { $first: '$comment' },
        actorId: { $first: '$actorId' },
        at: { $first: '$at' },
      },
    },
  ]);
  const actors = await User.find({ _id: { $in: notes.map((n) => n.actorId).filter(Boolean) } })
    .select('name')
    .lean();
  const actorName = new Map(actors.map((a) => [a._id.toString(), a.name]));
  const noteOf = new Map(notes.map((n) => [n._id.toString(), n]));
  const blocked: BlockedTaskDto[] = blockedTasks
    .map((t) => {
      const n = noteOf.get(t._id.toString());
      const since = t.blockedSince ?? n?.at ?? null;
      return {
        task: brief(t),
        days: since ? Math.floor((Date.now() - since.getTime()) / DAY) : 0,
        note: n?.comment ?? null,
        by: n?.actorId ? (actorName.get(n.actorId.toString()) ?? null) : null,
        holdingUp: waiting.get(t._id.toString()) ?? 0,
      };
    })
    .sort((a, b) => b.holdingUp - a.holdingUp || b.days - a.days);

  /* ---------- Tasks most others wait for ---------- */
  const upstreamOpen = deps.filter(
    (d) => !FINISHED.includes(d.status) && visible.has(d.projectId.toString()),
  );
  const holdingUpMost = upstreamOpen
    .map((d) => ({ task: brief(d), dependents: waiting.get(d._id.toString()) ?? 0 }))
    .filter((x) => x.dependents > 1)
    .sort((a, b) => b.dependents - a.dependents)
    .slice(0, 10);

  /* ---------- Project → project ---------- */
  const downstream = s.projects.filter(
    (p) => p.dependsOn?.length && p.status !== 'completed' && p.status !== 'cancelled',
  );
  const upstream = await Project.find({
    _id: { $in: downstream.flatMap((p) => p.dependsOn.map((d) => d.projectId)) },
  })
    .select('key name endDate status')
    .lean();
  const upById = new Map(upstream.map((u) => [u._id.toString(), u]));
  const projects: ProjectLinkDto[] = downstream.flatMap((p) =>
    p.dependsOn
      .map((d): ProjectLinkDto | null => {
        const u = upById.get(d.projectId.toString());
        if (!u) return null;
        let state: ProjectLinkDto['state'];
        let reason: string;
        if (u.status === 'completed') {
          state = 'done';
          reason = `${u.key} is completed`;
        } else if (u.endDate && u.endDate < today) {
          state = 'late';
          reason = `${u.key} was due to end ${u.endDate} and is not completed`;
        } else if (u.endDate && p.endDate && u.endDate > p.endDate) {
          state = 'at_risk';
          reason = `${u.key} ends ${u.endDate}, after ${p.key} is due to end (${p.endDate})`;
        } else {
          state = 'ok';
          reason = u.endDate
            ? `${u.key} is planned to end ${u.endDate}`
            : `${u.key} has no end date`;
        }
        return {
          project: { id: p._id.toString(), key: p.key, name: p.name, endDate: p.endDate ?? null },
          dependsOn: {
            id: u._id.toString(),
            key: u.key,
            name: u.name,
            endDate: u.endDate ?? null,
            status: u.status,
          },
          note: d.note ?? null,
          state,
          reason,
        };
      })
      .filter((x): x is ProjectLinkDto => x !== null),
  );

  const open = links.filter((l) => l.state !== 'ready');
  return {
    summary: {
      openLinks: open.length,
      late: open.filter((l) => l.state === 'late').length,
      atRisk: open.filter((l) => l.state === 'at_risk').length,
      crossProject: open.filter((l) => l.crossProject).length,
      blocked: blocked.length,
      blockedOver3Days: blocked.filter((b) => b.days > 3).length,
      projectLinksAtRisk: projects.filter((p) => p.state === 'late' || p.state === 'at_risk')
        .length,
    },
    links: links.slice(0, MAX_LINKS),
    blocked,
    holdingUpMost,
    projects,
  };
}
