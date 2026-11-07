import { Types } from 'mongoose';
import {
  completeSprintSchema,
  createSprintSchema,
  projectAgileSettingsSchema,
  sprintScopeSchema,
  startSprintSchema,
  updateSprintSchema,
  type CompleteSprintInput,
  type CreateSprintInput,
  type EpicSummaryDto,
  type ProjectAgileSettingsDto,
  type ProjectAgileSettingsInput,
  type SprintDto,
  type SprintScopeInput,
  type StartSprintInput,
  type TaskDto,
  type TaskStatus,
  type UpdateSprintInput,
} from '@arihant/shared';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../../core/errors';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { canUpdateProject, taskReadFilter } from '../../core/rbac/work-access';
import { daysBetweenIso, orgToday } from '../../core/time';
import { recordAudit } from '../audit/audit.service';
import { recordActivity } from '../collab/activity.service';
import { loadReadableProject } from '../projects/project.service';
import { Project, type IProject } from '../projects/project.model';
import { Task } from '../tasks/task.model';
import { presentTasks } from '../tasks/task.presenter';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { Sprint, type ISprint } from './sprint.model';

const oid = (id: string) => new Types.ObjectId(id);
const OPEN: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'testing', 'blocked'];
const pts = (t: { storyPoints?: number | null }) => t.storyPoints ?? 0;

/** Project managers, editors and project leads plan sprints and the backlog. */
export function canPlan(auth: AuthContext, project: IProject): boolean {
  if (project.archived) return false;
  return (
    canUpdateProject(auth, project) ||
    project.members.some(
      (m) => m.userId.toString() === auth.userId && (m.role === 'manager' || m.role === 'lead'),
    )
  );
}

async function loadProjectForPlanning(rc: RequestContext, projectId: string, write: boolean) {
  const auth = requireAuth(rc);
  const project = await loadReadableProject(auth, projectId);
  if (write && !canPlan(auth, project))
    throw new ForbiddenError('Only the project manager or a project lead can plan sprints');
  return { auth, project };
}

async function loadSprint(rc: RequestContext, id: string, write: boolean) {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Sprint');
  const sprint = await Sprint.findOne({ _id: oid(id), deletedAt: null }).lean();
  if (!sprint) throw new NotFoundError('Sprint');
  const ctx = await loadProjectForPlanning(rc, sprint.projectId.toString(), write);
  return { ...ctx, sprint };
}

async function presentSprints(
  auth: AuthContext,
  project: IProject,
  sprints: ISprint[],
): Promise<SprintDto[]> {
  if (!sprints.length) return [];
  const rows = await Task.aggregate<{
    _id: Types.ObjectId;
    n: number;
    done: number;
    p: number;
    dp: number;
  }>([
    { $match: { sprintId: { $in: sprints.map((s) => s._id) }, deletedAt: null, parentId: null } },
    {
      $group: {
        _id: '$sprintId',
        n: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
        p: { $sum: { $ifNull: ['$storyPoints', 0] } },
        dp: {
          $sum: { $cond: [{ $eq: ['$status', 'done'] }, { $ifNull: ['$storyPoints', 0] }, 0] },
        },
      },
    },
  ]);
  const totals = new Map(rows.map((r) => [r._id.toString(), r]));
  const today = orgToday();
  const editable = canPlan(auth, project);
  return sprints.map((s) => {
    const t = totals.get(s._id.toString());
    return {
      id: s._id.toString(),
      project: { id: project._id.toString(), key: project.key, name: project.name },
      name: s.name,
      goal: s.goal ?? undefined,
      status: s.status,
      startDate: s.startDate ?? undefined,
      endDate: s.endDate ?? undefined,
      startedAt: s.startedAt?.toISOString(),
      completedAt: s.completedAt?.toISOString(),
      taskCount: t?.n ?? 0,
      doneCount: t?.done ?? 0,
      points: t?.p ?? 0,
      donePoints: t?.dp ?? 0,
      committedPoints: s.committedPoints ?? null,
      completedPoints: s.completedPoints ?? null,
      daysLeft:
        s.status === 'active' && s.endDate ? Math.max(0, daysBetweenIso(today, s.endDate)) : null,
      can: { edit: editable && s.status !== 'completed' },
    };
  });
}

/* ---------- Sprints ---------- */

export async function listSprints(rc: RequestContext, projectId: string): Promise<SprintDto[]> {
  const { auth, project } = await loadProjectForPlanning(rc, projectId, false);
  const sprints = await Sprint.find({ projectId: project._id, deletedAt: null }).lean();
  const order = { active: 0, planned: 1, completed: 2 } as const;
  sprints.sort((a, b) =>
    order[a.status] !== order[b.status]
      ? order[a.status] - order[b.status]
      : a.status === 'completed'
        ? b.number - a.number
        : a.number - b.number,
  );
  return presentSprints(auth, project, sprints);
}

export async function getSprint(rc: RequestContext, id: string): Promise<SprintDto> {
  const { auth, project, sprint } = await loadSprint(rc, id, false);
  return (await presentSprints(auth, project, [sprint]))[0]!;
}

export async function createSprint(rc: RequestContext, raw: CreateSprintInput): Promise<SprintDto> {
  const input = createSprintSchema.parse(raw);
  const { auth, project } = await loadProjectForPlanning(rc, input.projectId, true);
  const last = await Sprint.findOne({ projectId: project._id })
    .sort({ number: -1 })
    .select('number')
    .lean();
  const number = (last?.number ?? 0) + 1;
  const doc = await Sprint.create({
    projectId: project._id,
    number,
    name: input.name ?? `${project.key} Sprint ${number}`,
    goal: input.goal ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    createdBy: auth.userObjectId,
  });
  return (await presentSprints(auth, project, [doc.toObject()]))[0]!;
}

export async function updateSprint(
  rc: RequestContext,
  id: string,
  raw: UpdateSprintInput,
): Promise<SprintDto> {
  const input = updateSprintSchema.parse(raw);
  const { auth, project, sprint } = await loadSprint(rc, id, true);
  if (sprint.status === 'completed')
    throw new UnprocessableError('A completed sprint cannot be changed');
  const start = input.startDate !== undefined ? input.startDate : sprint.startDate;
  const end = input.endDate !== undefined ? input.endDate : sprint.endDate;
  if (start && end && start > end)
    throw new UnprocessableError('End date must be on or after the start date');
  if (sprint.status === 'active' && (!start || !end))
    throw new UnprocessableError('A running sprint needs start and end dates');
  const updated = await Sprint.findByIdAndUpdate(
    sprint._id,
    { $set: input },
    { returnDocument: 'after' },
  ).lean();
  return (await presentSprints(auth, project, [updated!]))[0]!;
}

/** Only planned sprints can be deleted; their tasks go back to the backlog. */
export async function deleteSprint(rc: RequestContext, id: string): Promise<void> {
  const { sprint } = await loadSprint(rc, id, true);
  if (sprint.status !== 'planned')
    throw new UnprocessableError('Only sprints that have not started can be deleted');
  await Task.updateMany({ sprintId: sprint._id }, { $set: { sprintId: null } });
  await Sprint.updateOne({ _id: sprint._id }, { $set: { deletedAt: new Date() } });
}

export async function startSprint(
  rc: RequestContext,
  id: string,
  raw: StartSprintInput,
): Promise<SprintDto> {
  const input = startSprintSchema.parse(raw);
  const { auth, project, sprint } = await loadSprint(rc, id, true);
  if (sprint.status !== 'planned') throw new UnprocessableError('This sprint has already started');
  const tasks = await Task.find({ sprintId: sprint._id, deletedAt: null, parentId: null })
    .select('storyPoints')
    .lean();
  if (!tasks.length) throw new UnprocessableError('Add tasks to the sprint before starting it');
  let updated: ISprint | null;
  try {
    updated = await Sprint.findOneAndUpdate(
      { _id: sprint._id, status: 'planned' },
      {
        $set: {
          status: 'active',
          startDate: input.startDate,
          endDate: input.endDate,
          goal: input.goal ?? sprint.goal ?? null,
          startedAt: new Date(),
          committedTaskIds: tasks.map((t) => t._id),
          committedPoints: tasks.reduce((n, t) => n + pts(t), 0),
        },
      },
      { returnDocument: 'after' },
    ).lean();
  } catch (err) {
    if ((err as { code?: number }).code === 11000)
      throw new ConflictError(
        'Another sprint is already running in this project. Complete it first.',
      );
    throw err;
  }
  if (!updated)
    throw new ConflictError('This sprint was changed by someone else. Reload and try again.');
  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: project.name,
    verb: 'sprint_started',
    summary: `started ${sprint.name} (${tasks.length} tasks, ${updated.committedPoints} points)`,
  });
  return (await presentSprints(auth, project, [updated]))[0]!;
}

export async function completeSprint(
  rc: RequestContext,
  id: string,
  raw: CompleteSprintInput,
): Promise<SprintDto & { carriedOver: number }> {
  const input = completeSprintSchema.parse(raw);
  const { auth, project, sprint } = await loadSprint(rc, id, true);
  if (sprint.status !== 'active')
    throw new UnprocessableError('Only a running sprint can be completed');
  let targetId: Types.ObjectId | null = null;
  if (input.moveOpenTo !== 'backlog') {
    const target = await Sprint.findOne({ _id: oid(input.moveOpenTo), deletedAt: null }).lean();
    if (!target || !target.projectId.equals(project._id) || target.status !== 'planned')
      throw new UnprocessableError('Choose a planned sprint of the same project');
    targetId = target._id;
  }
  const tasks = await Task.find({ sprintId: sprint._id, deletedAt: null, parentId: null })
    .select('status storyPoints')
    .lean();
  const done = tasks.filter((t) => t.status === 'done');
  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const updated = await Sprint.findOneAndUpdate(
    { _id: sprint._id, status: 'active' },
    {
      $set: {
        status: 'completed',
        completedAt: new Date(),
        completedTaskIds: done.map((t) => t._id),
        completedPoints: done.reduce((n, t) => n + pts(t), 0),
        carriedOverTaskIds: open.map((t) => t._id),
      },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!updated)
    throw new ConflictError('This sprint was changed by someone else. Reload and try again.');
  if (open.length) {
    const ids = open.map((t) => t._id);
    await Task.updateMany(
      { $or: [{ _id: { $in: ids } }, { parentId: { $in: ids } }] },
      { $set: { sprintId: targetId } },
    );
  }
  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: project.name,
    verb: 'sprint_completed',
    summary: `completed ${sprint.name}: ${done.length} done (${updated.completedPoints} points), ${open.length} moved to ${targetId ? 'the next sprint' : 'the backlog'}`,
  });
  await recordAudit(rc, {
    action: 'sprint.completed',
    entityType: 'project',
    entityId: project._id,
    summary: `Completed ${sprint.name} in ${project.key}`,
    after: {
      done: done.length,
      carriedOver: open.length,
      completedPoints: updated.completedPoints,
    },
  });
  return { ...(await presentSprints(auth, project, [updated]))[0]!, carriedOver: open.length };
}

/** Moves tasks (with their subtasks) into a sprint, or back to the backlog. */
export async function setSprintScope(
  rc: RequestContext,
  raw: SprintScopeInput,
): Promise<{ moved: number }> {
  const input = sprintScopeSchema.parse(raw);
  const auth = requireAuth(rc);
  const ids = [...new Set(input.taskIds)].map(oid);
  const tasks = await Task.find({ $and: [{ _id: { $in: ids } }, await taskReadFilter(auth)] })
    .select('projectId parentId type status')
    .lean();
  if (tasks.length !== ids.length) throw new NotFoundError('Task');
  const projectIds = new Set(tasks.map((t) => t.projectId.toString()));
  if (projectIds.size !== 1) throw new UnprocessableError('Plan tasks of one project at a time');
  const project = await Project.findById(tasks[0]!.projectId).lean();
  if (!project || !canPlan(auth, project))
    throw new ForbiddenError('Only the project manager or a project lead can plan sprints');
  if (tasks.some((t) => t.parentId))
    throw new UnprocessableError('Subtasks follow their parent task');
  if (tasks.some((t) => t.type === 'epic'))
    throw new UnprocessableError('Epics are not planned into sprints');
  if (input.sprintId) {
    const sprint = await Sprint.findOne({ _id: oid(input.sprintId), deletedAt: null }).lean();
    if (!sprint || !sprint.projectId.equals(project._id))
      throw new UnprocessableError('Choose a sprint from the same project');
    if (sprint.status === 'completed')
      throw new UnprocessableError('That sprint is already completed');
  }
  const res = await Task.updateMany(
    { $or: [{ _id: { $in: ids } }, { parentId: { $in: ids } }], deletedAt: null },
    { $set: { sprintId: input.sprintId ? oid(input.sprintId) : null } },
  );
  return { moved: Math.min(res.modifiedCount, ids.length) };
}

/** Planning view: running and planned sprints with their tasks, then the ranked backlog. */
export async function getBacklog(
  rc: RequestContext,
  projectId: string,
): Promise<{
  sprints: (SprintDto & { tasks: TaskDto[] })[];
  backlog: TaskDto[];
  canPlan: boolean;
}> {
  const { auth, project } = await loadProjectForPlanning(rc, projectId, false);
  const read = await taskReadFilter(auth);
  const sprints = await Sprint.find({
    projectId: project._id,
    deletedAt: null,
    status: { $ne: 'completed' },
  })
    .sort({ status: 1, number: 1 })
    .lean();
  sprints.sort((a, b) =>
    a.status === b.status ? a.number - b.number : a.status === 'active' ? -1 : 1,
  );
  const sortStage = [
    { $addFields: { r: { $ifNull: ['$backlogRank', '{'] } } },
    { $sort: { r: 1 as const, createdAt: 1 as const, _id: 1 as const } },
    { $limit: 500 },
  ];
  const [inSprints, backlogDocs] = await Promise.all([
    Task.aggregate([
      {
        $match: {
          $and: [
            read,
            { sprintId: { $in: sprints.map((s) => s._id) }, deletedAt: null, parentId: null },
          ],
        },
      },
      ...sortStage,
    ]),
    Task.aggregate([
      {
        $match: {
          $and: [
            read,
            { projectId: project._id, sprintId: null, deletedAt: null, parentId: null },
            { type: { $ne: 'epic' }, status: { $in: OPEN } },
          ],
        },
      },
      ...sortStage,
    ]),
  ]);
  const presented = await presentTasks(auth, [...inSprints, ...backlogDocs]);
  const byId = new Map(presented.map((t) => [t.id, t]));
  const sprintDtos = await presentSprints(auth, project, sprints);
  return {
    sprints: sprintDtos.map((s) => ({
      ...s,
      tasks: inSprints
        .filter((t) => t.sprintId.toString() === s.id)
        .map((t) => byId.get(t._id.toString())!),
    })),
    backlog: backlogDocs.map((t) => byId.get(t._id.toString())!),
    canPlan: canPlan(auth, project),
  };
}

/* ---------- Epics ---------- */

export async function listEpics(rc: RequestContext, projectId: string): Promise<EpicSummaryDto[]> {
  const { auth, project } = await loadProjectForPlanning(rc, projectId, false);
  const read = await taskReadFilter(auth);
  const epics = await Task.find({
    $and: [read, { projectId: project._id, type: 'epic', deletedAt: null }],
  })
    .sort({ createdAt: 1 })
    .select('key title status')
    .lean();
  if (!epics.length) return [];
  const rows = await Task.aggregate<{
    _id: Types.ObjectId;
    n: number;
    done: number;
    p: number;
    dp: number;
  }>([
    {
      $match: {
        epicId: { $in: epics.map((e) => e._id) },
        deletedAt: null,
        status: { $ne: 'cancelled' },
      },
    },
    {
      $group: {
        _id: '$epicId',
        n: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
        p: { $sum: { $ifNull: ['$storyPoints', 0] } },
        dp: {
          $sum: { $cond: [{ $eq: ['$status', 'done'] }, { $ifNull: ['$storyPoints', 0] }, 0] },
        },
      },
    },
  ]);
  const m = new Map(rows.map((r) => [r._id.toString(), r]));
  return epics.map((e) => {
    const r = m.get(e._id.toString());
    const n = r?.n ?? 0;
    const percent =
      r && r.p > 0
        ? Math.round((r.dp / r.p) * 100)
        : n
          ? Math.round(((r?.done ?? 0) / n) * 100)
          : 0;
    return {
      id: e._id.toString(),
      key: e.key,
      title: e.title,
      status: e.status,
      childCount: n,
      childDone: r?.done ?? 0,
      points: r?.p ?? 0,
      donePoints: r?.dp ?? 0,
      percent,
    };
  });
}

/* ---------- Components and WIP limits ---------- */

export async function getAgileSettings(
  rc: RequestContext,
  projectId: string,
): Promise<ProjectAgileSettingsDto> {
  const { auth, project } = await loadProjectForPlanning(rc, projectId, false);
  const leadIds = (project.components ?? [])
    .map((c) => c.leadId)
    .filter((x): x is Types.ObjectId => Boolean(x));
  const [leads, counts] = await Promise.all([
    leadIds.length
      ? User.find({ _id: { $in: leadIds } })
          .select('name email employeeId designation')
          .lean()
      : [],
    Task.aggregate<{ _id: string; n: number }>([
      { $match: { projectId: project._id, deletedAt: null, status: { $in: OPEN } } },
      { $unwind: '$components' },
      { $group: { _id: '$components', n: { $sum: 1 } } },
    ]),
  ]);
  const leadMap = new Map(leads.map((u) => [u._id.toString(), toUserRef(u)]));
  const countMap = new Map(counts.map((c) => [c._id, c.n]));
  return {
    components: (project.components ?? []).map((c) => ({
      name: c.name,
      description: c.description ?? undefined,
      lead: c.leadId ? (leadMap.get(c.leadId.toString()) ?? null) : null,
      openTasks: countMap.get(c.name) ?? 0,
    })),
    wipLimits: Object.fromEntries(Object.entries(project.wipLimits ?? {}).filter(([, v]) => v > 0)),
    canEdit: canUpdateProject(auth, project) && !project.archived,
  };
}

export async function saveAgileSettings(
  rc: RequestContext,
  projectId: string,
  raw: ProjectAgileSettingsInput,
): Promise<ProjectAgileSettingsDto> {
  const input = projectAgileSettingsSchema.parse(raw);
  const auth = requireAuth(rc);
  const project = await loadReadableProject(auth, projectId);
  if (!canUpdateProject(auth, project) || project.archived) throw new ForbiddenError();
  const set: Record<string, unknown> = {};
  if (input.components) {
    set.components = input.components.map((c) => ({
      name: c.name,
      description: c.description ?? null,
      leadId: c.leadId ? oid(c.leadId) : null,
    }));
    const kept = new Set(input.components.map((c) => c.name));
    const removed = (project.components ?? []).map((c) => c.name).filter((n) => !kept.has(n));
    if (removed.length)
      await Task.updateMany(
        { projectId: project._id, components: { $in: removed } },
        { $pull: { components: { $in: removed } } },
      );
  }
  if (input.wipLimits) {
    const statuses = new Set<string>([
      'backlog',
      'todo',
      'in_progress',
      'in_review',
      'testing',
      'blocked',
      'done',
    ]);
    const bad = Object.keys(input.wipLimits).filter((k) => !statuses.has(k));
    if (bad.length) throw new UnprocessableError(`Unknown board column: ${bad.join(', ')}`);
    set.wipLimits = Object.fromEntries(Object.entries(input.wipLimits).filter(([, v]) => v > 0));
  }
  await Project.updateOne({ _id: project._id }, { $set: set });
  await recordAudit(rc, {
    action: 'project.agile_settings_changed',
    entityType: 'project',
    entityId: project._id,
    summary: `Changed components / WIP limits of ${project.key}`,
    after: set,
  });
  return getAgileSettings(rc, projectId);
}
