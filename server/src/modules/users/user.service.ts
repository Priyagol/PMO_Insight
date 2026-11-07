import { Types, type QueryFilter } from 'mongoose';
import type {
  CreateUserInput,
  EmploymentStatus,
  PageMeta,
  UpdateUserInput,
  UserDto,
  UserListQuery,
} from '@arihant/shared';
import { createUserSchema } from '@arihant/shared';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../../core/errors';
import { escapeRegex, toPageMeta, toPageWindow } from '../../core/pagination';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import type { AuthContext } from '../../core/rbac/context';
import { scopeOf, userScopeFilter } from '../../core/rbac/policy';
import { usersSharingProjects } from '../../core/rbac/work-access';
import { recordAudit } from '../audit/audit.service';
import { revokeAllSessions, sendPasswordLink } from '../auth/session.service';
import { Department } from '../departments/department.model';
import { Role } from '../roles/role.model';
import { registerSkills } from '../skills/skill.model';
import { toUserDto, USER_POPULATE, type PopulatedUser } from './user.mapper';
import { User, type IUser } from './user.model';

const oid = (id: string) => new Types.ObjectId(id);

/** Directory visibility: "project" scope means people who share a project with the caller. */
async function directoryFilter(auth: AuthContext): Promise<QueryFilter<IUser>> {
  const scope = scopeOf(auth, 'user:read');
  return scope === 'project' ? usersSharingProjects(auth) : userScopeFilter(auth, scope);
}

async function loadDto(id: Types.ObjectId | string): Promise<UserDto> {
  const doc = await User.findById(id)
    .select('+passwordHash')
    .populate([...USER_POPULATE])
    .lean<PopulatedUser>();
  if (!doc) throw new NotFoundError('Employee');
  return toUserDto(doc);
}

/** Directory listing, limited to the caller's `user:read` scope. */
export async function listUsers(
  rc: RequestContext,
  query: UserListQuery,
): Promise<{ items: UserDto[]; meta: PageMeta }> {
  const auth = requireAuth(rc);
  const filters: QueryFilter<IUser>[] = [await directoryFilter(auth)];
  if (query.departmentId) filters.push({ departmentId: oid(query.departmentId) });
  if (query.roleId) filters.push({ roleIds: oid(query.roleId) });
  if (query.managerId) filters.push({ managerId: oid(query.managerId) });
  filters.push(query.status ? { status: query.status } : { status: { $ne: 'terminated' } });
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filters.push({ $or: [{ name: rx }, { email: rx }, { employeeId: rx }, { designation: rx }] });
  }
  const filter: QueryFilter<IUser> = { $and: filters };
  const win = toPageWindow(
    query,
    ['name', 'employeeId', 'createdAt', 'lastLoginAt', 'designation'],
    {
      name: 1,
      _id: 1,
    },
  );
  const [docs, total] = await Promise.all([
    User.find(filter)
      .select('+passwordHash')
      .sort(win.sort)
      .skip(win.skip)
      .limit(win.limit)
      .populate([...USER_POPULATE])
      .lean<PopulatedUser[]>(),
    User.countDocuments(filter),
  ]);
  return { items: docs.map(toUserDto), meta: toPageMeta(query, total) };
}

/** Returns 404 (not 403) for users outside the caller's scope, so existence is not leaked. */
export async function getUser(rc: RequestContext, id: string): Promise<UserDto> {
  const auth = requireAuth(rc);
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Employee');
  const visible = await User.exists({
    $and: [{ _id: oid(id) }, await directoryFilter(auth)],
  });
  if (!visible) throw new NotFoundError('Employee');
  return loadDto(id);
}

async function assertDepartment(id: string | null | undefined): Promise<void> {
  if (!id) return;
  if (!(await Department.exists({ _id: oid(id), archived: false }))) {
    throw new UnprocessableError('Selected department does not exist');
  }
}

/** Manager must exist, be active, not be the user, and not create a reporting cycle. */
async function assertManager(
  userId: string | null,
  managerId: string | null | undefined,
): Promise<void> {
  if (!managerId) return;
  if (userId && managerId === userId)
    throw new UnprocessableError('An employee cannot report to themselves');
  const manager = await User.findById(managerId).select('status managerId').lean();
  if (!manager || manager.status !== 'active')
    throw new UnprocessableError('Selected manager is not an active employee');
  if (!userId) return;
  let cursor = manager.managerId;
  for (let depth = 0; cursor && depth < 50; depth += 1) {
    if (cursor.toString() === userId)
      throw new UnprocessableError('This manager reports to the employee (reporting cycle)');
    const next = await User.findById(cursor).select('managerId').lean();
    cursor = next?.managerId ?? null;
  }
}

/** Only a Super Admin may grant the Super Admin role. */
async function assertRoles(rc: RequestContext, roleIds: string[]): Promise<Types.ObjectId[]> {
  const auth = requireAuth(rc);
  const unique = [...new Set(roleIds)];
  const roles = await Role.find({ _id: { $in: unique.map(oid) } })
    .select('key')
    .lean();
  if (roles.length !== unique.length)
    throw new UnprocessableError('One or more selected roles do not exist');
  if (roles.some((r) => r.key === 'super_admin') && !auth.isSuperAdmin) {
    throw new ForbiddenError('Only a Super Admin can grant the Super Admin role');
  }
  return roles.map((r) => r._id);
}

async function activeSuperAdminCount(excludeUserId?: string): Promise<number> {
  const role = await Role.findOne({ key: 'super_admin' }).select('_id').lean();
  if (!role) return 0;
  return User.countDocuments({
    roleIds: role._id,
    status: 'active',
    ...(excludeUserId ? { _id: { $ne: oid(excludeUserId) } } : {}),
  });
}

export async function createUser(
  rc: RequestContext,
  raw: CreateUserInput,
): Promise<{ user: UserDto; inviteSent: boolean }> {
  const auth = requireAuth(rc);
  const input = createUserSchema.parse(raw);
  await assertDepartment(input.departmentId);
  await assertManager(null, input.managerId);
  const roleIds = await assertRoles(rc, input.roleIds);
  await registerSkills(input.skills.map((s) => s.name));

  const created = await User.create({
    employeeId: input.employeeId,
    name: input.name,
    email: input.email,
    phone: input.phone,
    designation: input.designation,
    departmentId: input.departmentId ? oid(input.departmentId) : null,
    managerId: input.managerId ? oid(input.managerId) : null,
    roleIds,
    skills: input.skills,
    weeklyCapacityHours: input.weeklyCapacityHours,
    joinedAt: input.joinedAt ? new Date(input.joinedAt) : undefined,
    status: 'active',
    createdBy: auth.userObjectId,
  });

  const inviteSent = await sendPasswordLink(created, 'invite', auth.userObjectId);
  const user = await loadDto(created._id);
  await recordAudit(rc, {
    action: 'user.created',
    entityType: 'user',
    entityId: created._id,
    summary: `Created employee ${user.name} (${user.employeeId}) with roles ${user.roles.map((r) => r.name).join(', ')}`,
    after: user,
  });
  return { user, inviteSent };
}

export async function updateUser(
  rc: RequestContext,
  id: string,
  input: UpdateUserInput,
): Promise<UserDto> {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Employee');
  const user = await User.findById(id);
  if (!user) throw new NotFoundError('Employee');
  const before = await loadDto(id);

  if (input.departmentId !== undefined) await assertDepartment(input.departmentId);
  if (input.managerId !== undefined) await assertManager(id, input.managerId);
  if (input.skills) await registerSkills(input.skills.map((s) => s.name));

  const { departmentId, managerId, joinedAt, ...rest } = input;
  user.set(rest);
  if (departmentId !== undefined) user.departmentId = departmentId ? oid(departmentId) : null;
  if (managerId !== undefined) user.managerId = managerId ? oid(managerId) : null;
  if (joinedAt !== undefined) user.joinedAt = joinedAt ? new Date(joinedAt) : undefined;
  await user.save();

  const after = await loadDto(id);
  await recordAudit(rc, {
    action: 'user.updated',
    entityType: 'user',
    entityId: user._id,
    summary: `Updated employee ${after.name} (${after.employeeId})`,
    before,
    after,
  });
  return after;
}

export async function setUserStatus(
  rc: RequestContext,
  id: string,
  status: EmploymentStatus,
): Promise<UserDto> {
  const auth = requireAuth(rc);
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Employee');
  if (id === auth.userId && status !== 'active')
    throw new UnprocessableError('You cannot deactivate your own account');
  const user = await User.findById(id).populate('roleIds', 'key');
  if (!user) throw new NotFoundError('Employee');
  const previous = user.status;
  if (previous === status) return loadDto(id);

  const isSuper = (user.roleIds as unknown as { key: string }[]).some(
    (r) => r.key === 'super_admin',
  );
  if (isSuper && status !== 'active' && (await activeSuperAdminCount(id)) === 0) {
    throw new UnprocessableError('At least one active Super Admin is required');
  }
  await User.updateOne({ _id: user._id }, { $set: { status } });
  if (status !== 'active') await revokeAllSessions(user._id, 'deactivated');

  const dto = await loadDto(id);
  await recordAudit(rc, {
    action: 'user.status_changed',
    entityType: 'user',
    entityId: user._id,
    summary: `Changed status of ${dto.name} from ${previous} to ${status}`,
    before: { status: previous },
    after: { status },
  });
  return dto;
}

export async function setUserRoles(
  rc: RequestContext,
  id: string,
  roleIds: string[],
): Promise<UserDto> {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Employee');
  const user = await User.findById(id).populate('roleIds', 'key name');
  if (!user) throw new NotFoundError('Employee');
  const currentRoles = user.roleIds as unknown as {
    _id: Types.ObjectId;
    key: string;
    name: string;
  }[];
  const nextIds = await assertRoles(rc, roleIds);
  const nextRoles = await Role.find({ _id: { $in: nextIds } })
    .select('key name')
    .lean();

  const losesSuper =
    currentRoles.some((r) => r.key === 'super_admin') &&
    !nextRoles.some((r) => r.key === 'super_admin');
  if (losesSuper) {
    if (!requireAuth(rc).isSuperAdmin)
      throw new ForbiddenError('Only a Super Admin can remove the Super Admin role');
    if (user.status === 'active' && (await activeSuperAdminCount(id)) === 0) {
      throw new UnprocessableError('At least one active Super Admin is required');
    }
  }
  await User.updateOne({ _id: user._id }, { $set: { roleIds: nextIds } });
  const dto = await loadDto(id);
  await recordAudit(rc, {
    action: 'user.roles_changed',
    entityType: 'user',
    entityId: user._id,
    summary: `Changed roles of ${dto.name}: ${currentRoles.map((r) => r.name).join(', ') || 'none'} → ${dto.roles
      .map((r) => r.name)
      .join(', ')}`,
    before: { roles: currentRoles.map((r) => r.key) },
    after: { roles: dto.roles.map((r) => r.key) },
  });
  return dto;
}

export async function resendInvite(rc: RequestContext, id: string): Promise<{ sent: boolean }> {
  const auth = requireAuth(rc);
  const user = Types.ObjectId.isValid(id)
    ? await User.findById(id).select('+passwordHash').lean()
    : null;
  if (!user) throw new NotFoundError('Employee');
  if (user.passwordHash)
    throw new ConflictError('This employee has already activated their account');
  if (user.status !== 'active')
    throw new UnprocessableError('Only active employees can be invited');
  const sent = await sendPasswordLink(user, 'invite', auth.userObjectId);
  await recordAudit(rc, {
    action: 'user.invite_sent',
    entityType: 'user',
    entityId: user._id,
    summary: `Re-sent account invite to ${user.name}`,
  });
  return { sent };
}

export async function sendResetLink(rc: RequestContext, id: string): Promise<{ sent: boolean }> {
  const auth = requireAuth(rc);
  const user = Types.ObjectId.isValid(id)
    ? await User.findById(id).select('+passwordHash').lean()
    : null;
  if (!user) throw new NotFoundError('Employee');
  if (!user.passwordHash)
    throw new ConflictError(
      'This employee has not activated their account yet; resend the invite instead',
    );
  if (user.status !== 'active')
    throw new UnprocessableError('Only active employees can reset their password');
  const sent = await sendPasswordLink(user, 'reset', auth.userObjectId);
  await recordAudit(rc, {
    action: 'user.password_reset_sent',
    entityType: 'user',
    entityId: user._id,
    summary: `Sent a password reset link to ${user.name}`,
  });
  return { sent };
}

export { loadDto as loadUserDto };
