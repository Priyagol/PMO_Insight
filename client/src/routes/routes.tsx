import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { AppShell } from '@/layouts/AppShell';
import { ModulePendingPage } from '@/pages/ModulePendingPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PublicOnly, RequireAuth } from './guards';
import { ALL_NAV_ITEMS } from './nav-config';
import { RequirePermission } from './RequirePermission';

/** Code-split a named export so each module downloads only when first opened. */
function page<M extends Record<string, unknown>>(
  loader: () => Promise<M>,
  name: keyof M,
): ReactNode {
  const Component = lazy(() => loader().then((m) => ({ default: m[name] as ComponentType })));
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Component />
    </Suspense>
  );
}

/** Pages that are built. Every other navigation item renders the "scheduled" page. */
const IMPLEMENTED: Record<string, ReactNode> = {
  projects: page(() => import('@/features/work/projects/ProjectsPage'), 'ProjectsPage'),
  'project-templates': page(() => import('@/features/planning/TemplatesPage'), 'TemplatesPage'),
  'task-workflows': page(() => import('@/features/workflows/WorkflowsPage'), 'WorkflowsPage'),
  'help-center': page(() => import('@/features/servicedesk/HelpCenterPage'), 'HelpCenterPage'),
  search: page(() => import('@/features/search/SearchPage'), 'SearchPage'),
  'my-tasks': page(() => import('@/features/work/tasks/TaskPages'), 'MyTasksPage'),
  'task-board': page(() => import('@/features/work/tasks/TaskPages'), 'TaskBoardPage'),
  calendar: page(() => import('@/features/work/tasks/TaskPages'), 'CalendarPage'),
  'my-workspace': page(() => import('@/features/tracking/MyWorkspacePage'), 'MyWorkspacePage'),
  'work-logs': page(() => import('@/features/tracking/WorkLogsPage'), 'WorkLogsPage'),
  timesheets: page(() => import('@/features/tracking/TimesheetsPage'), 'TimesheetsPage'),
  teams: page(() => import('@/features/tracking/TeamsPage'), 'TeamsPage'),
  'smart-assignment': page(
    () => import('@/features/tracking/SmartAssignmentPage'),
    'SmartAssignmentPage',
  ),
  analytics: page(() => import('@/features/insights/AnalyticsPage'), 'AnalyticsPage'),
  'project-health': page(
    () => import('@/features/insights/ProjectHealthPage'),
    'ProjectHealthPage',
  ),
  'project-timeline': page(
    () => import('@/features/insights/ProjectTimelinePage'),
    'ProjectTimelinePage',
  ),
  risks: page(() => import('@/features/insights/RisksPage'), 'RisksPage'),
  approvals: page(() => import('@/features/collaboration/ApprovalsPage'), 'ApprovalsPage'),
  documents: page(() => import('@/features/delivery/DocumentsPage'), 'DocumentsPage'),
  releases: page(() => import('@/features/delivery/ReleasesPage'), 'ReleasesPage'),
  stakeholders: page(() => import('@/features/delivery/StakeholdersPage'), 'StakeholdersPage'),
  meetings: page(() => import('@/features/collaboration/MeetingsPage'), 'MeetingsPage'),
  'automation-center': page(
    () => import('@/features/intelligence/AutomationsPage'),
    'AutomationsPage',
  ),
  'workflow-builder': page(
    () => import('@/features/intelligence/WorkflowBuilderPage'),
    'WorkflowBuilderPage',
  ),
  'ai-assistant': page(() => import('@/features/intelligence/AiAssistantPage'), 'AiAssistantPage'),
  employees: page(() => import('@/features/org/employees/EmployeesPage'), 'EmployeesPage'),
  departments: page(() => import('@/features/org/departments/DepartmentsPage'), 'DepartmentsPage'),
  roles: page(() => import('@/features/org/roles/RolesPage'), 'RolesPage'),
  'audit-logs': page(() => import('@/features/org/audit/AuditLogsPage'), 'AuditLogsPage'),
  settings: page(() => import('@/features/org/settings/SettingsPage'), 'SettingsPage'),
};

export const routes: RouteObject[] = [
  {
    path: '/login',
    element: (
      <PublicOnly>{page(() => import('@/features/auth/pages/LoginPage'), 'LoginPage')}</PublicOnly>
    ),
  },
  {
    path: '/forgot-password',
    element: (
      <PublicOnly>
        {page(() => import('@/features/auth/pages/ForgotPasswordPage'), 'ForgotPasswordPage')}
      </PublicOnly>
    ),
  },
  // Reachable while signed in too: an invite link may be opened in a browser with another session.
  {
    path: '/reset-password',
    element: page(() => import('@/features/auth/pages/ResetPasswordPage'), 'ResetPasswordPage'),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      {
        index: true,
        element: (
          <RequirePermission permission="dashboard:view">
            {page(() => import('@/pages/OverviewPage'), 'OverviewPage')}
          </RequirePermission>
        ),
      },
      ...ALL_NAV_ITEMS.filter((item) => item.path !== '/').map<RouteObject>((item) => ({
        path: item.path.slice(1),
        element: (
          <RequirePermission permission={item.permission}>
            {IMPLEMENTED[item.id] ?? <ModulePendingPage item={item} />}
          </RequirePermission>
        ),
      })),
      {
        path: 'projects/:projectId',
        element: (
          <RequirePermission permission="project:read">
            {page(() => import('@/features/work/projects/ProjectDetailPage'), 'ProjectDetailPage')}
          </RequirePermission>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
