import { Types } from 'mongoose';
import {
  LINK_LABELS,
  addLinkSchema,
  cloneTaskSchema,
  rankBetween,
  type AddLinkInput,
  type CloneTaskInput,
  type CreateTaskInput,
  type LinkType,
  type TaskDto,
} from '@arihant/shared';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../../core/errors';
import { nextKey } from '../../core/idgen';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import {
  canCreateTaskIn,
  canUpdateProject,
  isProjectParticipant,
  taskReadFilter,
} from '../../core/rbac/work-access';
import { syncFixRelease } from '../agile/task-fields';
import { recordAudit } from '../audit/audit.service';
import { recordActivity } from '../collab/activity.service';
import { loadReadableProject } from '../projects/project.service';
import { Project } from '../projects/project.model';
import { Task, type ITask } from './task.model';
import { presentTasks } from './task.presenter';
import { assertCanWrite, createTask, getTask, lastRankIn, loadTask } from './task.service';

const oid = (id: string) => new Types.ObjectId(id);

/* ---------- Links ---------- */

export async function addLink(rc: RequestContext, id: string, raw: AddLinkInput): Promise<TaskDto> {
  const auth = requireAuth(rc);
  const input = addLinkSchema.parse(raw);
  const { task, project } = await loadTask(auth, id);
  await assertCanWrite(auth, 'task:update', task, project);
  if (input.taskId === id) throw new UnprocessableError('A task cannot link to itself');
  const other = await Task.findOne({
    $and: [{ _id: oid(input.taskId) }, await taskReadFilter(auth)],
  })
    .select('key title links')
    .lean();
  if (!other) throw new NotFoundError('Linked task');
  const exists =
    task.links?.some((l) => l.type === input.type && l.taskId.equals(other._id)) ||
    (input.type === 'relates' &&
      other.links?.some((l) => l.type === 'relates' && l.taskId.equals(task._id)));
  if (exists) throw new ConflictError('These tasks are already linked that way');
  await Task.updateOne(
    { _id: task._id },
    { $push: { links: { type: input.type, taskId: other._id } } },
  );
  await recordActivity(rc, {
    projectId: task.projectId,
    entityType: 'task',
    entityId: task._id,
    entityLabel: `${task.key} ${task.title}`,
    verb: 'linked',
    summary: `${task.key} ${LINK_LABELS[input.type].outward} ${other.key}`,
  });
  return getTask(rc, id);
}

export async function removeLink(
  rc: RequestContext,
  id: string,
  type: LinkType,
  otherId: string,
): Promise<TaskDto> {
  const auth = requireAuth(rc);
  const { task, project } = await loadTask(auth, id);
  await assertCanWrite(auth, 'task:update', task, project);
  const other = oid(otherId);
  const out = await Task.updateOne(
    { _id: task._id },
    { $pull: { links: { type, taskId: other } } },
  );
  // An inward link is stored on the other task; removing it from here is allowed for editors of this task.
  const inn = await Task.updateOne(
    { _id: other, deletedAt: null },
    { $pull: { links: { type, taskId: task._id } } },
  );
  if (!out.modifiedCount && !inn.modifiedCount) throw new NotFoundError('Link');
  await recordActivity(rc, {
    projectId: task.projectId,
    entityType: 'task',
    entityId: task._id,
    entityLabel: `${task.key} ${task.title}`,
    verb: 'unlinked',
    summary: `removed a "${LINK_LABELS[type].outward}" link from ${task.key}`,
  });
  return getTask(rc, id);
}

/* ---------- Clone ---------- */

function cloneInput(t: ITask, projectId: string, assigneeOk: boolean): CreateTaskInput {
  return {
    projectId,
    title: t.title,
    description: t.description ?? undefined,
    type: t.type ?? 'task',
    priority: t.priority,
    status: 'todo',
    assigneeId: assigneeOk && t.assigneeId ? t.assigneeId.toString() : null,
    startDate: t.startDate ?? null,
    dueDate: t.dueDate ?? null,
    estimatedHours: t.estimatedHours ?? null,
    complexity: t.complexity ?? null,
    requiredSkills: t.requiredSkills,
    tags: t.tags,
    checklist: t.checklist.map((c) => ({ text: c.text, done: false })),
    storyPoints: t.storyPoints ?? null,
    epicId: t.epicId?.toString() ?? null,
    components: t.components ?? [],
    acceptanceCriteria: t.acceptanceCriteria ?? null,
    bug: t.bug
      ? {
          severity: t.bug.severity,
          stepsToReproduce: t.bug.stepsToReproduce ?? null,
          expectedResult: t.bug.expectedResult ?? null,
          actualResult: t.bug.actualResult ?? null,
          environment: t.bug.environment ?? null,
          regression: t.bug.regression,
          foundInReleaseId: t.bug.foundInReleaseId?.toString() ?? null,
        }
      : null,
    customFields: t.customFields ?? {},
  };
}

/** Copies a task (and optionally its subtasks) in the same project, linked as a clone. */
export async function cloneTask(
  rc: RequestContext,
  id: string,
  raw: CloneTaskInput,
): Promise<TaskDto> {
  const auth = requireAuth(rc);
  const input = cloneTaskSchema.parse(raw);
  const { task, project } = await loadTask(auth, id);
  const base = cloneInput(
    task,
    project._id.toString(),
    Boolean(task.assigneeId && isProjectParticipant(project, task.assigneeId.toString())),
  );
  const copy = await createTask(rc, {
    ...base,
    title: input.title ?? task.title,
    parentId: task.parentId?.toString() ?? null,
  });
  await Task.updateOne(
    { _id: oid(copy.id) },
    { $push: { links: { type: 'clones', taskId: task._id } } },
  );
  if (input.includeSubtasks && !task.parentId) {
    const subs = await Task.find({ parentId: task._id, deletedAt: null })
      .sort({ createdAt: 1 })
      .lean();
    for (const s of subs) {
      await createTask(rc, {
        ...cloneInput(
          s,
          project._id.toString(),
          Boolean(s.assigneeId && isProjectParticipant(project, s.assigneeId.toString())),
        ),
        epicId: null,
        parentId: copy.id,
      });
    }
  }
  return getTask(rc, copy.id);
}

/* ---------- Move to another project ---------- */

export async function moveToProject(
  rc: RequestContext,
  id: string,
  targetId: string,
): Promise<TaskDto> {
  const auth = requireAuth(rc);
  const { task, project } = await loadTask(auth, id);
  await assertCanWrite(auth, 'task:delete', task, project);
  if (task.parentId) throw new UnprocessableError('Move the parent task; subtasks move with it');
  const target = await loadReadableProject(auth, targetId);
  if (target._id.equals(project._id))
    throw new UnprocessableError('The task is already in that project');
  if (target.archived) throw new UnprocessableError('That project is archived');
  if (!canCreateTaskIn(auth, target))
    throw new ForbiddenError('You cannot create tasks in that project');
  if (task.type === 'epic' && (await Task.exists({ epicId: task._id, deletedAt: null })))
    throw new UnprocessableError('Move or detach the tasks in this epic first');

  const targetComponents = new Set((target.components ?? []).map((c) => c.name));
  const family = [task, ...(await Task.find({ parentId: task._id, deletedAt: null }).lean())];
  const moved: { from: string; to: string }[] = [];
  for (const t of family) {
    const key = await nextKey(target.key);
    const keepAssignee = t.assigneeId && isProjectParticipant(target, t.assigneeId.toString());
    await Task.updateOne(
      { _id: t._id },
      {
        $set: {
          key,
          projectId: target._id,
          rank: rankBetween(await lastRankIn(target._id, t.status), null),
          backlogRank: null,
          assigneeId: keepAssignee ? t.assigneeId : null,
          milestoneId: null,
          sprintId: null,
          epicId: null,
          fixReleaseId: null,
          components: (t.components ?? []).filter((c) => targetComponents.has(c)),
          ...(t.bug ? { 'bug.foundInReleaseId': null } : {}),
        },
        $push: { previousKeys: t.key },
        ...(keepAssignee ? {} : { $inc: { assignmentVersion: 1 } }),
      },
    );
    if (t.fixReleaseId) await syncFixRelease(t._id, t.fixReleaseId, null);
    moved.push({ from: t.key, to: key });
  }
  const newKey = moved[0]!.to;
  for (const [p, verb] of [
    [project, `moved ${task.key} to ${target.key} as ${newKey}`],
    [target, `moved ${task.key} in from ${project.key} as ${newKey}`],
  ] as const) {
    await recordActivity(rc, {
      projectId: p._id,
      entityType: 'task',
      entityId: task._id,
      entityLabel: `${newKey} ${task.title}`,
      verb: 'moved',
      summary: verb,
    });
  }
  await recordAudit(rc, {
    action: 'task.moved',
    entityType: 'task',
    entityId: task._id,
    summary: `Moved ${moved.map((m) => `${m.from} → ${m.to}`).join(', ')} from ${project.key} to ${target.key}`,
  });
  return getTask(rc, id);
}

/* ---------- Deleted tasks ---------- */

async function loadManagedProject(rc: RequestContext, projectId: string) {
  const auth = requireAuth(rc);
  const project = await loadReadableProject(auth, projectId);
  if (!canUpdateProject(auth, project))
    throw new ForbiddenError(
      'Only people who manage the project can see and restore deleted tasks',
    );
  return { auth, project };
}

/** Top-level tasks deleted in the project (subtasks come back with their parent). */
export async function listDeleted(rc: RequestContext, projectId: string): Promise<TaskDto[]> {
  const { auth, project } = await loadManagedProject(rc, projectId);
  const docs = await Task.find({ projectId: project._id, deletedAt: { $ne: null }, parentId: null })
    .sort({ deletedAt: -1 })
    .limit(100)
    .lean();
  const dtos = await presentTasks(auth, docs);
  return dtos.map((d, i) => ({ ...d, updatedAt: docs[i]!.deletedAt!.toISOString() }));
}

export async function restoreTask(rc: RequestContext, id: string): Promise<TaskDto> {
  requireAuth(rc);
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Task');
  const task = await Task.findOne({ _id: oid(id), deletedAt: { $ne: null } }).lean();
  if (!task) throw new NotFoundError('Deleted task');
  const project = await Project.findById(task.projectId).lean();
  if (!project) throw new NotFoundError('Deleted task');
  await loadManagedProject(rc, project._id.toString());
  if (project.archived) throw new UnprocessableError('Restore the project first');
  if (task.parentId && (await Task.exists({ _id: task.parentId, deletedAt: { $ne: null } })))
    throw new UnprocessableError('Restore the parent task instead');
  // Subtasks deleted together with the parent come back with it.
  await Task.updateMany(
    { $or: [{ _id: task._id }, { parentId: task._id, deletedAt: task.deletedAt }] },
    { $set: { deletedAt: null } },
  );
  if (task.sprintId) {
    // A completed sprint keeps its history; restored work goes back to the backlog.
    const { Sprint } = await import('../agile/sprint.model');
    const s = await Sprint.findById(task.sprintId).select('status').lean();
    if (!s || s.status === 'completed')
      await Task.updateOne({ _id: task._id }, { $set: { sprintId: null } });
  }
  await recordActivity(rc, {
    projectId: task.projectId,
    entityType: 'task',
    entityId: task._id,
    entityLabel: `${task.key} ${task.title}`,
    verb: 'restored',
    summary: `restored ${task.key}`,
  });
  await recordAudit(rc, {
    action: 'task.restored',
    entityType: 'task',
    entityId: task._id,
    summary: `Restored task ${task.key} – ${task.title}`,
  });
  return getTask(rc, id);
}

/* ---------- Backlog order ---------- */

/** Gives every open task in the project a backlog rank (older tasks may not have one yet). */
async function normaliseBacklog(projectId: Types.ObjectId): Promise<void> {
  const rows = await Task.aggregate<{ _id: Types.ObjectId }>([
    { $match: { projectId, deletedAt: null, parentId: null } },
    { $addFields: { r: { $ifNull: ['$backlogRank', '{'] } } },
    { $sort: { r: 1, createdAt: 1, _id: 1 } },
    { $project: { _id: 1 } },
  ]);
  let prev: string | null = null;
  const ops = rows.map((row) => {
    prev = rankBetween(prev, null);
    return { updateOne: { filter: { _id: row._id }, update: { $set: { backlogRank: prev } } } };
  });
  if (ops.length) await Task.bulkWrite(ops);
}

export async function rankInBacklog(
  rc: RequestContext,
  id: string,
  input: { beforeId?: string | null; afterId?: string | null },
): Promise<TaskDto> {
  const auth = requireAuth(rc);
  const { task, project } = await loadTask(auth, id);
  await assertCanWrite(auth, 'task:update', task, project);
  const neighbourIds = [input.beforeId, input.afterId]
    .filter((x): x is string => Boolean(x))
    .map(oid);
  let neighbours = await Task.find({
    _id: { $in: neighbourIds },
    projectId: task.projectId,
    deletedAt: null,
  })
    .select('backlogRank')
    .lean();
  if (neighbours.some((n) => !n.backlogRank) || !task.backlogRank) {
    await normaliseBacklog(task.projectId);
    neighbours = await Task.find({ _id: { $in: neighbourIds } })
      .select('backlogRank')
      .lean();
  }
  const before = input.beforeId ? neighbours.find((n) => n._id.equals(input.beforeId!)) : undefined;
  const after = input.afterId ? neighbours.find((n) => n._id.equals(input.afterId!)) : undefined;
  if ((input.beforeId && !before) || (input.afterId && !after))
    throw new UnprocessableError('The backlog changed; reload and try again');
  if (before && after && before.backlogRank! >= after.backlogRank!)
    throw new UnprocessableError('The backlog changed; reload and try again');
  await Task.updateOne(
    { _id: task._id },
    { $set: { backlogRank: rankBetween(before?.backlogRank ?? null, after?.backlogRank ?? null) } },
  );
  return getTask(rc, id);
}
