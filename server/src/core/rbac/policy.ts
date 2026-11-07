import { Types, type QueryFilter } from 'mongoose';
import { hasPermission, type Permission, type Scope } from '@arihant/shared';
import { ForbiddenError } from '../errors';
import type { AuthContext } from './context';
import type { IUser } from '../../modules/users/user.model';

/** Returns the scope at which the user holds a permission, or throws 403. */
export function scopeOf(auth: AuthContext, permission: Permission): Scope {
  const scope = auth.permissions[permission];
  if (!scope) throw new ForbiddenError();
  return scope;
}

export function can(auth: AuthContext, permission: Permission, minScope: Scope = 'own'): boolean {
  return hasPermission(auth.permissions, permission, minScope);
}

export function assertCan(
  auth: AuthContext,
  permission: Permission,
  minScope: Scope = 'own',
): void {
  if (!can(auth, permission, minScope)) throw new ForbiddenError();
}

/**
 * Mongo filter limiting user-directory reads to the caller's scope. Every list, export
 * and detail query on users must AND this in, so results never exceed what the user may see.
 *
 * - own:        only themselves
 * - team:       themselves and their direct reports
 * - project:    same as department until projects exist (Phase 3 adds shared-project members)
 * - department: everyone in their department (only themselves if they have no department)
 * - org:        everyone
 */
export function userScopeFilter(auth: AuthContext, scope: Scope): QueryFilter<IUser> {
  switch (scope) {
    case 'org':
      return {};
    case 'department':
    case 'project':
      return auth.departmentId
        ? { departmentId: new Types.ObjectId(auth.departmentId) }
        : { _id: auth.userObjectId };
    case 'team':
      return { $or: [{ _id: auth.userObjectId }, { managerId: auth.userObjectId }] };
    case 'own':
    default:
      return { _id: auth.userObjectId };
  }
}
