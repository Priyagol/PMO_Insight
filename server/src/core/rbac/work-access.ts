import { Types, type QueryFilter } from 'mongoose';
import type { Permission, Scope } from '@arihant/shared';
import { Project, type IProject } from '../../modules/projects/project.model';
import { Task, type ITask } from '../../modules/tasks/task.model';
import { User, type IUser } from '../../modules/users/user.model';
import type { AuthContext } from './context';

/**
 * Record-level access rules for projects and tasks.
 *
 * Scope meaning for project/task permissions:
 * - org:        every project / task
 * - department: projects of the user's department, plus projects they belong to
 * - project:    projects the user belongs to (member, manager or business owner)
 * - team:       projects where the user or a direct report belongs; tasks assigned to them
 * - own:        projects they belong to; tasks assigned to, reported by or watched by them
 */

const oid = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

export function isProjectParticipant(
  project: Pick<IProject, 'members' | 'managerId' | 'ownerId'>,
  userId: string,
): boolean {
  return (
    project.managerId?.toString() === userId ||
    project.ownerId?.toString() === userId ||
    project.members.some((m) => m.userId.toString() === userId)
  );
}

function participantFilter(userIds: Types.ObjectId[]): QueryFilter<IProject> {
  return {
    $or: [
      { 'members.userId': { $in: userIds } },
      { managerId: { $in: userIds } },
      { ownerId: { $in: userIds } },
    ],
  };
}

async function teamIds(auth: AuthContext): Promise<Types.ObjectId[]> {
  const reports = await User.find({ managerId: auth.userObjectId }).select('_id').lean();
  return [auth.userObjectId, ...reports.map((r) => r._id)];
}

/**
 * Confidential projects (Phase 9E) the user may not see: only their participants and super
 * administrators see them, whatever the user's scope.
 */
export async function hiddenProjectIds(auth: AuthContext): Promise<Types.ObjectId[]> {
  if (auth.isSuperAdmin) return [];
  const rows = await Project.find({
    confidential: true,
    $nor: [participantFilter([auth.userObjectId])],
  })
    .select('_id')
    .lean();
  return rows.map((r) => r._id);
}

/** Mongo filter for projects visible at the given scope. */
export async function projectScopeFilter(
  auth: AuthContext,
  scope: Scope,
): Promise<QueryFilter<IProject>> {
  const base = await scopeOnlyFilter(auth, scope);
  const hidden = await hiddenProjectIds(auth);
  return hidden.length ? { $and: [base, { _id: { $nin: hidden } }] } : base;
}

async function scopeOnlyFilter(auth: AuthContext, scope: Scope): Promise<QueryFilter<IProject>> {
  switch (scope) {
    case 'org':
      return {};
    case 'department':
      return auth.departmentId
        ? {
            $or: [{ departmentId: oid(auth.departmentId) }, participantFilter([auth.userObjectId])],
          }
        : participantFilter([auth.userObjectId]);
    case 'team':
      return participantFilter(await teamIds(auth));
    case 'project':
    case 'own':
    default:
      return participantFilter([auth.userObjectId]);
  }
}

/** Project ids readable by the user, or 'all'. */
export async function readableProjectIds(auth: AuthContext): Promise<Types.ObjectId[] | 'all'> {
  const scope = auth.permissions['project:read'];
  if (!scope) return [];
  if (scope === 'org' && !(await hiddenProjectIds(auth)).length) return 'all';
  const docs = await Project.find(await projectScopeFilter(auth, scope))
    .select('_id')
    .lean();
  return docs.map((d) => d._id);
}

/** Mongo filter for tasks the user may read (always excludes soft-deleted tasks). */
export async function taskReadFilter(auth: AuthContext): Promise<QueryFilter<ITask>> {
  const scoped = await scopedTaskFilter(auth);
  const [hidden, restriction] = await Promise.all([
    hiddenProjectIds(auth),
    restrictedTaskClause(auth),
  ]);
  const extra: QueryFilter<ITask>[] = [];
  if (hidden.length) extra.push({ projectId: { $nin: hidden } });
  if (restriction) extra.push(restriction);
  return extra.length ? { $and: [scoped, ...extra] } : scoped;
}

/** Projects whose restricted tasks the user may see because they manage the project. */
async function managedProjectFilter(auth: AuthContext): Promise<QueryFilter<IProject> | 'all'> {
  const scope = auth.permissions['project:update'];
  const me = auth.userObjectId;
  const leads = {
    $or: [
      { managerId: me },
      { members: { $elemMatch: { userId: me, role: { $in: ['manager', 'lead'] } } } },
    ],
  };
  switch (scope) {
    case 'org':
      return 'all';
    case 'department':
      return auth.departmentId
        ? { $or: [{ departmentId: oid(auth.departmentId) }, participantFilter([me])] }
        : participantFilter([me]);
    case 'project':
    case 'team':
      return leads;
    case 'own':
      return { managerId: me };
    default:
      return { _id: { $in: [] } };
  }
}

/**
 * Restricted tasks (Phase 9E) are visible only to the people listed on them, their assignee and
 * reporter, the managers of their project and super administrators. Null = no restriction applies.
 */
export async function restrictedTaskClause(auth: AuthContext): Promise<QueryFilter<ITask> | null> {
  if (auth.isSuperAdmin) return null;
  const managed = await managedProjectFilter(auth);
  if (managed === 'all') return null;
  const projects = await Project.find(managed).select('_id').lean();
  return {
    $or: [
      { restricted: { $ne: true } },
      { allowedUserIds: auth.userObjectId },
      { assigneeId: auth.userObjectId },
      { reporterId: auth.userObjectId },
      { projectId: { $in: projects.map((p) => p._id) } },
    ],
  };
}

/** Restricted tasks of a project the user may not see (to leave them out of activity feeds). */
export async function hiddenRestrictedTasks(
  auth: AuthContext,
  projectId: Types.ObjectId,
): Promise<Types.ObjectId[]> {
  const clause = await restrictedTaskClause(auth);
  if (!clause) return [];
  const rows = await Task.find({ projectId, restricted: true, $nor: [clause] })
    .select('_id')
    .lean();
  return rows.map((r) => r._id);
}

async function scopedTaskFilter(auth: AuthContext): Promise<QueryFilter<ITask>> {
  const scope = auth.permissions['task:read'];
  if (!scope) return { _id: { $in: [] } };
  const base: QueryFilter<ITask> = { deletedAt: null };
  switch (scope) {
    case 'org':
      return base;
    case 'department':
    case 'project': {
      const projects = await Project.find(await projectScopeFilter(auth, scope))
        .select('_id')
        .lean();
      return { ...base, projectId: { $in: projects.map((p) => p._id) } };
    }
    case 'team':
      return {
        ...base,
        $or: [{ assigneeId: { $in: await teamIds(auth) } }, { reporterId: auth.userObjectId }],
      };
    case 'own':
    default:
      return {
        ...base,
        $or: [
          { assigneeId: auth.userObjectId },
          { reporterId: auth.userObjectId },
          { watcherIds: auth.userObjectId },
        ],
      };
  }
}

type ProjectLike = Pick<IProject, 'members' | 'managerId' | 'ownerId' | 'departmentId'>;

/** Project-level write rule shared by update / archive / member management. */
function projectWrite(auth: AuthContext, permission: Permission, project: ProjectLike): boolean {
  const scope = auth.permissions[permission];
  switch (scope) {
    case 'org':
      return true;
    case 'department':
      return (
        (auth.departmentId !== null && project.departmentId?.toString() === auth.departmentId) ||
        isProjectParticipant(project, auth.userId)
      );
    case 'project':
    case 'team':
      // Managers and leads of the project may change it; plain members may not.
      return (
        project.managerId.toString() === auth.userId ||
        project.members.some(
          (m) => m.userId.toString() === auth.userId && (m.role === 'manager' || m.role === 'lead'),
        )
      );
    case 'own':
      return project.managerId.toString() === auth.userId;
    default:
      return false;
  }
}

export const canUpdateProject = (auth: AuthContext, p: ProjectLike) =>
  projectWrite(auth, 'project:update', p);
export const canArchiveProject = (auth: AuthContext, p: ProjectLike) =>
  projectWrite(auth, 'project:delete', p);

export function canCreateTaskIn(auth: AuthContext, project: ProjectLike): boolean {
  const scope = auth.permissions['task:create'];
  if (!scope) return false;
  if (scope === 'org') return true;
  if (
    scope === 'department' &&
    auth.departmentId &&
    project.departmentId?.toString() === auth.departmentId
  )
    return true;
  return isProjectParticipant(project, auth.userId);
}

/** Task-level write rule for task:update / task:delete. `teamMemberIds` is needed only for team scope. */
export function canWriteTask(
  auth: AuthContext,
  permission: 'task:update' | 'task:delete',
  task: Pick<ITask, 'assigneeId' | 'reporterId'>,
  project: ProjectLike,
  teamMemberIds?: string[],
): boolean {
  const scope = auth.permissions[permission];
  const assignee = task.assigneeId?.toString();
  switch (scope) {
    case 'org':
      return true;
    case 'department':
      return (
        (auth.departmentId !== null && project.departmentId?.toString() === auth.departmentId) ||
        isProjectParticipant(project, auth.userId)
      );
    case 'project':
      return isProjectParticipant(project, auth.userId);
    case 'team':
      return (
        Boolean(assignee && teamMemberIds?.includes(assignee)) ||
        task.reporterId.toString() === auth.userId
      );
    case 'own':
      return assignee === auth.userId || task.reporterId.toString() === auth.userId;
    default:
      return false;
  }
}

export async function teamMemberIds(auth: AuthContext): Promise<string[]> {
  return (await teamIds(auth)).map((id) => id.toString());
}

/** Users who share at least one (non-archived) project with the caller: the directory's "project" scope. */
export async function usersSharingProjects(auth: AuthContext): Promise<QueryFilter<IUser>> {
  const projects = await Project.find({
    archived: false,
    ...participantFilter([auth.userObjectId]),
  })
    .select('members managerId ownerId')
    .lean();
  const ids = new Set<string>([auth.userId]);
  for (const p of projects) {
    ids.add(p.managerId.toString());
    if (p.ownerId) ids.add(p.ownerId.toString());
    for (const m of p.members) ids.add(m.userId.toString());
  }
  return { _id: { $in: [...ids].map((id) => new Types.ObjectId(id)) } };
}

/**
 * People whose records (work logs, timesheets, leave, workload) the caller may see
 * at a scope: own = self, team = self + direct reports, project = people sharing a
 * project, department = same department, org = everyone.
 */
export async function peopleFilter(
  auth: AuthContext,
  scope: Scope | undefined,
): Promise<QueryFilter<IUser>> {
  switch (scope) {
    case 'org':
      return {};
    case 'department':
      return auth.departmentId
        ? { departmentId: new Types.ObjectId(auth.departmentId) }
        : { _id: auth.userObjectId };
    case 'project':
      return usersSharingProjects(auth);
    case 'team':
      return { $or: [{ _id: auth.userObjectId }, { managerId: auth.userObjectId }] };
    case 'own':
      return { _id: auth.userObjectId };
    default:
      return { _id: { $in: [] } };
  }
}

/** Ids of people visible for a permission, or 'all' for organisation scope. */
export async function visiblePeople(
  auth: AuthContext,
  permission: Permission,
): Promise<Types.ObjectId[] | 'all'> {
  const scope = auth.permissions[permission];
  if (scope === 'org') return 'all';
  const users = await User.find(await peopleFilter(auth, scope))
    .select('_id')
    .lean();
  return users.map((u) => u._id);
}

export async function canSeePerson(
  auth: AuthContext,
  permission: Permission,
  userId: string,
): Promise<boolean> {
  if (userId === auth.userId && auth.permissions[permission]) return true;
  const visible = await visiblePeople(auth, permission);
  return visible === 'all' || visible.some((id) => id.toString() === userId);
}
