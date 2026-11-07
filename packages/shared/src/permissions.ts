/**
 * Permission catalogue. A permission is `resource:action`; each role grants it
 * with a scope. Backend enforcement lives in the server policy engine; the
 * client only uses these to decide what to render.
 */

export const SCOPES = ['own', 'team', 'project', 'department', 'org'] as const;
export type Scope = (typeof SCOPES)[number];

/** Higher rank = wider visibility. */
export const SCOPE_RANK: Record<Scope, number> = {
  own: 0,
  team: 1,
  project: 2,
  department: 3,
  org: 4,
};

export const PERMISSIONS = [
  'dashboard:view',
  'project:read',
  'project:create',
  'project:update',
  'project:delete',
  'task:read',
  'task:create',
  'task:update',
  'task:delete',
  'assignment:execute',
  'assignment:configure',
  'worklog:read',
  'worklog:write',
  'timesheet:approve',
  'calendar:view',
  'meeting:read',
  'meeting:write',
  'team:read',
  'document:read',
  'document:write',
  'analytics:view',
  'risk:read',
  'risk:write',
  'approval:act',
  'stakeholder:read',
  'stakeholder:write',
  'release:read',
  'release:write',
  'automation:manage',
  'ai:use',
  'user:read',
  'user:manage',
  'department:manage',
  'role:manage',
  'audit:read',
  'settings:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** A permission granted with a scope, e.g. `{ permission: 'task:update', scope: 'project' }`. */
export interface PermissionGrant {
  permission: Permission;
  scope: Scope;
}

/** Map of permission -> widest granted scope, as delivered to the client in the session. */
export type PermissionMap = Partial<Record<Permission, Scope>>;

export function hasPermission(
  map: PermissionMap | null | undefined,
  permission: Permission,
  minScope: Scope = 'own',
): boolean {
  const granted = map?.[permission];
  if (!granted) return false;
  return SCOPE_RANK[granted] >= SCOPE_RANK[minScope];
}

/** Merge grants from several roles, keeping the widest scope per permission. */
export function mergeGrants(grants: readonly PermissionGrant[]): PermissionMap {
  const map: PermissionMap = {};
  for (const { permission, scope } of grants) {
    const current = map[permission];
    if (!current || SCOPE_RANK[scope] > SCOPE_RANK[current]) map[permission] = scope;
  }
  return map;
}
