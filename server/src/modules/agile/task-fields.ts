import { Types } from 'mongoose';
import type { BugSeverity, IssueType, TaskStatus } from '@arihant/shared';
import { UnprocessableError } from '../../core/errors';
import { Release } from '../delivery/delivery.models';
import type { IProject } from '../projects/project.model';
import { Task, type ITask } from '../tasks/task.model';
import { Sprint } from './sprint.model';

const oid = (id: string) => new Types.ObjectId(id);

/** Agile / defect fields as accepted by create and update (all optional). */
export interface AgileFieldInput {
  type?: IssueType;
  storyPoints?: number | null;
  epicId?: string | null;
  sprintId?: string | null;
  components?: string[];
  fixReleaseId?: string | null;
  acceptanceCriteria?: string | null;
  remainingHours?: number | null;
  bug?: {
    severity?: BugSeverity;
    stepsToReproduce?: string | null;
    expectedResult?: string | null;
    actualResult?: string | null;
    environment?: string | null;
    regression?: boolean;
    foundInReleaseId?: string | null;
  } | null;
}

/**
 * Validates the Phase 9A fields against the project and returns the `$set` values.
 * `current` is the stored task for updates (undefined on create).
 */
export async function resolveAgileFields(
  project: IProject,
  input: AgileFieldInput,
  current?: Pick<ITask, '_id' | 'type' | 'parentId' | 'epicId' | 'bug' | 'fixReleaseId'> & {
    parentIdNext?: Types.ObjectId | null;
  },
): Promise<Record<string, unknown>> {
  const set: Record<string, unknown> = {};
  const type = input.type ?? current?.type ?? 'task';
  const parentId = current ? (current.parentIdNext ?? current.parentId) : undefined;

  if (input.type !== undefined && current && input.type !== current.type) {
    if (current.type === 'epic' && (await Task.exists({ epicId: current._id, deletedAt: null })))
      throw new UnprocessableError('Move the tasks out of this epic before changing its type');
  }
  if (input.type !== undefined) set.type = input.type;
  if (type === 'epic') {
    if (parentId) throw new UnprocessableError('An epic cannot be a subtask');
    const epicNext = input.epicId !== undefined ? input.epicId : current?.epicId;
    if (epicNext) throw new UnprocessableError('An epic cannot belong to another epic');
  }

  if (input.storyPoints !== undefined) set.storyPoints = input.storyPoints;
  if (input.acceptanceCriteria !== undefined)
    set.acceptanceCriteria = input.acceptanceCriteria || null;
  if (input.remainingHours !== undefined) set.remainingHours = input.remainingHours;

  if (input.epicId !== undefined) {
    if (input.epicId) {
      if (current && input.epicId === current._id.toString())
        throw new UnprocessableError('A task cannot be its own epic');
      const epic = await Task.findOne({ _id: oid(input.epicId), deletedAt: null })
        .select('projectId type')
        .lean();
      if (!epic || !epic.projectId.equals(project._id) || epic.type !== 'epic')
        throw new UnprocessableError('Choose an epic from the same project');
    }
    set.epicId = input.epicId ? oid(input.epicId) : null;
  }

  if (input.sprintId !== undefined) {
    if (input.sprintId) {
      const sprint = await Sprint.findOne({ _id: oid(input.sprintId), deletedAt: null })
        .select('projectId status')
        .lean();
      if (!sprint || !sprint.projectId.equals(project._id))
        throw new UnprocessableError('Choose a sprint from the same project');
      if (sprint.status === 'completed')
        throw new UnprocessableError('That sprint is already completed');
      if (type === 'epic') throw new UnprocessableError('Epics are not planned into sprints');
    }
    set.sprintId = input.sprintId ? oid(input.sprintId) : null;
  }

  if (input.components !== undefined) {
    const known = new Map((project.components ?? []).map((c) => [c.name.toLowerCase(), c.name]));
    const names = [...new Set(input.components.map((c) => c.trim()))];
    const unknown = names.filter((n) => !known.has(n.toLowerCase()));
    if (unknown.length)
      throw new UnprocessableError(
        `Unknown component: ${unknown.join(', ')}. Add it in project setup first.`,
      );
    set.components = names.map((n) => known.get(n.toLowerCase())!);
  }

  if (input.fixReleaseId !== undefined) {
    if (input.fixReleaseId) await assertReleaseInProject(input.fixReleaseId, project._id);
    set.fixReleaseId = input.fixReleaseId ? oid(input.fixReleaseId) : null;
  }

  if (input.bug !== undefined || input.type !== undefined) {
    if (type !== 'bug') {
      if (input.bug) throw new UnprocessableError('Bug details apply to bugs only');
      if (current?.bug || input.type !== undefined) set.bug = null;
    } else if (input.bug !== undefined || (input.type === 'bug' && !current?.bug)) {
      const b = input.bug ?? {};
      if (b.foundInReleaseId) await assertReleaseInProject(b.foundInReleaseId, project._id);
      set.bug = {
        severity: b.severity ?? current?.bug?.severity ?? 'major',
        stepsToReproduce: b.stepsToReproduce ?? null,
        expectedResult: b.expectedResult ?? null,
        actualResult: b.actualResult ?? null,
        environment: b.environment ?? null,
        regression: b.regression ?? false,
        foundInReleaseId: b.foundInReleaseId ? oid(b.foundInReleaseId) : null,
      };
    }
  }
  return set;
}

async function assertReleaseInProject(id: string, projectId: Types.ObjectId) {
  const r = await Release.findOne({ _id: oid(id) })
    .select('projectId')
    .lean();
  if (!r || !r.projectId.equals(projectId))
    throw new UnprocessableError('Choose a release from the same project');
}

/** Keeps a release's task list in step with the tasks' fix version. */
export async function syncFixRelease(
  taskId: Types.ObjectId,
  from: Types.ObjectId | null | undefined,
  to: Types.ObjectId | null | undefined,
): Promise<void> {
  if (from && (!to || !from.equals(to)))
    await Release.updateOne({ _id: from }, { $pull: { taskIds: taskId } });
  if (to && (!from || !from.equals(to)))
    await Release.updateOne({ _id: to }, { $addToSet: { taskIds: taskId } });
}

/** startedAt is set the first time work starts (in progress, review or testing) and kept afterwards. */
export function startedAtFor(
  task: Pick<ITask, 'startedAt'> | undefined,
  to: TaskStatus,
): Date | undefined {
  if (['in_progress', 'in_review', 'testing'].includes(to) && !task?.startedAt) return new Date();
  return undefined;
}
