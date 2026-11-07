import type { Request } from 'express';
import { Types } from 'mongoose';
import { mergeGrants, type PermissionMap } from '@arihant/shared';
import { UnauthenticatedError } from '../errors';
import { Role } from '../../modules/roles/role.model';
import { User } from '../../modules/users/user.model';

/** The authenticated principal, resolved from the database on every request. */
export interface AuthContext {
  userId: string;
  userObjectId: Types.ObjectId;
  name: string;
  email: string;
  departmentId: string | null;
  roleKeys: string[];
  permissions: PermissionMap;
  isSuperAdmin: boolean;
}

/** Everything a service needs to know about who is acting and from where (for audit). */
export interface RequestContext {
  auth: AuthContext | null;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  /** The caller used a personal API token. */
  viaApiToken?: boolean;
}

export function requestContext(req: Request): RequestContext {
  return {
    auth: req.auth ?? null,
    ip: req.ip,
    userAgent: req.get('user-agent')?.slice(0, 300),
    requestId: req.id,
    viaApiToken: Boolean(req.apiTokenScope),
  };
}

/**
 * Loads the user's current roles and permissions. Doing this per request (one indexed
 * user read + one role read) means role edits, deactivation and logout-all take effect
 * immediately rather than when the access token expires.
 */
export async function loadAuthContext(userId: string, tokenVersion: number): Promise<AuthContext> {
  if (!Types.ObjectId.isValid(userId)) throw new UnauthenticatedError('Invalid session');
  const user = await User.findById(userId)
    .select('name email departmentId roleIds status tokenVersion')
    .lean();
  if (!user || user.status !== 'active' || user.tokenVersion !== tokenVersion) {
    throw new UnauthenticatedError('Session is no longer valid. Please sign in again.');
  }
  const roles = await Role.find({ _id: { $in: user.roleIds } })
    .select('key grants')
    .lean();
  const roleKeys = roles.map((r) => r.key);
  return {
    userId: user._id.toString(),
    userObjectId: user._id,
    name: user.name,
    email: user.email,
    departmentId: user.departmentId ? user.departmentId.toString() : null,
    roleKeys,
    permissions: mergeGrants(roles.flatMap((r) => r.grants)),
    isSuperAdmin: roleKeys.includes('super_admin'),
  };
}

export function requireAuth(rc: RequestContext): AuthContext {
  if (!rc.auth) throw new UnauthenticatedError();
  return rc.auth;
}
