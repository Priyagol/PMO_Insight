import { type Types } from 'mongoose';
import {
  DEFAULT_ROLE_GRANTS,
  ORG_ONLY_PERMISSIONS,
  PERMISSIONS,
  ROLE_LABELS,
  SYSTEM_ROLES,
  type PermissionGrant,
  type RoleDto,
  type RoleInput,
} from '@arihant/shared';
import { ConflictError, NotFoundError, UnprocessableError } from '../../core/errors';
import type { RequestContext } from '../../core/rbac/context';
import { recordAudit } from '../audit/audit.service';
import { User } from '../users/user.model';
import { Role, type IRole } from './role.model';

const SUPER_ADMIN_KEY = 'super_admin';
const ALL_ORG_GRANTS: PermissionGrant[] = PERMISSIONS.map((permission) => ({
  permission,
  scope: 'org',
}));

/**
 * Idempotently creates the nine system roles with their default grants. Existing roles
 * keep any edits an administrator made; Super Admin is always reset to every permission.
 */
export async function ensureSystemRoles(): Promise<void> {
  await Role.bulkWrite(
    SYSTEM_ROLES.map((key) =>
      key === SUPER_ADMIN_KEY
        ? {
            updateOne: {
              filter: { key },
              update: {
                $set: { grants: ALL_ORG_GRANTS, isSystem: true },
                $setOnInsert: {
                  name: ROLE_LABELS[key],
                  description: 'Full access to every module and setting.',
                },
              },
              upsert: true,
            },
          }
        : {
            updateOne: {
              filter: { key },
              update: {
                $setOnInsert: {
                  name: ROLE_LABELS[key],
                  grants: DEFAULT_ROLE_GRANTS[key],
                  isSystem: true,
                },
              },
              upsert: true,
            },
          },
    ),
    { ordered: false },
  );
}

/** Rejects duplicate permissions and narrow scopes on administrative permissions. */
function normalizeGrants(grants: PermissionGrant[]): PermissionGrant[] {
  const seen = new Set<string>();
  for (const g of grants) {
    if (seen.has(g.permission))
      throw new UnprocessableError(`Permission "${g.permission}" is listed twice`);
    seen.add(g.permission);
    if (ORG_ONLY_PERMISSIONS.includes(g.permission) && g.scope !== 'org') {
      throw new UnprocessableError(`"${g.permission}" can only be granted organisation-wide`);
    }
  }
  return [...grants].sort(
    (a, b) => PERMISSIONS.indexOf(a.permission) - PERMISSIONS.indexOf(b.permission),
  );
}

function toRoleDto(role: IRole, userCount: number): RoleDto {
  return {
    id: role._id.toString(),
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    locked: role.key === SUPER_ADMIN_KEY,
    grants: role.grants.map((g) => ({ permission: g.permission, scope: g.scope })),
    userCount,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

async function countUsersByRole(): Promise<Map<string, number>> {
  const rows = await User.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { status: { $ne: 'terminated' } } },
    { $unwind: '$roleIds' },
    { $group: { _id: '$roleIds', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.count]));
}

export async function listRoles(): Promise<RoleDto[]> {
  const [roles, counts] = await Promise.all([
    Role.find().sort({ isSystem: -1, name: 1 }).lean(),
    countUsersByRole(),
  ]);
  // Keep system roles in their canonical hierarchy order.
  const order = (r: IRole) => (r.isSystem ? SYSTEM_ROLES.indexOf(r.key as never) : 100);
  return roles
    .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
    .map((r) => toRoleDto(r, counts.get(r._id.toString()) ?? 0));
}

export async function getRole(id: string): Promise<RoleDto> {
  const role = await Role.findById(id).lean();
  if (!role) throw new NotFoundError('Role');
  const count = await User.countDocuments({ roleIds: role._id, status: { $ne: 'terminated' } });
  return toRoleDto(role, count);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

export async function createRole(rc: RequestContext, input: RoleInput): Promise<RoleDto> {
  const base = `custom_${slugify(input.name) || 'role'}`;
  let key = base;
  for (let i = 2; await Role.exists({ key }); i += 1) key = `${base}_${i}`;
  if (
    await Role.exists({
      name: new RegExp(`^${input.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    })
  ) {
    throw new ConflictError('A role with this name already exists');
  }
  const role = await Role.create({
    key,
    name: input.name,
    description: input.description,
    isSystem: false,
    grants: normalizeGrants(input.grants),
  });
  await recordAudit(rc, {
    action: 'role.created',
    entityType: 'role',
    entityId: role._id,
    summary: `Created role "${role.name}" with ${role.grants.length} permissions`,
    after: { name: role.name, grants: role.grants },
  });
  return toRoleDto(role.toObject(), 0);
}

export async function updateRole(
  rc: RequestContext,
  id: string,
  input: Partial<RoleInput>,
): Promise<RoleDto> {
  const role = await Role.findById(id);
  if (!role) throw new NotFoundError('Role');
  if (role.key === SUPER_ADMIN_KEY)
    throw new UnprocessableError('The Super Admin role cannot be modified');
  if (role.isSystem && input.name && input.name !== role.name) {
    throw new UnprocessableError('System roles cannot be renamed');
  }
  const before = { name: role.name, description: role.description, grants: role.toObject().grants };
  if (input.name !== undefined) role.name = input.name;
  if (input.description !== undefined) role.description = input.description;
  if (input.grants !== undefined) role.grants = normalizeGrants(input.grants);
  await role.save();
  await recordAudit(rc, {
    action: 'role.updated',
    entityType: 'role',
    entityId: role._id,
    summary: `Updated role "${role.name}"`,
    before,
    after: { name: role.name, description: role.description, grants: role.toObject().grants },
  });
  return getRole(id);
}

export async function deleteRole(rc: RequestContext, id: string): Promise<void> {
  const role = await Role.findById(id).lean();
  if (!role) throw new NotFoundError('Role');
  if (role.isSystem) throw new UnprocessableError('System roles cannot be deleted');
  const assigned = await User.countDocuments({ roleIds: role._id });
  if (assigned > 0) {
    throw new ConflictError(
      `This role is assigned to ${assigned} employee(s). Reassign them first.`,
    );
  }
  await Role.deleteOne({ _id: role._id });
  await recordAudit(rc, {
    action: 'role.deleted',
    entityType: 'role',
    entityId: role._id,
    summary: `Deleted role "${role.name}"`,
    before: { name: role.name, grants: role.grants },
  });
}

export async function getRoleIdByKey(key: string): Promise<Types.ObjectId> {
  const role = await Role.findOne({ key }).select('_id').lean();
  if (!role) throw new NotFoundError(`Role ${key}`);
  return role._id;
}
