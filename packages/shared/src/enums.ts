/**
 * Domain enumerations shared by client and server.
 * Keep values stable: they are persisted in MongoDB.
 */

export const PROJECT_STATUSES = [
  'planning',
  'not_started',
  'in_progress',
  'on_hold',
  'at_risk',
  'completed',
  'cancelled',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'testing',
  'blocked',
  'done',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Task statuses that count towards an employee's active workload. */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  'todo',
  'in_progress',
  'in_review',
  'testing',
  'blocked',
];

export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const EMPLOYMENT_STATUSES = ['active', 'inactive', 'terminated'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const SYSTEM_ROLES = [
  'super_admin',
  'managing_director',
  'cto',
  'director',
  'department_head',
  'project_manager',
  'team_lead',
  'developer',
  'qa_tester',
  'employee',
  'external_stakeholder',
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const ROLE_LABELS: Record<SystemRole, string> = {
  super_admin: 'Super Admin',
  managing_director: 'MD / Chairman',
  cto: 'CTO / CIO',
  director: 'Director / Management',
  department_head: 'Department Head',
  project_manager: 'Project Manager',
  team_lead: 'Team Lead',
  developer: 'Developer',
  qa_tester: 'QA / Tester',
  employee: 'Employee',
  external_stakeholder: 'External Stakeholder',
};

export const STATUS_LABELS: Record<ProjectStatus | TaskStatus, string> = {
  planning: 'Planning',
  not_started: 'Not Started',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  at_risk: 'At Risk',
  completed: 'Completed',
  cancelled: 'Cancelled',
  backlog: 'Backlog',
  todo: 'To Do',
  in_review: 'In Review',
  testing: 'Testing',
  blocked: 'Blocked',
  done: 'Done',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
