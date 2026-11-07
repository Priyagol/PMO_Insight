import { Types } from 'mongoose';
import {
  createMilestoneSchema,
  projectCustomFieldsSchema,
  projectDependenciesSchema,
  updateMilestoneSchema,
  type CreateMilestoneInput,
  type CustomFieldDef,
  type CustomValues,
  type MilestoneDto,
  type ProjectCustomFieldsInput,
  type ProjectDependenciesDto,
  type ProjectDependenciesInput,
  type UpdateMilestoneInput,
  validateCustomValues,
} from '@arihant/shared';
import {
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from '../../core/errors';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { canUpdateProject, projectScopeFilter } from '../../core/rbac/work-access';
import { orgToday } from '../../core/time';
import { recordAudit } from '../audit/audit.service';
import { recordActivity } from '../collab/activity.service';
import { Project, type IProject } from '../projects/project.model';
import { loadReadableProject } from '../projects/project.service';
import { Task } from '../tasks/task.model';
import { Milestone, type IMilestone } from './planning.models';

const oid = (id: string) => new Types.ObjectId(id);
const CLOSED = ['completed', 'cancelled'];

async function loadEditableProject(auth: AuthContext, projectId: string): Promise<IProject> {
  const project = await loadReadableProject(auth, projectId);
  if (!canUpdateProject(auth, project)) throw new ForbiddenError();
  if (project.archived) throw new UnprocessableError('Restore the project before changing it');
  return project;
}

/* ============================ Milestones ============================ */

async function presentMilestones(
  auth: AuthContext,
  project: IProject,
  docs: IMilestone[],
): Promise<MilestoneDto[]> {
  const rows = docs.length
    ? await Task.aggregate<{ _id: Types.ObjectId; total: number; done: number }>([
        {
          $match: {
            milestoneId: { $in: docs.map((d) => d._id) },
            deletedAt: null,
            status: { $ne: 'cancelled' },
          },
        },
        {
          $group: {
            _id: '$milestoneId',
            total: { $sum: 1 },
            done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
          },
        },
      ])
    : [];
  const counts = new Map(rows.map((r) => [r._id.toString(), r]));
  const today = orgToday();
  const canEdit = !project.archived && canUpdateProject(auth, project);
  return docs.map((m) => {
    const c = counts.get(m._id.toString());
    const total = c?.total ?? 0;
    const done = c?.done ?? 0;
    return {
      id: m._id.toString(),
      projectId: m.projectId.toString(),
      name: m.name,
      description: m.description ?? undefined,
      dueDate: m.dueDate,
      status: m.status,
      completedAt: m.completedAt?.toISOString(),
      overdue: m.status === 'open' && m.dueDate < today,
      progress: { total, done, percent: total ? Math.round((done / total) * 100) : 0 },
      canEdit,
      createdAt: m.createdAt.toISOString(),
    };
  });
}

export async function listMilestones(
  rc: RequestContext,
  projectId: string,
): Promise<MilestoneDto[]> {
  const auth = requireAuth(rc);
  const project = await loadReadableProject(auth, projectId);
  const docs = await Milestone.find({ projectId: project._id })
    .sort({ dueDate: 1, createdAt: 1 })
    .lean();
  return presentMilestones(auth, project, docs);
}

async function loadMilestone(
  auth: AuthContext,
  id: string,
): Promise<{ milestone: IMilestone; project: IProject }> {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Milestone');
  const milestone = await Milestone.findById(id).lean();
  if (!milestone) throw new NotFoundError('Milestone');
  // Same 404 when the project is outside the caller's scope.
  const project = await loadReadableProject(auth, milestone.projectId.toString()).catch(() => {
    throw new NotFoundError('Milestone');
  });
  return { milestone, project };
}

export async function createMilestone(
  rc: RequestContext,
  projectId: string,
  raw: CreateMilestoneInput,
): Promise<MilestoneDto> {
  const auth = requireAuth(rc);
  const input = createMilestoneSchema.parse(raw);
  const project = await loadEditableProject(auth, projectId);
  const doc = await Milestone.create({
    projectId: project._id,
    name: input.name,
    description: input.description ?? null,
    dueDate: input.dueDate,
    createdBy: auth.userObjectId,
  });
  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: `${project.key} ${project.name}`,
    verb: 'milestone_added',
    summary: `added milestone "${doc.name}" due ${doc.dueDate}`,
  });
  return (await presentMilestones(auth, project, [doc.toObject()]))[0]!;
}

export async function updateMilestone(
  rc: RequestContext,
  id: string,
  raw: UpdateMilestoneInput,
): Promise<MilestoneDto> {
  const auth = requireAuth(rc);
  const input = updateMilestoneSchema.parse(raw);
  const { milestone, project } = await loadMilestone(auth, id);
  if (!canUpdateProject(auth, project)) throw new ForbiddenError();
  if (project.archived) throw new UnprocessableError('Restore the project before changing it');
  const set: Record<string, unknown> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.description !== undefined) set.description = input.description;
  if (input.dueDate !== undefined) set.dueDate = input.dueDate;
  if (input.status !== undefined && input.status !== milestone.status) {
    set.status = input.status;
    set.completedAt = input.status === 'completed' ? new Date() : null;
  }
  const updated = await Milestone.findByIdAndUpdate(
    milestone._id,
    { $set: set },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (set.status) {
    await recordActivity(rc, {
      projectId: project._id,
      entityType: 'project',
      entityId: project._id,
      entityLabel: `${project.key} ${project.name}`,
      verb: set.status === 'completed' ? 'milestone_completed' : 'milestone_reopened',
      summary: `${set.status === 'completed' ? 'completed' : 'reopened'} milestone "${updated!.name}"`,
    });
  }
  return (await presentMilestones(auth, project, [updated!]))[0]!;
}

/** Deletes a milestone; its tasks stay and are simply unlinked. */
export async function deleteMilestone(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  const { milestone, project } = await loadMilestone(auth, id);
  if (!canUpdateProject(auth, project)) throw new ForbiddenError();
  if (project.archived) throw new UnprocessableError('Restore the project before changing it');
  await Task.updateMany({ milestoneId: milestone._id }, { $set: { milestoneId: null } });
  await Milestone.deleteOne({ _id: milestone._id });
  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: `${project.key} ${project.name}`,
    verb: 'milestone_deleted',
    summary: `deleted milestone "${milestone.name}"`,
  });
  await recordAudit(rc, {
    action: 'milestone.deleted',
    entityType: 'project',
    entityId: project._id,
    summary: `Deleted milestone "${milestone.name}" from ${project.key}`,
  });
}

/** A task's milestone must belong to the task's project. */
export async function assertMilestoneInProject(
  milestoneId: string,
  projectId: Types.ObjectId,
): Promise<void> {
  if (
    !Types.ObjectId.isValid(milestoneId) ||
    !(await Milestone.exists({ _id: oid(milestoneId), projectId }))
  )
    throw new UnprocessableError('The milestone must belong to the same project');
}

/* ============================ Project dependencies ============================ */

function delayReason(upstream: IProject, downstream: IProject, today: string): string | undefined {
  if (CLOSED.includes(upstream.status)) return undefined;
  if (upstream.endDate && upstream.endDate < today)
    return `${upstream.key} passed its end date (${upstream.endDate}) without completing`;
  if (upstream.endDate && downstream.startDate && upstream.endDate >= downstream.startDate)
    return `${upstream.key} ends ${upstream.endDate}, on or after this project starts (${downstream.startDate})`;
  if (upstream.status === 'at_risk') return `${upstream.key} is marked at risk`;
  return undefined;
}

export async function getDependencies(
  rc: RequestContext,
  projectId: string,
): Promise<ProjectDependenciesDto> {
  const auth = requireAuth(rc);
  const project = await loadReadableProject(auth, projectId);
  const scope = await projectScopeFilter(auth, auth.permissions['project:read']!);
  const ids = (project.dependsOn ?? []).map((d) => d.projectId);
  const [upstream, dependents] = await Promise.all([
    ids.length
      ? Project.find({ $and: [{ _id: { $in: ids } }, scope] }).lean()
      : Promise.resolve([]),
    Project.find({ $and: [{ 'dependsOn.projectId': project._id, archived: false }, scope] })
      .select('key name status')
      .sort({ key: 1 })
      .lean(),
  ]);
  const byId = new Map(upstream.map((p) => [p._id.toString(), p]));
  const today = orgToday();
  const dependsOn = (project.dependsOn ?? [])
    .map((d) => {
      const p = byId.get(d.projectId.toString());
      if (!p) return null;
      const reason = delayReason(p, project, today);
      return {
        project: {
          id: p._id.toString(),
          key: p.key,
          name: p.name,
          status: p.status,
          endDate: p.endDate ?? undefined,
        },
        note: d.note,
        delayed: Boolean(reason),
        reason,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
  return {
    dependsOn,
    hiddenUpstream: ids.length - dependsOn.length,
    dependents: dependents.map((p) => ({
      id: p._id.toString(),
      key: p.key,
      name: p.name,
      status: p.status,
    })),
    canEdit: !project.archived && canUpdateProject(auth, project),
  };
}

/** Rejects a dependency graph cycle across all projects (A → B → … → A). */
async function assertNoProjectCycle(
  projectId: Types.ObjectId,
  upstream: Types.ObjectId[],
): Promise<void> {
  const target = projectId.toString();
  const seen = new Set<string>();
  let frontier = upstream.map(String);
  for (let depth = 0; frontier.length && depth < 50; depth += 1) {
    if (frontier.includes(target))
      throw new UnprocessableError('These dependencies would create a cycle between projects');
    frontier.forEach((f) => seen.add(f));
    const next = await Project.find({ _id: { $in: frontier.map(oid) } })
      .select('dependsOn')
      .lean();
    frontier = next
      .flatMap((n) => (n.dependsOn ?? []).map((d) => d.projectId.toString()))
      .filter((d) => !seen.has(d));
  }
}

/**
 * Replaces the upstream list. Upstream projects the caller cannot see are kept as they are
 * (the caller can neither see nor remove them).
 */
export async function setDependencies(
  rc: RequestContext,
  projectId: string,
  raw: ProjectDependenciesInput,
): Promise<ProjectDependenciesDto> {
  const auth = requireAuth(rc);
  const input = projectDependenciesSchema.parse(raw);
  const project = await loadEditableProject(auth, projectId);
  const wanted = new Map(input.dependencies.map((d) => [d.projectId, d.note]));
  if (wanted.has(project._id.toString()))
    throw new UnprocessableError('A project cannot depend on itself');

  const scope = await projectScopeFilter(auth, auth.permissions['project:read']!);
  const visible = await Project.find({
    $and: [{ _id: { $in: [...wanted.keys()].map(oid) } }, scope],
  })
    .select('_id archived')
    .lean();
  if (visible.length !== wanted.size)
    throw new UnprocessableError('One or more projects were not found');

  const currentIds = (project.dependsOn ?? []).map((d) => d.projectId);
  const visibleCurrent = currentIds.length
    ? new Set(
        (
          await Project.find({ $and: [{ _id: { $in: currentIds } }, scope] })
            .select('_id')
            .lean()
        ).map((p) => p._id.toString()),
      )
    : new Set<string>();
  const hiddenKept = (project.dependsOn ?? []).filter(
    (d) => !visibleCurrent.has(d.projectId.toString()),
  );
  const next = [
    ...hiddenKept,
    ...[...wanted].map(([id, note]) => ({ projectId: oid(id), ...(note ? { note } : {}) })),
  ];
  await assertNoProjectCycle(
    project._id,
    next.map((d) => d.projectId),
  );
  await Project.updateOne({ _id: project._id }, { $set: { dependsOn: next } });

  const before = new Set(currentIds.map(String));
  const after = new Set(next.map((d) => d.projectId.toString()));
  const added = [...after].filter((x) => !before.has(x)).length;
  const removed = [...before].filter((x) => !after.has(x)).length;
  if (added || removed) {
    await recordActivity(rc, {
      projectId: project._id,
      entityType: 'project',
      entityId: project._id,
      entityLabel: `${project.key} ${project.name}`,
      verb: 'dependencies_updated',
      summary: `updated project dependencies (${added} added, ${removed} removed)`,
    });
  }
  return getDependencies(rc, projectId);
}

/* ============================ Custom fields ============================ */

/**
 * Replaces a project's task field definitions. Values of removed fields, of fields whose type
 * changed, and of dropdown options that no longer exist are cleared from the project's tasks.
 */
export async function setCustomFields(
  rc: RequestContext,
  projectId: string,
  raw: ProjectCustomFieldsInput,
): Promise<CustomFieldDef[]> {
  const auth = requireAuth(rc);
  const { fields } = projectCustomFieldsSchema.parse(raw);
  const project = await loadEditableProject(auth, projectId);
  const before = new Map((project.customFields ?? []).map((f) => [f.key, f]));
  const unset: Record<string, ''> = {};
  for (const [key, old] of before) {
    const now = fields.find((f) => f.key === key);
    if (!now || now.type !== old.type) unset[`customFields.${key}`] = '';
  }
  if (Object.keys(unset).length)
    await Task.updateMany({ projectId: project._id }, { $unset: unset });
  for (const f of fields) {
    const old = before.get(f.key);
    if (f.type === 'select' && old?.type === 'select') {
      await Task.updateMany(
        {
          projectId: project._id,
          [`customFields.${f.key}`]: { $exists: true, $nin: [...f.options, null] },
        },
        { $unset: { [`customFields.${f.key}`]: '' } },
      );
    }
  }
  await Project.updateOne({ _id: project._id }, { $set: { customFields: fields } });
  await recordActivity(rc, {
    projectId: project._id,
    entityType: 'project',
    entityId: project._id,
    entityLabel: `${project.key} ${project.name}`,
    verb: 'custom_fields_updated',
    summary: `updated task fields (${fields.map((f) => f.label).join(', ') || 'none'})`,
  });
  await recordAudit(rc, {
    action: 'project.custom_fields_updated',
    entityType: 'project',
    entityId: project._id,
    summary: `Set ${fields.length} custom task field(s) on ${project.key}`,
    before: { fields: [...before.values()] },
    after: { fields },
  });
  return fields;
}

/** Validates task values against the project's definitions (400 with per-field details). */
export function checkCustomValues(
  project: IProject,
  input: CustomValues,
  existing?: CustomValues,
): CustomValues {
  const { values, errors } = validateCustomValues(project.customFields ?? [], input, existing);
  if (Object.keys(errors).length)
    throw new ValidationError(
      Object.entries(errors).map(([key, message]) => ({ path: `customFields.${key}`, message })),
      Object.values(errors)[0],
    );
  return values;
}
