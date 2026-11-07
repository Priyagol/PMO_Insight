import { Types } from 'mongoose';
import {
  DEFAULT_WORKFLOW,
  ROLE_LABELS,
  STATUS_LABELS,
  WORKFLOW_FIELD_LABELS,
  assignWorkflowSchema,
  createWorkflowSchema,
  statusLabel,
  transitionsFrom,
  updateWorkflowSchema,
  workflowDefinitionSchema,
  type AssignWorkflowInput,
  type AvailableTransitionDto,
  type CreateWorkflowInput,
  type SystemRole,
  type TaskStatus,
  type TaskTransitionsDto,
  type TransitionHistoryDto,
  type UpdateTaskInput,
  type WorkflowDefinition,
  type WorkflowDto,
  type WorkflowField,
  type WorkflowTransition,
} from '@arihant/shared';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../../core/errors';
import { can } from '../../core/rbac/policy';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { canUpdateProject } from '../../core/rbac/work-access';
import { recordAudit } from '../audit/audit.service';
import { recordActivity } from '../collab/activity.service';
import { Approval } from '../approvals/approval.model';
import { loadReadableProject } from '../projects/project.service';
import { Project, type IProject } from '../projects/project.model';
import { Task, type ITask } from '../tasks/task.model';
import { User } from '../users/user.model';
import {
  TaskTransition,
  TaskWorkflow,
  type ITaskWorkflow,
  type TransitionVia,
} from './workflow.models';

const oid = (id: string) => new Types.ObjectId(id);
const CLOSED: TaskStatus[] = ['done', 'cancelled'];

export interface ResolvedWorkflow {
  id: string | null;
  name: string;
  def: WorkflowDefinition;
}

/** The workflow a project uses (the standard one when none is set). */
export async function workflowOf(project: Pick<IProject, 'workflowId'>): Promise<ResolvedWorkflow> {
  if (project.workflowId) {
    const w = await TaskWorkflow.findById(project.workflowId).lean();
    if (w) return { id: w._id.toString(), name: w.name, def: w.definition };
  }
  return { id: null, name: 'Standard workflow', def: DEFAULT_WORKFLOW };
}

/* ============================ Checking a move ============================ */

interface Blocker {
  kind: 'forbidden' | 'invalid';
  message: string;
}

export interface TransitionCheck {
  auth: AuthContext;
  task: ITask;
  project: IProject;
  to: TaskStatus;
  /** Changes made in the same request (count towards required fields). */
  patch?: Partial<UpdateTaskInput>;
  comment?: string | null;
  /** Skip role / assignee restrictions and the approval step (an approved request). */
  approved?: boolean;
}

export interface TransitionDecision {
  workflow: ResolvedWorkflow;
  transition: WorkflowTransition;
  needsApproval: boolean;
}

const hasValue = (v: unknown) =>
  v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);

/** Fields required for a status that would be empty after this change. */
export function missingRequired(
  def: WorkflowDefinition,
  status: TaskStatus,
  task: ITask,
  patch: Partial<UpdateTaskInput> = {},
  assigneeWillBeSet = false,
): WorkflowField[] {
  const pick = <K extends keyof UpdateTaskInput>(k: K, current: unknown) =>
    patch[k] !== undefined ? patch[k] : current;
  const value: Record<WorkflowField, unknown> = {
    assignee: assigneeWillBeSet ? 'set' : pick('assigneeId', task.assigneeId),
    dueDate: pick('dueDate', task.dueDate),
    estimatedHours: pick('estimatedHours', task.estimatedHours),
    storyPoints: pick('storyPoints', task.storyPoints),
    fixRelease: pick('fixReleaseId', task.fixReleaseId),
    description: pick('description', task.description),
    components: pick('components', task.components),
  };
  return (def.required[status] ?? []).filter((f) => !hasValue(value[f]));
}

async function blockersFor(
  c: TransitionCheck,
  workflow: ResolvedWorkflow,
  t: WorkflowTransition,
): Promise<Blocker[]> {
  const out: Blocker[] = [];
  const { auth, task, project } = c;
  if (!c.approved) {
    if (
      t.roles.length &&
      !auth.isSuperAdmin &&
      !auth.roleKeys.some((r) => t.roles.includes(r as SystemRole))
    ) {
      out.push({
        kind: 'forbidden',
        message: `Only ${t.roles.map((r) => ROLE_LABELS[r]).join(', ')} can use “${t.name}”`,
      });
    }
    if (
      t.assigneeOnly &&
      task.assigneeId?.toString() !== auth.userId &&
      !canUpdateProject(auth, project)
    ) {
      out.push({ kind: 'forbidden', message: `Only the assignee can use “${t.name}”` });
    }
  }
  for (const cond of t.conditions) {
    if (cond === 'subtasks_done') {
      const open = await Task.countDocuments({
        parentId: task._id,
        deletedAt: null,
        status: { $nin: CLOSED },
      });
      if (open) out.push({ kind: 'invalid', message: `${open} subtask(s) are still open` });
    } else if (cond === 'checklist_done') {
      const list = c.patch?.checklist ?? task.checklist;
      const left = list.filter((i) => !i.done).length;
      if (left) out.push({ kind: 'invalid', message: `${left} checklist item(s) are not done` });
    } else if (cond === 'dependencies_done') {
      const deps = (c.patch?.dependencyIds ?? task.dependencyIds.map(String)).map(String);
      const open = deps.length
        ? await Task.countDocuments({
            _id: { $in: deps.map(oid) },
            deletedAt: null,
            status: { $nin: CLOSED },
          })
        : 0;
      if (open)
        out.push({ kind: 'invalid', message: `${open} task(s) it depends on are not done yet` });
    }
  }
  if (t.requireComment && !c.comment?.trim())
    out.push({ kind: 'invalid', message: `“${t.name}” needs a comment` });
  const assigns = t.actions.includes('assign_reporter') || t.actions.includes('assign_actor');
  const missing = missingRequired(workflow.def, t.to, task, c.patch, assigns);
  if (missing.length)
    out.push({
      kind: 'invalid',
      message: `${statusLabel(workflow.def, t.to)} needs: ${missing.map((f) => WORKFLOW_FIELD_LABELS[f]).join(', ')}`,
    });
  return out;
}

/**
 * Decides whether a status change is allowed by the project's workflow. Throws 403 / 422 with
 * the reason otherwise. The caller still applies the generic permission checks.
 */
export async function checkTransition(c: TransitionCheck): Promise<TransitionDecision> {
  const workflow = await workflowOf(c.project);
  const { def } = workflow;
  const from = c.task.status;
  if (!def.statuses.includes(c.to))
    throw new UnprocessableError(
      `${STATUS_LABELS[c.to]} is not used in this project's workflow (${workflow.name})`,
    );
  const candidates = transitionsFrom(def, from).filter((t) => t.to === c.to);
  if (!candidates.length)
    throw new UnprocessableError(
      `A task cannot move from ${statusLabel(def, from)} to ${statusLabel(def, c.to)} in ${workflow.name}`,
    );
  let first: Blocker[] | null = null;
  for (const t of candidates) {
    const blockers = await blockersFor(c, workflow, t);
    if (!blockers.length)
      return { workflow, transition: t, needsApproval: t.approval && !c.approved };
    first ??= blockers;
  }
  const forbidden = first!.find((b) => b.kind === 'forbidden');
  if (forbidden) throw new ForbiddenError(forbidden.message);
  throw new UnprocessableError(first!.map((b) => b.message).join('. '));
}

/** Rejects edits that empty a field the task's current status requires. */
export async function checkRequiredStillMet(
  task: ITask,
  project: IProject,
  patch: Partial<UpdateTaskInput>,
): Promise<void> {
  const { def } = await workflowOf(project);
  const missing = missingRequired(def, task.status, task, patch).filter(
    (f) =>
      ({
        assignee: patch.assigneeId,
        dueDate: patch.dueDate,
        estimatedHours: patch.estimatedHours,
        storyPoints: patch.storyPoints,
        fixRelease: patch.fixReleaseId,
        description: patch.description,
        components: patch.components,
      })[f] !== undefined,
  );
  if (missing.length)
    throw new UnprocessableError(
      `${statusLabel(def, task.status)} requires ${missing.map((f) => WORKFLOW_FIELD_LABELS[f]).join(', ')}`,
    );
}

/** Status for a new task: the requested one if the workflow uses it, else the first status. */
export async function initialStatus(project: IProject, requested: TaskStatus): Promise<TaskStatus> {
  const { def } = await workflowOf(project);
  return def.statuses.includes(requested) ? requested : def.statuses[0]!;
}

/** Statuses shown as board columns for a project. */
export async function boardStatuses(project: IProject): Promise<TaskStatus[]> {
  return (await workflowOf(project)).def.statuses.filter((s) => s !== 'cancelled');
}

/* ============================ History ============================ */

export async function recordTransition(
  rc: RequestContext,
  input: {
    task: Pick<ITask, '_id' | 'projectId' | 'createdAt'>;
    from: TaskStatus | null;
    to: TaskStatus;
    transition?: string | null;
    via: TransitionVia;
    comment?: string | null;
    actorId?: Types.ObjectId | null;
  },
): Promise<void> {
  const last = await TaskTransition.findOne({ taskId: input.task._id })
    .sort({ at: -1 })
    .select('at')
    .lean();
  const since = last?.at ?? input.task.createdAt;
  const now = new Date();
  await TaskTransition.create({
    taskId: input.task._id,
    projectId: input.task.projectId,
    from: input.from,
    to: input.to,
    transition: input.transition ?? null,
    via: input.via,
    actorId: input.actorId !== undefined ? input.actorId : (rc.auth?.userObjectId ?? null),
    comment: input.comment ?? null,
    durationMs: input.from && since ? Math.max(0, now.getTime() - since.getTime()) : null,
    at: now,
  });
}

export async function transitionHistory(task: ITask): Promise<TransitionHistoryDto[]> {
  const rows = await TaskTransition.find({ taskId: task._id }).sort({ at: 1 }).limit(500).lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.actorId).filter(Boolean) } })
    .select('name')
    .lean();
  return rows.map((r) => {
    const u = r.actorId ? users.find((x) => x._id.equals(r.actorId!)) : null;
    return {
      id: r._id.toString(),
      from: r.from,
      to: r.to,
      transition: r.transition,
      via: r.via,
      by: u ? { id: u._id.toString(), name: u.name } : null,
      comment: r.comment,
      durationMs: r.durationMs,
      at: r.at.toISOString(),
    };
  });
}

/** What the caller can do with a task right now, with the reasons when not. */
export async function availableTransitions(
  auth: AuthContext,
  task: ITask,
  project: IProject,
): Promise<TaskTransitionsDto> {
  const workflow = await workflowOf(project);
  const { def } = workflow;
  const transitions: AvailableTransitionDto[] = [];
  for (const t of transitionsFrom(def, task.status)) {
    if (!def.statuses.includes(t.to)) continue;
    // A comment is asked for in the dialog, so it is not a blocker here.
    const blockers = (
      await blockersFor({ auth, task, project, to: t.to, comment: 'x' }, workflow, t)
    ).map((b) => b.message);
    transitions.push({
      id: t.id,
      name: t.name,
      to: t.to,
      toLabel: statusLabel(def, t.to),
      requireComment: t.requireComment,
      approval: t.approval,
      blockers,
    });
  }
  let pending: TaskTransitionsDto['pending'] = null;
  if (task.pendingTransition) {
    const a = await Approval.findById(task.pendingTransition.approvalId).select('key').lean();
    pending = {
      to: task.pendingTransition.to,
      approvalId: task.pendingTransition.approvalId.toString(),
      approvalKey: a?.key ?? '',
      requestedBy: task.pendingTransition.requestedBy.toString(),
    };
  }
  return {
    workflow: { id: workflow.id, name: workflow.name, statuses: def.statuses, labels: def.labels },
    current: task.status,
    pending,
    transitions,
  };
}

/* ============================ Workflow library ============================ */

/** Directors, department heads and administrators maintain workflows. */
const canManageWorkflows = (auth: AuthContext) =>
  auth.isSuperAdmin || can(auth, 'project:update', 'department');

async function present(auth: AuthContext, rows: ITaskWorkflow[]): Promise<WorkflowDto[]> {
  const projects = await Project.find({ workflowId: { $in: rows.map((r) => r._id) } })
    .select('key name workflowId')
    .lean();
  return rows.map((w) => ({
    id: w._id.toString(),
    name: w.name,
    description: w.description,
    definition: w.definition,
    projects: projects
      .filter((p) => p.workflowId?.equals(w._id))
      .map((p) => ({ id: p._id.toString(), key: p.key, name: p.name })),
    canEdit: canManageWorkflows(auth),
    updatedAt: w.updatedAt.toISOString(),
  }));
}

export async function listWorkflows(rc: RequestContext): Promise<WorkflowDto[]> {
  const auth = requireAuth(rc);
  const rows = await TaskWorkflow.find().sort({ name: 1 }).lean();
  return present(auth, rows);
}

async function load(id: string): Promise<ITaskWorkflow> {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Workflow');
  const w = await TaskWorkflow.findById(id).lean();
  if (!w) throw new NotFoundError('Workflow');
  return w;
}

export async function getWorkflow(rc: RequestContext, id: string): Promise<WorkflowDto> {
  const auth = requireAuth(rc);
  return (await present(auth, [await load(id)]))[0]!;
}

const dup = (e: unknown) => (e as { code?: number }).code === 11000;

export async function createWorkflow(
  rc: RequestContext,
  raw: CreateWorkflowInput,
): Promise<WorkflowDto> {
  const auth = requireAuth(rc);
  if (!canManageWorkflows(auth)) throw new ForbiddenError('You cannot manage workflows');
  const input = createWorkflowSchema.parse(raw);
  try {
    const w = await TaskWorkflow.create({
      name: input.name,
      description: input.description ?? null,
      definition: input.definition,
      createdBy: auth.userObjectId,
    });
    await recordAudit(rc, {
      action: 'workflow.created',
      entityType: 'workflow',
      entityId: w._id,
      summary: `Created task workflow “${w.name}”`,
      after: input.definition,
    });
    return (await present(auth, [w.toObject()]))[0]!;
  } catch (e) {
    if (dup(e)) throw new ConflictError('A workflow with this name already exists');
    throw e;
  }
}

/** Counts of tasks in statuses, for the projects using a workflow. */
async function tasksIn(projectIds: Types.ObjectId[], statuses: TaskStatus[]) {
  if (!projectIds.length || !statuses.length) return [];
  return Task.aggregate<{ _id: TaskStatus; count: number }>([
    { $match: { projectId: { $in: projectIds }, status: { $in: statuses }, deletedAt: null } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
}

export async function updateWorkflow(
  rc: RequestContext,
  id: string,
  raw: unknown,
): Promise<WorkflowDto> {
  const auth = requireAuth(rc);
  if (!canManageWorkflows(auth)) throw new ForbiddenError('You cannot manage workflows');
  const input = updateWorkflowSchema.parse(raw);
  const w = await load(id);
  if (input.definition) {
    const removed = w.definition.statuses.filter((s) => !input.definition!.statuses.includes(s));
    const projects = await Project.find({ workflowId: w._id }).select('_id').lean();
    const stuck = await tasksIn(
      projects.map((p) => p._id),
      removed,
    );
    if (stuck.length)
      throw new UnprocessableError(
        `Tasks are still in ${stuck.map((s) => `${statusLabel(w.definition, s._id)} (${s.count})`).join(', ')}. Move them first or keep those statuses.`,
        { stuck },
      );
  }
  try {
    const next = await TaskWorkflow.findOneAndUpdate(
      { _id: w._id, version: w.version },
      {
        $set: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.definition ? { definition: input.definition } : {}),
        },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    ).lean();
    if (!next) throw new ConflictError('Someone else changed this workflow. Reload and try again.');
    await recordAudit(rc, {
      action: 'workflow.updated',
      entityType: 'workflow',
      entityId: w._id,
      summary: `Changed task workflow “${next.name}”`,
      before: w.definition,
      after: next.definition,
    });
    return (await present(auth, [next]))[0]!;
  } catch (e) {
    if (dup(e)) throw new ConflictError('A workflow with this name already exists');
    throw e;
  }
}

export async function deleteWorkflow(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  if (!canManageWorkflows(auth)) throw new ForbiddenError('You cannot manage workflows');
  const w = await load(id);
  const used = await Project.countDocuments({ workflowId: w._id });
  if (used)
    throw new ConflictError(`${used} project(s) use this workflow. Switch them to another first.`);
  await TaskWorkflow.deleteOne({ _id: w._id });
  await recordAudit(rc, {
    action: 'workflow.deleted',
    entityType: 'workflow',
    entityId: w._id,
    summary: `Deleted task workflow “${w.name}”`,
  });
}

/**
 * Switches a project to a workflow. Tasks whose status the new workflow does not use are moved
 * using `statusMap`; without a mapping for them the switch is refused (422 with the counts).
 */
export async function assignWorkflow(
  rc: RequestContext,
  projectId: string,
  raw: AssignWorkflowInput,
): Promise<{ workflowId: string | null; moved: number }> {
  const auth = requireAuth(rc);
  const input = assignWorkflowSchema.parse(raw);
  const project = await loadReadableProject(auth, projectId);
  if (!canUpdateProject(auth, project))
    throw new ForbiddenError('Only the project manager can change the workflow');
  if (project.archived) throw new UnprocessableError('This project is archived');
  const next: ResolvedWorkflow = input.workflowId
    ? await (async () => {
        const w = await load(input.workflowId!);
        return { id: w._id.toString(), name: w.name, def: w.definition };
      })()
    : { id: null, name: 'Standard workflow', def: DEFAULT_WORKFLOW };

  const outside = (
    await tasksIn([project._id], [...new Set(Object.keys(STATUS_LABELS))] as TaskStatus[])
  ).filter((r) => !next.def.statuses.includes(r._id));
  const unmapped = outside.filter((r) => {
    const target = input.statusMap[r._id];
    return !target || !next.def.statuses.includes(target);
  });
  if (unmapped.length)
    throw new UnprocessableError(
      `Choose where tasks go: ${unmapped.map((u) => `${STATUS_LABELS[u._id]} (${u.count})`).join(', ')} ${unmapped.length === 1 ? 'is' : 'are'} not in ${next.name}`,
      { unmapped: unmapped.map((u) => ({ status: u._id, count: u.count })) },
    );

  let moved = 0;
  for (const r of outside) {
    const to = input.statusMap[r._id]!;
    const tasks = await Task.find({ projectId: project._id, status: r._id, deletedAt: null })
      .select('_id projectId createdAt')
      .lean();
    const set: Record<string, unknown> = { status: to };
    if (to === 'done') set.completedAt = new Date();
    if (r._id === 'done') set.completedAt = null;
    if (to === 'blocked') set.blockedSince = new Date();
    if (r._id === 'blocked') set.blockedSince = null;
    await Task.updateMany({ _id: { $in: tasks.map((t) => t._id) } }, { $set: set });
    for (const t of tasks)
      await recordTransition(rc, {
        task: t,
        from: r._id,
        to,
        transition: `Workflow changed to ${next.name}`,
        via: 'workflow_change',
      });
    moved += tasks.length;
  }
  await Project.updateOne(
    { _id: project._id },
    { $set: { workflowId: next.id ? oid(next.id) : null }, $inc: { version: 1 } },
  );
  const before = await workflowOf(project);
  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: `${project.key} ${project.name}`,
    verb: 'updated',
    summary: `switched the task workflow from ${before.name} to ${next.name}${moved ? ` (${moved} task(s) moved)` : ''}`,
  });
  await recordAudit(rc, {
    action: 'project.workflow_changed',
    entityType: 'project',
    entityId: project._id,
    summary: `${project.key}: workflow ${before.name} → ${next.name}; ${moved} task(s) moved`,
    before: { workflowId: project.workflowId?.toString() ?? null },
    after: { workflowId: next.id, statusMap: input.statusMap },
  });
  return { workflowId: next.id, moved };
}

/** Validates a definition without saving (editor preview). */
export function validateDefinition(raw: unknown) {
  const r = workflowDefinitionSchema.safeParse(raw);
  return r.success
    ? { ok: true as const }
    : {
        ok: false as const,
        issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
}
