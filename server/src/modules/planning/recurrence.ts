import { Types } from 'mongoose';
import {
  addDays,
  daysBetween,
  nextOccurrence,
  rankBetween,
  type RecurrenceRule,
} from '@arihant/shared';
import { eventBus } from '../../core/events';
import { nextKey } from '../../core/idgen';
import type { RequestContext } from '../../core/rbac/context';
import { isProjectParticipant } from '../../core/rbac/work-access';
import { orgToday } from '../../core/time';
import { recordActivity } from '../collab/activity.service';
import { Project } from '../projects/project.model';
import { Task, type ITask } from '../tasks/task.model';
import { User } from '../users/user.model';

/**
 * First due date of the next occurrence that is not in the past. A task completed late does
 * not create a backlog of already-overdue copies: the series skips ahead to today or later.
 */
export function nextDueDate(
  rule: RecurrenceRule,
  currentDue: string,
  today: string,
): string | null {
  let next = nextOccurrence(rule, currentDue);
  for (let i = 0; next && next < today && i < 2000; i += 1) next = nextOccurrence(rule, next);
  return next;
}

/**
 * Called after a repeating task moves to Done. Creates the next occurrence exactly once
 * (claimed atomically through `nextOccurrenceId`), shifting start and due dates together.
 * Returns the new task id, or null when the series has ended or was already continued.
 */
export async function continueSeries(
  rc: RequestContext,
  taskId: Types.ObjectId,
): Promise<Types.ObjectId | null> {
  const task = await Task.findOne({ _id: taskId, deletedAt: null }).lean();
  if (!task?.recurrence || task.nextOccurrenceId || !task.dueDate) return null;
  const rule: RecurrenceRule = {
    frequency: task.recurrence.frequency,
    interval: task.recurrence.interval ?? 1,
    workdaysOnly: task.recurrence.workdaysOnly ?? false,
    until: task.recurrence.until ?? null,
  };
  const due = nextDueDate(rule, task.dueDate, orgToday());
  if (!due) return null;
  const project = await Project.findById(task.projectId).lean();
  if (!project || project.archived) return null;

  const newId = new Types.ObjectId();
  const claimed = await Task.findOneAndUpdate(
    { _id: task._id, nextOccurrenceId: null },
    { $set: { nextOccurrenceId: newId } },
  ).lean();
  if (!claimed) return null;

  const shift = daysBetween(task.dueDate, due);
  const keepAssignee =
    task.assigneeId &&
    isProjectParticipant(project, task.assigneeId.toString()) &&
    (await User.exists({ _id: task.assigneeId, status: 'active' }));
  const last = await Task.findOne({ projectId: task.projectId, status: 'todo', deletedAt: null })
    .sort({ rank: -1 })
    .select('rank')
    .lean();
  const doc = await Task.create({
    _id: newId,
    key: await nextKey(project.key),
    projectId: task.projectId,
    parentId: null,
    title: task.title,
    description: task.description ?? null,
    status: 'todo',
    priority: task.priority,
    priorityOrder: task.priorityOrder,
    assigneeId: keepAssignee ? task.assigneeId : null,
    reporterId: task.reporterId,
    watcherIds: task.watcherIds,
    startDate: task.startDate ? addDays(task.startDate, shift) : null,
    dueDate: due,
    estimatedHours: task.estimatedHours ?? null,
    complexity: task.complexity ?? null,
    requiredSkills: task.requiredSkills,
    tags: task.tags,
    checklist: task.checklist.map((c) => ({ text: c.text, done: false })),
    recurrence: rule,
    recurrenceSeriesId: task.recurrenceSeriesId ?? task._id,
    recurrenceIndex: (task.recurrenceIndex ?? 1) + 1,
    customFields: task.customFields ?? {},
    rank: rankBetween(last?.rank ?? null, null),
  });
  await recordActivity(rc, {
    projectId: task.projectId,
    entityType: 'task',
    entityId: newId,
    entityLabel: `${doc.key} ${doc.title}`,
    verb: 'created',
    summary: `created ${doc.key}, the next occurrence of repeating task ${task.key} (due ${due})`,
  });
  eventBus.publish(
    'task.created',
    {
      taskId: newId.toString(),
      projectId: task.projectId.toString(),
      recurringFrom: task._id.toString(),
    },
    { actorId: rc.auth?.userId, requestId: rc.requestId },
  );
  return newId;
}

export type { ITask };
