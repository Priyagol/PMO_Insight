import { Types, type ClientSession } from 'mongoose';
import { addDays, rankBetween, validateCustomValues, type CustomFieldDef } from '@arihant/shared';
import { nextKey } from '../../core/idgen';
import type { IProject } from '../projects/project.model';
import { PRIORITY_ORDER, Task } from '../tasks/task.model';
import { Milestone, ProjectTemplate, type IProjectTemplate } from './planning.models';

/**
 * Materialises a template inside a new project (same transaction as the project insert):
 * milestones and tasks are dated relative to the project start; parent, milestone and
 * dependency links are re-pointed to the new records. Returns the created task ids.
 */
export async function applyTemplate(
  session: ClientSession,
  project: Pick<IProject, '_id' | 'key'>,
  template: IProjectTemplate,
  start: string,
  actorId: Types.ObjectId,
): Promise<Types.ObjectId[]> {
  const msIds = new Map<string, Types.ObjectId>();
  for (const m of template.milestones) {
    const _id = new Types.ObjectId();
    msIds.set(m.ref, _id);
    await Milestone.create(
      [
        {
          _id,
          projectId: project._id,
          name: m.name,
          description: m.description ?? null,
          dueDate: addDays(start, m.dueOffsetDays),
          createdBy: actorId,
        },
      ],
      { session },
    );
  }

  const defs: CustomFieldDef[] = template.customFields ?? [];
  // Parents before their subtasks.
  const ordered = [...template.tasks].sort(
    (a, b) => Number(Boolean(a.parentRef)) - Number(Boolean(b.parentRef)),
  );
  const taskIds = new Map<string, Types.ObjectId>();
  for (const t of ordered) taskIds.set(t.ref, new Types.ObjectId());

  let rank: string | null = null;
  const created: Types.ObjectId[] = [];
  for (const t of ordered) {
    const _id = taskIds.get(t.ref)!;
    const dueDate = t.dueOffsetDays != null ? addDays(start, t.dueOffsetDays) : null;
    let startDate = t.startOffsetDays != null ? addDays(start, t.startOffsetDays) : null;
    if (startDate && dueDate && startDate > dueDate) startDate = dueDate;
    const recurrence =
      t.recurrence && dueDate && !t.parentRef ? { ...t.recurrence, until: null } : null;
    rank = rankBetween(rank, null);
    await Task.create(
      [
        {
          _id,
          key: await nextKey(project.key, session),
          projectId: project._id,
          parentId: t.parentRef ? (taskIds.get(t.parentRef) ?? null) : null,
          title: t.title,
          description: t.description ?? null,
          status: 'todo',
          priority: t.priority,
          priorityOrder: PRIORITY_ORDER[t.priority],
          assigneeId: null,
          reporterId: actorId,
          watcherIds: [actorId],
          startDate,
          dueDate,
          estimatedHours: t.estimatedHours ?? null,
          complexity: t.complexity ?? null,
          requiredSkills: t.requiredSkills,
          tags: t.tags,
          checklist: t.checklist.map((text) => ({ text, done: false })),
          milestoneId: t.milestoneRef ? (msIds.get(t.milestoneRef) ?? null) : null,
          recurrence,
          recurrenceSeriesId: recurrence ? _id : null,
          recurrenceIndex: recurrence ? 1 : null,
          // Template values are re-checked against the template's own definitions; invalid ones are dropped.
          customFields: validateCustomValues(defs, cleanValues(defs, t.customFields)).values,
          rank,
        },
      ],
      { session },
    );
    created.push(_id);
  }
  for (const t of ordered) {
    const deps = t.dependencyRefs
      .map((r) => taskIds.get(r))
      .filter((d): d is Types.ObjectId => Boolean(d));
    if (deps.length)
      await Task.updateOne(
        { _id: taskIds.get(t.ref) },
        { $set: { dependencyIds: deps } },
        { session },
      );
  }
  await ProjectTemplate.updateOne({ _id: template._id }, { $inc: { usageCount: 1 } }, { session });
  return created;
}

/** Keeps only individually valid values for known fields (required checks do not apply here). */
function cleanValues(defs: CustomFieldDef[], values: Record<string, unknown> | undefined) {
  const out: Record<string, string | number | boolean | null> = {};
  for (const d of defs) {
    const v = values?.[d.key];
    if (v === undefined) continue;
    const one = validateCustomValues([{ ...d, required: false }], {
      [d.key]: v as string | number | boolean | null,
    });
    if (!Object.keys(one.errors).length) Object.assign(out, one.values);
  }
  return out;
}
