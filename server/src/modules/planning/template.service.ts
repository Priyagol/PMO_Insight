import { Types } from 'mongoose';
import {
  createTemplateSchema,
  daysBetween,
  saveAsTemplateSchema,
  updateTemplateSchema,
  type CreateTemplateInput,
  type SaveAsTemplateInput,
  type TemplateDto,
  type TemplateMilestone,
  type TemplateSummaryDto,
  type TemplateTask,
  type UpdateTemplateInput,
} from '@arihant/shared';
import { ForbiddenError, NotFoundError } from '../../core/errors';
import { escapeRegex } from '../../core/pagination';
import { requireAuth, type AuthContext, type RequestContext } from '../../core/rbac/context';
import { can } from '../../core/rbac/policy';
import { recordAudit } from '../audit/audit.service';
import { loadReadableProject } from '../projects/project.service';
import { Task } from '../tasks/task.model';
import { User } from '../users/user.model';
import { Milestone, ProjectTemplate, type IProjectTemplate } from './planning.models';

/*
 * Templates are an organisation-wide library: anyone who may create projects can browse and
 * use them. The author, or someone with organisation-wide project creation, may edit them.
 */

function assertCanUse(auth: AuthContext) {
  if (!can(auth, 'project:create')) throw new ForbiddenError();
}
const canEdit = (auth: AuthContext, t: IProjectTemplate) =>
  t.createdBy.equals(auth.userObjectId) || can(auth, 'project:create', 'org');

async function summaries(
  auth: AuthContext,
  docs: IProjectTemplate[],
): Promise<TemplateSummaryDto[]> {
  const authors = await User.find({ _id: { $in: docs.map((d) => d.createdBy) } })
    .select('name')
    .lean();
  const names = new Map(authors.map((u) => [u._id.toString(), u.name]));
  return docs.map((t) => ({
    id: t._id.toString(),
    name: t.name,
    description: t.description ?? undefined,
    category: t.category ?? undefined,
    priority: t.priority,
    durationDays: t.durationDays ?? undefined,
    taskCount: t.tasks.length,
    milestoneCount: t.milestones.length,
    customFieldCount: t.customFields.length,
    usageCount: t.usageCount,
    createdBy: names.has(t.createdBy.toString())
      ? { id: t.createdBy.toString(), name: names.get(t.createdBy.toString())! }
      : null,
    canEdit: canEdit(auth, t),
    updatedAt: t.updatedAt.toISOString(),
  }));
}

async function present(auth: AuthContext, t: IProjectTemplate): Promise<TemplateDto> {
  const [summary] = await summaries(auth, [t]);
  return {
    ...summary!,
    objectives: t.objectives,
    estimatedHours: t.estimatedHours ?? undefined,
    customFields: t.customFields,
    milestones: t.milestones,
    tasks: t.tasks,
  };
}

async function load(auth: AuthContext, id: string): Promise<IProjectTemplate> {
  assertCanUse(auth);
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Template');
  const t = await ProjectTemplate.findOne({ _id: id, archived: false }).lean();
  if (!t) throw new NotFoundError('Template');
  return t;
}

export async function listTemplates(rc: RequestContext, q?: string): Promise<TemplateSummaryDto[]> {
  const auth = requireAuth(rc);
  assertCanUse(auth);
  const filter: Record<string, unknown> = { archived: false };
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { category: rx }, { description: rx }];
  }
  const docs = await ProjectTemplate.find(filter).sort({ name: 1 }).limit(200).lean();
  return summaries(auth, docs);
}

export async function getTemplate(rc: RequestContext, id: string): Promise<TemplateDto> {
  const auth = requireAuth(rc);
  return present(auth, await load(auth, id));
}

export async function createTemplate(
  rc: RequestContext,
  raw: CreateTemplateInput,
): Promise<TemplateDto> {
  const auth = requireAuth(rc);
  assertCanUse(auth);
  const input = createTemplateSchema.parse(raw);
  const doc = await ProjectTemplate.create({ ...input, createdBy: auth.userObjectId });
  await recordAudit(rc, {
    action: 'template.created',
    entityType: 'projectTemplate',
    entityId: doc._id,
    summary: `Created project template "${doc.name}" (${input.tasks.length} tasks)`,
  });
  return present(auth, doc.toObject());
}

export async function updateTemplate(
  rc: RequestContext,
  id: string,
  raw: UpdateTemplateInput,
): Promise<TemplateDto> {
  const auth = requireAuth(rc);
  const input = updateTemplateSchema.parse(raw);
  const t = await load(auth, id);
  if (!canEdit(auth, t)) throw new ForbiddenError('Only the author can edit this template');
  // Links inside the template must stay consistent when only one list is replaced.
  createTemplateSchema.parse({
    name: input.name ?? t.name,
    milestones: input.milestones ?? t.milestones,
    tasks: input.tasks ?? t.tasks,
  });
  const updated = await ProjectTemplate.findByIdAndUpdate(
    t._id,
    { $set: input },
    { returnDocument: 'after' },
  ).lean();
  await recordAudit(rc, {
    action: 'template.updated',
    entityType: 'projectTemplate',
    entityId: t._id,
    summary: `Updated project template "${updated!.name}" (${Object.keys(input).join(', ')})`,
  });
  return present(auth, updated!);
}

export async function deleteTemplate(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  const t = await load(auth, id);
  if (!canEdit(auth, t)) throw new ForbiddenError('Only the author can delete this template');
  // Archived rather than removed: projects keep their templateId reference.
  await ProjectTemplate.updateOne({ _id: t._id }, { $set: { archived: true } });
  await recordAudit(rc, {
    action: 'template.deleted',
    entityType: 'projectTemplate',
    entityId: t._id,
    summary: `Deleted project template "${t.name}"`,
  });
}

/**
 * Captures a project's structure as a template: custom fields, milestones and (optionally)
 * open tasks with dates turned into offsets from the project start. People, statuses, logged
 * time and comments are not copied.
 */
export async function saveProjectAsTemplate(
  rc: RequestContext,
  projectId: string,
  raw: SaveAsTemplateInput,
): Promise<TemplateDto> {
  const auth = requireAuth(rc);
  assertCanUse(auth);
  const input = saveAsTemplateSchema.parse(raw);
  const project = await loadReadableProject(auth, projectId);

  const [milestoneDocs, allTasks] = await Promise.all([
    Milestone.find({ projectId: project._id }).sort({ dueDate: 1 }).lean(),
    input.includeTasks
      ? Task.find({ projectId: project._id, deletedAt: null, status: { $ne: 'cancelled' } })
          .sort({ parentId: 1, rank: 1 })
          .lean()
      : Promise.resolve([]),
  ]);
  // A repeating series appears once: earlier occurrences that already have a successor are skipped.
  const taskDocs = allTasks.filter(
    (t) =>
      !(
        t.recurrence &&
        t.nextOccurrenceId &&
        allTasks.some((x) => x._id.equals(t.nextOccurrenceId!))
      ),
  );
  const dates = [
    project.startDate,
    ...milestoneDocs.map((m) => m.dueDate),
    ...taskDocs.flatMap((t) => [t.startDate, t.dueDate]),
  ].filter((d): d is string => Boolean(d));
  const base = project.startDate ?? dates.sort()[0] ?? null;
  const offsetOf = (d: string | null | undefined) =>
    d && base ? Math.max(0, daysBetween(base, d)) : null;

  const milestones: TemplateMilestone[] = milestoneDocs.map((m, i) => ({
    ref: `m${i + 1}`,
    name: m.name,
    ...(m.description ? { description: m.description } : {}),
    dueOffsetDays: offsetOf(m.dueDate) ?? 0,
  }));
  const msRef = new Map(milestoneDocs.map((m, i) => [m._id.toString(), `m${i + 1}`]));
  const taskRef = new Map(taskDocs.map((t, i) => [t._id.toString(), `t${i + 1}`]));
  const tasks: TemplateTask[] = taskDocs.map((t) => ({
    ref: taskRef.get(t._id.toString())!,
    parentRef: t.parentId ? (taskRef.get(t.parentId.toString()) ?? null) : null,
    title: t.title,
    ...(t.description ? { description: t.description } : {}),
    priority: t.priority,
    estimatedHours: t.estimatedHours ?? null,
    complexity: t.complexity ?? null,
    requiredSkills: t.requiredSkills.map((s) => ({ name: s.name, minLevel: s.minLevel })),
    tags: t.tags,
    checklist: t.checklist.map((c) => c.text),
    startOffsetDays: offsetOf(t.startDate),
    dueOffsetDays: offsetOf(t.dueDate),
    milestoneRef: t.milestoneId ? (msRef.get(t.milestoneId.toString()) ?? null) : null,
    dependencyRefs: t.dependencyIds
      .map((d) => taskRef.get(d.toString()))
      .filter((r): r is string => Boolean(r)),
    recurrence:
      t.recurrence && !t.parentId
        ? {
            frequency: t.recurrence.frequency,
            interval: t.recurrence.interval ?? 1,
            workdaysOnly: t.recurrence.workdaysOnly ?? false,
          }
        : null,
    customFields: (t.customFields ?? {}) as TemplateTask['customFields'],
  }));

  const duration =
    project.startDate && project.endDate ? daysBetween(project.startDate, project.endDate) : null;
  return createTemplate(rc, {
    name: input.name,
    description: input.description ?? project.description ?? undefined,
    category: project.category ?? undefined,
    priority: project.priority,
    objectives: project.objectives,
    durationDays: duration != null && duration >= 0 ? duration : null,
    estimatedHours: project.estimatedHours ?? null,
    customFields: project.customFields ?? [],
    milestones,
    tasks,
  }).then(async (dto) => {
    await ProjectTemplate.updateOne({ _id: dto.id }, { $set: { sourceProjectId: project._id } });
    return dto;
  });
}
