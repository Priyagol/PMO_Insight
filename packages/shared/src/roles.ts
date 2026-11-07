import type { SystemRole } from './enums';
import type { Permission, PermissionGrant, Scope } from './permissions';
import { PERMISSIONS } from './permissions';

/** Human-readable catalogue for the Roles & Permissions editor. */
export const PERMISSION_GROUPS: {
  resource: string;
  label: string;
  permissions: { key: Permission; label: string }[];
}[] = [
  {
    resource: 'dashboard',
    label: 'Dashboard',
    permissions: [{ key: 'dashboard:view', label: 'View dashboards' }],
  },
  {
    resource: 'project',
    label: 'Projects',
    permissions: [
      { key: 'project:read', label: 'View projects' },
      { key: 'project:create', label: 'Create projects' },
      { key: 'project:update', label: 'Edit projects' },
      { key: 'project:delete', label: 'Archive / delete projects' },
    ],
  },
  {
    resource: 'task',
    label: 'Tasks',
    permissions: [
      { key: 'task:read', label: 'View tasks' },
      { key: 'task:create', label: 'Create tasks' },
      { key: 'task:update', label: 'Edit tasks' },
      { key: 'task:delete', label: 'Delete tasks' },
    ],
  },
  {
    resource: 'assignment',
    label: 'Smart assignment',
    permissions: [
      { key: 'assignment:execute', label: 'Assign, batch-assign and rebalance' },
      { key: 'assignment:configure', label: 'Configure assignment weights' },
    ],
  },
  {
    resource: 'worklog',
    label: 'Work logs & timesheets',
    permissions: [
      { key: 'worklog:read', label: 'View work logs' },
      { key: 'worklog:write', label: 'Log work' },
      { key: 'timesheet:approve', label: 'Approve timesheets' },
    ],
  },
  {
    resource: 'calendar',
    label: 'Calendar',
    permissions: [{ key: 'calendar:view', label: 'View calendar' }],
  },
  {
    resource: 'meeting',
    label: 'Meetings',
    permissions: [
      { key: 'meeting:read', label: 'View meetings' },
      { key: 'meeting:write', label: 'Manage meetings & minutes' },
    ],
  },
  {
    resource: 'team',
    label: 'Teams & resources',
    permissions: [{ key: 'team:read', label: 'View capacity & workload' }],
  },
  {
    resource: 'document',
    label: 'Documents',
    permissions: [
      { key: 'document:read', label: 'View documents' },
      { key: 'document:write', label: 'Upload & edit documents' },
    ],
  },
  {
    resource: 'analytics',
    label: 'Analytics',
    permissions: [{ key: 'analytics:view', label: 'View analytics & reports' }],
  },
  {
    resource: 'risk',
    label: 'Risks & issues',
    permissions: [
      { key: 'risk:read', label: 'View risks' },
      { key: 'risk:write', label: 'Raise & manage risks' },
    ],
  },
  {
    resource: 'approval',
    label: 'Approvals',
    permissions: [{ key: 'approval:act', label: 'Approve / reject requests' }],
  },
  {
    resource: 'stakeholder',
    label: 'Stakeholders',
    permissions: [
      { key: 'stakeholder:read', label: 'View stakeholders' },
      { key: 'stakeholder:write', label: 'Manage stakeholders' },
    ],
  },
  {
    resource: 'release',
    label: 'Releases',
    permissions: [
      { key: 'release:read', label: 'View releases' },
      { key: 'release:write', label: 'Manage releases' },
    ],
  },
  {
    resource: 'automation',
    label: 'Automation',
    permissions: [{ key: 'automation:manage', label: 'Manage automations' }],
  },
  {
    resource: 'ai',
    label: 'AI assistant',
    permissions: [{ key: 'ai:use', label: 'Use AI assistant' }],
  },
  {
    resource: 'admin',
    label: 'Administration',
    permissions: [
      { key: 'user:read', label: 'View employee directory' },
      { key: 'user:manage', label: 'Manage employees' },
      { key: 'department:manage', label: 'Manage departments' },
      { key: 'role:manage', label: 'Manage roles & permissions' },
      { key: 'audit:read', label: 'View audit logs' },
      { key: 'settings:manage', label: 'Manage system settings' },
    ],
  },
];

/** Permissions where only the "org" scope is meaningful (administrative actions). */
export const ORG_ONLY_PERMISSIONS: readonly Permission[] = [
  'user:manage',
  'department:manage',
  'role:manage',
  'audit:read',
  'settings:manage',
  'assignment:configure',
];

const grants = (scope: Scope, permissions: readonly Permission[]): PermissionGrant[] =>
  permissions.map((permission) => ({ permission, scope }));

/**
 * Seeded default grants per system role (architecture §11). Administrators can edit
 * them afterwards, except Super Admin, which always holds every permission.
 */
export const DEFAULT_ROLE_GRANTS: Record<SystemRole, PermissionGrant[]> = {
  super_admin: grants('org', PERMISSIONS),
  director: grants('org', [
    'dashboard:view',
    'project:read',
    'project:create',
    'project:update',
    'task:read',
    'task:create',
    'task:update',
    'assignment:execute',
    'worklog:read',
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
    'ai:use',
    'user:read',
    'audit:read',
  ]).concat(grants('own', ['worklog:write'])),
  department_head: grants('department', [
    'dashboard:view',
    'project:read',
    'project:create',
    'project:update',
    'task:read',
    'task:create',
    'task:update',
    'task:delete',
    'assignment:execute',
    'worklog:read',
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
    'release:read',
    'automation:manage',
    'ai:use',
    'user:read',
  ]).concat(grants('own', ['worklog:write'])),
  project_manager: grants('project', [
    'dashboard:view',
    'project:read',
    'project:create',
    'project:update',
    'task:read',
    'task:create',
    'task:update',
    'task:delete',
    'assignment:execute',
    'worklog:read',
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
  ]).concat(grants('department', ['user:read']), grants('own', ['worklog:write'])),
  team_lead: grants('project', [
    'project:read',
    'task:read',
    'task:create',
    'task:update',
    'meeting:read',
    'meeting:write',
    'document:read',
    'document:write',
    'risk:read',
    'risk:write',
    'release:read',
    'stakeholder:read',
  ]).concat(
    grants('team', [
      'dashboard:view',
      'assignment:execute',
      'worklog:read',
      'timesheet:approve',
      'team:read',
      'analytics:view',
      'approval:act',
      'ai:use',
      'calendar:view',
    ]),
    grants('department', ['user:read']),
    grants('own', ['worklog:write']),
  ),
  developer: grants('project', [
    'project:read',
    'task:read',
    'task:create',
    'meeting:read',
    'document:read',
    'document:write',
    'risk:read',
    'risk:write',
    'release:read',
  ]).concat(
    grants('own', [
      'dashboard:view',
      'task:update',
      'worklog:read',
      'worklog:write',
      'calendar:view',
      'analytics:view',
      'ai:use',
    ]),
    grants('department', ['user:read']),
  ),
  qa_tester: grants('project', [
    'project:read',
    'task:read',
    'task:create',
    'meeting:read',
    'document:read',
    'document:write',
    'risk:read',
    'risk:write',
    'release:read',
  ]).concat(
    grants('own', [
      'dashboard:view',
      'task:update',
      'worklog:read',
      'worklog:write',
      'calendar:view',
      'analytics:view',
      'ai:use',
    ]),
    grants('department', ['user:read']),
  ),
  employee: grants('project', ['project:read', 'meeting:read', 'document:read']).concat(
    grants('own', [
      'dashboard:view',
      'task:read',
      'task:update',
      'worklog:read',
      'worklog:write',
      'calendar:view',
      'analytics:view',
      'ai:use',
    ]),
    grants('department', ['user:read']),
  ),
  external_stakeholder: grants('project', ['project:read', 'document:read', 'release:read']).concat(
    grants('own', ['approval:act']),
  ),
};
