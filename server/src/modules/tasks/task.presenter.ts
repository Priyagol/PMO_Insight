import { type Types } from 'mongoose';
import {
  LINK_LABELS,
  STATUS_LABELS,
  describeRecurrence,
  type TaskLinkDto,
  type CustomValues,
  type TaskDto,
  type TaskRef,
  type UserRef,
  type TaskStatus,
} from '@arihant/shared';
import type { AuthContext } from '../../core/rbac/context';
import { canWriteTask, teamMemberIds } from '../../core/rbac/work-access';
import { orgToday } from '../../core/time';
import { Attachment, Comment } from '../collab/collab.models';
import { Sprint } from '../agile/sprint.model';
import { Release } from '../delivery/delivery.models';
import { Milestone } from '../planning/planning.models';
import { Project, type IProject } from '../projects/project.model';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { TaskWorkflow } from '../workflows/workflow.models';
import { Task, type ITask } from './task.model';

const ref = (t: Pick<ITask, '_id' | 'key' | 'title' | 'status'>): TaskRef => ({
  id: t._id.toString(),
  key: t.key,
  title: t.title,
  status: t.status,
});

async function countBy(
  model: typeof Comment | typeof Attachment,
  field: 'entityId',
  ids: Types.ObjectId[],
): Promise<Map<string, number>> {
  const rows = await (model as typeof Comment).aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { [field]: { $in: ids }, deletedAt: null } },
    { $group: { _id: `$${field}`, n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.n]));
}

/**
 * Builds TaskDtos for a batch of tasks with a fixed number of queries
 * (users, projects, parents/dependencies, subtask/comment/attachment counts).
 */
export async function presentTasks(auth: AuthContext, tasks: ITask[]): Promise<TaskDto[]> {
  if (tasks.length === 0) return [];
  const ids = tasks.map((t) => t._id);
  const userIds = new Set<string>();
  const projectIds = new Set<string>();
  const relatedIds = new Set<string>();
  const milestoneIds = new Set<string>();
  const sprintIds = new Set<string>();
  const releaseIds = new Set<string>();
  for (const t of tasks) {
    if (t.assigneeId) userIds.add(t.assigneeId.toString());
    userIds.add(t.reporterId.toString());
    projectIds.add(t.projectId.toString());
    if (t.parentId) relatedIds.add(t.parentId.toString());
    if (t.nextOccurrenceId) relatedIds.add(t.nextOccurrenceId.toString());
    if (t.milestoneId) milestoneIds.add(t.milestoneId.toString());
    t.dependencyIds.forEach((d) => relatedIds.add(d.toString()));
    if (t.epicId) relatedIds.add(t.epicId.toString());
    (t.links ?? []).forEach((l) => relatedIds.add(l.taskId.toString()));
    if (t.sprintId) sprintIds.add(t.sprintId.toString());
    if (t.fixReleaseId) releaseIds.add(t.fixReleaseId.toString());
    if (t.bug?.foundInReleaseId) releaseIds.add(t.bug.foundInReleaseId.toString());
  }

  const needTeam =
    auth.permissions['task:update'] === 'team' || auth.permissions['task:delete'] === 'team';
  const [sprints, releases, inbound] = await Promise.all([
    sprintIds.size
      ? Sprint.find({ _id: { $in: [...sprintIds] } })
          .select('name status')
          .lean()
      : Promise.resolve([]),
    releaseIds.size
      ? Release.find({ _id: { $in: [...releaseIds] } })
          .select('version')
          .lean()
      : Promise.resolve([]),
    Task.find({ 'links.taskId': { $in: ids }, deletedAt: null })
      .select('key title status links')
      .lean(),
  ]);
  const sprintMap = new Map(
    sprints.map((x) => [
      x._id.toString(),
      { id: x._id.toString(), name: x.name, status: x.status },
    ]),
  );
  const releaseMap = new Map(
    releases.map((r) => [r._id.toString(), { id: r._id.toString(), version: r.version }]),
  );
  const linksOf = (t: ITask): TaskLinkDto[] => {
    const out: TaskLinkDto[] = [];
    for (const l of t.links ?? []) {
      const other = relatedMap.get(l.taskId.toString());
      if (other)
        out.push({
          type: l.type,
          direction: 'outward',
          label: LINK_LABELS[l.type].outward,
          task: other,
        });
    }
    for (const o of inbound) {
      for (const l of o.links ?? []) {
        if (l.taskId.equals(t._id))
          out.push({
            type: l.type,
            direction: 'inward',
            label: LINK_LABELS[l.type].inward,
            task: ref(o),
          });
      }
    }
    return out;
  };

  const [users, projects, related, subtaskRows, comments, attachments, team, milestones] =
    await Promise.all([
      User.find({ _id: { $in: [...userIds] } })
        .select('name email employeeId designation')
        .lean(),
      Project.find({ _id: { $in: [...projectIds] } })
        .select('key name members managerId ownerId departmentId archived customFields workflowId')
        .lean(),
      Task.find({ _id: { $in: [...relatedIds] }, deletedAt: null })
        .select('key title status')
        .lean(),
      Task.aggregate<{ _id: Types.ObjectId; total: number; done: number }>([
        { $match: { parentId: { $in: ids }, deletedAt: null } },
        {
          $group: {
            _id: '$parentId',
            total: { $sum: 1 },
            done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
          },
        },
      ]),
      countBy(Comment, 'entityId', ids),
      countBy(Attachment, 'entityId', ids),
      needTeam ? teamMemberIds(auth) : Promise.resolve(undefined),
      milestoneIds.size
        ? Milestone.find({ _id: { $in: [...milestoneIds] } })
            .select('name dueDate status')
            .lean()
        : Promise.resolve([]),
    ]);
  const milestoneMap = new Map(
    milestones.map((m) => [
      m._id.toString(),
      { id: m._id.toString(), name: m.name, dueDate: m.dueDate, status: m.status },
    ]),
  );

  const userMap = new Map<string, UserRef>(users.map((u) => [u._id.toString(), toUserRef(u)]));
  const projectMap = new Map<string, IProject>(
    projects.map((p) => [p._id.toString(), p as IProject]),
  );
  const relatedMap = new Map(related.map((r) => [r._id.toString(), ref(r)]));
  // Status names can be renamed by a project's workflow (Phase 9C).
  const workflowIds = projects
    .map((p) => p.workflowId)
    .filter((w): w is Types.ObjectId => Boolean(w));
  const workflows = workflowIds.length
    ? await TaskWorkflow.find({ _id: { $in: workflowIds } })
        .select('definition.labels')
        .lean()
    : [];
  const labelsOf = (p: IProject): Partial<Record<TaskStatus, string>> =>
    (p.workflowId && workflows.find((w) => w._id.equals(p.workflowId!))?.definition.labels) || {};
  const subtasks = new Map(subtaskRows.map((r) => [r._id.toString(), r]));
  const today = orgToday();

  return tasks.map((t) => {
    const project = projectMap.get(t.projectId.toString())!;
    const editable = !project.archived && !t.deletedAt;
    const sub = subtasks.get(t._id.toString());
    return {
      id: t._id.toString(),
      key: t.key,
      project: { id: project._id.toString(), key: project.key, name: project.name },
      parent: t.parentId ? (relatedMap.get(t.parentId.toString()) ?? null) : null,
      title: t.title,
      description: t.description ?? undefined,
      status: t.status,
      statusLabel: labelsOf(project)[t.status] ?? STATUS_LABELS[t.status],
      restricted: t.restricted ?? false,
      allowedUserIds: (t.allowedUserIds ?? []).map(String),
      pendingTransition: t.pendingTransition
        ? { to: t.pendingTransition.to, approvalId: t.pendingTransition.approvalId.toString() }
        : null,
      priority: t.priority,
      assignee: t.assigneeId ? (userMap.get(t.assigneeId.toString()) ?? null) : null,
      reporter: userMap.get(t.reporterId.toString()) ?? null,
      watcherIds: t.watcherIds.map(String),
      startDate: t.startDate ?? undefined,
      dueDate: t.dueDate ?? undefined,
      estimatedHours: t.estimatedHours ?? undefined,
      actualHours: t.actualHours,
      complexity: t.complexity ?? undefined,
      requiredSkills: t.requiredSkills.map((s) => ({ name: s.name, minLevel: s.minLevel })),
      tags: t.tags,
      checklist: t.checklist.map((c) => ({ id: c._id.toString(), text: c.text, done: c.done })),
      dependencies: t.dependencyIds
        .map((d) => relatedMap.get(d.toString()))
        .filter((d): d is TaskRef => Boolean(d)),
      milestone: t.milestoneId ? (milestoneMap.get(t.milestoneId.toString()) ?? null) : null,
      recurrence: t.recurrence
        ? {
            frequency: t.recurrence.frequency,
            interval: t.recurrence.interval ?? 1,
            workdaysOnly: t.recurrence.workdaysOnly ?? false,
            until: t.recurrence.until ?? null,
            summary: describeRecurrence({
              frequency: t.recurrence.frequency,
              interval: t.recurrence.interval ?? 1,
              workdaysOnly: t.recurrence.workdaysOnly ?? false,
              until: t.recurrence.until ?? null,
            }),
            index: t.recurrenceIndex ?? 1,
            nextTask: t.nextOccurrenceId
              ? (() => {
                  const n = relatedMap.get(t.nextOccurrenceId.toString());
                  return n ? { id: n.id, key: n.key } : null;
                })()
              : null,
          }
        : null,
      customFields: pickDefined(project.customFields ?? [], t.customFields),
      type: t.type ?? 'task',
      storyPoints: t.storyPoints ?? undefined,
      epic: t.epicId ? (relatedMap.get(t.epicId.toString()) ?? null) : null,
      sprint: t.sprintId ? (sprintMap.get(t.sprintId.toString()) ?? null) : null,
      components: t.components ?? [],
      fixRelease: t.fixReleaseId ? (releaseMap.get(t.fixReleaseId.toString()) ?? null) : null,
      acceptanceCriteria: t.acceptanceCriteria ?? undefined,
      remainingHours:
        t.remainingHours != null
          ? t.remainingHours
          : t.estimatedHours != null
            ? Math.max(0, Math.round((t.estimatedHours - t.actualHours) * 100) / 100)
            : undefined,
      remainingIsManual: t.remainingHours != null,
      bug: t.bug
        ? {
            severity: t.bug.severity,
            stepsToReproduce: t.bug.stepsToReproduce ?? undefined,
            expectedResult: t.bug.expectedResult ?? undefined,
            actualResult: t.bug.actualResult ?? undefined,
            environment: t.bug.environment ?? undefined,
            regression: t.bug.regression ?? false,
            foundInRelease: t.bug.foundInReleaseId
              ? (releaseMap.get(t.bug.foundInReleaseId.toString()) ?? null)
              : null,
          }
        : null,
      links: linksOf(t),
      startedAt: t.startedAt?.toISOString(),
      previousKeys: t.previousKeys ?? [],
      subtaskCount: sub?.total ?? 0,
      subtasksDone: sub?.done ?? 0,
      commentCount: comments.get(t._id.toString()) ?? 0,
      attachmentCount: attachments.get(t._id.toString()) ?? 0,
      rank: t.rank,
      overdue: Boolean(
        t.dueDate && t.dueDate < today && t.status !== 'done' && t.status !== 'cancelled',
      ),
      blockedSince: t.blockedSince?.toISOString(),
      completedAt: t.completedAt?.toISOString(),
      can: {
        update: editable && canWriteTask(auth, 'task:update', t, project, team),
        delete: editable && canWriteTask(auth, 'task:delete', t, project, team),
      },
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  });
}

/** Only values for fields the project still defines are exposed. */
function pickDefined(defs: { key: string }[], values: CustomValues | undefined): CustomValues {
  const out: CustomValues = {};
  if (!values) return out;
  for (const d of defs)
    if (values[d.key] !== undefined && values[d.key] !== null) out[d.key] = values[d.key]!;
  return out;
}
