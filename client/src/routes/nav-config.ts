import type { LucideIcon } from 'lucide-react';
import {
  LayoutTemplate,
  BadgeCheck,
  Bot,
  Building2,
  CalendarDays,
  ChartColumn,
  Clock3,
  FileText,
  FolderKanban,
  GitBranch,
  Handshake,
  HeartPulse,
  Hourglass,
  KeyRound,
  LifeBuoy,
  LayoutDashboard,
  ListTodo,
  Presentation,
  Rocket,
  ScrollText,
  Search,
  Settings,
  ShieldAlert,
  Shuffle,
  SquareKanban,
  UserCog,
  UserRound,
  UsersRound,
  Workflow,
  Zap,
} from 'lucide-react';
import { hasPermission, type Permission, type PermissionMap } from '@arihant/shared';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  /** Permission required to see the item. Backend enforcement is separate and authoritative. */
  permission: Permission;
  /** Roadmap phase in which the module is delivered. */
  phase: number;
  description: string;
  keywords?: string[];
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      {
        id: 'overview',
        label: 'Overview',
        path: '/',
        icon: LayoutDashboard,
        permission: 'dashboard:view',
        phase: 5,
        description: 'Executive dashboard and organisation snapshot',
        keywords: ['dashboard', 'home'],
      },
      {
        id: 'my-workspace',
        label: 'My Workspace',
        path: '/my-workspace',
        icon: UserRound,
        permission: 'task:read',
        phase: 4,
        description: 'Your tasks, timer, journal and deadlines',
      },
      {
        id: 'projects',
        label: 'Projects',
        path: '/projects',
        icon: FolderKanban,
        permission: 'project:read',
        phase: 3,
        description: 'Project portfolio and 360° project workspaces',
      },
      {
        id: 'project-templates',
        label: 'Project Templates',
        path: '/project-templates',
        icon: LayoutTemplate,
        permission: 'project:create',
        phase: 5,
        description: 'Reusable project structures with milestones, tasks and fields',
        keywords: ['template', 'blueprint'],
      },
      {
        id: 'my-tasks',
        label: 'My Tasks',
        path: '/tasks/mine',
        icon: ListTodo,
        permission: 'task:read',
        phase: 3,
        description: 'Everything assigned to you',
      },
      {
        id: 'task-board',
        label: 'Task Board',
        path: '/tasks/board',
        icon: SquareKanban,
        permission: 'task:read',
        phase: 3,
        description: 'Kanban, list, calendar and timeline views',
        keywords: ['kanban'],
      },
      {
        id: 'help-center',
        label: 'Help Center',
        path: '/help',
        icon: LifeBuoy,
        permission: 'task:read',
        phase: 9,
        description: 'Raise requests with service desks and follow them',
        keywords: ['service desk', 'request', 'support', 'ticket', 'incident'],
      },
      {
        id: 'search',
        label: 'Search & Filters',
        path: '/search',
        icon: Search,
        permission: 'task:read',
        phase: 9,
        description: 'Query language, saved and shared filters, history and exports',
        keywords: ['query', 'filter', 'find', 'aql', 'export'],
      },
      {
        id: 'work-logs',
        label: 'Work Logs',
        path: '/work-logs',
        icon: Clock3,
        permission: 'worklog:write',
        phase: 4,
        description: 'Log work and run timers',
        keywords: ['timer', 'time'],
      },
      {
        id: 'timesheets',
        label: 'Timesheets',
        path: '/timesheets',
        icon: Hourglass,
        // Everyone who logs work can open their own timesheet; approvals are gated separately.
        permission: 'worklog:write',
        phase: 4,
        description: 'Weekly timesheets and approvals',
      },
      {
        id: 'calendar',
        label: 'Calendar',
        path: '/calendar',
        icon: CalendarDays,
        permission: 'calendar:view',
        phase: 3,
        description: 'Deadlines, meetings and leave',
      },
      {
        id: 'meetings',
        label: 'Meetings',
        path: '/meetings',
        icon: Presentation,
        permission: 'meeting:read',
        phase: 6,
        description: 'Meetings, minutes, decisions and action items',
        keywords: ['mom', 'minutes'],
      },
      {
        id: 'teams',
        label: 'Teams & Resources',
        path: '/teams',
        icon: UsersRound,
        permission: 'team:read',
        phase: 4,
        description: 'Capacity, utilisation and workload balance',
      },
      {
        id: 'documents',
        label: 'Documents',
        path: '/documents',
        icon: FileText,
        permission: 'document:read',
        phase: 6,
        description: 'BRD, SRS, SOPs and project documents',
      },
    ],
  },
  {
    id: 'management',
    label: 'Management',
    items: [
      {
        id: 'analytics',
        label: 'Analytics & Reports',
        path: '/analytics',
        icon: ChartColumn,
        permission: 'analytics:view',
        phase: 5,
        description: 'Dashboards, reports and exports',
        keywords: ['reports', 'bi'],
      },
      {
        id: 'project-health',
        label: 'Project Health',
        path: '/project-health',
        icon: HeartPulse,
        permission: 'analytics:view',
        phase: 5,
        description: 'Health scores and early warnings',
      },
      {
        id: 'risks',
        label: 'Risks & Issues',
        path: '/risks',
        icon: ShieldAlert,
        permission: 'risk:read',
        phase: 5,
        description: 'Risk register, issues and blockers',
      },
      {
        id: 'approvals',
        label: 'Approvals',
        path: '/approvals',
        icon: BadgeCheck,
        // Requesters follow their own requests here; deciding needs approval:act (checked in the page and API).
        permission: 'project:read',
        phase: 6,
        description: 'Pending approvals and history',
      },
      {
        id: 'stakeholders',
        label: 'Stakeholders',
        path: '/stakeholders',
        icon: Handshake,
        permission: 'stakeholder:read',
        phase: 6,
        description: 'Clients, change requests and sign-offs',
      },
      {
        id: 'releases',
        label: 'Releases & Deployments',
        path: '/releases',
        icon: Rocket,
        permission: 'release:read',
        phase: 6,
        description: 'Release planning and deployment history',
      },
      {
        id: 'task-workflows',
        label: 'Task Workflows',
        path: '/task-workflows',
        icon: GitBranch,
        permission: 'project:update',
        phase: 9,
        description: 'Custom statuses, transitions, rules and approvals for tasks',
        keywords: ['workflow', 'status', 'transition'],
      },
    ],
  },
  {
    id: 'automation',
    label: 'Automation',
    items: [
      {
        id: 'smart-assignment',
        label: 'Smart Assignment',
        path: '/smart-assignment',
        icon: Shuffle,
        permission: 'assignment:execute',
        phase: 4,
        description: 'Automatic, capacity-aware ticket distribution',
        keywords: ['allocate', 'distribute'],
      },
      {
        id: 'automation-center',
        label: 'Automation Center',
        path: '/automations',
        icon: Zap,
        permission: 'automation:manage',
        phase: 7,
        description: 'No-code rules: triggers, conditions, actions',
      },
      {
        id: 'workflow-builder',
        label: 'Workflow Builder',
        path: '/workflows',
        icon: Workflow,
        permission: 'automation:manage',
        phase: 7,
        description: 'Visual approval and automation workflows',
      },
      {
        id: 'ai-assistant',
        label: 'AI Assistant',
        path: '/ai',
        icon: Bot,
        permission: 'ai:use',
        phase: 7,
        description: 'Summaries, task generation and Ask Your Data',
      },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    items: [
      {
        id: 'employees',
        label: 'Employees',
        path: '/admin/employees',
        icon: UserCog,
        permission: 'user:read',
        phase: 2,
        description: 'Employee directory and skills',
      },
      {
        id: 'departments',
        label: 'Departments',
        path: '/admin/departments',
        icon: Building2,
        permission: 'department:manage',
        phase: 2,
        description: 'Departments and heads',
      },
      {
        id: 'roles',
        label: 'Roles & Permissions',
        path: '/admin/roles',
        icon: KeyRound,
        permission: 'role:manage',
        phase: 2,
        description: 'Custom roles and permission scopes',
      },
      {
        id: 'audit-logs',
        label: 'Audit Logs',
        path: '/admin/audit-logs',
        icon: ScrollText,
        permission: 'audit:read',
        phase: 2,
        description: 'Traceable history of critical actions',
      },
      {
        id: 'settings',
        label: 'System Settings',
        path: '/admin/settings',
        icon: Settings,
        permission: 'settings:manage',
        phase: 2,
        description: 'Organisation configuration',
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/** Sections and items the user may see; empty sections are removed. */
export function filterNav(sections: NavSection[], permissions: PermissionMap): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((i) => hasPermission(permissions, i.permission)),
    }))
    .filter((section) => section.items.length > 0);
}

export function findNavItem(pathname: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((i) => i.path === pathname);
}

export function findNavSection(itemId: string): NavSection | undefined {
  return NAV_SECTIONS.find((s) => s.items.some((i) => i.id === itemId));
}

/** Deepest navigation item whose path is a prefix of the pathname (for nested pages). */
export function findNavItemByPrefix(pathname: string): NavItem | undefined {
  return ALL_NAV_ITEMS.filter((i) => i.path !== '/' && pathname.startsWith(i.path + '/')).sort(
    (a, b) => b.path.length - a.path.length,
  )[0];
}
