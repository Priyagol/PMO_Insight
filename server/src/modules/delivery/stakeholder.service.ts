import { Types } from 'mongoose';
import {
  changeRequestQuerySchema,
  createChangeRequestSchema,
  createFeedbackSchema,
  createStakeholderSchema,
  feedbackQuerySchema,
  stakeholderQuerySchema,
  updateChangeRequestSchema,
  updateStakeholderSchema,
  type ChangeRequestDto,
  type ChangeRequestQuery,
  type CreateChangeRequestInput,
  type CreateFeedbackInput,
  type CreateStakeholderInput,
  type FeedbackDto,
  type FeedbackQuery,
  type PageMeta,
  type StakeholderDto,
  type StakeholderQuery,
  type UpdateChangeRequestInput,
  type UpdateStakeholderInput,
  type UserRef,
} from '@arihant/shared';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../../core/errors';
import { nextKey } from '../../core/idgen';
import { escapeRegex, toPageMeta, toPageWindow } from '../../core/pagination';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { can } from '../../core/rbac/policy';
import {
  canUpdateProject,
  isProjectParticipant,
  readableProjectIds,
} from '../../core/rbac/work-access';
import { Approval } from '../approvals/approval.model';
import {
  cancel as cancelApproval,
  registerApprovalClosed,
  registerApprovalEffect,
  requestApproval,
} from '../approvals/approval.service';
import { recordAudit } from '../audit/audit.service';
import { recordActivity } from '../collab/activity.service';
import { Project, type IProject } from '../projects/project.model';
import { loadReadableProject } from '../projects/project.service';
import { Task } from '../tasks/task.model';
import { createTask } from '../tasks/task.service';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import {
  ChangeRequest,
  Feedback,
  Stakeholder,
  type IChangeRequest,
  type IStakeholder,
} from './delivery.models';
import { isExternal } from './document.service';

const oid = (id: string) => new Types.ObjectId(id);
const projRef = (p: IProject) => ({ id: p._id.toString(), key: p.key, name: p.name });

/* ============================ Stakeholders ============================ */

/** Stakeholders linked to a readable project; unlinked ones only for department/org readers. */
async function stakeholderFilter(auth: AuthContext): Promise<Record<string, unknown>> {
  const scope = auth.permissions['stakeholder:read'];
  if (!scope || isExternal(auth)) throw new ForbiddenError();
  const ids = await readableProjectIds(auth);
  if (ids === 'all') return { deletedAt: null };
  const broad = scope === 'org' || scope === 'department';
  return {
    deletedAt: null,
    $or: [{ projectIds: { $in: ids } }, ...(broad ? [{ projectIds: { $size: 0 } }] : [])],
  };
}
const canWriteStakeholders = (auth: AuthContext) =>
  can(auth, 'stakeholder:write') && !isExternal(auth);

async function assertReadableProjects(auth: AuthContext, ids: string[]): Promise<Types.ObjectId[]> {
  const unique = [...new Set(ids)];
  for (const id of unique) await loadReadableProject(auth, id);
  return unique.map(oid);
}

async function presentStakeholders(
  auth: AuthContext,
  docs: IStakeholder[],
): Promise<StakeholderDto[]> {
  const ids = docs.map((d) => d._id);
  const [projects, openCrs, ratings] = await Promise.all([
    Project.find({ _id: { $in: docs.flatMap((d) => d.projectIds) } })
      .select('key name')
      .lean(),
    ChangeRequest.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { stakeholderId: { $in: ids }, status: { $in: ['draft', 'submitted'] } } },
      { $group: { _id: '$stakeholderId', n: { $sum: 1 } } },
    ]),
    Feedback.aggregate<{ _id: Types.ObjectId; avg: number }>([
      { $match: { stakeholderId: { $in: ids } } },
      { $group: { _id: '$stakeholderId', avg: { $avg: '$rating' } } },
    ]),
  ]);
  const p = new Map(
    projects.map((x) => [x._id.toString(), { id: x._id.toString(), key: x.key, name: x.name }]),
  );
  const crs = new Map(openCrs.map((x) => [x._id.toString(), x.n]));
  const avg = new Map(ratings.map((x) => [x._id.toString(), Math.round(x.avg * 10) / 10]));
  const edit = canWriteStakeholders(auth);
  return docs.map((s) => ({
    id: s._id.toString(),
    name: s.name,
    organisation: s.organisation ?? undefined,
    role: s.role ?? undefined,
    type: s.type,
    email: s.email ?? undefined,
    phone: s.phone ?? undefined,
    influence: s.influence,
    interest: s.interest,
    projects: s.projectIds
      .map((id) => p.get(id.toString()))
      .filter((x): x is NonNullable<typeof x> => Boolean(x)),
    notes: s.notes ?? undefined,
    openChangeRequests: crs.get(s._id.toString()) ?? 0,
    averageRating: avg.get(s._id.toString()) ?? null,
    can: { edit },
    updatedAt: s.updatedAt.toISOString(),
  }));
}

async function loadStakeholder(auth: AuthContext, id: string): Promise<IStakeholder> {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Stakeholder');
  const s = await Stakeholder.findOne({
    $and: [{ _id: oid(id) }, await stakeholderFilter(auth)],
  }).lean();
  if (!s) throw new NotFoundError('Stakeholder');
  return s;
}

export async function listStakeholders(
  rc: RequestContext,
  raw: StakeholderQuery,
): Promise<{ items: StakeholderDto[]; meta: PageMeta }> {
  const auth = requireAuth(rc);
  const q = stakeholderQuerySchema.parse(raw);
  const and: Record<string, unknown>[] = [await stakeholderFilter(auth)];
  if (q.projectId) and.push({ projectIds: oid(q.projectId) });
  if (q.type) and.push({ type: q.type });
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    and.push({ $or: [{ name: rx }, { organisation: rx }, { role: rx }] });
  }
  const filter = { $and: and };
  const win = toPageWindow(q, ['name', 'updatedAt'], { name: 1, _id: 1 });
  const [docs, total] = await Promise.all([
    Stakeholder.find(filter).sort(win.sort).skip(win.skip).limit(win.limit).lean(),
    Stakeholder.countDocuments(filter),
  ]);
  return { items: await presentStakeholders(auth, docs), meta: toPageMeta(q, total) };
}

export async function createStakeholder(
  rc: RequestContext,
  raw: CreateStakeholderInput,
): Promise<StakeholderDto> {
  const auth = requireAuth(rc);
  if (!canWriteStakeholders(auth)) throw new ForbiddenError();
  const input = createStakeholderSchema.parse(raw);
  const projectIds = await assertReadableProjects(auth, input.projectIds);
  const doc = await Stakeholder.create({
    ...input,
    email: input.email?.toLowerCase() ?? null,
    projectIds,
    createdBy: auth.userObjectId,
  });
  await recordAudit(rc, {
    action: 'stakeholder.created',
    entityType: 'stakeholder',
    entityId: doc._id,
    summary: `Added stakeholder ${doc.name}${doc.organisation ? ` (${doc.organisation})` : ''}`,
  });
  return (await presentStakeholders(auth, [doc.toObject()]))[0]!;
}

export async function updateStakeholder(
  rc: RequestContext,
  id: string,
  raw: UpdateStakeholderInput,
): Promise<StakeholderDto> {
  const auth = requireAuth(rc);
  if (!canWriteStakeholders(auth)) throw new ForbiddenError();
  const input = updateStakeholderSchema.parse(raw);
  const s = await loadStakeholder(auth, id);
  const set: Record<string, unknown> = { ...input };
  if (input.email) set.email = input.email.toLowerCase();
  if (input.projectIds) set.projectIds = await assertReadableProjects(auth, input.projectIds);
  const updated = await Stakeholder.findByIdAndUpdate(
    s._id,
    { $set: set },
    { returnDocument: 'after' },
  ).lean();
  return (await presentStakeholders(auth, [updated!]))[0]!;
}

export async function deleteStakeholder(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  if (!canWriteStakeholders(auth)) throw new ForbiddenError();
  const s = await loadStakeholder(auth, id);
  await Stakeholder.updateOne({ _id: s._id }, { $set: { deletedAt: new Date() } });
  await recordAudit(rc, {
    action: 'stakeholder.deleted',
    entityType: 'stakeholder',
    entityId: s._id,
    summary: `Removed stakeholder ${s.name}`,
  });
}

/* ============================ Change requests ============================ */

const canRaiseIn = (auth: AuthContext, project: IProject) =>
  !project.archived &&
  !isExternal(auth) &&
  (isProjectParticipant(project, auth.userId) || canUpdateProject(auth, project));

async function crFilter(auth: AuthContext): Promise<Record<string, unknown>> {
  if (isExternal(auth)) throw new ForbiddenError();
  const ids = await readableProjectIds(auth);
  return ids === 'all' ? {} : { projectId: { $in: ids } };
}

async function presentCrs(auth: AuthContext, docs: IChangeRequest[]): Promise<ChangeRequestDto[]> {
  const [projects, stakeholders, users, approvals, tasks] = await Promise.all([
    Project.find({ _id: { $in: docs.map((d) => d.projectId) } }).lean(),
    Stakeholder.find({
      _id: { $in: docs.map((d) => d.stakeholderId).filter((x): x is Types.ObjectId => Boolean(x)) },
    })
      .select('name organisation')
      .lean(),
    User.find({ _id: { $in: docs.map((d) => d.raisedBy) } })
      .select('name email employeeId designation')
      .lean(),
    Approval.find({ entityType: 'change_request', entityId: { $in: docs.map((d) => d._id) } })
      .sort({ createdAt: -1 })
      .select('key status entityId')
      .lean(),
    Task.find({
      _id: {
        $in: docs.map((d) => d.implementationTaskId).filter((x): x is Types.ObjectId => Boolean(x)),
      },
    })
      .select('key')
      .lean(),
  ]);
  const p = new Map(projects.map((x) => [x._id.toString(), x as IProject]));
  const s = new Map(
    stakeholders.map((x) => [
      x._id.toString(),
      { id: x._id.toString(), name: x.name, organisation: x.organisation ?? undefined },
    ]),
  );
  const u = new Map<string, UserRef>(users.map((x) => [x._id.toString(), toUserRef(x)]));
  const a = new Map<string, { id: string; key: string; status: string }>();
  for (const x of approvals)
    if (!a.has(x.entityId!.toString()))
      a.set(x.entityId!.toString(), { id: x._id.toString(), key: x.key, status: x.status });
  const t = new Map(tasks.map((x) => [x._id.toString(), { id: x._id.toString(), key: x.key }]));
  return docs.map((d) => {
    const project = p.get(d.projectId.toString())!;
    const mine = d.raisedBy.equals(auth.userObjectId);
    const editor = mine || canUpdateProject(auth, project);
    return {
      id: d._id.toString(),
      key: d.key,
      project: projRef(project),
      stakeholder: d.stakeholderId ? (s.get(d.stakeholderId.toString()) ?? null) : null,
      title: d.title,
      description: d.description ?? undefined,
      reason: d.reason ?? undefined,
      impacts: d.impacts,
      priority: d.priority,
      estimatedHours: d.estimatedHours ?? undefined,
      costImpact: d.costImpact ?? undefined,
      scheduleImpactDays: d.scheduleImpactDays ?? undefined,
      status: d.status,
      approval: a.get(d._id.toString()) ?? null,
      implementationTask: d.implementationTaskId
        ? (t.get(d.implementationTaskId.toString()) ?? null)
        : null,
      raisedBy: u.get(d.raisedBy.toString()) ?? null,
      can: {
        edit: editor && d.status === 'draft' && !project.archived,
        submit: editor && d.status === 'draft' && !project.archived,
      },
      createdAt: d.createdAt.toISOString(),
    };
  });
}

async function loadCr(
  auth: AuthContext,
  id: string,
): Promise<{ cr: IChangeRequest; project: IProject }> {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Change request');
  const cr = await ChangeRequest.findOne({ $and: [{ _id: oid(id) }, await crFilter(auth)] }).lean();
  if (!cr) throw new NotFoundError('Change request');
  const project = await Project.findById(cr.projectId).lean();
  if (!project) throw new NotFoundError('Change request');
  return { cr, project };
}

async function assertStakeholderOnProject(
  auth: AuthContext,
  stakeholderId: string | null | undefined,
  projectId: Types.ObjectId,
) {
  if (!stakeholderId) return null;
  const s = await loadStakeholder(auth, stakeholderId);
  if (!s.projectIds.some((p) => p.equals(projectId)))
    throw new UnprocessableError('The stakeholder is not linked to this project');
  return s._id;
}

export async function listChangeRequests(
  rc: RequestContext,
  raw: ChangeRequestQuery,
): Promise<{ items: ChangeRequestDto[]; meta: PageMeta }> {
  const auth = requireAuth(rc);
  const q = changeRequestQuerySchema.parse(raw);
  const and: Record<string, unknown>[] = [await crFilter(auth)];
  if (q.projectId) and.push({ projectId: oid(q.projectId) });
  if (q.stakeholderId) and.push({ stakeholderId: oid(q.stakeholderId) });
  if (q.status) and.push({ status: q.status });
  const filter = { $and: and };
  const win = toPageWindow(q, ['createdAt'], { createdAt: -1, _id: -1 });
  const [docs, total] = await Promise.all([
    ChangeRequest.find(filter).sort(win.sort).skip(win.skip).limit(win.limit).lean(),
    ChangeRequest.countDocuments(filter),
  ]);
  return { items: await presentCrs(auth, docs), meta: toPageMeta(q, total) };
}

export async function getChangeRequest(rc: RequestContext, id: string): Promise<ChangeRequestDto> {
  const auth = requireAuth(rc);
  return (await presentCrs(auth, [(await loadCr(auth, id)).cr]))[0]!;
}

export async function createChangeRequest(
  rc: RequestContext,
  raw: CreateChangeRequestInput,
): Promise<ChangeRequestDto> {
  const auth = requireAuth(rc);
  const input = createChangeRequestSchema.parse(raw);
  const project = await loadReadableProject(auth, input.projectId);
  if (!canRaiseIn(auth, project))
    throw new ForbiddenError('Only people on the project can raise change requests');
  const stakeholderId = await assertStakeholderOnProject(auth, input.stakeholderId, project._id);
  const doc = await ChangeRequest.create({
    ...input,
    stakeholderId,
    key: await nextKey('CR'),
    projectId: project._id,
    raisedBy: auth.userObjectId,
  });
  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: `${project.key} ${project.name}`,
    verb: 'change_request',
    summary: `raised change request ${doc.key}: ${doc.title}`,
  });
  return getChangeRequest(rc, doc._id.toString());
}

export async function updateChangeRequest(
  rc: RequestContext,
  id: string,
  raw: UpdateChangeRequestInput,
): Promise<ChangeRequestDto> {
  const auth = requireAuth(rc);
  const input = updateChangeRequestSchema.parse(raw);
  const { cr, project } = await loadCr(auth, id);
  const [dto] = await presentCrs(auth, [cr]);
  if (!dto!.can.edit)
    throw new ForbiddenError('Only drafts can be edited, by their author or the project manager');
  const set: Record<string, unknown> = { ...input };
  if (input.stakeholderId !== undefined)
    set.stakeholderId = await assertStakeholderOnProject(auth, input.stakeholderId, project._id);
  await ChangeRequest.updateOne({ _id: cr._id, status: 'draft' }, { $set: set });
  return getChangeRequest(rc, id);
}

export async function submitChangeRequest(
  rc: RequestContext,
  id: string,
): Promise<ChangeRequestDto> {
  const auth = requireAuth(rc);
  const { cr, project } = await loadCr(auth, id);
  const [dto] = await presentCrs(auth, [cr]);
  if (!dto!.can.submit)
    throw new ForbiddenError(
      'Only drafts can be submitted, by their author or the project manager',
    );
  const impact = [
    cr.impacts.length ? `Impact: ${cr.impacts.join(', ')}.` : '',
    cr.estimatedHours != null ? `Effort: ${cr.estimatedHours} h.` : '',
    cr.scheduleImpactDays != null ? `Schedule: ${cr.scheduleImpactDays} day(s).` : '',
    cr.reason ? `Reason: ${cr.reason}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  await requestApproval(rc, project, {
    entityType: 'change_request',
    entityId: cr._id,
    title: `${cr.key}: ${cr.title}`,
    description: [cr.description, impact].filter(Boolean).join('\n\n') || null,
    amount: cr.costImpact ?? null,
  });
  await ChangeRequest.updateOne({ _id: cr._id }, { $set: { status: 'submitted' } });
  return getChangeRequest(rc, id);
}

/** Withdraws a draft, or a submitted request by withdrawing its approval. */
export async function withdrawChangeRequest(
  rc: RequestContext,
  id: string,
): Promise<ChangeRequestDto> {
  const auth = requireAuth(rc);
  const { cr } = await loadCr(auth, id);
  if (!cr.raisedBy.equals(auth.userObjectId))
    throw new ForbiddenError('Only the author can withdraw a change request');
  if (cr.status === 'draft')
    await ChangeRequest.updateOne({ _id: cr._id }, { $set: { status: 'withdrawn' } });
  else if (cr.status === 'submitted') {
    const pending = await Approval.findOne({
      entityType: 'change_request',
      entityId: cr._id,
      status: 'pending',
    })
      .select('_id')
      .lean();
    if (pending) await cancelApproval(rc, pending._id.toString());
    else await ChangeRequest.updateOne({ _id: cr._id }, { $set: { status: 'withdrawn' } });
  } else throw new UnprocessableError(`A ${cr.status} change request cannot be withdrawn`);
  return getChangeRequest(rc, id);
}

/** Turns an approved change request into a task in its project (once). */
export async function createImplementationTask(
  rc: RequestContext,
  id: string,
): Promise<ChangeRequestDto> {
  const auth = requireAuth(rc);
  const { cr } = await loadCr(auth, id);
  if (cr.status !== 'approved')
    throw new UnprocessableError('Only approved change requests can be scheduled');
  if (cr.implementationTaskId)
    throw new ConflictError('A task was already created for this change request');
  const claimed = await ChangeRequest.updateOne(
    { _id: cr._id, implementationTaskId: null },
    { $set: { implementationTaskId: new Types.ObjectId() } },
  );
  if (!claimed.modifiedCount)
    throw new ConflictError('A task was already created for this change request');
  try {
    const task = await createTask(rc, {
      projectId: cr.projectId.toString(),
      title: `${cr.key}: ${cr.title}`.slice(0, 200),
      description: [cr.description, `Approved change request ${cr.key}.`]
        .filter(Boolean)
        .join('\n\n'),
      priority: cr.priority,
      estimatedHours: cr.estimatedHours ?? null,
      tags: ['change-request'],
    });
    await ChangeRequest.updateOne(
      { _id: cr._id },
      { $set: { implementationTaskId: oid(task.id) } },
    );
  } catch (err) {
    await ChangeRequest.updateOne({ _id: cr._id }, { $set: { implementationTaskId: null } });
    throw err;
  }
  return getChangeRequest(rc, id);
}

export async function markImplemented(rc: RequestContext, id: string): Promise<ChangeRequestDto> {
  const auth = requireAuth(rc);
  const { cr, project } = await loadCr(auth, id);
  if (!canUpdateProject(auth, project)) throw new ForbiddenError();
  if (cr.status !== 'approved')
    throw new UnprocessableError('Only approved change requests can be marked implemented');
  await ChangeRequest.updateOne({ _id: cr._id }, { $set: { status: 'implemented' } });
  return getChangeRequest(rc, id);
}

registerApprovalEffect('change_request', async (rc, a) => {
  const cr = await ChangeRequest.findOneAndUpdate(
    { _id: a.entityId, status: 'submitted' },
    { $set: { status: 'approved' } },
    { returnDocument: 'after' },
  ).lean();
  if (cr)
    await recordActivity(rc, {
      projectId: cr.projectId,
      entityType: 'project',
      entityId: cr.projectId,
      entityLabel: cr.key,
      verb: 'change_request',
      summary: `change request ${cr.key} approved (${a.key})`,
    });
});
registerApprovalClosed('change_request', async (_rc, a, outcome) => {
  await ChangeRequest.updateOne(
    { _id: a.entityId, status: 'submitted' },
    { $set: { status: outcome === 'rejected' ? 'rejected' : 'withdrawn' } },
  );
});

/* ============================ Feedback ============================ */

export async function listFeedback(
  rc: RequestContext,
  raw: FeedbackQuery,
): Promise<{ items: FeedbackDto[]; meta: PageMeta }> {
  const auth = requireAuth(rc);
  const q = feedbackQuerySchema.parse(raw);
  const and: Record<string, unknown>[] = [await crFilter(auth)];
  if (!can(auth, 'stakeholder:read')) throw new ForbiddenError();
  if (q.projectId) and.push({ projectId: oid(q.projectId) });
  if (q.stakeholderId) and.push({ stakeholderId: oid(q.stakeholderId) });
  const filter = { $and: and };
  const win = toPageWindow(q, ['createdAt'], { createdAt: -1, _id: -1 });
  const [docs, total] = await Promise.all([
    Feedback.find(filter).sort(win.sort).skip(win.skip).limit(win.limit).lean(),
    Feedback.countDocuments(filter),
  ]);
  const [projects, stakeholders, users] = await Promise.all([
    Project.find({ _id: { $in: docs.map((d) => d.projectId) } }).lean(),
    Stakeholder.find({ _id: { $in: docs.map((d) => d.stakeholderId) } })
      .select('name organisation')
      .lean(),
    User.find({ _id: { $in: docs.map((d) => d.recordedBy) } })
      .select('name email employeeId designation')
      .lean(),
  ]);
  const p = new Map(projects.map((x) => [x._id.toString(), x as IProject]));
  const s = new Map(
    stakeholders.map((x) => [
      x._id.toString(),
      { id: x._id.toString(), name: x.name, organisation: x.organisation ?? undefined },
    ]),
  );
  const u = new Map<string, UserRef>(users.map((x) => [x._id.toString(), toUserRef(x)]));
  return {
    items: docs.map((d) => ({
      id: d._id.toString(),
      project: projRef(p.get(d.projectId.toString())!),
      stakeholder: s.get(d.stakeholderId.toString()) ?? {
        id: d.stakeholderId.toString(),
        name: 'Removed stakeholder',
      },
      rating: d.rating,
      category: d.category,
      comment: d.comment ?? undefined,
      receivedOn: d.receivedOn,
      recordedBy: u.get(d.recordedBy.toString()) ?? null,
      createdAt: d.createdAt.toISOString(),
    })),
    meta: toPageMeta(q, total),
  };
}

export async function recordFeedback(
  rc: RequestContext,
  raw: CreateFeedbackInput,
): Promise<FeedbackDto> {
  const auth = requireAuth(rc);
  if (!canWriteStakeholders(auth)) throw new ForbiddenError();
  const input = createFeedbackSchema.parse(raw);
  const project = await loadReadableProject(auth, input.projectId);
  await assertStakeholderOnProject(auth, input.stakeholderId, project._id);
  const doc = await Feedback.create({
    ...input,
    projectId: project._id,
    stakeholderId: oid(input.stakeholderId),
    recordedBy: auth.userObjectId,
  });
  const { items } = await listFeedback(rc, { projectId: project._id.toString(), limit: 100 });
  return items.find((f) => f.id === doc._id.toString())!;
}
