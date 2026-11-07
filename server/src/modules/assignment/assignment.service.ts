import { randomUUID } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import {
  OPEN_TASK_STATUSES,
  batchPreviewSchema,
  type AssignmentConfig,
  type AssignmentPlanDto,
  type BatchPreviewInput,
  type CandidateScore,
  type PlanWorkload,
  type SuggestionDto,
  type UserRef,
} from '@arihant/shared';
import { logger } from '../../config/logger';
import { eventBus } from '../../core/events';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../../core/errors';
import { withLock } from '../../core/lock';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { can } from '../../core/rbac/policy';
import { isProjectParticipant } from '../../core/rbac/work-access';
import { recordAudit } from '../audit/audit.service';
import { recordActivity } from '../collab/activity.service';
import { AssignmentHistory, type IAssignmentHistory } from '../collab/collab.models';
import { loadReadableProject } from '../projects/project.service';
import { Project, type IProject } from '../projects/project.model';
import { Role } from '../roles/role.model';
import { Task, type ITask } from '../tasks/task.model';
import { AssignmentPlan, type IAssignmentPlan } from '../tracking/tracking.models';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { planBatch, planRebalance, rank, type EngineCandidate } from './engine';
import { getAssignmentConfig, loadCandidates, toEngineTask } from './workload.service';

const oid = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);
const PLAN_TTL_MS = 24 * 3600_000;
const UNSTARTED = ['backlog', 'todo'] as const;

/* ---------- Execution dispatch (BullMQ in production, inline in tests) ---------- */

export type PlanDispatcher = (planId: string, idempotencyKey: string) => Promise<void>;
let dispatcher: PlanDispatcher | null = null;
/** Registered at startup (queue producer) and by tests (inline execution). */
export function setPlanDispatcher(next: PlanDispatcher | null): void {
  dispatcher = next;
}

/* ---------- Permissions ---------- */

/** May the caller distribute work in this project? */
export function canAssignIn(
  auth: AuthContext,
  project: Pick<IProject, 'members' | 'managerId' | 'ownerId' | 'departmentId'>,
): boolean {
  const scope = auth.permissions['assignment:execute'];
  if (!scope) return false;
  if (scope === 'org') return true;
  if (
    scope === 'department' &&
    auth.departmentId &&
    project.departmentId?.toString() === auth.departmentId
  )
    return true;
  return isProjectParticipant(project, auth.userId);
}

async function loadAssignableProject(auth: AuthContext, projectId: string): Promise<IProject> {
  const project = await loadReadableProject(auth, projectId);
  if (project.archived) throw new UnprocessableError('This project is archived');
  if (!canAssignIn(auth, project))
    throw new ForbiddenError('You cannot assign work in this project');
  return project;
}

/* ---------- Candidate pools ---------- */

/**
 * Candidate pool: active team members and leads by default. Managers coordinate work and
 * viewers only observe, so they are included only when listed explicitly in userIds.
 */
async function poolFor(
  project: IProject,
  filter: { roleKeys?: string[]; userIds?: string[] } = {},
): Promise<Types.ObjectId[]> {
  const ids = filter.userIds?.length
    ? project.members
        .filter((m) => m.role !== 'viewer' && filter.userIds!.includes(m.userId.toString()))
        .map((m) => m.userId.toString())
    : project.members
        .filter((m) => m.role === 'member' || m.role === 'lead')
        .map((m) => m.userId.toString());
  const query: Record<string, unknown> = { _id: { $in: ids.map(oid) }, status: 'active' };
  if (filter.roleKeys?.length) {
    const roles = await Role.find({ key: { $in: filter.roleKeys } })
      .select('_id')
      .lean();
    query.roleIds = { $in: roles.map((r) => r._id) };
  }
  const users = await User.find(query).select('_id').lean();
  return users.map((u) => u._id);
}

const toCandidateScore = (r: ReturnType<typeof rank>[number]): CandidateScore => ({
  user: r.candidate.ref,
  eligible: r.eligible,
  score: Math.round(r.score * 1000) / 10,
  breakdown: r.breakdown,
  reasons: r.reasons,
  capacityHours: r.candidate.capacityHours,
  loadHours: r.candidate.loadHours,
  availableDays: Math.round(r.candidate.availableDays * 10) / 10,
});

/* ---------- Single-task suggestion ---------- */

export async function suggest(rc: RequestContext, taskId: string): Promise<SuggestionDto> {
  const auth = requireAuth(rc);
  const task = await Task.findOne({ _id: oid(taskId), deletedAt: null }).lean();
  if (!task) throw new NotFoundError('Task');
  const project = await loadAssignableProject(auth, task.projectId.toString());
  const cfg = await getAssignmentConfig();
  const pool = (await poolFor(project)).filter((id) => !task.assigneeId?.equals(id));
  const engineTask = toEngineTask(task, cfg);
  const ranked = rank(engineTask, await loadCandidates(pool, cfg), cfg);
  return {
    task: {
      id: taskId,
      key: task.key,
      title: task.title,
      effortHours: engineTask.effortHours,
      priority: task.priority,
    },
    candidates: ranked.map(toCandidateScore),
  };
}

/** Atomically sets an assignee (optimistic on assignmentVersion) and records history in one transaction. */
async function assignOne(
  task: Pick<ITask, '_id' | 'projectId' | 'key' | 'title' | 'assigneeId' | 'assignmentVersion'>,
  toUserId: Types.ObjectId | null,
  meta: {
    method: IAssignmentHistory['method'];
    score?: number | null;
    reason: string;
    actorId: Types.ObjectId | null;
    triggeredBy: 'user' | 'automation';
    batchId?: string;
  },
): Promise<boolean> {
  const session = await mongoose.startSession();
  try {
    let ok = false;
    await session.withTransaction(async () => {
      const res = await Task.updateOne(
        {
          _id: task._id,
          deletedAt: null,
          assignmentVersion: task.assignmentVersion,
          assigneeId: task.assigneeId ?? null,
          status: { $nin: ['done', 'cancelled'] },
        },
        {
          $set: { assigneeId: toUserId },
          $inc: { assignmentVersion: 1 },
          ...(toUserId ? { $addToSet: { watcherIds: toUserId } } : {}),
        },
        { session },
      );
      ok = res.modifiedCount === 1;
      if (!ok) return;
      await AssignmentHistory.create(
        [
          {
            taskId: task._id,
            projectId: task.projectId,
            fromUserId: task.assigneeId ?? null,
            toUserId,
            method: meta.method,
            score: meta.score ?? null,
            reason: meta.reason,
            triggeredBy: meta.triggeredBy,
            actorId: meta.actorId,
            batchId: meta.batchId ?? null,
          },
        ],
        { session },
      );
    });
    return ok;
  } finally {
    await session.endSession();
  }
}

/** Assigns a task to a suggested candidate after re-checking eligibility. */
export async function assignSuggested(rc: RequestContext, taskId: string, userId: string) {
  const auth = requireAuth(rc);
  const task = await Task.findOne({ _id: oid(taskId), deletedAt: null }).lean();
  if (!task) throw new NotFoundError('Task');
  const project = await loadAssignableProject(auth, task.projectId.toString());
  if (!isProjectParticipant(project, userId))
    throw new UnprocessableError('The assignee must be a member of the project team');
  const cfg = await getAssignmentConfig();
  return withLock(`assign:project:${project._id.toString()}`, async () => {
    const [candidate] = await loadCandidates([oid(userId)], cfg);
    if (!candidate) throw new UnprocessableError('The selected person is not active');
    const [evaluation] = rank(toEngineTask(task, cfg), [candidate], cfg);
    if (!evaluation!.eligible)
      throw new UnprocessableError(`Not eligible: ${evaluation!.reasons.join('; ')}`);
    const ok = await assignOne(task, oid(userId), {
      method: 'suggested',
      score: evaluation!.score,
      reason: `Suggested match, score ${Math.round(evaluation!.score * 100)}`,
      actorId: auth.userObjectId,
      triggeredBy: 'user',
    });
    if (!ok) throw new ConflictError('The task changed meanwhile. Reload and try again.');
    await recordActivity(rc, {
      projectId: project._id,
      entityType: 'task',
      entityId: task._id,
      entityLabel: `${task.key} ${task.title}`,
      verb: 'assigned',
      summary: `assigned ${task.key} to ${candidate.ref.name} (smart suggestion, score ${Math.round(evaluation!.score * 100)})`,
    });
    eventBus.publish(
      'task.assigned',
      { taskId, to: userId, method: 'suggested' },
      { actorId: auth.userId },
    );
    return {
      assigned: true,
      user: candidate.ref,
      score: Math.round(evaluation!.score * 1000) / 10,
    };
  });
}

/* ---------- Automatic assignment of new tasks ---------- */

/**
 * Assigns a newly created, unassigned task in a project that opted into auto-assignment.
 * Runs under the project lock; quietly leaves the task unassigned if nobody is eligible.
 */
export async function autoAssign(
  taskId: string,
): Promise<{ assigned: boolean; userId?: string; reason: string }> {
  const task = await Task.findOne({ _id: oid(taskId), deletedAt: null, assigneeId: null }).lean();
  if (!task) return { assigned: false, reason: 'Task not found or already assigned' };
  const project = await Project.findById(task.projectId).lean();
  if (!project?.autoAssign || project.archived)
    return { assigned: false, reason: 'Auto-assignment is off' };
  const cfg = await getAssignmentConfig();
  return withLock(`assign:project:${project._id.toString()}`, async () => {
    const fresh = await Task.findOne({ _id: task._id, assigneeId: null }).lean();
    if (!fresh) return { assigned: false, reason: 'Already assigned' };
    const best = rank(
      toEngineTask(fresh, cfg),
      await loadCandidates(await poolFor(project), cfg),
      cfg,
    )[0];
    if (!best?.eligible)
      return { assigned: false, reason: best ? best.reasons.join('; ') : 'No candidates' };
    const ok = await assignOne(fresh, oid(best.candidate.id), {
      method: 'auto',
      score: best.score,
      reason: `Auto-assigned on creation, score ${Math.round(best.score * 100)}`,
      actorId: null,
      triggeredBy: 'automation',
    });
    if (ok) {
      await recordActivity(
        { auth: null },
        {
          projectId: project._id,
          entityType: 'task',
          entityId: task._id,
          entityLabel: `${task.key} ${task.title}`,
          verb: 'assigned',
          summary: `auto-assigned ${task.key} to ${best.candidate.ref.name} (score ${Math.round(best.score * 100)})`,
        },
      );
    }
    return {
      assigned: ok,
      userId: best.candidate.id,
      reason: ok ? 'Assigned' : 'Changed meanwhile',
    };
  });
}

/** Subscribes auto-assignment to task creation (API process). */
export function registerAutoAssignment(): () => void {
  return eventBus.subscribe('task.created', async (event) => {
    const { taskId } = event.payload as { taskId: string };
    const result = await autoAssign(taskId);
    if (result.assigned) logger.info({ taskId, userId: result.userId }, 'Task auto-assigned');
  });
}

/* ---------- Plans ---------- */

async function savePlan(
  auth: AuthContext,
  data: Pick<
    IAssignmentPlan,
    'kind' | 'projectId' | 'poolKey' | 'candidateIds' | 'proposals' | 'skipped' | 'manualReview'
  >,
): Promise<IAssignmentPlan> {
  const doc = await AssignmentPlan.create({
    ...data,
    status: 'draft',
    idempotencyKey: randomUUID(),
    createdBy: auth.userObjectId,
    expiresAt: new Date(Date.now() + PLAN_TTL_MS),
  });
  return doc.toObject();
}

export async function previewBatch(
  rc: RequestContext,
  raw: BatchPreviewInput,
): Promise<AssignmentPlanDto> {
  const auth = requireAuth(rc);
  const input = batchPreviewSchema.parse(raw);
  const project = await loadAssignableProject(auth, input.projectId);
  const cfg = await getAssignmentConfig();

  const taskFilter: Record<string, unknown> = {
    projectId: project._id,
    deletedAt: null,
    status: { $in: [...UNSTARTED, ...OPEN_TASK_STATUSES] },
  };
  if (input.taskIds?.length) taskFilter._id = { $in: input.taskIds.map(oid) };
  else taskFilter.assigneeId = null;
  const tasks = await Task.find(taskFilter).lean();
  if (tasks.length === 0)
    throw new UnprocessableError('There are no unassigned open tasks to distribute');
  const alreadyAssigned = tasks.filter((t) => t.assigneeId);
  const toPlan = tasks.filter((t) => !t.assigneeId);

  const pool = await poolFor(project, input);
  const candidates = await loadCandidates(pool, cfg);
  const { proposals, skipped } = planBatch(
    toPlan.map((t) => toEngineTask(t, cfg)),
    candidates,
    cfg,
  );
  const byId = new Map(toPlan.map((t) => [t._id.toString(), t]));

  const plan = await savePlan(auth, {
    kind: 'batch',
    projectId: project._id,
    poolKey: `assign:project:${project._id.toString()}`,
    candidateIds: pool,
    proposals: proposals.map((p) => {
      const t = byId.get(p.taskId)!;
      return {
        taskId: t._id,
        fromUserId: null,
        toUserId: p.toUserId ? oid(p.toUserId) : null,
        assignmentVersion: t.assignmentVersion,
        effortHours: toEngineTask(t, cfg).effortHours,
        score: p.score,
        reason: p.reason,
      };
    }),
    skipped: [
      ...skipped.map((s) => ({ taskId: oid(s.taskId), reason: s.reason })),
      ...alreadyAssigned.map((t) => ({ taskId: t._id, reason: 'Already assigned' })),
    ],
    manualReview: [],
  });
  return presentPlan(plan);
}

/** Someone became unavailable: propose new owners for their unstarted, non-critical work. */
export async function previewReassign(
  rc: RequestContext,
  userId: string,
): Promise<AssignmentPlanDto> {
  const auth = requireAuth(rc);
  if (!can(auth, 'assignment:execute')) throw new ForbiddenError();
  const person = await User.findById(oid(userId)).select('name').lean();
  if (!person) throw new NotFoundError('Employee');
  const cfg = await getAssignmentConfig();
  const tasks = await Task.find({
    assigneeId: person._id,
    deletedAt: null,
    status: { $in: [...UNSTARTED, ...OPEN_TASK_STATUSES] },
  }).lean();
  const projects = new Map(
    (await Project.find({ _id: { $in: tasks.map((t) => t.projectId) } }).lean()).map((p) => [
      p._id.toString(),
      p,
    ]),
  );

  const proposals: IAssignmentPlan['proposals'] = [];
  const skipped: IAssignmentPlan['skipped'] = [];
  const manualReview: IAssignmentPlan['manualReview'] = [];
  const candidateIds = new Set<string>();
  // Shared candidate state across projects so loads accumulate correctly.
  const candidateCache = new Map<string, EngineCandidate>();

  for (const t of tasks) {
    const project = projects.get(t.projectId.toString());
    if (!project || project.archived || !canAssignIn(auth, project)) {
      skipped.push({ taskId: t._id, reason: 'You cannot assign work in this project' });
      continue;
    }
    if (!UNSTARTED.includes(t.status as (typeof UNSTARTED)[number])) {
      manualReview.push({ taskId: t._id, reason: 'Work already started: decide manually' });
      continue;
    }
    if (t.priority === 'critical') {
      manualReview.push({ taskId: t._id, reason: 'Critical task: decide manually' });
      continue;
    }
    const pool = (await poolFor(project)).filter((id) => !id.equals(person._id));
    const missing = pool.filter((id) => !candidateCache.has(id.toString()));
    for (const c of await loadCandidates(missing, cfg)) candidateCache.set(c.id, c);
    const candidates = pool
      .map((id) => candidateCache.get(id.toString()))
      .filter((c): c is EngineCandidate => Boolean(c));
    candidates.forEach((c) => candidateIds.add(c.id));
    const engineTask = toEngineTask(t, cfg);
    const best = rank(engineTask, candidates, cfg)[0];
    if (!best?.eligible) {
      skipped.push({
        taskId: t._id,
        reason: best ? `No eligible teammate: ${best.reasons[0]}` : 'No teammates in this project',
      });
      continue;
    }
    best.candidate.loadHours += engineTask.effortHours;
    best.candidate.openTasks += 1;
    best.candidate.lastAssignedAt = Date.now() + proposals.length;
    proposals.push({
      taskId: t._id,
      fromUserId: person._id,
      toUserId: oid(best.candidate.id),
      assignmentVersion: t.assignmentVersion,
      effortHours: engineTask.effortHours,
      score: best.score,
      reason: `${person.name} unavailable; best match score ${Math.round(best.score * 100)}`,
    });
  }
  if (tasks.length === 0)
    throw new UnprocessableError(`${person.name} has no open tasks to reassign`);

  const plan = await savePlan(auth, {
    kind: 'reassign',
    projectId: null,
    poolKey: `assign:user:${userId}`,
    candidateIds: [...candidateIds].map(oid),
    proposals,
    skipped,
    manualReview,
  });
  return presentPlan(plan);
}

/** Detects uneven load in a project team and proposes moving unstarted work. */
export async function previewRebalance(
  rc: RequestContext,
  input: { projectId: string; roleKeys?: string[]; userIds?: string[] },
): Promise<AssignmentPlanDto> {
  const auth = requireAuth(rc);
  const project = await loadAssignableProject(auth, input.projectId);
  const cfg = await getAssignmentConfig();
  const pool = await poolFor(project, input);
  const candidates = await loadCandidates(pool, cfg);
  const movableTasks = await Task.find({
    projectId: project._id,
    deletedAt: null,
    status: { $in: [...UNSTARTED] },
    priority: { $ne: 'critical' },
    assigneeId: { $in: pool },
  }).lean();
  const movable = new Map<string, ReturnType<typeof toEngineTask>[]>();
  for (const t of movableTasks) {
    const k = t.assigneeId!.toString();
    movable.set(k, [...(movable.get(k) ?? []), toEngineTask(t, cfg)]);
  }
  const { moves } = planRebalance(candidates, movable, cfg);
  if (moves.length === 0)
    throw new UnprocessableError('The team is already balanced within the configured thresholds');
  const byId = new Map(movableTasks.map((t) => [t._id.toString(), t]));
  const plan = await savePlan(auth, {
    kind: 'rebalance',
    projectId: project._id,
    poolKey: `assign:project:${project._id.toString()}`,
    candidateIds: pool,
    proposals: moves.map((m) => {
      const t = byId.get(m.taskId)!;
      return {
        taskId: t._id,
        fromUserId: oid(m.fromUserId),
        toUserId: oid(m.toUserId),
        assignmentVersion: t.assignmentVersion,
        effortHours: toEngineTask(t, cfg).effortHours,
        score: m.score,
        reason: m.reason,
      };
    }),
    skipped: [],
    manualReview: [],
  });
  return presentPlan(plan);
}

/* ---------- Plan lifecycle ---------- */

async function loadOwnPlan(auth: AuthContext, id: string): Promise<IAssignmentPlan> {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Plan');
  const plan = await AssignmentPlan.findById(id).lean();
  if (!plan) throw new NotFoundError('Plan');
  if (!plan.createdBy.equals(auth.userObjectId) && auth.permissions['assignment:execute'] !== 'org')
    throw new NotFoundError('Plan');
  return plan;
}

export async function getPlan(rc: RequestContext, id: string): Promise<AssignmentPlanDto> {
  return presentPlan(await loadOwnPlan(requireAuth(rc), id));
}

export async function listPlans(rc: RequestContext): Promise<AssignmentPlanDto[]> {
  const auth = requireAuth(rc);
  const filter =
    auth.permissions['assignment:execute'] === 'org' ? {} : { createdBy: auth.userObjectId };
  const plans = await AssignmentPlan.find(filter).sort({ createdAt: -1 }).limit(20).lean();
  return Promise.all(plans.map((p) => presentPlan(p)));
}

/** Manager overrides on a draft: change or clear the proposed assignee per task. */
export async function modifyPlan(
  rc: RequestContext,
  id: string,
  changes: { taskId: string; toUserId: string | null }[],
) {
  const auth = requireAuth(rc);
  const plan = await loadOwnPlan(auth, id);
  if (plan.status !== 'draft') throw new ConflictError('Only draft plans can be changed');
  const allowed = new Set(plan.candidateIds.map(String));
  const proposals = plan.proposals.map((p) => {
    const change = changes.find((c) => c.taskId === p.taskId.toString());
    if (!change) return p;
    if (change.toUserId && !allowed.has(change.toUserId))
      throw new UnprocessableError('Choose someone from the candidate pool');
    return {
      ...p,
      toUserId: change.toUserId ? oid(change.toUserId) : null,
      score: 0,
      reason: change.toUserId ? 'Manager override' : 'Removed from plan',
    };
  });
  await AssignmentPlan.updateOne({ _id: plan._id, status: 'draft' }, { $set: { proposals } });
  return getPlan(rc, id);
}

export async function rejectPlan(rc: RequestContext, id: string) {
  const auth = requireAuth(rc);
  const plan = await loadOwnPlan(auth, id);
  const res = await AssignmentPlan.updateOne(
    { _id: plan._id, status: 'draft' },
    { $set: { status: 'rejected' } },
  );
  if (res.modifiedCount === 0) throw new ConflictError('This plan is no longer a draft');
  return getPlan(rc, id);
}

/**
 * Approves a draft. The status flip is atomic, so double clicks or concurrent approvals
 * dispatch execution exactly once. Execution runs in the background worker.
 */
export async function approvePlan(rc: RequestContext, id: string): Promise<AssignmentPlanDto> {
  const auth = requireAuth(rc);
  const plan = await loadOwnPlan(auth, id);
  const approved = await AssignmentPlan.findOneAndUpdate(
    { _id: plan._id, status: 'draft', expiresAt: { $gt: new Date() } },
    { $set: { status: 'approved', approvedBy: auth.userObjectId } },
    { returnDocument: 'after' },
  ).lean();
  if (!approved) {
    if (plan.status === 'draft') {
      await AssignmentPlan.updateOne(
        { _id: plan._id, status: 'draft' },
        { $set: { status: 'expired' } },
      );
      throw new ConflictError('This preview has expired. Create a new one.');
    }
    return presentPlan(plan); // already approved/executing/executed: idempotent
  }
  await recordAudit(rc, {
    action: 'assignment.plan_approved',
    entityType: 'assignmentPlan',
    entityId: plan._id,
    summary: `Approved ${plan.kind} plan with ${plan.proposals.filter((p) => p.toUserId).length} assignment(s)`,
  });
  if (!dispatcher) throw new Error('Assignment dispatcher is not configured');
  await dispatcher(plan._id.toString(), plan.idempotencyKey);
  return getPlan(rc, id);
}

/**
 * Executes an approved plan under the pool lock. Each assignment re-validates the task
 * (unchanged since preview) and the person (active, still on the team, capacity), then
 * commits task + history in one transaction. Problems are reported as conflicts.
 */
export async function executePlan(planId: string): Promise<void> {
  const plan = await AssignmentPlan.findOneAndUpdate(
    { _id: oid(planId), status: 'approved' },
    { $set: { status: 'executing' } },
    { returnDocument: 'after' },
  ).lean();
  if (!plan) return; // not approved, or already taken by another worker: idempotent no-op

  const cfg: AssignmentConfig = await getAssignmentConfig();
  const conflicts: { taskId: Types.ObjectId; reason: string }[] = [];
  let assigned = 0;
  try {
    await withLock(plan.poolKey, async () => {
      const targets = [
        ...new Set(plan.proposals.filter((p) => p.toUserId).map((p) => p.toUserId!.toString())),
      ];
      const candidates = new Map(
        (await loadCandidates(targets.map(oid), cfg)).map((c) => [c.id, c]),
      );
      const tasks = new Map(
        (await Task.find({ _id: { $in: plan.proposals.map((p) => p.taskId) } }).lean()).map((t) => [
          t._id.toString(),
          t,
        ]),
      );
      const projects = new Map(
        (
          await Project.find({ _id: { $in: [...tasks.values()].map((t) => t.projectId) } }).lean()
        ).map((p) => [p._id.toString(), p]),
      );

      for (const p of plan.proposals) {
        if (!p.toUserId) continue;
        const task = tasks.get(p.taskId.toString());
        const candidate = candidates.get(p.toUserId.toString());
        const project = task ? projects.get(task.projectId.toString()) : undefined;
        let reason: string | null = null;
        if (!task || task.deletedAt) reason = 'Task was deleted';
        else if (
          task.assignmentVersion !== p.assignmentVersion ||
          String(task.assigneeId ?? '') !== String(p.fromUserId ?? '')
        )
          reason = 'Task was reassigned after the preview';
        else if (!candidate) reason = 'Person is no longer active';
        else if (!project || !isProjectParticipant(project, candidate.id))
          reason = 'Person is no longer on the project team';
        else if (
          !cfg.allowOverCapacity &&
          candidate.loadHours + p.effortHours > candidate.capacityHours + 1e-9
        )
          reason = `${candidate.ref.name} no longer has capacity`;
        if (reason) {
          conflicts.push({ taskId: p.taskId, reason });
          continue;
        }
        const ok = await assignOne(task!, p.toUserId, {
          method: plan.kind,
          score: p.score,
          reason: p.reason,
          actorId: plan.approvedBy ?? plan.createdBy,
          triggeredBy: 'user',
          batchId: plan._id.toString(),
        });
        if (!ok) {
          conflicts.push({ taskId: p.taskId, reason: 'Task changed while the plan was running' });
          continue;
        }
        candidate!.loadHours += p.effortHours;
        assigned += 1;
        await recordActivity(
          { auth: null },
          {
            projectId: task!.projectId,
            entityType: 'task',
            entityId: task!._id,
            entityLabel: `${task!.key} ${task!.title}`,
            verb: 'assigned',
            summary: `${plan.kind === 'batch' ? 'batch-assigned' : plan.kind === 'reassign' ? 'reassigned' : 'rebalanced'} ${task!.key} to ${candidate!.ref.name}`,
          },
        );
      }
    });
  } catch (err) {
    logger.error({ err, planId }, 'Assignment plan execution failed');
    conflicts.push(
      ...plan.proposals
        .filter((p) => p.toUserId)
        .slice(assigned)
        .map((p) => ({ taskId: p.taskId, reason: 'Execution failed; try again' })),
    );
  }
  await AssignmentPlan.updateOne(
    { _id: plan._id },
    { $set: { status: 'executed', result: { assigned, conflicts } } },
  );
  eventBus.publish('assignment.plan_executed', { planId, assigned, conflicts: conflicts.length });
}

/* ---------- Presentation ---------- */

export async function presentPlan(plan: IAssignmentPlan): Promise<AssignmentPlanDto> {
  const cfg = await getAssignmentConfig();
  const taskIds = [
    ...plan.proposals.map((p) => p.taskId),
    ...plan.skipped.map((s) => s.taskId),
    ...plan.manualReview.map((m) => m.taskId),
  ];
  const userIds = new Set<string>(plan.candidateIds.map(String));
  plan.proposals.forEach((p) => {
    if (p.fromUserId) userIds.add(p.fromUserId.toString());
    if (p.toUserId) userIds.add(p.toUserId.toString());
  });
  const [tasks, users, project, creator, candidates] = await Promise.all([
    Task.find({ _id: { $in: taskIds } })
      .select('key title priority status')
      .lean(),
    User.find({ _id: { $in: [...userIds].map(oid) } })
      .select('name email employeeId designation')
      .lean(),
    plan.projectId ? Project.findById(plan.projectId).select('key name').lean() : null,
    User.findById(plan.createdBy).select('name email employeeId designation').lean(),
    plan.status === 'draft'
      ? loadCandidates([...userIds].map(oid), cfg)
      : Promise.resolve([] as EngineCandidate[]),
  ]);
  const taskMap = new Map(tasks.map((t) => [t._id.toString(), t]));
  const userMap = new Map<string, UserRef>(users.map((u) => [u._id.toString(), toUserRef(u)]));
  const conflicts = new Map(
    (plan.result?.conflicts ?? []).map((c) => [c.taskId.toString(), c.reason]),
  );

  // Workload table for drafts: current load and load if the plan were executed now.
  const workload: PlanWorkload[] = candidates
    .map((c) => {
      const added = plan.proposals.filter((p) => p.toUserId?.toString() === c.id);
      const removed = plan.proposals.filter((p) => p.fromUserId?.toString() === c.id && p.toUserId);
      const after =
        c.loadHours +
        added.reduce((s, p) => s + p.effortHours, 0) -
        removed.reduce((s, p) => s + p.effortHours, 0);
      return {
        user: c.ref,
        capacityHours: c.capacityHours,
        loadBefore: c.loadHours,
        loadAfter: Math.round(after * 100) / 100,
        tasksAdded: added.length,
        tasksRemoved: removed.length,
        overCapacity: after > c.capacityHours + 1e-9,
      };
    })
    .sort((a, b) => b.tasksAdded - a.tasksAdded || a.user.name.localeCompare(b.user.name));

  const taskInfo = (id: Types.ObjectId) => {
    const t = taskMap.get(id.toString());
    return { taskId: id.toString(), key: t?.key ?? '—', title: t?.title ?? 'Deleted task' };
  };
  return {
    id: plan._id.toString(),
    kind: plan.kind,
    status: plan.status === 'draft' && plan.expiresAt < new Date() ? 'expired' : plan.status,
    project: project ? { id: project._id.toString(), key: project.key, name: project.name } : null,
    createdBy: creator ? toUserRef(creator) : null,
    proposals: plan.proposals.map((p) => ({
      ...taskInfo(p.taskId),
      priority: taskMap.get(p.taskId.toString())?.priority ?? 'medium',
      effortHours: p.effortHours,
      fromUser: p.fromUserId ? (userMap.get(p.fromUserId.toString()) ?? null) : null,
      toUser: p.toUserId ? (userMap.get(p.toUserId.toString()) ?? null) : null,
      score: Math.round(p.score * 1000) / 10,
      reason: conflicts.get(p.taskId.toString())
        ? `Not applied: ${conflicts.get(p.taskId.toString())}`
        : p.reason,
    })),
    skipped: plan.skipped.map((s) => ({ ...taskInfo(s.taskId), reason: s.reason })),
    manualReview: plan.manualReview.map((m) => ({
      ...taskInfo(m.taskId),
      status: taskMap.get(m.taskId.toString())?.status ?? 'todo',
      reason: m.reason,
    })),
    workload,
    result: plan.result
      ? {
          assigned: plan.result.assigned,
          conflicts: plan.result.conflicts.map((c) => ({
            ...taskInfo(c.taskId),
            reason: c.reason,
          })),
        }
      : undefined,
    createdAt: plan.createdAt.toISOString(),
    expiresAt: plan.expiresAt.toISOString(),
  };
}
