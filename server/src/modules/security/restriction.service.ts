import { Types } from 'mongoose';
import { projectConfidentialSchema, taskRestrictionSchema } from '@arihant/shared';
import { ForbiddenError, UnprocessableError } from '../../core/errors';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { canUpdateProject, isProjectParticipant } from '../../core/rbac/work-access';
import { recordAudit } from '../audit/audit.service';
import { recordActivity } from '../collab/activity.service';
import { loadReadableProject } from '../projects/project.service';
import { Project } from '../projects/project.model';
import { Task } from '../tasks/task.model';
import { loadTask } from '../tasks/task.service';
import { User } from '../users/user.model';

/** Restricts a task to named people (plus assignee, reporter and project managers). */
export async function setTaskRestriction(
  rc: RequestContext,
  taskId: string,
  raw: unknown,
): Promise<{ restricted: boolean; allowedUserIds: string[] }> {
  const auth = requireAuth(rc);
  const input = taskRestrictionSchema.parse(raw);
  const { task, project } = await loadTask(auth, taskId);
  if (!canUpdateProject(auth, project) && !task.reporterId.equals(auth.userObjectId))
    throw new ForbiddenError('Only the project manager or the reporter can restrict this task');
  const ids = [...new Set(input.allowedUserIds)];
  const notMembers = ids.filter((id) => !isProjectParticipant(project, id));
  if (notMembers.length)
    throw new UnprocessableError('People must be on the project to be given access');
  const allowed = input.restricted ? ids.map((id) => new Types.ObjectId(id)) : [];
  await Task.updateOne(
    { _id: task._id },
    { $set: { restricted: input.restricted, allowedUserIds: allowed } },
  );
  const names = allowed.length
    ? (
        await User.find({ _id: { $in: allowed } })
          .select('name')
          .lean()
      ).map((u) => u.name)
    : [];
  const summary = input.restricted
    ? `restricted ${task.key} to ${names.length ? names.join(', ') + ', ' : ''}its assignee, reporter and project managers`
    : `removed the access restriction on ${task.key}`;
  await recordActivity(rc, {
    projectId: task.projectId,
    entityType: 'task',
    entityId: task._id,
    // The title is left out so the project feed does not reveal restricted work.
    entityLabel: task.key,
    verb: 'updated',
    summary,
  });
  await recordAudit(rc, {
    action: 'task.restriction_changed',
    entityType: 'task',
    entityId: task._id,
    summary: `${auth.name} ${summary}`,
    before: {
      restricted: task.restricted ?? false,
      allowedUserIds: (task.allowedUserIds ?? []).map(String),
    },
    after: { restricted: input.restricted, allowedUserIds: ids },
  });
  return { restricted: input.restricted, allowedUserIds: allowed.map(String) };
}

/** Marks a project confidential: only its members and super administrators can see it. */
export async function setProjectConfidential(
  rc: RequestContext,
  projectId: string,
  raw: unknown,
): Promise<{ confidential: boolean }> {
  const auth = requireAuth(rc);
  const { confidential } = projectConfidentialSchema.parse(raw);
  const project = await loadReadableProject(auth, projectId);
  if (!canUpdateProject(auth, project))
    throw new ForbiddenError('Only the project manager can change this');
  await Project.updateOne({ _id: project._id }, { $set: { confidential }, $inc: { version: 1 } });
  await recordAudit(rc, {
    action: 'project.confidentiality_changed',
    entityType: 'project',
    entityId: project._id,
    summary: `${auth.name} marked ${project.key} ${confidential ? 'confidential' : 'not confidential'}`,
    before: { confidential: project.confidential ?? false },
    after: { confidential },
  });
  return { confidential };
}
