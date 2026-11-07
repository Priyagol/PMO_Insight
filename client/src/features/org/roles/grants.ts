import type { Permission, PermissionGrant, Scope } from '@arihant/shared';

export const SCOPE_LABELS: Record<Scope, string> = {
  own: 'Own',
  team: 'Team',
  project: 'Project',
  department: 'Department',
  org: 'Organisation',
};

export type GrantMap = Partial<Record<Permission, Scope>>;

export const toMap = (grants: PermissionGrant[]): GrantMap =>
  Object.fromEntries(grants.map((g) => [g.permission, g.scope]));

export const toGrants = (map: GrantMap): PermissionGrant[] =>
  (Object.entries(map) as [Permission, Scope][]).map(([permission, scope]) => ({
    permission,
    scope,
  }));

/** Order-insensitive equality of two grant maps. */
export const sameGrants = (a: GrantMap, b: GrantMap): boolean => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return (
    ka.length === kb.length &&
    ka.every((k, i) => k === kb[i] && a[k as Permission] === b[k as Permission])
  );
};
