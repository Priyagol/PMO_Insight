import { Types, type QueryFilter } from 'mongoose';
import {
  BOARD_COLUMNS,
  STATUS_LABELS,
  boardQuerySchema,
  createTaskSchema,
  rankBetween,
  taskListQuerySchema,
  type BoardColumnDto,
  type BulkTaskInput,
  type CreateTaskInput,
  type MoveTaskInput,
  type PageMeta,
  type TaskDto,
  type TaskListQuery,
  type TaskStatus,
  type UpdateTaskInput,
} from '@arihant/shared';
import { eventBus } from '../../core/events';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../../core/errors';
import { nextKey } from '../../core/idgen';
import { escapeRegex, toPageMeta, toPageWindow } from '../../core/pagination';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import {
  canCreateTaskIn,
  canWriteTask,
  isProjectParticipant,
  taskReadFilter,
  teamMemberIds,
} from '../../core/rbac/work-access';
import { orgToday } from '../../core/time';
import { recordAudit } from '../audit/audit.service';
import { diffFields, recordActivity } from '../collab/activity.service';
import { AssignmentHistory } from '../collab/collab.models';
import { assertMilestoneInProject, checkCustomValues } from '../planning/planning.service';
import { continueSeries } from '../planning/recurrence';
import { loadReadableProject } from '../projects/project.service';
import { Project, type IProject } from '../projects/project.model';
import { User } from '../users/user.model';
import { resolveAgileFields, startedAtFor, syncFixRelease } from '../agile/task-fields';
import { Sprint } from '../agile/sprint.model';
import { PRIORITY_ORDER, Task, type ITask } from './task.model';
import { presentTasks } from './task.presenter';
import { compileAql } from '../search/aql.compiler';
import { requestApproval } from '../approvals/approval.service';
import { addComment } from '../collab/comment.service';
import { notify } from '../notifications/notification.service';
import {
  boardStatuses,
  checkRequiredStillMet,
  checkTransition,
  initialStatus,
  recordTransition,
  type TransitionDecision,
} from '../workflows/workflow.service';
import type { TransitionVia } from '../workflows/workflow.models';

const oid = (id: string) => new Types.ObjectId(id);
const TRACKED_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'assigneeId',
  'startDate',
  'dueDate',
  'estimatedHours',
  'complexity',
  'requiredSkills',
  'tags',
  'dependencyIds',
  'type',
  'storyPoints',
  'epicId',
  'sprintId',
  'components',
  'fixReleaseId',
  'remainingHours',
];
const MAX_BOARD_COLUMN = 200;

/* ---------- Loading & permissions ---------- */

export async function loadTask(
  auth: AuthContext,
  id: string,
): Promise<{ task: ITask; project: IProject }> {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Task');
  const task = await Task.findOne({ $and: [{ _id: oid(id) }, await taskReadFilter(auth)] }).lean();
  if (!task) throw new NotFoundError('Task');
  const project = await Project.findById(task.projectId).lean();
  if (!project) throw new NotFoundError('Task');
  return { task, project };
}

export async function assertCanWrite(
  auth: AuthContext,
  permission: 'task:update' | 'task:delete',
  task: ITask,
  project: IProject,
): Promise<void> {
  if (project.archived)
    throw new UnprocessableError('This project is archived. Restore it to change tasks.');
  const team = auth.permissions[permission] === 'team' ? await teamMemberIds(auth) : undefined;
  if (!canWriteTask(auth, permission, task, project, team)) throw new ForbiddenError();
}

/** Assignees must be active members of the project. */
async function assertAssignable(project: IProject, assigneeId: string): Promise<void> {
  if (!isProjectParticipant(project, assigneeId)) {
    throw new UnprocessableError('The assignee must be a member of the project team');
  }
  if (!(await User.exists({ _id: oid(assigneeId), status: 'active' }))) {
    throw new UnprocessableError('The assignee is not an active employee');
  }
}

export async function lastRankIn(
  projectId: Types.ObjectId,
  status: TaskStatus,
): Promise<string | null> {
  const last = await Task.findOne({ projectId, status, deletedAt: null })
    .sort({ rank: -1 })
    .select('rank')
    .lean();
  return last?.rank ?? null;
}

/** Rejects dependencies that would create a cycle (A depends on B depends on … A). */
async function assertNoCycle(
  taskId: Types.ObjectId,
  dependencyIds: Types.ObjectId[],
): Promise<void> {
  const target = taskId.toString();
  const seen = new Set<string>();
  let frontier = dependencyIds.map(String);
  for (let depth = 0; frontier.length && depth < 50; depth += 1) {
    if (frontier.includes(target))
      throw new UnprocessableError('These dependencies would create a cycle');
    frontier.forEach((f) => seen.add(f));
    const next = await Task.find({ _id: { $in: frontier.map(oid) } })
      .select('dependencyIds')
      .lean();
    frontier = next.flatMap((n) => n.dependencyIds.map(String)).filter((d) => !seen.has(d));
  }
}

function lifecycleFields(
  from: TaskStatus,
  to: TaskStatus,
  task?: Pick<ITask, 'startedAt'>,
): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  const started = startedAtFor(task, to);
  if (started) set.startedAt = started;
  if (to === 'blocked' && from !== 'blocked') set.blockedSince = new Date();
  if (to !== 'blocked' && from === 'blocked') set.blockedSince = null;
  if (to === 'done' && from !== 'done') set.completedAt = new Date();
  if (to !== 'done' && from === 'done') set.completedAt = null;
  return set;
}

function assertTransition(
  auth: AuthContext,
  task: ITask,
  project: IProject,
  to: TaskStatus,
  team?: string[],
): void {
  // Cancelling is a destructive decision: it needs delete rights.
  if (
    to === 'cancelled' &&
    task.status !== 'cancelled' &&
    !canWriteTask(auth, 'task:delete', task, project, team)
  ) {
    throw new ForbiddenError('You do not have permission to cancel this task');
  }
}

async function recordAssignment(
  rc: RequestContext,
  task: ITask,
  from: Types.ObjectId | null,
  to: Types.ObjectId | null,
): Promise<void> {
  await AssignmentHistory.create({
    taskId: task._id,
    projectId: task.projectId,
    fromUserId: from,
    toUserId: to,
    method: 'manual',
    triggeredBy: 'user',
    actorId: rc.auth?.userObjectId ?? null,
    reason: 'Assigned manually',
  });
  eventBus.publish(
    'task.assigned',
    { taskId: task._id.toString(), from: from?.toString() ?? null, to: to?.toString() ?? null },
    { actorId: rc.auth?.userId, requestId: rc.requestId },
  );
}

/* ---------- Queries ---------- */

async function buildFilter(
  auth: AuthContext,
  q: ReturnType<typeof boardQuerySchema.parse>,
): Promise<QueryFilter<ITask>> {
  const and: QueryFilter<ITask>[] = [await taskReadFilter(auth)];
  if (q.projectId?.length) and.push({ projectId: { $in: q.projectId.map(oid) } });
  else {
    // Hide tasks of archived projects unless a project is chosen explicitly.
    const archived = await Project.find({ archived: true }).select('_id').lean();
    if (archived.length) and.push({ projectId: { $nin: archived.map((p) => p._id) } });
  }
  if (q.assigneeId === 'me') and.push({ assigneeId: auth.userObjectId });
  else if (q.assigneeId === 'none') and.push({ assigneeId: null });
  else if (q.assigneeId) and.push({ assigneeId: oid(q.assigneeId) });
  if (q.status?.length) and.push({ status: { $in: q.status } });
  if (q.priority?.length) and.push({ priority: { $in: q.priority } });
  if (q.tag) and.push({ tags: q.tag });
  if (q.parentId === 'none') and.push({ parentId: null });
  else if (q.parentId) and.push({ parentId: oid(q.parentId) });
  if (q.dueFrom || q.dueTo) {
    and.push({
      dueDate: {
        $ne: null,
        ...(q.dueFrom ? { $gte: q.dueFrom } : {}),
        ...(q.dueTo ? { $lte: q.dueTo } : {}),
      },
    });
  }
  if (q.overdue === 'true')
    and.push({ dueDate: { $ne: null, $lt: orgToday() }, status: { $nin: ['done', 'cancelled'] } });
  if (q.watching === 'true') and.push({ watcherIds: auth.userObjectId });
  if (q.milestoneId === 'none') and.push({ milestoneId: null });
  else if (q.milestoneId) and.push({ milestoneId: oid(q.milestoneId) });
  if (q.type?.length) and.push({ type: { $in: q.type } });
  if (q.sprintId === 'none') and.push({ sprintId: null });
  else if (q.sprintId === 'active') {
    const active = await Sprint.find({
      status: 'active',
      deletedAt: null,
      ...(q.projectId?.length ? { projectId: { $in: q.projectId.map(oid) } } : {}),
    })
      .select('_id')
      .lean();
    and.push({ sprintId: { $in: active.map((x) => x._id) } });
  } else if (q.sprintId) and.push({ sprintId: oid(q.sprintId) });
  if (q.epicId === 'none') and.push({ epicId: null });
  else if (q.epicId) and.push({ epicId: oid(q.epicId) });
  if (q.component) and.push({ components: q.component });
  if (q.fixReleaseId === 'none') and.push({ fixReleaseId: null });
  else if (q.fixReleaseId) and.push({ fixReleaseId: oid(q.fixReleaseId) });
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    and.push({ $or: [{ title: rx }, { key: rx }, { tags: rx }, { previousKeys: rx }] });
  }
  if (q.updatedWithin)
    and.push({ updatedAt: { $gte: new Date(Date.now() - q.updatedWithin * 86_400_000) } });
  if (q.aql) and.push((await compileAql(auth, q.aql)).filter);
  return { $and: and };
}

const SORT_FIELDS: Record<string, string> = {
  key: 'key',
  title: 'title',
  dueDate: 'dueDate',
  startDate: 'startDate',
  priority: 'priorityOrder',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  rank: 'rank',
};

export async function listTasks(
  rc: RequestContext,
  raw: TaskListQuery,
): Promise<{ items: TaskDto[]; meta: PageMeta }> {
  const auth = requireAuth(rc);
  const query = taskListQuerySchema.parse(raw);
  const filter = await buildFilter(auth, query);
  let sort: Record<string, 1 | -1> = { updatedAt: -1, _id: -1 };
  if (query.sort) {
    const desc = query.sort.startsWith('-');
    const field = SORT_FIELDS[desc ? query.sort.slice(1) : query.sort];
    if (!field) toPageWindow({ ...query, sort: query.sort }, []); // throws a 400 with a clear message
    sort = { [field!]: desc ? -1 : 1, _id: 1 };
  }
  const [docs, total] = await Promise.all([
    Task.find(filter)
      .sort(sort)
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Task.countDocuments(filter),
  ]);
  return { items: await presentTasks(auth, docs), meta: toPageMeta(query, total) };
}

/** Kanban data: one column per status, ordered by rank. */
export async function getBoard(rc: RequestContext, raw: unknown): Promise<BoardColumnDto[]> {
  const auth = requireAuth(rc);
  const query = boardQuerySchema.parse(raw);
  let statuses: TaskStatus[] = query.status?.length ? query.status : [...BOARD_COLUMNS];
  if (!query.status?.length && query.projectId?.length === 1) {
    const project = await Project.findById(query.projectId[0]).select('workflowId').lean();
    if (project) statuses = await boardStatuses(project as IProject);
  }
  const filter = await buildFilter(auth, { ...query, status: undefined });
  const columns = await Promise.all(
    statuses.map(async (status) => {
      const f = { $and: [filter, { status }] };
      const [docs, total] = await Promise.all([
        Task.find(f).sort({ rank: 1, _id: 1 }).limit(MAX_BOARD_COLUMN).lean(),
        Task.countDocuments(f),
      ]);
      return { status, total, docs };
    }),
  );
  const presented = await presentTasks(
    auth,
    columns.flatMap((c) => c.docs),
  );
  const byId = new Map(presented.map((t) => [t.id, t]));
  return columns.map((c) => ({
    status: c.status,
    total: c.total,
    tasks: c.docs.map((d) => byId.get(d._id.toString())!),
  }));
}

export async function getTask(rc: RequestContext, id: string): Promise<TaskDto> {
  const auth = requireAuth(rc);
  const { task } = await loadTask(auth, id);
  return (await presentTasks(auth, [task]))[0]!;
}

/* ---------- Commands ---------- */

export async function createTask(rc: RequestContext, raw: CreateTaskInput): Promise<TaskDto> {
  const task = await createTaskRecord(rc, raw);
  return getTask(rc, task._id.toString());
}

/**
 * Creates the task. `serviceRequest`: raised through a service desk's help centre, where the
 * person asking does not need to be on the project (the service desk checks the request type).
 */
export async function createTaskRecord(
  rc: RequestContext,
  raw: CreateTaskInput,
  opts: { serviceRequest?: boolean } = {},
): Promise<ITask> {
  const auth = requireAuth(rc);
  const input = createTaskSchema.parse(raw);
  const project = opts.serviceRequest
    ? await Project.findById(input.projectId).lean()
    : await loadReadableProject(auth, input.projectId);
  if (!project) throw new NotFoundError('Project');
  if (project.archived) throw new UnprocessableError('This project is archived');
  if (!opts.serviceRequest && !canCreateTaskIn(auth, project))
    throw new ForbiddenError('You cannot create tasks in this project');

  if (input.parentId) {
    const parent = await Task.findOne({ _id: oid(input.parentId), deletedAt: null })
      .select('projectId parentId type')
      .lean();
    if (!parent || !parent.projectId.equals(project._id))
      throw new UnprocessableError('Parent task must be in the same project');
    if (parent.parentId) throw new UnprocessableError('Subtasks cannot have their own subtasks');
    if (parent.type === 'epic')
      throw new UnprocessableError('Add work to an epic with the Epic field, not as a subtask');
  }
  if (input.assigneeId) await assertAssignable(project, input.assigneeId);
  if (input.milestoneId) await assertMilestoneInProject(input.milestoneId, project._id);
  const customFields = checkCustomValues(project, input.customFields ?? {});
  const agile = await resolveAgileFields(project, input);
  const status = await initialStatus(project, input.status);
  const taskId = new Types.ObjectId();
  const lastBacklog = await Task.findOne({ projectId: project._id, backlogRank: { $ne: null } })
    .sort({ backlogRank: -1 })
    .select('backlogRank')
    .lean();

  const assignee = input.assigneeId ? oid(input.assigneeId) : null;
  const watchers = [
    auth.userObjectId,
    ...(assignee && !assignee.equals(auth.userObjectId) ? [assignee] : []),
  ];
  const doc = await Task.create({
    _id: taskId,
    key: await nextKey(project.key),
    projectId: project._id,
    parentId: input.parentId ? oid(input.parentId) : null,
    title: input.title,
    description: input.description ?? null,
    status,
    priority: input.priority,
    priorityOrder: PRIORITY_ORDER[input.priority],
    assigneeId: assignee,
    reporterId: auth.userObjectId,
    watcherIds: watchers,
    startDate: input.startDate ?? null,
    dueDate: input.dueDate ?? null,
    estimatedHours: input.estimatedHours ?? null,
    complexity: input.complexity ?? null,
    requiredSkills: input.requiredSkills,
    tags: [...new Set(input.tags)],
    checklist: input.checklist.map((c) => ({ text: c.text, done: c.done })),
    rank: rankBetween(await lastRankIn(project._id, status), null),
    blockedSince: status === 'blocked' ? new Date() : null,
    completedAt: status === 'done' ? new Date() : null,
    milestoneId: input.milestoneId ? oid(input.milestoneId) : null,
    recurrence: input.recurrence ?? null,
    recurrenceSeriesId: input.recurrence ? taskId : null,
    recurrenceIndex: input.recurrence ? 1 : null,
    customFields: dropNulls(customFields),
    ...agile,
    backlogRank: rankBetween(lastBacklog?.backlogRank ?? null, null),
    startedAt: startedAtFor(undefined, status) ?? null,
  });
  const task = doc.toObject();
  if (task.fixReleaseId) await syncFixRelease(task._id, null, task.fixReleaseId);

  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'task',
    entityId: task._id,
    entityLabel: `${task.key} ${task.title}`,
    verb: 'created',
    summary: `created ${task.key}${task.parentId ? ' (subtask)' : ''}`,
  });
  if (assignee) await recordAssignment(rc, task, null, assignee);
  await recordTransition(rc, { task, from: null, to: status, via: 'create' });
  eventBus.publish(
    'task.created',
    { taskId: task._id.toString(), projectId: project._id.toString() },
    { actorId: auth.userId, requestId: rc.requestId },
  );
  return task;
}

export interface UpdateOptions {
  /** How the change was made (workflow history). */
  via?: TransitionVia;
  /** The status change was approved through the Approvals module. */
  approved?: boolean;
}

export async function updateTask(
  rc: RequestContext,
  id: string,
  input: UpdateTaskInput,
  opts: UpdateOptions = {},
): Promise<TaskDto> {
  const auth = requireAuth(rc);
  const { task, project } = await loadTask(auth, id);
  await assertCanWrite(auth, 'task:update', task, project);
  const team = auth.permissions['task:delete'] === 'team' ? await teamMemberIds(auth) : undefined;

  const set: Record<string, unknown> = {};
  const unsetFields: Record<string, ''> = {};
  for (const key of [
    'title',
    'description',
    'priority',
    'startDate',
    'dueDate',
    'estimatedHours',
    'complexity',
    'requiredSkills',
  ] as const) {
    if (input[key] !== undefined) set[key] = input[key];
  }
  if (input.tags !== undefined) set.tags = [...new Set(input.tags)];
  if (input.priority) set.priorityOrder = PRIORITY_ORDER[input.priority];
  if (input.checklist !== undefined) {
    set.checklist = input.checklist.map((c) => ({
      _id: c.id && Types.ObjectId.isValid(c.id) ? oid(c.id) : new Types.ObjectId(),
      text: c.text,
      done: c.done ?? false,
    }));
  }

  const start = (set.startDate !== undefined ? set.startDate : task.startDate) as string | null;
  const due = (set.dueDate !== undefined ? set.dueDate : task.dueDate) as string | null;
  if (start && due && start > due)
    throw new UnprocessableError('Due date must be on or after the start date');

  let decision: TransitionDecision | null = null;
  let assigneeTarget = input.assigneeId;
  if (input.status && input.status !== task.status) {
    assertTransition(auth, task, project, input.status, team);
    decision = await checkTransition({
      auth,
      task,
      project,
      to: input.status,
      patch: input,
      comment: input.transitionComment,
      approved: opts.approved,
    });
    if (decision.needsApproval) {
      await requestTransitionApproval(rc, task, project, decision, input.transitionComment);
    } else {
      set.status = input.status;
      set.rank = rankBetween(await lastRankIn(task.projectId, input.status), null);
      Object.assign(set, lifecycleFields(task.status, input.status, task));
      if (task.pendingTransition) set.pendingTransition = null;
      if (input.assigneeId === undefined) assigneeTarget = actionAssignee(decision, task, auth);
    }
  } else {
    await checkRequiredStillMet(task, project, input);
  }

  let assigneeChanged = false;
  if (
    assigneeTarget !== undefined &&
    (assigneeTarget ?? null) !== (task.assigneeId?.toString() ?? null)
  ) {
    if (assigneeTarget) await assertAssignable(project, assigneeTarget);
    set.assigneeId = assigneeTarget ? oid(assigneeTarget) : null;
    assigneeChanged = true;
  }

  if (input.milestoneId !== undefined) {
    if (input.milestoneId) await assertMilestoneInProject(input.milestoneId, task.projectId);
    set.milestoneId = input.milestoneId ? oid(input.milestoneId) : null;
  }
  if (input.recurrence !== undefined) {
    if (input.recurrence && task.parentId) throw new UnprocessableError('Subtasks cannot repeat');
    if (input.recurrence && !due) throw new UnprocessableError('A repeating task needs a due date');
    set.recurrence = input.recurrence;
    if (input.recurrence && !task.recurrenceSeriesId) {
      set.recurrenceSeriesId = task._id;
      set.recurrenceIndex = 1;
    }
  } else if (task.recurrence && set.dueDate === null) {
    throw new UnprocessableError('A repeating task needs a due date');
  }
  if (input.customFields !== undefined) {
    const values = checkCustomValues(project, input.customFields, task.customFields ?? {});
    for (const [k, v] of Object.entries(values)) {
      if (v === null) unsetFields[`customFields.${k}`] = '';
      else set[`customFields.${k}`] = v;
    }
  }

  Object.assign(set, await resolveAgileFields(project, input, task));

  if (input.dependencyIds !== undefined) {
    const deps = [...new Set(input.dependencyIds)].filter((d) => d !== id).map(oid);
    const visible = await Task.countDocuments({
      $and: [{ _id: { $in: deps } }, await taskReadFilter(auth)],
    });
    if (visible !== deps.length)
      throw new UnprocessableError('One or more dependencies were not found');
    await assertNoCycle(task._id, deps);
    set.dependencyIds = deps;
  }

  const update: Record<string, unknown> = { $set: set };
  if (Object.keys(unsetFields).length) update.$unset = unsetFields;
  if (assigneeChanged) {
    update.$inc = { assignmentVersion: 1 };
    if (set.assigneeId) update.$addToSet = { watcherIds: set.assigneeId };
  }
  // Optimistic concurrency on the assignee: a parallel reassignment makes this update fail instead of silently winning.
  const updated = await Task.findOneAndUpdate(
    { _id: task._id, assignmentVersion: task.assignmentVersion },
    update,
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!updated)
    throw new UnprocessableError('The task was reassigned by someone else. Reload and try again.');

  const changes = diffFields(
    task as unknown as Record<string, unknown>,
    updated as unknown as Record<string, unknown>,
    TRACKED_FIELDS,
  );
  if (input.checklist !== undefined) {
    const doneBefore = task.checklist.filter((c) => c.done).length;
    const doneAfter = updated.checklist.filter((c) => c.done).length;
    if (doneBefore !== doneAfter || task.checklist.length !== updated.checklist.length) {
      changes.push({
        field: 'checklist',
        from: `${doneBefore}/${task.checklist.length}`,
        to: `${doneAfter}/${updated.checklist.length}`,
      });
    }
  }
  if (changes.length) {
    await recordActivity(rc, {
      projectId: task.projectId,
      entityType: 'task',
      entityId: task._id,
      entityLabel: `${task.key} ${updated.title}`,
      verb: set.status ? 'status_changed' : 'updated',
      summary: set.status
        ? `moved ${task.key} from ${STATUS_LABELS[task.status]} to ${STATUS_LABELS[updated.status]}`
        : `updated ${changes.map((c) => c.field).join(', ')} on ${task.key}`,
      changes,
    });
  }
  if (assigneeChanged) await recordAssignment(rc, updated, task.assigneeId, updated.assigneeId);
  if (set.fixReleaseId !== undefined)
    await syncFixRelease(task._id, task.fixReleaseId, updated.fixReleaseId);
  if (set.status && decision) {
    await afterTransition(rc, task, updated, decision, input.transitionComment, opts.via ?? 'user');
    eventBus.publish(
      'task.status_changed',
      { taskId: id, from: task.status, to: updated.status },
      { actorId: auth.userId, requestId: rc.requestId },
    );
    if (updated.status === 'done') await continueSeries(rc, task._id);
  }
  return getTask(rc, id);
}

/** Assignee set by a transition's automatic actions (undefined = unchanged). */
function actionAssignee(
  decision: TransitionDecision,
  task: ITask,
  auth: AuthContext,
): string | null | undefined {
  const a = decision.transition.actions;
  if (a.includes('assign_reporter')) return task.reporterId.toString();
  if (a.includes('assign_actor')) return auth.userId;
  if (a.includes('unassign')) return null;
  return undefined;
}

/** History entry, transition comment and notifications after a status change. */
async function afterTransition(
  rc: RequestContext,
  before: ITask,
  after: ITask,
  decision: TransitionDecision,
  comment: string | undefined,
  via: TransitionVia,
): Promise<void> {
  await recordTransition(rc, {
    task: before,
    from: before.status,
    to: after.status,
    transition: decision.transition.name,
    via,
    comment: comment ?? null,
  });
  if (comment) await addComment(rc, before._id.toString(), { body: comment });
  if (decision.transition.actions.includes('notify_watchers')) {
    await notify(after.watcherIds, {
      type: 'task_status',
      title: `${after.key} moved to ${decision.workflow.def.labels[after.status] ?? STATUS_LABELS[after.status]}`,
      body: `${decision.transition.name}: ${after.title}`,
      link: `/tasks/board?task=${after._id.toString()}`,
      actorId: rc.auth?.userId,
    });
  }
}

/** Starts an approval for a workflow move; the task moves when it is approved. */
async function requestTransitionApproval(
  rc: RequestContext,
  task: ITask,
  project: IProject,
  decision: TransitionDecision,
  comment: string | undefined,
): Promise<void> {
  const auth = requireAuth(rc);
  if (task.pendingTransition)
    throw new UnprocessableError('A status change for this task is already waiting for approval');
  const label = (s: TaskStatus) => decision.workflow.def.labels[s] ?? STATUS_LABELS[s];
  const approval = await requestApproval(rc, project, {
    entityType: 'task_transition',
    entityId: task._id,
    title: `${task.key}: ${decision.transition.name} (${label(task.status)} → ${label(decision.transition.to)})`,
    description: comment ? `${task.title}\n\n${comment}` : task.title,
  });
  await Task.updateOne(
    { _id: task._id },
    {
      $set: {
        pendingTransition: {
          to: decision.transition.to,
          transitionId: decision.transition.id,
          approvalId: oid(approval.id),
          requestedBy: auth.userObjectId,
          comment: comment ?? null,
        },
      },
    },
  );
  await recordActivity(rc, {
    projectId: task.projectId,
    entityType: 'task',
    entityId: task._id,
    entityLabel: `${task.key} ${task.title}`,
    verb: 'updated',
    summary: `asked for approval to move ${task.key} to ${label(decision.transition.to)} (${approval.key})`,
  });
}

/** Drag-and-drop: change status (validated) and place between two neighbours in the target column. */
export async function moveTask(
  rc: RequestContext,
  id: string,
  input: MoveTaskInput,
): Promise<TaskDto> {
  const auth = requireAuth(rc);
  const { task, project } = await loadTask(auth, id);
  await assertCanWrite(auth, 'task:update', task, project);
  let decision: TransitionDecision | null = null;
  if (input.status !== task.status) {
    const team = auth.permissions['task:delete'] === 'team' ? await teamMemberIds(auth) : undefined;
    assertTransition(auth, task, project, input.status, team);
    decision = await checkTransition({
      auth,
      task,
      project,
      to: input.status,
      comment: input.transitionComment,
    });
    if (decision.needsApproval) {
      // Dropping on a column that needs approval asks for it; the card stays where it was.
      await requestTransitionApproval(rc, task, project, decision, input.transitionComment);
      return getTask(rc, id);
    }
    const assignee = actionAssignee(decision, task, auth);
    // Transitions that change the assignee go through the full update path.
    if (assignee !== undefined)
      return updateTask(
        rc,
        id,
        { status: input.status, transitionComment: input.transitionComment },
        { via: 'board' },
      );
  }

  const neighbourIds = [input.beforeId, input.afterId]
    .filter((x): x is string => Boolean(x))
    .map(oid);
  const neighbours = await Task.find({
    _id: { $in: neighbourIds },
    projectId: task.projectId,
    status: input.status,
    deletedAt: null,
  })
    .select('rank')
    .lean();
  const before = input.beforeId ? neighbours.find((n) => n._id.equals(input.beforeId!)) : undefined;
  const after = input.afterId ? neighbours.find((n) => n._id.equals(input.afterId!)) : undefined;
  let rank: string;
  if (
    (input.beforeId && !before) ||
    (input.afterId && !after) ||
    (before && after && before.rank >= after.rank)
  ) {
    // Neighbours moved concurrently: fall back to the end of the column.
    rank = rankBetween(await lastRankIn(task.projectId, input.status), null);
  } else {
    rank = rankBetween(before?.rank ?? null, after?.rank ?? null);
  }

  const set: Record<string, unknown> = { rank };
  if (input.status !== task.status)
    Object.assign(
      set,
      { status: input.status, pendingTransition: null },
      lifecycleFields(task.status, input.status, task),
    );
  await Task.updateOne({ _id: task._id }, { $set: set });

  if (input.status !== task.status && decision) {
    const after = { ...task, status: input.status } as ITask;
    await afterTransition(rc, task, after, decision, input.transitionComment, 'board');
    await recordActivity(rc, {
      projectId: task.projectId,
      entityType: 'task',
      entityId: task._id,
      entityLabel: `${task.key} ${task.title}`,
      verb: 'status_changed',
      summary: `moved ${task.key} from ${STATUS_LABELS[task.status]} to ${STATUS_LABELS[input.status]}`,
      changes: [{ field: 'status', from: task.status, to: input.status }],
    });
    eventBus.publish(
      'task.status_changed',
      { taskId: id, from: task.status, to: input.status },
      { actorId: auth.userId, requestId: rc.requestId },
    );
    if (input.status === 'done') await continueSeries(rc, task._id);
  }
  return getTask(rc, id);
}

/** Applies the same change to many tasks; each task is checked individually and failures are reported. */
export async function bulkUpdate(
  rc: RequestContext,
  input: BulkTaskInput,
): Promise<{ updated: number; failed: { id: string; key?: string; reason: string }[] }> {
  const failed: { id: string; key?: string; reason: string }[] = [];
  let updated = 0;
  for (const id of [...new Set(input.ids)]) {
    try {
      await updateTask(rc, id, input.set);
      updated += 1;
    } catch (err) {
      failed.push({ id, reason: err instanceof Error ? err.message : 'Failed' });
    }
  }
  if (failed.length) {
    const keys = await Task.find({ _id: { $in: failed.map((f) => oid(f.id)) } })
      .select('key')
      .lean();
    for (const f of failed) f.key = keys.find((k) => k._id.toString() === f.id)?.key;
  }
  await recordAudit(rc, {
    action: 'task.bulk_updated',
    entityType: 'task',
    summary: `Bulk-updated ${updated} task(s) (${Object.keys(input.set).join(', ')}); ${failed.length} failed`,
    after: { set: input.set, ids: input.ids, failed },
  });
  return { updated, failed };
}

/** Soft-deletes a task and its subtasks. */
export async function deleteTask(rc: RequestContext, id: string, audit = true): Promise<void> {
  const auth = requireAuth(rc);
  const { task, project } = await loadTask(auth, id);
  await assertCanWrite(auth, 'task:delete', task, project);
  const now = new Date();
  await Task.updateMany(
    { $or: [{ _id: task._id }, { parentId: task._id }], deletedAt: null },
    { $set: { deletedAt: now } },
  );
  // Other tasks no longer depend on a deleted task.
  await Task.updateMany({ dependencyIds: task._id }, { $pull: { dependencyIds: task._id } });
  await recordActivity(rc, {
    projectId: task.projectId,
    entityType: 'task',
    entityId: task._id,
    entityLabel: `${task.key} ${task.title}`,
    verb: 'deleted',
    summary: `deleted ${task.key}`,
  });
  if (audit) {
    await recordAudit(rc, {
      action: 'task.deleted',
      entityType: 'task',
      entityId: task._id,
      summary: `Deleted task ${task.key} – ${task.title}`,
    });
  }
}

export async function bulkDelete(
  rc: RequestContext,
  ids: string[],
): Promise<{ deleted: number; failed: { id: string; reason: string }[] }> {
  const failed: { id: string; reason: string }[] = [];
  let deleted = 0;
  for (const id of [...new Set(ids)]) {
    try {
      await deleteTask(rc, id, false);
      deleted += 1;
    } catch (err) {
      failed.push({ id, reason: err instanceof Error ? err.message : 'Failed' });
    }
  }
  await recordAudit(rc, {
    action: 'task.bulk_deleted',
    entityType: 'task',
    summary: `Bulk-deleted ${deleted} task(s); ${failed.length} failed`,
    after: { ids, failed },
  });
  return { deleted, failed };
}

export async function setWatching(
  rc: RequestContext,
  id: string,
  watching: boolean,
): Promise<TaskDto> {
  const auth = requireAuth(rc);
  const { task } = await loadTask(auth, id);
  await Task.updateOne(
    { _id: task._id },
    watching
      ? { $addToSet: { watcherIds: auth.userObjectId } }
      : { $pull: { watcherIds: auth.userObjectId } },
  );
  return getTask(rc, id);
}

/** Used by comments/attachments to authorise access to a task. */
export async function loadTaskForCollab(auth: AuthContext, id: string) {
  return loadTask(auth, id);
}

export async function canEditTask(
  auth: AuthContext,
  task: ITask,
  project: IProject,
): Promise<boolean> {
  if (project.archived) return false;
  const team = auth.permissions['task:update'] === 'team' ? await teamMemberIds(auth) : undefined;
  return canWriteTask(auth, 'task:update', task, project, team);
}

/** Stored values omit cleared (null) fields. */
function dropNulls<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)) as Partial<T>;
}
