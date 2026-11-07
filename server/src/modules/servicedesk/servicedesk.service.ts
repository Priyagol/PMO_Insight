import mongoose, { Schema, Types, type QueryFilter } from 'mongoose';
import {
  PRIORITIES,
  REQUEST_KINDS,
  REQUEST_KIND_LABELS,
  STATUS_LABELS,
  requestTypeSchema,
  serviceDeskSettingsSchema,
  submitRequestSchema,
  validateAnswers,
  type AnswerValue,
  type FormField,
  type QueueView,
  type RequestCommentDto,
  type RequestTypeDto,
  type RequestTypeInput,
  type ServiceDeskReportDto,
  type ServiceDeskSettingsDto,
  type ServiceRequestDto,
  type SlaClockDto,
  type SubmitRequestInput,
  type TaskStatus,
} from '@arihant/shared';
import { eventBus } from '../../core/events';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../../core/errors';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { canUpdateProject, isProjectParticipant } from '../../core/rbac/work-access';
import { recordActivity } from '../collab/activity.service';
import { Comment } from '../collab/collab.models';
import { notify } from '../notifications/notification.service';
import { loadReadableProject } from '../projects/project.service';
import { Project, type IProject } from '../projects/project.model';
import { Task, type ITask } from '../tasks/task.model';
import { createTaskRecord, loadTask } from '../tasks/task.service';
import { User } from '../users/user.model';
import { recordTransition, workflowOf } from '../workflows/workflow.service';
import { requestApproval } from '../approvals/approval.service';

/* ============================ Request types ============================ */

interface IRequestType {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  name: string;
  description: string | null;
  kind: (typeof REQUEST_KINDS)[number];
  fields: FormField[];
  defaultPriority: (typeof PRIORITIES)[number];
  requesterSetsPriority: boolean;
  sla: { responseHours: number; resolutionHours: number } | null;
  approvalRequired: boolean;
  helpLinks: { title: string; url: string }[];
  active: boolean;
  createdAt: Date;
}
const requestTypeModelSchema = new Schema<IRequestType>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true, maxlength: 80 },
    description: { type: String, default: null, maxlength: 500 },
    kind: { type: String, enum: REQUEST_KINDS, default: 'service_request' },
    // Validated with the shared schema before every write.
    fields: { type: Schema.Types.Mixed, default: [] },
    defaultPriority: { type: String, enum: PRIORITIES, default: 'medium' },
    requesterSetsPriority: { type: Boolean, default: false },
    sla: { type: Schema.Types.Mixed, default: null },
    approvalRequired: { type: Boolean, default: false },
    helpLinks: { type: Schema.Types.Mixed, default: [] },
    active: { type: Boolean, default: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'requestTypes',
    minimize: false,
  },
);
requestTypeModelSchema.index({ projectId: 1, name: 1 }, { unique: true });
export const RequestType =
  (mongoose.models.RequestType as mongoose.Model<IRequestType> | undefined) ??
  mongoose.model<IRequestType>('RequestType', requestTypeModelSchema);

const projectRef = (p: Pick<IProject, '_id' | 'key' | 'name'>) => ({
  id: p._id.toString(),
  key: p.key,
  name: p.name,
});

function presentType(t: IRequestType, p: Pick<IProject, '_id' | 'key' | 'name'>): RequestTypeDto {
  return {
    id: t._id.toString(),
    project: projectRef(p),
    name: t.name,
    description: t.description,
    kind: t.kind,
    fields: t.fields,
    defaultPriority: t.defaultPriority,
    requesterSetsPriority: t.requesterSetsPriority,
    sla: t.sla,
    approvalRequired: t.approvalRequired,
    helpLinks: t.helpLinks,
    active: t.active,
  };
}

async function manageableProject(auth: AuthContext, projectId: string): Promise<IProject> {
  const project = await loadReadableProject(auth, projectId);
  if (!canUpdateProject(auth, project))
    throw new ForbiddenError('Only the project manager can change the service desk');
  return project;
}

export async function getSettings(
  rc: RequestContext,
  projectId: string,
): Promise<ServiceDeskSettingsDto> {
  const auth = requireAuth(rc);
  const project = await loadReadableProject(auth, projectId);
  const sd = project.serviceDesk;
  const agents = await User.find({ _id: { $in: sd?.agentIds ?? [] } })
    .select('name')
    .lean();
  return {
    enabled: Boolean(sd?.enabled),
    agents: agents.map((a) => ({ id: a._id.toString(), name: a.name })),
    autoAssign: sd?.autoAssign ?? 'none',
    canEdit: canUpdateProject(auth, project),
  };
}

export async function saveSettings(
  rc: RequestContext,
  projectId: string,
  raw: unknown,
): Promise<ServiceDeskSettingsDto> {
  const auth = requireAuth(rc);
  const project = await manageableProject(auth, projectId);
  const input = serviceDeskSettingsSchema.parse(raw);
  const notMembers = input.agentIds.filter((id) => !isProjectParticipant(project, id));
  if (notMembers.length) throw new UnprocessableError('Agents must be members of the project');
  await Project.updateOne(
    { _id: project._id },
    {
      $set: {
        serviceDesk: {
          enabled: input.enabled,
          agentIds: input.agentIds.map((id) => new Types.ObjectId(id)),
          autoAssign: input.autoAssign,
          nextAgent: project.serviceDesk?.nextAgent ?? 0,
        },
      },
    },
  );
  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: `${project.key} ${project.name}`,
    verb: 'updated',
    summary: `${input.enabled ? 'turned on' : 'turned off'} the service desk`,
  });
  return getSettings(rc, projectId);
}

export async function listRequestTypes(
  rc: RequestContext,
  projectId: string,
): Promise<RequestTypeDto[]> {
  const auth = requireAuth(rc);
  const project = await loadReadableProject(auth, projectId);
  const rows = await RequestType.find({ projectId: project._id }).sort({ name: 1 }).lean();
  return rows.map((t) => presentType(t, project));
}

export async function createRequestType(
  rc: RequestContext,
  projectId: string,
  raw: RequestTypeInput,
): Promise<RequestTypeDto> {
  const auth = requireAuth(rc);
  const project = await manageableProject(auth, projectId);
  const input = requestTypeSchema.parse(raw);
  try {
    const t = await RequestType.create({
      ...input,
      description: input.description ?? null,
      projectId: project._id,
    });
    return presentType(t.toObject(), project);
  } catch (e) {
    if ((e as { code?: number }).code === 11000)
      throw new UnprocessableError('A request type with this name already exists');
    throw e;
  }
}

export async function updateRequestType(
  rc: RequestContext,
  id: string,
  raw: RequestTypeInput,
): Promise<RequestTypeDto> {
  const auth = requireAuth(rc);
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Request type');
  const t = await RequestType.findById(id).lean();
  if (!t) throw new NotFoundError('Request type');
  const project = await manageableProject(auth, t.projectId.toString());
  const input = requestTypeSchema.parse(raw);
  const next = await RequestType.findByIdAndUpdate(
    t._id,
    { $set: { ...input, description: input.description ?? null } },
    { returnDocument: 'after' },
  ).lean();
  return presentType(next!, project);
}

/* ============================ Help centre ============================ */

/** Every active request type of every service desk, for anyone in the organisation. */
export async function portal(rc: RequestContext): Promise<RequestTypeDto[]> {
  const auth = requireAuth(rc);
  if (auth.roleKeys.includes('external_stakeholder')) return [];
  const projects = await Project.find({
    'serviceDesk.enabled': true,
    archived: false,
    confidential: { $ne: true },
  })
    .select('key name')
    .lean();
  const types = await RequestType.find({
    projectId: { $in: projects.map((p) => p._id) },
    active: true,
  })
    .sort({ name: 1 })
    .lean();
  return types.map((t) =>
    presentType(
      t,
      projects.find((p) => p._id.equals(t.projectId))!,
    ),
  );
}

const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);

function describeAnswers(fields: FormField[], answers: Record<string, AnswerValue>): string {
  const lines = fields
    .filter((f) => answers[f.key] !== undefined)
    .map((f) => {
      const v = answers[f.key];
      return `- **${f.label}:** ${v === null ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}`;
    });
  return lines.join('\n');
}

/** Raises a request through the help centre. */
export async function submitRequest(
  rc: RequestContext,
  raw: SubmitRequestInput,
): Promise<ServiceRequestDto> {
  const auth = requireAuth(rc);
  if (auth.roleKeys.includes('external_stakeholder'))
    throw new ForbiddenError('External stakeholders use the stakeholder portal');
  const input = submitRequestSchema.parse(raw);
  const type = await RequestType.findById(input.requestTypeId).lean();
  if (!type || !type.active) throw new NotFoundError('Request type');
  const project = await Project.findById(type.projectId).lean();
  if (!project?.serviceDesk?.enabled || project.archived || project.confidential)
    throw new NotFoundError('Request type');
  const check = validateAnswers(type.fields, input.answers);
  if (!check.ok)
    throw new UnprocessableError('Some answers need attention', { fields: check.errors });
  const priority =
    type.requesterSetsPriority && input.priority ? input.priority : type.defaultPriority;
  const { def } = await workflowOf(project);
  const initial = type.approvalRequired && def.statuses.includes('backlog') ? 'backlog' : 'todo';

  // Round robin across the agents (atomic, so parallel requests get different people).
  let assigneeId: string | undefined;
  const sd = project.serviceDesk;
  if (sd.autoAssign === 'round_robin') {
    const pool = (sd.agentIds.length ? sd.agentIds : project.members.map((m) => m.userId)).map(
      String,
    );
    const active = (
      await User.find({ _id: { $in: pool }, status: 'active' })
        .select('_id')
        .lean()
    ).map((u) => u._id.toString());
    const ordered = pool.filter((p) => active.includes(p));
    if (ordered.length) {
      const updated = await Project.findOneAndUpdate(
        { _id: project._id },
        { $inc: { 'serviceDesk.nextAgent': 1 } },
        { returnDocument: 'before' },
      ).lean();
      assigneeId = ordered[(updated?.serviceDesk?.nextAgent ?? 0) % ordered.length];
    }
  }

  const task = await createTaskRecord(
    rc,
    {
      projectId: project._id.toString(),
      title: input.summary,
      description: `${REQUEST_KIND_LABELS[type.kind]} via the help centre: **${type.name}**\n\n${describeAnswers(type.fields, check.answers)}`,
      priority,
      status: initial,
      assigneeId,
      tags: [type.kind === 'service_request' ? 'request' : type.kind],
    },
    { serviceRequest: true },
  );
  const now = task.createdAt;
  // The requester follows the request in the help centre, not as reporter or watcher of the
  // task: that keeps the team's internal comments and activity away from them.
  await Task.updateOne(
    { _id: task._id },
    {
      $pull: { watcherIds: auth.userObjectId },
      $set: {
        reporterId: project.managerId,
        serviceRequest: {
          requestTypeId: type._id,
          kind: type.kind,
          requesterId: auth.userObjectId,
          answers: check.answers,
          responseDueAt: type.sla ? addHours(now, type.sla.responseHours) : null,
          resolutionDueAt: type.sla ? addHours(now, type.sla.resolutionHours) : null,
          firstResponseAt: null,
          awaitingApproval: type.approvalRequired,
          alerts: [],
          feedback: null,
        },
      },
    },
  );
  if (type.approvalRequired) {
    await requestApproval(rc, project, {
      entityType: 'service_request',
      entityId: task._id,
      title: `${task.key}: ${type.name} – ${input.summary}`.slice(0, 200),
      description: describeAnswers(type.fields, check.answers),
    });
  }
  const agents = sd.agentIds.length ? sd.agentIds : [project.managerId];
  const major = type.kind === 'incident' && priority === 'critical';
  await notify(assigneeId ? [new Types.ObjectId(assigneeId)] : agents, {
    type: 'task_assigned',
    title: `${major ? 'Major incident' : 'New request'} ${task.key}: ${input.summary}`,
    body: `${type.name} from ${auth.name}`,
    link: `/projects/${project._id.toString()}?tab=service-desk&task=${task._id.toString()}`,
    actorId: auth.userId,
  });
  if (major)
    await notify([project.managerId, ...agents], {
      type: 'risk_alert',
      title: `Major incident ${task.key}: ${input.summary}`,
      body: `Raised by ${auth.name}`,
      link: `/projects/${project._id.toString()}?tab=service-desk&task=${task._id.toString()}`,
      actorId: auth.userId,
    });
  return (await presentRequests([(await Task.findById(task._id).lean())!]))[0]!;
}

/* ============================ Presentation and SLA ============================ */

function clock(
  due: Date | null | undefined,
  doneAt: Date | null | undefined,
  totalHours: number | undefined,
  now: Date,
): SlaClockDto | null {
  if (!due) return null;
  if (doneAt)
    return {
      dueAt: due.toISOString(),
      doneAt: doneAt.toISOString(),
      state: doneAt <= due ? 'met' : 'missed',
    };
  if (now > due) return { dueAt: due.toISOString(), doneAt: null, state: 'breached' };
  const left = due.getTime() - now.getTime();
  const total = (totalHours ?? 1) * 3_600_000;
  return {
    dueAt: due.toISOString(),
    doneAt: null,
    state: left <= total * 0.25 ? 'at_risk' : 'running',
  };
}

async function presentRequests(tasks: ITask[], now = new Date()): Promise<ServiceRequestDto[]> {
  const isId = (x: Types.ObjectId | null | undefined): x is Types.ObjectId => Boolean(x);
  const typeIds = tasks.map((t) => t.serviceRequest?.requestTypeId).filter(isId);
  const [types, users, projects] = await Promise.all([
    RequestType.find({ _id: { $in: typeIds } }).lean(),
    User.find({
      _id: {
        $in: tasks.flatMap((t) => [t.assigneeId, t.serviceRequest?.requesterId]).filter(isId),
      },
    })
      .select('name')
      .lean(),
    Project.find({ _id: { $in: tasks.map((t) => t.projectId) } })
      .select('key name workflowId')
      .lean(),
  ]);
  const name = (id?: Types.ObjectId | null) => {
    const u = id ? users.find((x) => x._id.equals(id)) : null;
    return u ? { id: u._id.toString(), name: u.name } : null;
  };
  const out: ServiceRequestDto[] = [];
  for (const t of tasks) {
    const sr = t.serviceRequest!;
    const type = types.find((x) => x._id.equals(sr.requestTypeId));
    const project = projects.find((p) => p._id.equals(t.projectId))!;
    const labels = (await workflowOf(project as IProject)).def.labels;
    const resolvedAt =
      t.status === 'done' || t.status === 'cancelled' ? (t.completedAt ?? t.updatedAt) : null;
    out.push({
      id: t._id.toString(),
      key: t.key,
      summary: t.title,
      kind: sr.kind,
      requestType: type ? { id: type._id.toString(), name: type.name } : null,
      project: projectRef(project),
      status: t.status,
      statusLabel: labels[t.status] ?? STATUS_LABELS[t.status],
      priority: t.priority,
      requester: name(sr.requesterId),
      assignee: name(t.assigneeId),
      answers: (type?.fields ?? [])
        .filter((f) => sr.answers[f.key] !== undefined)
        .map((f) => ({ key: f.key, label: f.label, value: sr.answers[f.key]! })),
      sla: {
        response: clock(
          sr.responseDueAt,
          sr.firstResponseAt ?? resolvedAt,
          type?.sla?.responseHours,
          now,
        ),
        resolution: clock(sr.resolutionDueAt, resolvedAt, type?.sla?.resolutionHours, now),
      },
      awaitingApproval: sr.awaitingApproval,
      feedback: sr.feedback ? { rating: sr.feedback.rating, comment: sr.feedback.comment } : null,
      createdAt: t.createdAt.toISOString(),
      resolvedAt: resolvedAt?.toISOString() ?? null,
    });
  }
  return out;
}

/* ============================ Requesters ============================ */

export async function myRequests(rc: RequestContext): Promise<ServiceRequestDto[]> {
  const auth = requireAuth(rc);
  const rows = await Task.find({ 'serviceRequest.requesterId': auth.userObjectId, deletedAt: null })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  return presentRequests(rows);
}

/** A request the caller raised, or one they can see as a team member. */
async function loadRequest(
  auth: AuthContext,
  id: string,
): Promise<{ task: ITask; asRequester: boolean }> {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Request');
  const task = await Task.findOne({
    _id: new Types.ObjectId(id),
    deletedAt: null,
    serviceRequest: { $ne: null },
  }).lean();
  if (!task) throw new NotFoundError('Request');
  if (task.serviceRequest!.requesterId.equals(auth.userObjectId))
    return { task, asRequester: true };
  const { task: visible } = await loadTask(auth, id); // 404 unless the caller may see the task
  return { task: visible, asRequester: false };
}

export async function getRequest(rc: RequestContext, id: string): Promise<ServiceRequestDto> {
  const { task } = await loadRequest(requireAuth(rc), id);
  return (await presentRequests([task]))[0]!;
}

/** The conversation with the requester: their messages and the team's replies (not internal comments). */
export async function requestComments(
  rc: RequestContext,
  id: string,
): Promise<RequestCommentDto[]> {
  const { task } = await loadRequest(requireAuth(rc), id);
  const requesterId = task.serviceRequest!.requesterId;
  const rows = await Comment.find({
    entityId: task._id,
    deletedAt: null,
    $or: [{ authorId: requesterId }, { visibleToRequester: true }],
  })
    .sort({ createdAt: 1 })
    .limit(500)
    .lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.authorId) } })
    .select('name')
    .lean();
  return rows.map((c) => {
    const u = users.find((x) => x._id.equals(c.authorId));
    return {
      id: c._id.toString(),
      author: u ? { id: u._id.toString(), name: u.name } : null,
      fromTeam: !c.authorId.equals(requesterId),
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    };
  });
}

/** Requester message, or a team reply visible to the requester (counts as the first response). */
export async function addRequestComment(
  rc: RequestContext,
  id: string,
  body: string,
): Promise<RequestCommentDto[]> {
  const auth = requireAuth(rc);
  const { task, asRequester } = await loadRequest(auth, id);
  const project = await Project.findById(task.projectId).lean();
  if (!project || project.archived) throw new UnprocessableError('This project is archived');
  await Comment.create({
    entityType: 'task',
    entityId: task._id,
    projectId: task.projectId,
    authorId: auth.userObjectId,
    body,
    mentions: [],
    parentId: null,
    visibleToRequester: true,
  });
  await recordActivity(rc, {
    projectId: task.projectId,
    entityType: 'task',
    entityId: task._id,
    entityLabel: `${task.key} ${task.title}`,
    verb: 'commented',
    summary: asRequester
      ? `the requester replied on ${task.key}`
      : `replied to the requester on ${task.key}`,
  });
  if (asRequester) {
    await notify([task.assigneeId ?? project.managerId], {
      type: 'task_comment',
      title: `${task.key}: new message from ${auth.name}`,
      body: body.slice(0, 200),
      link: `/projects/${project._id.toString()}?tab=service-desk&task=${task._id.toString()}`,
      actorId: auth.userId,
    });
  } else {
    if (!task.serviceRequest!.firstResponseAt)
      await Task.updateOne(
        { _id: task._id },
        { $set: { 'serviceRequest.firstResponseAt': new Date() } },
      );
    await notify([task.serviceRequest!.requesterId], {
      type: 'task_comment',
      title: `Reply on your request ${task.key}`,
      body: body.slice(0, 200),
      link: `/help?request=${task._id.toString()}`,
      actorId: auth.userId,
    });
  }
  return requestComments(rc, id);
}

export async function rateRequest(
  rc: RequestContext,
  id: string,
  input: { rating: number; comment?: string },
): Promise<ServiceRequestDto> {
  const auth = requireAuth(rc);
  const { task, asRequester } = await loadRequest(auth, id);
  if (!asRequester) throw new ForbiddenError('Only the person who raised the request can rate it');
  if (task.status !== 'done') throw new UnprocessableError('Rate the request once it is resolved');
  await Task.updateOne(
    { _id: task._id },
    {
      $set: {
        'serviceRequest.feedback': {
          rating: input.rating,
          comment: input.comment ?? null,
          at: new Date(),
        },
      },
    },
  );
  return getRequest(rc, id);
}

/* ============================ Agents ============================ */

export async function queue(
  rc: RequestContext,
  projectId: string,
  view: QueueView,
): Promise<ServiceRequestDto[]> {
  const auth = requireAuth(rc);
  const project = await loadReadableProject(auth, projectId);
  const now = new Date();
  const base: QueryFilter<ITask> = {
    projectId: project._id,
    deletedAt: null,
    serviceRequest: { $ne: null },
  };
  const open = { status: { $nin: ['done', 'cancelled'] as TaskStatus[] } };
  const filter: QueryFilter<ITask> =
    view === 'resolved'
      ? { ...base, status: { $in: ['done', 'cancelled'] } }
      : view === 'unassigned'
        ? { ...base, ...open, assigneeId: null }
        : view === 'mine'
          ? { ...base, ...open, assigneeId: auth.userObjectId }
          : view === 'awaiting_approval'
            ? { ...base, ...open, 'serviceRequest.awaitingApproval': true }
            : view === 'breached'
              ? {
                  ...base,
                  ...open,
                  $or: [
                    { 'serviceRequest.resolutionDueAt': { $lt: now } },
                    {
                      'serviceRequest.firstResponseAt': null,
                      'serviceRequest.responseDueAt': { $lt: now },
                    },
                  ],
                }
              : { ...base, ...open };
  const rows = await Task.find(filter)
    .sort({ 'serviceRequest.resolutionDueAt': 1, createdAt: 1 })
    .limit(300)
    .lean();
  // Only requests the caller may see as a team member.
  const visible: ITask[] = [];
  for (const t of rows) {
    try {
      await loadTask(auth, t._id.toString());
      visible.push(t);
    } catch {
      /* not visible */
    }
  }
  const items = await presentRequests(visible, now);
  return view === 'at_risk'
    ? items.filter(
        (r) => r.sla.response?.state === 'at_risk' || r.sla.resolution?.state === 'at_risk',
      )
    : items;
}

export async function report(rc: RequestContext, projectId: string): Promise<ServiceDeskReportDto> {
  const auth = requireAuth(rc);
  const project = await loadReadableProject(auth, projectId);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const all = await Task.find({
    projectId: project._id,
    deletedAt: null,
    serviceRequest: { $ne: null },
  })
    .select('status completedAt createdAt serviceRequest')
    .lean();
  const open = all.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const resolved = all.filter(
    (t) => t.status === 'done' && t.completedAt && t.completedAt >= since,
  );
  const pct = (xs: boolean[]) =>
    xs.length ? Math.round((xs.filter(Boolean).length / xs.length) * 100) : null;
  const responses = all
    .filter(
      (t) =>
        t.serviceRequest!.responseDueAt && (t.serviceRequest!.firstResponseAt || t.completedAt),
    )
    .map(
      (t) =>
        (t.serviceRequest!.firstResponseAt ?? t.completedAt!) <= t.serviceRequest!.responseDueAt!,
    );
  const resolutions = all
    .filter((t) => t.serviceRequest!.resolutionDueAt && t.status === 'done' && t.completedAt)
    .map((t) => t.completedAt! <= t.serviceRequest!.resolutionDueAt!);
  const ratings = all
    .map((t) => t.serviceRequest!.feedback?.rating)
    .filter((r): r is number => typeof r === 'number');
  return {
    open: open.length,
    resolvedLast30: resolved.length,
    responseSlaMetPercent: pct(responses),
    resolutionSlaMetPercent: pct(resolutions),
    averageRating: ratings.length
      ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10
      : null,
    ratings: ratings.length,
    byKind: REQUEST_KINDS.map((kind) => ({
      kind,
      open: open.filter((t) => t.serviceRequest!.kind === kind).length,
    })),
  };
}

/* ============================ Background work ============================ */

/** First response also counts when the team moves the request on. */
export function registerServiceDeskSubscribers(): () => void {
  return eventBus.subscribe('task.status_changed', async (e) => {
    const p = e.payload as { taskId?: string; from?: string };
    if (!p.taskId) return;
    await Task.updateOne(
      {
        _id: new Types.ObjectId(p.taskId),
        serviceRequest: { $ne: null },
        'serviceRequest.firstResponseAt': null,
      },
      { $set: { 'serviceRequest.firstResponseAt': new Date() } },
    );
  });
}

/** Warns about SLAs about to breach and escalates breaches (each once). Run every 15 minutes. */
export async function scanSlas(now = new Date()): Promise<number> {
  const open = await Task.find({
    deletedAt: null,
    status: { $nin: ['done', 'cancelled'] },
    'serviceRequest.resolutionDueAt': { $ne: null },
  })
    .select('key title projectId assigneeId serviceRequest')
    .lean();
  let sent = 0;
  for (const t of open) {
    const sr = t.serviceRequest!;
    const type = await RequestType.findById(sr.requestTypeId).select('sla').lean();
    if (!type?.sla) continue;
    const project = await Project.findById(t.projectId).select('managerId').lean();
    const checks: { key: string; due: Date | null; done: boolean; hours: number; what: string }[] =
      [
        {
          key: 'response',
          due: sr.responseDueAt,
          done: Boolean(sr.firstResponseAt),
          hours: type.sla.responseHours,
          what: 'first response',
        },
        {
          key: 'resolution',
          due: sr.resolutionDueAt,
          done: false,
          hours: type.sla.resolutionHours,
          what: 'resolution',
        },
      ];
    for (const c of checks) {
      if (!c.due || c.done) continue;
      const state = clock(c.due, null, c.hours, now)!.state;
      const alert =
        state === 'breached' ? `${c.key}_breach` : state === 'at_risk' ? `${c.key}_risk` : null;
      if (!alert || sr.alerts.includes(alert)) continue;
      const claimed = await Task.updateOne(
        { _id: t._id, 'serviceRequest.alerts': { $ne: alert } },
        { $addToSet: { 'serviceRequest.alerts': alert } },
      );
      if (!claimed.modifiedCount) continue;
      // At risk: the assignee (or the manager). Breached: also the project manager (escalation).
      const to =
        state === 'breached'
          ? [t.assigneeId, project?.managerId]
          : [t.assigneeId ?? project?.managerId];
      await notify(to, {
        type: 'risk_alert',
        title: `${t.key}: ${c.what} SLA ${state === 'breached' ? 'breached' : 'due soon'}`,
        body: `${t.title} — due ${c.due.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
        link: `/projects/${t.projectId.toString()}?tab=service-desk&task=${t._id.toString()}`,
      });
      sent += 1;
    }
  }
  return sent;
}

/** What happens when a request that needed approval is decided. */
export async function onRequestApproval(
  rc: RequestContext,
  taskId: Types.ObjectId,
  approved: boolean,
): Promise<void> {
  const task = await Task.findById(taskId).lean();
  if (!task?.serviceRequest?.awaitingApproval) return;
  const to = approved ? 'todo' : 'cancelled';
  await Task.updateOne(
    { _id: task._id },
    {
      $set: {
        'serviceRequest.awaitingApproval': false,
        status: to,
        ...(to === 'cancelled' ? { completedAt: new Date() } : {}),
      },
    },
  );
  await recordTransition(rc, {
    task,
    from: task.status,
    to,
    transition: approved ? 'Approved' : 'Rejected',
    via: 'approval',
  });
  await notify([task.serviceRequest.requesterId], {
    type: 'approval_decided',
    title: `Your request ${task.key} was ${approved ? 'approved' : 'not approved'}`,
    body: task.title,
    link: `/help?request=${task._id.toString()}`,
  });
}
