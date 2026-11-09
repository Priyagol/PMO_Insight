import mongoose, { Types, type QueryFilter } from 'mongoose';
import {
  DEFAULT_WORKFLOW,
  DEFAULT_TASK_EFFORT_HOURS,
  STATUS_LABELS,
  addDays,
  createProjectSchema,
  duplicateProjectSchema,
  type CreateProjectInput,
  type DuplicateProjectInput,
  type PageMeta,
  type ProjectDto,
  type ProjectListQuery,
  type ProjectMemberRole,
  type ProjectProgress,
  type ProjectVersionDto,
  type TaskStatus,
  type UpdateProjectInput,
  type UserRef,
} from '@arihant/shared';
import { projectListQuerySchema, rankBetween } from '@arihant/shared';
import { eventBus } from '../../core/events';
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
  canArchiveProject,
  canCreateTaskIn,
  canUpdateProject,
  projectScopeFilter,
} from '../../core/rbac/work-access';
import { orgToday } from '../../core/time';
import { recordAudit } from '../audit/audit.service';
import { diffFields, recordActivity } from '../collab/activity.service';
import { Department } from '../departments/department.model';
import { Task } from '../tasks/task.model';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { Milestone, ProjectTemplate } from '../planning/planning.models';
import { applyTemplate } from '../planning/template-apply';
import { TaskWorkflow } from '../workflows/workflow.models';
import { Project, ProjectVersion, type IProject } from './project.model';

const oid = (id: string) => new Types.ObjectId(id);
const VERSIONED_FIELDS = [
  'name',
  'description',
  'category',
  'departmentId',
  'managerId',
  'ownerId',
  'priority',
  'status',
  'startDate',
  'endDate',
  'estimatedHours',
  'budget',
  'objectives',
];

/* ---------- Presentation ---------- */

const EMPTY_PROGRESS: ProjectProgress = {
  totalTasks: 0,
  doneTasks: 0,
  overdueTasks: 0,
  blockedTasks: 0,
  percent: 0,
  byStatus: {},
};

/** Effort-weighted progress for many projects in one aggregation (cancelled tasks excluded). */
export async function computeProgress(
  projectIds: Types.ObjectId[],
): Promise<Map<string, ProjectProgress>> {
  const today = orgToday();
  const rows = await Task.aggregate<{
    _id: { projectId: Types.ObjectId; status: TaskStatus };
    count: number;
    effort: number;
    overdue: number;
  }>([
    {
      $match: {
        projectId: { $in: projectIds },
        deletedAt: null,
        parentId: null,
        status: { $ne: 'cancelled' },
      },
    },
    {
      $group: {
        _id: { projectId: '$projectId', status: '$status' },
        count: { $sum: 1 },
        effort: { $sum: { $ifNull: ['$estimatedHours', DEFAULT_TASK_EFFORT_HOURS] } },
        overdue: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$dueDate', null] },
                  { $lt: ['$dueDate', today] },
                  { $ne: ['$status', 'done'] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  const out = new Map<string, ProjectProgress & { _effort: number; _doneEffort: number }>();
  for (const r of rows) {
    const key = r._id.projectId.toString();
    const p = out.get(key) ?? { ...EMPTY_PROGRESS, byStatus: {}, _effort: 0, _doneEffort: 0 };
    p.totalTasks += r.count;
    p.byStatus[r._id.status] = r.count;
    p.overdueTasks += r.overdue;
    p._effort += r.effort;
    if (r._id.status === 'done') {
      p.doneTasks += r.count;
      p._doneEffort += r.effort;
    }
    if (r._id.status === 'blocked') p.blockedTasks += r.count;
    out.set(key, p);
  }
  const result = new Map<string, ProjectProgress>();
  for (const [key, { _effort, _doneEffort, ...p }] of out) {
    result.set(key, { ...p, percent: _effort > 0 ? Math.round((_doneEffort / _effort) * 100) : 0 });
  }
  return result;
}

async function present(auth: AuthContext, projects: IProject[]): Promise<ProjectDto[]> {
  const userIds = new Set<string>();
  const deptIds = new Set<string>();
  for (const p of projects) {
    userIds.add(p.managerId.toString());
    if (p.ownerId) userIds.add(p.ownerId.toString());
    if (p.hold?.byId) userIds.add(p.hold.byId.toString());
    p.members.forEach((m) => userIds.add(m.userId.toString()));
    if (p.departmentId) deptIds.add(p.departmentId.toString());
  }
  const [users, depts, progress] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } })
      .select('name email employeeId designation')
      .lean(),
    Department.find({ _id: { $in: [...deptIds] } })
      .select('name code')
      .lean(),
    computeProgress(projects.map((p) => p._id)),
  ]);
  const wfIds = projects.map((p) => p.workflowId).filter((w): w is Types.ObjectId => Boolean(w));
  const wfs = wfIds.length
    ? await TaskWorkflow.find({ _id: { $in: wfIds } })
        .select('name definition')
        .lean()
    : [];
  const workflowDto = (p: IProject): ProjectDto['workflow'] => {
    const w = p.workflowId ? wfs.find((x) => x._id.equals(p.workflowId!)) : undefined;
    return w
      ? {
          id: w._id.toString(),
          name: w.name,
          statuses: w.definition.statuses,
          labels: w.definition.labels,
        }
      : { id: null, name: 'Standard workflow', statuses: DEFAULT_WORKFLOW.statuses, labels: {} };
  };
  const userMap = new Map<string, UserRef>(users.map((u) => [u._id.toString(), toUserRef(u)]));
  const deptMap = new Map(
    depts.map((d) => [d._id.toString(), { id: d._id.toString(), name: d.name, code: d.code }]),
  );

  return projects.map((p) => {
    const canUpdate = !p.archived && canUpdateProject(auth, p);
    return {
      id: p._id.toString(),
      key: p.key,
      name: p.name,
      description: p.description,
      category: p.category,
      department: p.departmentId ? (deptMap.get(p.departmentId.toString()) ?? null) : null,
      manager: userMap.get(p.managerId.toString()) ?? null,
      owner: p.ownerId ? (userMap.get(p.ownerId.toString()) ?? null) : null,
      members: p.members
        .map((m) => ({ user: userMap.get(m.userId.toString())!, role: m.role }))
        .filter((m) => m.user),
      priority: p.priority,
      status: p.status,
      startDate: p.startDate ?? undefined,
      endDate: p.endDate ?? undefined,
      estimatedHours: p.estimatedHours ?? undefined,
      budget: p.budget ? { amount: p.budget.amount, currency: 'INR' } : undefined,
      objectives: p.objectives,
      archived: p.archived,
      autoAssign: p.autoAssign ?? false,
      customFields: p.customFields ?? [],
      dependsOnCount: p.dependsOn?.length ?? 0,
      wipLimits: Object.fromEntries(
        Object.entries(p.wipLimits ?? {}).filter(([, v]) => typeof v === 'number' && v > 0),
      ),
      components: (p.components ?? []).map((c) => c.name),
      workflow: workflowDto(p),
      confidential: p.confidential ?? false,
      hold:
        p.status === 'on_hold' && p.hold
          ? {
              reason: p.hold.reason,
              since: p.hold.since.toISOString(),
              by: userMap.get(p.hold.byId.toString()) ?? null,
              until: p.hold.until ?? undefined,
            }
          : null,
      version: p.version,
      progress: progress.get(p._id.toString()) ?? EMPTY_PROGRESS,
      can: {
        update: canUpdate,
        archive: canArchiveProject(auth, p),
        createTask: !p.archived && canCreateTaskIn(auth, p),
        manageMembers: canUpdate,
      },
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  });
}

/* ---------- Reads ---------- */

/** Loads a project the caller may read, or 404 (existence is not revealed). */
export async function loadReadableProject(auth: AuthContext, id: string): Promise<IProject> {
  const scope = auth.permissions['project:read'];
  if (!scope || !Types.ObjectId.isValid(id)) throw new NotFoundError('Project');
  const project = await Project.findOne({
    $and: [{ _id: oid(id) }, await projectScopeFilter(auth, scope)],
  }).lean();
  if (!project) throw new NotFoundError('Project');
  return project;
}

export async function listProjects(
  rc: RequestContext,
  raw: ProjectListQuery,
): Promise<{ items: ProjectDto[]; meta: PageMeta }> {
  const auth = requireAuth(rc);
  const query = projectListQuerySchema.parse(raw);
  const filters: QueryFilter<IProject>[] = [
    await projectScopeFilter(auth, auth.permissions['project:read']!),
  ];
  filters.push({ archived: query.archived === 'true' });
  if (query.status?.length) filters.push({ status: { $in: query.status } });
  if (query.departmentId) filters.push({ departmentId: oid(query.departmentId) });
  if (query.managerId) filters.push({ managerId: oid(query.managerId) });
  if (query.mine === 'true') {
    filters.push({
      $or: [
        { 'members.userId': auth.userObjectId },
        { managerId: auth.userObjectId },
        { ownerId: auth.userObjectId },
      ],
    });
  }
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filters.push({ $or: [{ name: rx }, { key: rx }, { category: rx }] });
  }
  const filter = { $and: filters };
  const win = toPageWindow(
    query,
    ['name', 'key', 'endDate', 'startDate', 'updatedAt', 'createdAt', 'status'],
    {
      updatedAt: -1,
      _id: -1,
    },
  );
  const [docs, total] = await Promise.all([
    Project.find(filter).sort(win.sort).skip(win.skip).limit(win.limit).lean(),
    Project.countDocuments(filter),
  ]);
  return { items: await present(auth, docs), meta: toPageMeta(query, total) };
}

export async function getProject(rc: RequestContext, id: string): Promise<ProjectDto> {
  const auth = requireAuth(rc);
  const [dto] = await present(auth, [await loadReadableProject(auth, id)]);
  return dto!;
}

/* ---------- Writes ---------- */

async function assertActiveUsers(ids: string[], label: string): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const count = await User.countDocuments({ _id: { $in: unique.map(oid) }, status: 'active' });
  if (count !== unique.length) throw new UnprocessableError(`${label} must be active employees`);
}

/** Ensures manager and owner are listed as members with sensible roles. */
function normalizeMembers(
  members: { userId: string; role: ProjectMemberRole }[],
  managerId: string,
  ownerId: string | null | undefined,
): { userId: Types.ObjectId; role: ProjectMemberRole }[] {
  const map = new Map<string, ProjectMemberRole>();
  for (const m of members) map.set(m.userId, m.role);
  map.set(managerId, 'manager');
  if (ownerId && !map.has(ownerId)) map.set(ownerId, 'viewer');
  return [...map].map(([userId, role]) => ({ userId: oid(userId), role }));
}

export async function createProject(
  rc: RequestContext,
  raw: CreateProjectInput,
): Promise<ProjectDto> {
  const auth = requireAuth(rc);
  const input = createProjectSchema.parse(raw);
  const scope = auth.permissions['project:create'];
  if (!scope) throw new ForbiddenError();

  if (scope === 'department' && input.departmentId !== auth.departmentId) {
    throw new ForbiddenError('You can only create projects in your own department');
  }
  if (
    input.departmentId &&
    !(await Department.exists({ _id: oid(input.departmentId), archived: false }))
  ) {
    throw new UnprocessableError('Selected department does not exist');
  }
  await assertActiveUsers(
    [input.managerId, ...(input.ownerId ? [input.ownerId] : []), ...input.memberIds],
    'Manager, owner and members',
  );
  if (await Project.exists({ key: input.key }))
    throw new ConflictError(`Project key ${input.key} is already in use`);

  const members = input.memberIds.map((userId) => ({
    userId,
    role: 'member' as ProjectMemberRole,
  }));
  // Without organisation/department-wide rights the creator must stay inside the project to see it.
  if (scope !== 'org' && scope !== 'department' && input.managerId !== auth.userId) {
    members.push({ userId: auth.userId, role: 'lead' });
  }

  const template = input.templateId
    ? await ProjectTemplate.findOne({ _id: oid(input.templateId), archived: false }).lean()
    : null;
  if (input.templateId && !template)
    throw new UnprocessableError('The selected template was not found');
  const start = input.startDate ?? (template ? orgToday() : null);
  const endDate =
    input.endDate ??
    (template?.durationDays != null && start ? addDays(start, template.durationDays) : null);
  if (start && endDate && start > endDate)
    throw new UnprocessableError('End date must be on or after the start date');

  const fields = {
    key: input.key,
    name: input.name,
    description: input.description,
    category: input.category,
    departmentId: input.departmentId ? oid(input.departmentId) : null,
    managerId: oid(input.managerId),
    ownerId: input.ownerId ? oid(input.ownerId) : null,
    members: normalizeMembers(members, input.managerId, input.ownerId),
    priority: input.priority,
    status: input.status,
    startDate: start,
    endDate,
    estimatedHours: input.estimatedHours ?? template?.estimatedHours ?? null,
    budget: input.budget != null ? { amount: input.budget, currency: 'INR' as const } : null,
    objectives: input.objectives.length ? input.objectives : (template?.objectives ?? []),
    autoAssign: input.autoAssign,
    customFields: template?.customFields ?? [],
    templateId: template?._id ?? null,
    createdBy: auth.userObjectId,
  };
  let project!: IProject;
  let templateTaskIds: Types.ObjectId[] = [];
  if (!template) {
    project = (await Project.create(fields)).toObject();
  } else {
    // Project, milestones and tasks are created together or not at all.
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const [doc] = await Project.create([fields], { session });
        project = doc!.toObject();
        templateTaskIds = await applyTemplate(
          session,
          project,
          template,
          start!,
          auth.userObjectId,
        );
      });
    } finally {
      await session.endSession();
    }
  }

  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: `${project.key} ${project.name}`,
    verb: 'created',
    summary: template
      ? `created project ${project!.key} – ${project!.name} from template "${template.name}" (${templateTaskIds.length} tasks)`
      : `created project ${project!.key} – ${project!.name}`,
  });
  await recordAudit(rc, {
    action: 'project.created',
    entityType: 'project',
    entityId: project._id,
    summary: `Created project ${project.key} – ${project.name}`,
  });
  eventBus.publish(
    'project.created',
    { projectId: project!._id.toString() },
    { actorId: auth.userId, requestId: rc.requestId },
  );
  for (const taskId of templateTaskIds) {
    eventBus.publish(
      'task.created',
      { taskId: taskId.toString(), projectId: project!._id.toString() },
      { actorId: auth.userId, requestId: rc.requestId },
    );
  }
  return getProject(rc, project!._id.toString());
}

async function loadWritable(
  auth: AuthContext,
  id: string,
  check: (a: AuthContext, p: IProject) => boolean,
) {
  const project = await loadReadableProject(auth, id);
  if (!check(auth, project)) throw new ForbiddenError();
  return project;
}

export async function updateProject(
  rc: RequestContext,
  id: string,
  input: UpdateProjectInput,
): Promise<ProjectDto> {
  const auth = requireAuth(rc);
  const before = await loadWritable(auth, id, canUpdateProject);
  if (before.archived) throw new UnprocessableError('Restore the project before editing it');

  const next: Record<string, unknown> = {};
  if (input.name !== undefined) next.name = input.name;
  if (input.description !== undefined) next.description = input.description;
  if (input.category !== undefined) next.category = input.category;
  if (input.priority !== undefined) next.priority = input.priority;
  if (input.status !== undefined) next.status = input.status;
  if (input.startDate !== undefined) next.startDate = input.startDate;
  if (input.endDate !== undefined) next.endDate = input.endDate;
  if (input.estimatedHours !== undefined) next.estimatedHours = input.estimatedHours;
  if (input.objectives !== undefined) next.objectives = input.objectives;
  if (input.autoAssign !== undefined) next.autoAssign = input.autoAssign;
  if (input.budget !== undefined)
    next.budget = input.budget === null ? null : { amount: input.budget, currency: 'INR' };
  if (input.departmentId !== undefined) {
    if (
      input.departmentId &&
      !(await Department.exists({ _id: oid(input.departmentId), archived: false }))
    ) {
      throw new UnprocessableError('Selected department does not exist');
    }
    next.departmentId = input.departmentId ? oid(input.departmentId) : null;
  }
  const managerId = input.managerId ?? before.managerId.toString();
  const ownerId =
    input.ownerId !== undefined ? input.ownerId : (before.ownerId?.toString() ?? null);
  if (input.managerId !== undefined || input.ownerId !== undefined) {
    await assertActiveUsers([managerId, ...(ownerId ? [ownerId] : [])], 'Manager and owner');
    next.managerId = oid(managerId);
    next.ownerId = ownerId ? oid(ownerId) : null;
    next.members = normalizeMembers(
      before.members.map((m) => ({
        userId: m.userId.toString(),
        role: m.role === 'manager' ? 'member' : m.role,
      })),
      managerId,
      ownerId,
    );
  }
  const start = (next.startDate ?? before.startDate) as string | null;
  const end = (next.endDate ?? before.endDate) as string | null;
  if (start && end && start > end)
    throw new UnprocessableError('End date must be on or after the start date');
  // A later end date is a slip: the reason is kept in the project's history (delay analysis).
  const slipped = Boolean(
    next.endDate && before.endDate && (next.endDate as string) > before.endDate,
  );
  if (slipped && !input.dateChangeReason)
    throw new UnprocessableError('Give a reason for moving the end date later');

  // On hold: a reason is required; it is shown on the project until the project resumes.
  const status = (next.status as string | undefined) ?? before.status;
  const holding = status === 'on_hold';
  const startsHold = holding && before.status !== 'on_hold';
  const endsHold = !holding && before.status === 'on_hold';
  if (startsHold && !input.holdReason)
    throw new UnprocessableError('Say why the project is being put on hold');
  const holdUntil = input.holdUntil !== undefined ? input.holdUntil : (before.hold?.until ?? null);
  if (holding && holdUntil && holdUntil < orgToday())
    throw new UnprocessableError('The expected restart date cannot be in the past');
  if (startsHold || (holding && !before.hold && input.holdReason)) {
    next.hold = {
      reason: input.holdReason ?? 'No reason recorded',
      since: new Date(),
      byId: auth.userObjectId,
      until: holdUntil,
    };
  } else if (holding && before.hold) {
    next.hold = {
      ...before.hold,
      reason: input.holdReason ?? before.hold.reason,
      until: holdUntil,
    };
  } else if (endsHold) {
    next.hold = null;
  }

  const changes = diffFields(
    before as unknown as Record<string, unknown>,
    { ...before, ...next },
    VERSIONED_FIELDS,
  );
  if (holding && !startsHold && before.hold && next.hold) {
    const h = next.hold as { reason: string; until: string | null };
    if (h.reason !== before.hold.reason)
      changes.push({ field: 'holdReason', from: before.hold.reason, to: h.reason });
    if ((h.until ?? null) !== (before.hold.until ?? null))
      changes.push({ field: 'holdUntil', from: before.hold.until ?? null, to: h.until ?? null });
  }
  if (changes.length === 0) return getProject(rc, id);

  // Optimistic concurrency on `version` so two editors cannot silently overwrite each other.
  const updated = await Project.findOneAndUpdate(
    { _id: before._id, version: before.version },
    { $set: next, $inc: { version: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!updated)
    throw new ConflictError('The project was changed by someone else. Reload and try again.');

  await ProjectVersion.create({
    projectId: before._id,
    version: updated.version,
    changes,
    changedBy: auth.userObjectId,
    reason: startsHold ? input.holdReason : slipped ? input.dateChangeReason : null,
  });
  const holdDays = before.hold
    ? Math.max(1, Math.round((Date.now() - before.hold.since.getTime()) / 86_400_000))
    : 0;
  const holdSummary = startsHold
    ? `put the project on hold: ${input.holdReason}${holdUntil ? ` (expected to restart ${holdUntil})` : ''}`
    : endsHold
      ? `took the project off hold (${STATUS_LABELS[updated.status]}) after ${holdDays} day${holdDays === 1 ? '' : 's'}`
      : null;
  await recordActivity(rc, {
    projectId: before._id,
    entityType: 'project',
    entityId: before._id,
    entityLabel: `${before.key} ${updated.name}`,
    verb: 'updated',
    summary: holdSummary
      ? holdSummary
      : slipped
        ? `moved the end date from ${before.endDate} to ${updated.endDate}: ${input.dateChangeReason}`
        : `updated ${changes.map((c) => c.field).join(', ')}`,
    changes,
  });
  if (changes.some((c) => c.field === 'status')) {
    eventBus.publish(
      'project.status_changed',
      {
        projectId: id,
        from: before.status,
        to: updated.status,
        holdReason: startsHold ? input.holdReason : undefined,
        holdUntil: startsHold ? holdUntil : undefined,
      },
      { actorId: auth.userId },
    );
  }
  return getProject(rc, id);
}

export async function setMembers(
  rc: RequestContext,
  id: string,
  members: { userId: string; role: ProjectMemberRole }[],
): Promise<ProjectDto> {
  const auth = requireAuth(rc);
  const project = await loadWritable(auth, id, canUpdateProject);
  if (project.archived)
    throw new UnprocessableError('Restore the project before changing its team');
  await assertActiveUsers(
    members.map((m) => m.userId),
    'Members',
  );
  const next = normalizeMembers(members, project.managerId.toString(), project.ownerId?.toString());

  // Removed members keep their history, but open tasks assigned to them must be reassigned first.
  const removed = project.members
    .map((m) => m.userId.toString())
    .filter((uid) => !next.some((n) => n.userId.toString() === uid));
  if (removed.length) {
    const open = await Task.countDocuments({
      projectId: project._id,
      deletedAt: null,
      assigneeId: { $in: removed.map(oid) },
      status: { $nin: ['done', 'cancelled'] },
    });
    if (open > 0) {
      throw new ConflictError(
        `Removed members still have ${open} open task(s) in this project. Reassign them first.`,
      );
    }
  }
  await Project.updateOne({ _id: project._id }, { $set: { members: next } });
  const added = next.filter((n) => !project.members.some((m) => m.userId.equals(n.userId))).length;
  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: `${project.key} ${project.name}`,
    verb: 'team_changed',
    summary: `updated the team (${added} added, ${removed.length} removed)`,
  });
  await recordAudit(rc, {
    action: 'project.members_changed',
    entityType: 'project',
    entityId: project._id,
    summary: `Changed team of ${project.key}: ${added} added, ${removed.length} removed`,
    before: project.members,
    after: next,
  });
  return getProject(rc, id);
}

export async function setArchived(
  rc: RequestContext,
  id: string,
  archived: boolean,
): Promise<ProjectDto> {
  const auth = requireAuth(rc);
  const project = await loadWritable(auth, id, canArchiveProject);
  if (project.archived === archived) return getProject(rc, id);
  await Project.updateOne(
    { _id: project._id },
    { $set: { archived, archivedAt: archived ? new Date() : null } },
  );
  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: `${project.key} ${project.name}`,
    verb: archived ? 'archived' : 'restored',
    summary: archived ? 'archived the project' : 'restored the project',
  });
  await recordAudit(rc, {
    action: archived ? 'project.archived' : 'project.restored',
    entityType: 'project',
    entityId: project._id,
    summary: `${archived ? 'Archived' : 'Restored'} project ${project.key} – ${project.name}`,
  });
  return getProject(rc, id);
}

/** Copies a project (and optionally its open task structure) in one transaction. */
export async function duplicateProject(
  rc: RequestContext,
  id: string,
  raw: DuplicateProjectInput,
): Promise<ProjectDto> {
  const auth = requireAuth(rc);
  const input = duplicateProjectSchema.parse(raw);
  const source = await loadReadableProject(auth, id);
  if (!can(auth, 'project:create')) throw new ForbiddenError();
  if (
    auth.permissions['project:create'] === 'department' &&
    source.departmentId?.toString() !== auth.departmentId
  ) {
    throw new ForbiddenError('You can only create projects in your own department');
  }
  if (await Project.exists({ key: input.key }))
    throw new ConflictError(`Project key ${input.key} is already in use`);

  const session = await mongoose.startSession();
  let newId: Types.ObjectId | undefined;
  try {
    await session.withTransaction(async () => {
      const [copy] = await Project.create(
        [
          {
            key: input.key,
            name: input.name,
            description: source.description,
            category: source.category,
            departmentId: source.departmentId,
            managerId: source.managerId,
            ownerId: source.ownerId,
            members: input.includeMembers
              ? source.members
              : normalizeMembers([], source.managerId.toString(), source.ownerId?.toString()),
            priority: source.priority,
            status: 'planning',
            startDate: null,
            endDate: null,
            estimatedHours: source.estimatedHours,
            budget: source.budget,
            objectives: source.objectives,
            customFields: source.customFields ?? [],
            createdBy: auth.userObjectId,
          },
        ],
        { session },
      );
      newId = copy!._id;
      // Milestones keep their dates; tasks are re-linked to the copies below.
      const milestoneMap = new Map<string, Types.ObjectId>();
      for (const m of await Milestone.find({ projectId: source._id }).session(session).lean()) {
        const [mc] = await Milestone.create(
          [
            {
              projectId: newId,
              name: m.name,
              description: m.description,
              dueDate: m.dueDate,
              createdBy: auth.userObjectId,
            },
          ],
          { session },
        );
        milestoneMap.set(m._id.toString(), mc!._id);
      }
      if (!input.includeTasks) return;

      const tasks = await Task.find({
        projectId: source._id,
        deletedAt: null,
        status: { $ne: 'cancelled' },
      })
        .sort({ parentId: 1, rank: 1 })
        .session(session)
        .lean();
      const idMap = new Map<string, Types.ObjectId>();
      let lastRank: string | null = null;
      // Parents first (parentId null sorts first) so subtasks can be re-linked.
      for (const t of tasks) {
        const newTaskId = new Types.ObjectId();
        idMap.set(t._id.toString(), newTaskId);
        lastRank = rankBetween(lastRank, null);
        await Task.create(
          [
            {
              _id: newTaskId,
              key: await nextKey(input.key, session),
              projectId: newId,
              parentId: t.parentId ? (idMap.get(t.parentId.toString()) ?? null) : null,
              title: t.title,
              description: t.description,
              status: 'todo',
              priority: t.priority,
              assigneeId: input.includeMembers ? t.assigneeId : null,
              reporterId: auth.userObjectId,
              watcherIds: [auth.userObjectId],
              estimatedHours: t.estimatedHours,
              complexity: t.complexity,
              requiredSkills: t.requiredSkills,
              tags: t.tags,
              checklist: t.checklist.map((c) => ({ text: c.text, done: false })),
              milestoneId: t.milestoneId
                ? (milestoneMap.get(t.milestoneId.toString()) ?? null)
                : null,
              customFields: t.customFields ?? {},
              rank: lastRank,
            },
          ],
          { session },
        );
      }
      // Re-point dependencies inside the copy.
      for (const t of tasks) {
        const deps = t.dependencyIds.map((d) => idMap.get(d.toString())).filter(Boolean);
        if (deps.length)
          await Task.updateOne(
            { _id: idMap.get(t._id.toString()) },
            { $set: { dependencyIds: deps } },
            { session },
          );
      }
    });
  } finally {
    await session.endSession();
  }

  await recordActivity(rc, {
    projectId: newId!,
    entityType: 'project',
    entityId: newId!,
    entityLabel: `${input.key} ${input.name}`,
    verb: 'created',
    summary: `created this project as a copy of ${source.key}`,
  });
  await recordAudit(rc, {
    action: 'project.duplicated',
    entityType: 'project',
    entityId: newId!,
    summary: `Duplicated ${source.key} as ${input.key} (${input.includeTasks ? 'with' : 'without'} tasks)`,
  });
  return getProject(rc, newId!.toString());
}

export async function listVersions(rc: RequestContext, id: string): Promise<ProjectVersionDto[]> {
  const auth = requireAuth(rc);
  const project = await loadReadableProject(auth, id);
  const versions = await ProjectVersion.find({ projectId: project._id })
    .sort({ version: -1 })
    .limit(100)
    .lean();
  const users = new Map(
    (
      await User.find({ _id: { $in: versions.map((v) => v.changedBy).filter(Boolean) } })
        .select('name email employeeId designation')
        .lean()
    ).map((u) => [u._id.toString(), toUserRef(u)]),
  );
  return versions.map((v) => ({
    version: v.version,
    changedBy: v.changedBy ? (users.get(v.changedBy.toString()) ?? null) : null,
    changedAt: v.createdAt.toISOString(),
    changes: v.changes,
    reason: v.reason ?? undefined,
  }));
}

/** Project 360° summary: progress, upcoming deadlines and open work per member. */
export async function projectOverview(rc: RequestContext, id: string) {
  const auth = requireAuth(rc);
  const project = await loadReadableProject(auth, id);
  const today = orgToday();
  const inTwoWeeks = orgToday(14);
  const [dto, upcoming, workload] = await Promise.all([
    getProject(rc, id),
    Task.find({
      projectId: project._id,
      deletedAt: null,
      status: { $nin: ['done', 'cancelled'] },
      dueDate: { $ne: null, $lte: inTwoWeeks },
    })
      .sort({ dueDate: 1, priorityOrder: 1 })
      .limit(10)
      .select('key title status priority dueDate assigneeId')
      .lean(),
    Task.aggregate<{ _id: Types.ObjectId | null; open: number; effort: number }>([
      {
        $match: {
          projectId: project._id,
          deletedAt: null,
          status: { $nin: ['done', 'cancelled'] },
        },
      },
      {
        $group: {
          _id: '$assigneeId',
          open: { $sum: 1 },
          effort: { $sum: { $ifNull: ['$estimatedHours', 0] } },
        },
      },
    ]),
  ]);
  const names = new Map(dto.members.map((m) => [m.user.id, m.user]));
  return {
    project: dto,
    upcoming: upcoming.map((t) => ({
      id: t._id.toString(),
      key: t.key,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      overdue: Boolean(t.dueDate && t.dueDate < today),
      assignee: t.assigneeId ? (names.get(t.assigneeId.toString()) ?? null) : null,
    })),
    workload: workload
      .map((w) => ({
        user: w._id ? (names.get(w._id.toString()) ?? null) : null,
        openTasks: w.open,
        estimatedHours: w.effort,
      }))
      .sort((a, b) => b.openTasks - a.openTasks),
  };
}
