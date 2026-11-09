import { Types } from 'mongoose';
import {
  APPROVAL_ENTITY_LABELS,
  APPROVAL_ENTITY_TYPES,
  approvalDecisionSchema,
  approvalDelegateSchema,
  approvalQuerySchema,
  approvalRejectSchema,
  approvalWorkflowSchema,
  createApprovalSchema,
  type ApprovalDto,
  type ApprovalEntityType,
  type ApprovalQuery,
  type ApprovalStageDef,
  type ApprovalWorkflowDto,
  type CreateApprovalInput,
  type PageMeta,
  type UserRef,
} from '@arihant/shared';
import { eventBus } from '../../core/events';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../../core/errors';
import { nextKey } from '../../core/idgen';
import { toPageMeta, toPageWindow } from '../../core/pagination';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { can } from '../../core/rbac/policy';
import {
  canUpdateProject,
  isProjectParticipant,
  readableProjectIds,
} from '../../core/rbac/work-access';
import { recordAudit } from '../audit/audit.service';
import { recordActivity } from '../collab/activity.service';
import { Department } from '../departments/department.model';
import { notify } from '../notifications/notification.service';
import { Project, ProjectVersion, type IProject } from '../projects/project.model';
import { loadReadableProject } from '../projects/project.service';
import { Role } from '../roles/role.model';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { Approval, ApprovalWorkflow, type IApproval, type IApprovalStage } from './approval.model';

const oid = (id: string) => new Types.ObjectId(id);
const link = (id: Types.ObjectId | string) => `/approvals?open=${id.toString()}`;

/* ============================ Workflows ============================ */

/** Defaults used until an administrator changes them (configuration, not sample data). */
const DEFAULT_WORKFLOWS: Record<
  ApprovalEntityType,
  {
    name: string;
    description: string;
    stages: (Omit<ApprovalStageDef, 'fallbackOnly'> & { fallbackOnly?: boolean })[];
  }
> = {
  general: {
    name: 'General request',
    description: 'Budget, scope or other project requests.',
    stages: [
      { name: 'Project manager', approverType: 'project_manager', slaHours: 48 },
      { name: 'Department head', approverType: 'department_head', slaHours: 72 },
    ],
  },
  document_publish: {
    name: 'Document publication',
    description: 'Sign-off before a document is published to the project.',
    stages: [
      {
        name: 'Project manager',
        approverType: 'project_manager',
        slaHours: 48,
        fallbackOnly: false,
      },
      // Used only when the project manager is the one asking.
      {
        name: 'Department head',
        approverType: 'department_head',
        slaHours: 48,
        fallbackOnly: true,
      },
    ],
  },
  release_deploy: {
    name: 'Production deployment',
    description: 'Go-live approval before a release is deployed to production.',
    stages: [
      { name: 'Project manager', approverType: 'project_manager', slaHours: 24 },
      { name: 'Department head', approverType: 'department_head', slaHours: 24 },
    ],
  },
  change_request: {
    name: 'Change request',
    description: 'Scope, schedule or cost changes requested by stakeholders.',
    stages: [
      { name: 'Project manager', approverType: 'project_manager', slaHours: 72 },
      { name: 'Department head', approverType: 'department_head', slaHours: 72 },
    ],
  },
  service_request: {
    name: 'Service request',
    description: 'Requests whose type needs approval wait here before the team starts work.',
    stages: [
      { name: 'Project manager', approverType: 'project_manager', slaHours: 24 },
      {
        name: 'Department head',
        approverType: 'department_head',
        slaHours: 24,
        fallbackOnly: true,
      },
    ],
  },
  task_transition: {
    name: 'Task status change',
    description: 'Workflow transitions marked "needs approval" wait here before the task moves.',
    stages: [
      { name: 'Project manager', approverType: 'project_manager', slaHours: 24 },
      // Used only when the project manager is the one asking.
      {
        name: 'Department head',
        approverType: 'department_head',
        slaHours: 24,
        fallbackOnly: true,
      },
    ],
  },
  project_closure: {
    name: 'Project closure',
    description: 'Formal sign-off before a project is marked completed.',
    stages: [
      { name: 'Department head', approverType: 'department_head', slaHours: 72 },
      { name: 'Director', approverType: 'role', roleKey: 'director', slaHours: 120 },
    ],
  },
};

async function workflowFor(entityType: ApprovalEntityType) {
  const d = DEFAULT_WORKFLOWS[entityType];
  return ApprovalWorkflow.findOneAndUpdate(
    { entityType },
    { $setOnInsert: { entityType, name: d.name, description: d.description, stages: d.stages } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
}

const presentWorkflow = (
  w: NonNullable<Awaited<ReturnType<typeof workflowFor>>>,
): ApprovalWorkflowDto => ({
  id: w._id.toString(),
  entityType: w.entityType,
  name: w.name,
  description: w.description ?? undefined,
  stages: w.stages,
  updatedAt: w.updatedAt.toISOString(),
});

export async function listWorkflows(rc: RequestContext): Promise<ApprovalWorkflowDto[]> {
  requireAuth(rc);
  const all = await Promise.all(APPROVAL_ENTITY_TYPES.map((t) => workflowFor(t)));
  return all.map((w) => presentWorkflow(w!));
}

/** Changes apply to new requests; requests in flight keep the stages they started with. */
export async function updateWorkflow(
  rc: RequestContext,
  entityType: string,
  raw: unknown,
): Promise<ApprovalWorkflowDto> {
  const auth = requireAuth(rc);
  if (!can(auth, 'settings:manage', 'org')) throw new ForbiddenError();
  if (!(APPROVAL_ENTITY_TYPES as readonly string[]).includes(entityType))
    throw new NotFoundError('Workflow');
  const input = approvalWorkflowSchema.parse(raw);
  for (const s of input.stages) {
    if (s.approverType === 'role' && !(await Role.exists({ key: s.roleKey })))
      throw new UnprocessableError(`Unknown role "${s.roleKey}"`);
    if (
      s.approverType === 'users' &&
      (await User.countDocuments({ _id: { $in: s.userIds }, status: 'active' })) !==
        s.userIds!.length
    )
      throw new UnprocessableError('Every named approver must be an active employee');
  }
  const before = await workflowFor(entityType as ApprovalEntityType);
  const w = await ApprovalWorkflow.findOneAndUpdate(
    { entityType: entityType as ApprovalEntityType },
    {
      $set: {
        name: input.name,
        description: input.description ?? null,
        stages: input.stages,
        updatedBy: auth.userObjectId,
      },
    },
    { returnDocument: 'after' },
  ).lean();
  await recordAudit(rc, {
    action: 'approval_workflow.updated',
    entityType: 'approvalWorkflow',
    entityId: w!._id,
    summary: `Updated the "${w!.name}" approval workflow (${input.stages.map((s) => s.name).join(' → ')})`,
    before: { stages: before!.stages },
    after: { stages: input.stages },
  });
  return presentWorkflow(w!);
}

/* ============================ Approver resolution ============================ */

/** Active users who hold approval rights, from a candidate list. */
async function withApprovalRights(ids: Types.ObjectId[]): Promise<Types.ObjectId[]> {
  if (!ids.length) return [];
  const roles = await Role.find({ 'grants.permission': 'approval:act' }).select('_id').lean();
  const users = await User.find({
    _id: { $in: ids },
    status: 'active',
    roleIds: { $in: roles.map((r) => r._id) },
  })
    .select('_id')
    .lean();
  return users.map((u) => u._id);
}

/** Active directors with approval rights (last resort for a missing department head). */
async function directors(): Promise<Types.ObjectId[]> {
  const role = await Role.findOne({ key: 'director' }).select('_id').lean();
  if (!role) return [];
  return (
    await User.find({ roleIds: role._id, status: 'active' }).select('_id').limit(50).lean()
  ).map((u) => u._id);
}

/** Head of a department, if it exists and is active with approval rights. */
async function headOf(departmentId: Types.ObjectId | null | undefined) {
  if (!departmentId) return null;
  const d = await Department.findOne({ _id: departmentId, archived: false })
    .select('headId name')
    .lean();
  const [head] = d?.headId ? await withApprovalRights([d.headId]) : [];
  return head ? { id: head, department: d!.name } : null;
}

/**
 * A project's department head; when the project has none (no department, no head, or the head
 * is inactive), the head of the project manager's department. As a last resort (nobody else in
 * the whole workflow could approve), the directors. The fallback is noted on the stage.
 */
async function departmentHeadFor(
  project: IProject,
  lastResort: boolean,
): Promise<{ ids: Types.ObjectId[]; note?: string }> {
  const own = await headOf(project.departmentId);
  if (own) return { ids: [own.id] };
  const pm = await User.findById(project.managerId).select('departmentId').lean();
  const pmHead = await headOf(pm?.departmentId);
  if (pmHead)
    return {
      ids: [pmHead.id],
      note: `The project has no department head: sent to the head of ${pmHead.department} (the project manager's department)`,
    };
  if (!lastResort) return { ids: [] };
  return {
    ids: await directors(),
    note: 'The project has no department head and nobody else could approve: sent to the directors',
  };
}

async function resolveApprovers(
  stage: IApprovalStage,
  project: IProject,
  requesterId: Types.ObjectId,
  lastResort = false,
): Promise<{ ids: Types.ObjectId[]; note?: string }> {
  let ids: Types.ObjectId[] = [];
  let note: string | undefined;
  switch (stage.approverType) {
    case 'project_manager':
      ids = [project.managerId];
      break;
    case 'department_head': {
      ({ ids, note } = await departmentHeadFor(project, lastResort));
      break;
    }
    case 'reporting_manager': {
      const r = await User.findById(requesterId).select('managerId').lean();
      ids = r?.managerId ? [r.managerId] : [];
      break;
    }
    case 'role': {
      const role = await Role.findOne({ key: stage.roleKey }).select('_id').lean();
      ids = role
        ? (
            await User.find({ roleIds: role._id, status: 'active' }).select('_id').limit(50).lean()
          ).map((u) => u._id)
        : [];
      break;
    }
    case 'users':
      ids = stage.userIds ?? [];
      break;
  }
  // Nobody approves their own request.
  return {
    ids: (await withApprovalRights(ids)).filter((id) => !id.equals(requesterId)),
    note,
  };
}

/**
 * Starts stage `from` (or the next one with an eligible approver). Stages nobody can
 * approve are skipped with a note. Returns the index of the active stage, or -1 when
 * no stage remains.
 */
async function advance(
  doc: Pick<IApproval, 'stages' | 'requestedBy'>,
  project: IProject,
  from: number,
  now: Date,
  lastResort = false,
): Promise<number> {
  for (let i = from; i < doc.stages.length; i += 1) {
    const stage = doc.stages[i]!;
    if (stage.fallbackOnly && doc.stages.slice(0, i).some((s) => s.status === 'approved')) {
      stage.status = 'skipped';
      stage.note = 'Not needed: an earlier stage approved';
      continue;
    }
    const { ids: approvers, note } = await resolveApprovers(
      stage,
      project,
      doc.requestedBy,
      lastResort,
    );
    if (!approvers.length) {
      stage.status = 'skipped';
      stage.note = 'No eligible approver for this stage';
      continue;
    }
    stage.status = 'pending';
    stage.approverIds = approvers;
    if (note) stage.note = note;
    stage.startedAt = now;
    stage.dueAt = new Date(now.getTime() + stage.slaHours * 3600_000);
    return i;
  }
  return -1;
}

/* ============================ Effects ============================ */

type Effect = (rc: RequestContext, approval: IApproval) => Promise<void>;
const effects = new Map<ApprovalEntityType, Effect>();
/** Modules register what happens when a request of their type is fully approved (Phase 6B adds more). */
type ClosedEffect = (
  rc: RequestContext,
  approval: IApproval,
  outcome: 'rejected' | 'cancelled',
) => Promise<void>;
const closedEffects = new Map<ApprovalEntityType, ClosedEffect>();
/** What happens to the underlying record when a request is rejected or withdrawn. */
export function registerApprovalClosed(type: ApprovalEntityType, effect: ClosedEffect): void {
  closedEffects.set(type, effect);
}

export function registerApprovalEffect(type: ApprovalEntityType, effect: Effect): void {
  effects.set(type, effect);
}

registerApprovalEffect('project_closure', async (rc, a) => {
  const before = await Project.findById(a.projectId).lean();
  if (!before || before.status === 'completed') return;
  const updated = await Project.findOneAndUpdate(
    { _id: before._id },
    { $set: { status: 'completed' }, $inc: { version: 1 } },
    { returnDocument: 'after' },
  ).lean();
  await ProjectVersion.create({
    projectId: before._id,
    version: updated!.version,
    changes: [{ field: 'status', from: before.status, to: 'completed' }],
    changedBy: rc.auth?.userObjectId ?? null,
  });
  await recordActivity(rc, {
    projectId: before._id,
    entityType: 'project',
    entityId: before._id,
    entityLabel: `${before.key} ${before.name}`,
    verb: 'updated',
    summary: `closed the project (approval ${a.key})`,
    changes: [{ field: 'status', from: before.status, to: 'completed' }],
  });
  eventBus.publish(
    'project.status_changed',
    { projectId: before._id.toString(), from: before.status, to: 'completed' },
    { actorId: rc.auth?.userId },
  );
});

/* ============================ Presentation ============================ */

async function present(auth: AuthContext, docs: IApproval[]): Promise<ApprovalDto[]> {
  const userIds = new Set<string>();
  for (const d of docs) {
    userIds.add(d.requestedBy.toString());
    d.history.forEach((h) => h.by && userIds.add(h.by.toString()));
    d.stages.forEach((s) => {
      s.approverIds.forEach((a) => userIds.add(a.toString()));
      if (s.decidedBy) userIds.add(s.decidedBy.toString());
    });
  }
  const [users, projects] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } })
      .select('name email employeeId designation')
      .lean(),
    Project.find({ _id: { $in: docs.map((d) => d.projectId) } })
      .select('key name')
      .lean(),
  ]);
  const u = new Map<string, UserRef>(users.map((x) => [x._id.toString(), toUserRef(x)]));
  const p = new Map(
    projects.map((x) => [x._id.toString(), { id: x._id.toString(), key: x.key, name: x.name }]),
  );
  const now = Date.now();
  return docs.map((d) => {
    const current = d.status === 'pending' ? d.stages[d.currentStage] : undefined;
    return {
      id: d._id.toString(),
      key: d.key,
      entityType: d.entityType,
      entityId: d.entityId?.toString(),
      title: d.title,
      description: d.description ?? undefined,
      amount: d.amount ?? undefined,
      project: p.get(d.projectId.toString()) ?? {
        id: d.projectId.toString(),
        key: '?',
        name: 'Unavailable',
      },
      requestedBy: u.get(d.requestedBy.toString()) ?? null,
      status: d.status,
      currentStage: d.currentStage,
      stages: d.stages.map((s) => ({
        name: s.name,
        approverType: s.approverType,
        status: s.status,
        approvers: s.approverIds
          .map((a) => u.get(a.toString()))
          .filter((x): x is UserRef => Boolean(x)),
        note: s.note ?? undefined,
        decidedBy: s.decidedBy ? (u.get(s.decidedBy.toString()) ?? null) : null,
        comment: s.comment ?? undefined,
        decidedAt: s.decidedAt?.toISOString(),
        dueAt: s.dueAt?.toISOString(),
        overdue: s.status === 'pending' && Boolean(s.dueAt && s.dueAt.getTime() < now),
      })),
      history: d.history.map((h) => ({
        at: h.at.toISOString(),
        by: h.by ? (u.get(h.by.toString()) ?? null) : null,
        action: h.action,
        comment: h.comment ?? undefined,
      })),
      can: {
        act:
          Boolean(current?.approverIds.some((a) => a.equals(auth.userObjectId))) &&
          can(auth, 'approval:act'),
        cancel: d.status === 'pending' && d.requestedBy.equals(auth.userObjectId),
      },
      createdAt: d.createdAt.toISOString(),
      decidedAt: d.decidedAt?.toISOString(),
    };
  });
}

/* ============================ Queries ============================ */

async function visibleFilter(auth: AuthContext): Promise<Record<string, unknown>> {
  const mine = [{ requestedBy: auth.userObjectId }, { 'stages.approverIds': auth.userObjectId }];
  if (!can(auth, 'approval:act', 'project')) return { $or: mine };
  const projects = await readableProjectIds(auth);
  return projects === 'all' ? {} : { $or: [...mine, { projectId: { $in: projects } }] };
}

export async function listApprovals(
  rc: RequestContext,
  raw: ApprovalQuery,
): Promise<{ items: ApprovalDto[]; meta: PageMeta }> {
  const auth = requireAuth(rc);
  const q = approvalQuerySchema.parse(raw);
  const and: Record<string, unknown>[] = [];
  if (q.box === 'inbox') and.push({ status: 'pending', pendingApproverIds: auth.userObjectId });
  else if (q.box === 'mine') and.push({ requestedBy: auth.userObjectId });
  else and.push(await visibleFilter(auth));
  if (q.status) and.push({ status: q.status });
  if (q.projectId) and.push({ projectId: oid(q.projectId) });
  const filter = { $and: and };
  const win = toPageWindow(q, ['createdAt'], { createdAt: -1, _id: -1 });
  const [docs, total] = await Promise.all([
    Approval.find(filter).sort(win.sort).skip(win.skip).limit(win.limit).lean(),
    Approval.countDocuments(filter),
  ]);
  return { items: await present(auth, docs), meta: toPageMeta(q, total) };
}

async function loadVisible(auth: AuthContext, id: string): Promise<IApproval> {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Approval');
  const doc = await Approval.findOne({
    $and: [{ _id: oid(id) }, await visibleFilter(auth)],
  }).lean();
  if (!doc) throw new NotFoundError('Approval');
  return doc;
}

export async function getApproval(rc: RequestContext, id: string): Promise<ApprovalDto> {
  const auth = requireAuth(rc);
  return (await present(auth, [await loadVisible(auth, id)]))[0]!;
}

/* ============================ Commands ============================ */

export async function createApproval(
  rc: RequestContext,
  raw: CreateApprovalInput,
): Promise<ApprovalDto> {
  const auth = requireAuth(rc);
  const input = createApprovalSchema.parse(raw);
  const project = await loadReadableProject(auth, input.projectId);
  if (project.archived) throw new UnprocessableError('This project is archived');
  if (input.entityType === 'project_closure') {
    if (!canUpdateProject(auth, project))
      throw new ForbiddenError('Only the project manager can request closure');
    if (project.status === 'completed' || project.status === 'cancelled')
      throw new UnprocessableError(`The project is already ${project.status}`);
    if (
      await Approval.exists({
        projectId: project._id,
        entityType: 'project_closure',
        status: 'pending',
      })
    )
      throw new ConflictError('A closure request for this project is already pending');
  } else if (!isProjectParticipant(project, auth.userId) && !canUpdateProject(auth, project)) {
    throw new ForbiddenError('Only people on the project can raise requests for it');
  }

  const created = await startApproval(rc, project, {
    entityType: input.entityType,
    title: input.title,
    description: input.description ?? null,
    amount: input.amount ?? null,
    entityId: null,
  });
  return getApproval(rc, created._id.toString());
}

/**
 * Starts a request: snapshots the workflow's stages, resolves the first stage with an
 * eligible approver, records and notifies. Throws 422 when nobody can approve.
 */
async function startApproval(
  rc: RequestContext,
  project: IProject,
  input: {
    entityType: ApprovalEntityType;
    title: string;
    description: string | null;
    amount: number | null;
    entityId: Types.ObjectId | null;
  },
): Promise<IApproval> {
  const auth = requireAuth(rc);
  const workflow = await workflowFor(input.entityType);
  const now = new Date();
  const doc = {
    stages: workflow!.stages.map<IApprovalStage>((st) => ({
      name: st.name,
      approverType: st.approverType,
      roleKey: st.roleKey ?? null,
      userIds: (st.userIds ?? []).map(oid),
      slaHours: st.slaHours,
      fallbackOnly: st.fallbackOnly ?? false,
      status: 'waiting',
      approverIds: [],
    })),
    requestedBy: auth.userObjectId,
  };
  let current = await advance(doc, project, 0, now);
  if (current < 0) {
    // Nobody could approve: try again letting a department head stage reach the directors.
    for (const st of doc.stages) Object.assign(st, { status: 'waiting', note: null });
    current = await advance(doc, project, 0, now, true);
  }
  if (current < 0)
    throw new UnprocessableError(
      'Nobody is eligible to approve this request. Ask an administrator to review the approval workflow.',
    );
  const created = await Approval.create({
    key: await nextKey('APR'),
    entityType: input.entityType,
    projectId: project._id,
    entityId: input.entityId,
    title: input.title,
    description: input.description,
    amount: input.amount,
    requestedBy: auth.userObjectId,
    currentStage: current,
    stages: doc.stages,
    pendingApproverIds: doc.stages[current]!.approverIds,
    history: [{ at: now, by: auth.userObjectId, action: 'submitted' }],
  });
  await recordAudit(rc, {
    action: 'approval.requested',
    entityType: 'approval',
    entityId: created._id,
    summary: `Requested ${APPROVAL_ENTITY_LABELS[input.entityType].toLowerCase()} ${created.key} on ${project.key}: ${input.title}`,
  });
  await notify(doc.stages[current]!.approverIds, {
    type: 'approval_requested',
    title: `${created.key} needs your approval: ${input.title}`,
    body: `${APPROVAL_ENTITY_LABELS[input.entityType]} for ${project.key} ${project.name} (stage: ${doc.stages[current]!.name})`,
    link: link(created._id),
    actorId: auth.userId,
  });
  return created.toObject();
}

/**
 * Used by modules (documents, releases, change requests) to route one of their records
 * through approval. At most one pending request per record.
 */
export async function requestApproval(
  rc: RequestContext,
  project: IProject,
  input: {
    entityType: ApprovalEntityType;
    entityId: Types.ObjectId;
    title: string;
    description?: string | null;
    amount?: number | null;
  },
): Promise<ApprovalDto> {
  if (
    await Approval.exists({
      entityType: input.entityType,
      entityId: input.entityId,
      status: 'pending',
    })
  )
    throw new ConflictError('An approval for this is already pending');
  const created = await startApproval(rc, project, {
    entityType: input.entityType,
    entityId: input.entityId,
    title: input.title,
    description: input.description ?? null,
    amount: input.amount ?? null,
  });
  return getApproval(rc, created._id.toString());
}

/** Latest request for a record (any status), for module screens. */
export async function latestApprovalFor(
  rc: RequestContext,
  entityType: ApprovalEntityType,
  entityId: Types.ObjectId,
): Promise<ApprovalDto | null> {
  const auth = requireAuth(rc);
  const doc = await Approval.findOne({ entityType, entityId }).sort({ createdAt: -1 }).lean();
  return doc ? (await present(auth, [doc]))[0]! : null;
}

/** Loads a pending request the caller may decide right now. */
async function loadActionable(auth: AuthContext, id: string): Promise<IApproval> {
  const doc = await loadVisible(auth, id);
  if (doc.status !== 'pending') throw new ConflictError(`This request is already ${doc.status}`);
  const stage = doc.stages[doc.currentStage]!;
  if (!stage.approverIds.some((a) => a.equals(auth.userObjectId)) || !can(auth, 'approval:act'))
    throw new ForbiddenError('You are not an approver for the current stage');
  return doc;
}

/** Writes the new state only if nobody acted in between (optimistic `version`). */
async function save(
  doc: IApproval,
  set: Record<string, unknown>,
  entry: IApproval['history'][number],
): Promise<IApproval> {
  const updated = await Approval.findOneAndUpdate(
    { _id: doc._id, version: doc.version, status: 'pending' },
    { $set: set, $inc: { version: 1 }, $push: { history: entry } },
    { returnDocument: 'after' },
  ).lean();
  if (!updated)
    throw new ConflictError(
      'Someone else acted on this request first. Reload to see its current state.',
    );
  return updated;
}

export async function approve(rc: RequestContext, id: string, raw: unknown): Promise<ApprovalDto> {
  const auth = requireAuth(rc);
  const { comment } = approvalDecisionSchema.parse(raw ?? {});
  const doc = await loadActionable(auth, id);
  const project = await Project.findById(doc.projectId).lean();
  if (!project) throw new NotFoundError('Approval');
  const now = new Date();
  const stage = doc.stages[doc.currentStage]!;
  Object.assign(stage, {
    status: 'approved',
    decidedBy: auth.userObjectId,
    decidedAt: now,
    comment: comment ?? null,
  });
  const next = await advance(doc, project, doc.currentStage + 1, now);
  const finished = next < 0;
  const updated = await save(
    doc,
    {
      stages: doc.stages,
      currentStage: finished ? doc.currentStage : next,
      pendingApproverIds: finished ? [] : doc.stages[next]!.approverIds,
      ...(finished ? { status: 'approved', decidedAt: now } : {}),
    },
    {
      at: now,
      by: auth.userObjectId,
      action: `approved stage "${stage.name}"`,
      comment: comment ?? null,
    },
  );
  await recordAudit(rc, {
    action: finished ? 'approval.approved' : 'approval.stage_approved',
    entityType: 'approval',
    entityId: doc._id,
    summary: `${finished ? 'Approved' : `Approved stage "${stage.name}" of`} ${doc.key}${comment ? `: ${comment}` : ''}`,
  });
  if (finished) {
    await effects.get(doc.entityType)?.(rc, updated);
    await notify([doc.requestedBy], {
      type: 'approval_decided',
      title: `${doc.key} was approved: ${doc.title}`,
      body: comment ? `Comment: ${comment}` : undefined,
      link: link(doc._id),
      actorId: auth.userId,
    });
  } else {
    await notify(doc.stages[next]!.approverIds, {
      type: 'approval_requested',
      title: `${doc.key} needs your approval: ${doc.title}`,
      body: `Stage "${doc.stages[next]!.name}" (previous stage approved)`,
      link: link(doc._id),
      actorId: auth.userId,
    });
  }
  return getApproval(rc, id);
}

export async function reject(rc: RequestContext, id: string, raw: unknown): Promise<ApprovalDto> {
  const auth = requireAuth(rc);
  const { comment } = approvalRejectSchema.parse(raw);
  const doc = await loadActionable(auth, id);
  const now = new Date();
  const stage = doc.stages[doc.currentStage]!;
  Object.assign(stage, {
    status: 'rejected',
    decidedBy: auth.userObjectId,
    decidedAt: now,
    comment,
  });
  await save(
    doc,
    { stages: doc.stages, status: 'rejected', decidedAt: now, pendingApproverIds: [] },
    { at: now, by: auth.userObjectId, action: `rejected at stage "${stage.name}"`, comment },
  );
  await closedEffects.get(doc.entityType)?.(rc, doc, 'rejected');
  await recordAudit(rc, {
    action: 'approval.rejected',
    entityType: 'approval',
    entityId: doc._id,
    summary: `Rejected ${doc.key}: ${comment}`,
  });
  await notify([doc.requestedBy], {
    type: 'approval_decided',
    title: `${doc.key} was rejected: ${doc.title}`,
    body: `Reason: ${comment}`,
    link: link(doc._id),
    actorId: auth.userId,
  });
  return getApproval(rc, id);
}

/** Hands the caller's place in the current stage to someone else with approval rights. */
export async function delegate(rc: RequestContext, id: string, raw: unknown): Promise<ApprovalDto> {
  const auth = requireAuth(rc);
  const { toUserId, comment } = approvalDelegateSchema.parse(raw);
  const doc = await loadActionable(auth, id);
  const target = oid(toUserId);
  if (target.equals(doc.requestedBy))
    throw new UnprocessableError('A request cannot be delegated to its requester');
  if (target.equals(auth.userObjectId)) throw new UnprocessableError('Choose someone else');
  if (!(await withApprovalRights([target])).length)
    throw new UnprocessableError('That person cannot approve requests');
  const stage = doc.stages[doc.currentStage]!;
  stage.approverIds = [
    ...stage.approverIds.filter((a) => !a.equals(auth.userObjectId) && !a.equals(target)),
    target,
  ];
  const targetUser = await User.findById(target).select('name').lean();
  await save(
    doc,
    { stages: doc.stages, pendingApproverIds: stage.approverIds },
    {
      at: new Date(),
      by: auth.userObjectId,
      action: `delegated to ${targetUser?.name ?? 'a colleague'}`,
      comment: comment ?? null,
    },
  );
  await recordAudit(rc, {
    action: 'approval.delegated',
    entityType: 'approval',
    entityId: doc._id,
    summary: `Delegated ${doc.key} to ${targetUser?.name}`,
  });
  await notify([target], {
    type: 'approval_requested',
    title: `${doc.key} was delegated to you: ${doc.title}`,
    body: comment,
    link: link(doc._id),
    actorId: auth.userId,
  });
  return getApproval(rc, id);
}

export async function cancel(rc: RequestContext, id: string): Promise<ApprovalDto> {
  const auth = requireAuth(rc);
  const doc = await loadVisible(auth, id);
  if (!doc.requestedBy.equals(auth.userObjectId))
    throw new ForbiddenError('Only the requester can withdraw a request');
  if (doc.status !== 'pending') throw new ConflictError(`This request is already ${doc.status}`);
  await save(
    doc,
    { status: 'cancelled', decidedAt: new Date(), pendingApproverIds: [] },
    { at: new Date(), by: auth.userObjectId, action: 'withdrawn' },
  );
  await closedEffects.get(doc.entityType)?.(rc, doc, 'cancelled');
  await recordAudit(rc, {
    action: 'approval.cancelled',
    entityType: 'approval',
    entityId: doc._id,
    summary: `Withdrew ${doc.key}`,
  });
  return getApproval(rc, id);
}

/** Hourly (worker): one reminder per stage once its deadline has passed. */
export async function sendApprovalReminders(now = new Date()): Promise<number> {
  const due = await Approval.find({ status: 'pending', 'stages.dueAt': { $lte: now } }).lean();
  let sent = 0;
  for (const a of due) {
    const s = a.stages[a.currentStage];
    if (!s?.dueAt || s.dueAt > now || s.remindedAt) continue;
    const claimed = await Approval.updateOne(
      { _id: a._id, version: a.version, currentStage: a.currentStage },
      { $set: { [`stages.${a.currentStage}.remindedAt`]: now } },
    );
    if (!claimed.modifiedCount) continue;
    sent += await notify(s.approverIds, {
      type: 'approval_reminder',
      title: `Overdue: ${a.key} is waiting for your decision`,
      body: `${a.title} (stage "${s.name}" was due ${s.dueAt.toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
      link: link(a._id),
    });
  }
  return sent;
}
