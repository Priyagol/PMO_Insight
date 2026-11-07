import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from './api';
import type { Priority, ProjectStatus, TaskStatus } from './enums';
import type { UserRef } from './dto';

/* ============================================================================
 * Phase 5: risks & issues, project health, analytics and reports.
 * ========================================================================= */

/* ---------- Risks & issues ---------- */

export const RISK_TYPES = ['risk', 'issue', 'blocker'] as const;
export type RiskType = (typeof RISK_TYPES)[number];
export const RISK_STATUSES = ['open', 'mitigating', 'resolved', 'closed'] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];
export const RISK_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

/** Severity from score = probability × impact (1..25). */
export function riskSeverity(score: number): RiskSeverity {
  if (score >= 16) return 'critical';
  if (score >= 10) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

export const OPEN_RISK_STATUSES: readonly RiskStatus[] = ['open', 'mitigating'];

const riskFields = {
  projectId: objectIdSchema,
  type: z.enum(RISK_TYPES),
  title: z.string().trim().min(3, 'Enter a short title').max(200),
  description: z.string().trim().max(5000).optional(),
  probability: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  ownerId: objectIdSchema.nullable().optional(),
  mitigation: z.string().trim().max(5000).optional(),
  dueDate: z.iso.date().nullable().optional(),
  linkedTaskIds: z.array(objectIdSchema).max(50),
};

export const createRiskSchema = z.strictObject({
  ...riskFields,
  type: riskFields.type.default('risk'),
  linkedTaskIds: riskFields.linkedTaskIds.default([]),
});
export type CreateRiskInput = z.input<typeof createRiskSchema>;

export const updateRiskSchema = z
  .strictObject({
    ...riskFields,
    status: z.enum(RISK_STATUSES),
    note: z.string().trim().max(1000),
  })
  .omit({ projectId: true })
  // Built from the default-free fields: a partial update must never reset omitted fields.
  .partial();
export type UpdateRiskInput = z.input<typeof updateRiskSchema>;

export const escalateRiskSchema = z.strictObject({
  note: z.string().trim().min(3, 'Explain why').max(1000),
});

export const riskQuerySchema = paginationQuerySchema.extend({
  projectId: objectIdSchema.optional(),
  type: z.enum(RISK_TYPES).optional(),
  status: z.enum(['open', 'mitigating', 'resolved', 'closed', 'active']).optional(),
  severity: z.enum(RISK_SEVERITIES).optional(),
  ownerId: z.union([objectIdSchema, z.literal('me')]).optional(),
});
export type RiskQuery = z.input<typeof riskQuerySchema>;

export interface RiskDto {
  id: string;
  key: string;
  project: { id: string; key: string; name: string };
  type: RiskType;
  title: string;
  description?: string;
  probability: number;
  impact: number;
  score: number;
  severity: RiskSeverity;
  status: RiskStatus;
  owner: UserRef | null;
  mitigation?: string;
  dueDate?: string;
  linkedTasks: { id: string; key: string; title: string; status: TaskStatus }[];
  escalationLevel: number;
  history: { at: string; by: UserRef | null; action: string; note?: string }[];
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RiskHeatmapDto {
  /** cells[probability-1][impact-1] = number of active risks/issues. */
  cells: number[][];
  total: number;
}

/* ---------- Project health & early warnings ---------- */

export const HEALTH_BANDS = ['healthy', 'watch', 'at_risk'] as const;
export type HealthBand = (typeof HEALTH_BANDS)[number];

export function healthBand(score: number): HealthBand {
  if (score >= 75) return 'healthy';
  if (score >= 50) return 'watch';
  return 'at_risk';
}

export interface HealthFactor {
  key: 'schedule' | 'effort' | 'overdue' | 'risks' | 'blocked';
  label: string;
  weight: number;
  /** 0..1 */
  value: number;
  detail: string;
}

export interface ProjectHealthDto {
  project: { id: string; key: string; name: string; status: ProjectStatus; endDate?: string };
  manager: UserRef | null;
  score: number;
  band: HealthBand;
  factors: HealthFactor[];
  progress: number;
  warnings: EarlyWarningDto[];
}

export const WARNING_TYPES = [
  'deadline_approaching',
  'project_overdue',
  'blocked_too_long',
  'effort_overrun',
  'dependency_delayed',
  'critical_risk',
  'milestone_overdue',
  'upstream_project_delayed',
] as const;
export type WarningType = (typeof WARNING_TYPES)[number];

export interface EarlyWarningDto {
  type: WarningType;
  severity: 'warning' | 'serious' | 'critical';
  project: { id: string; key: string; name: string };
  entity?: { kind: 'task' | 'risk'; id: string; label: string };
  message: string;
}

/* ---------- Analytics ---------- */

export const analyticsQuerySchema = z.strictObject({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  departmentId: objectIdSchema.optional(),
  projectId: objectIdSchema.optional(),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export interface OverviewDto {
  period: { from: string; to: string };
  scope: 'organisation' | 'department' | 'projects' | 'personal';
  projects: {
    total: number;
    active: number;
    completed: number;
    delayed: number;
    atRisk: number;
    onHold: number;
  };
  tasks: {
    total: number;
    open: number;
    overdue: number;
    blocked: number;
    completedInPeriod: number;
    createdInPeriod: number;
  };
  people: {
    total: number;
    avgUtilization: number | null;
    overloaded: number;
    onLeave: number;
  } | null;
  hours: { loggedInPeriod: number; estimatedOpen: number };
  taskStatus: { status: TaskStatus; count: number }[];
  completionTrend: { week: string; completed: number; created: number }[];
  departments: {
    id: string | null;
    name: string;
    projects: number;
    openTasks: number;
    overdue: number;
    completed: number;
    loggedHours: number;
  }[];
  plannedVsActual: {
    project: { id: string; key: string; name: string };
    estimated: number;
    actual: number;
  }[];
  workload: { user: UserRef; utilization: number; loadHours: number; capacityHours: number }[];
  assignmentMethods: { method: string; count: number }[];
  upcoming: {
    projects: { id: string; key: string; name: string; endDate: string; progress: number }[];
    tasks: {
      id: string;
      key: string;
      title: string;
      dueDate: string;
      priority: Priority;
      assignee: UserRef | null;
    }[];
  };
  health: { healthy: number; watch: number; at_risk: number };
}

export interface ProjectAnalyticsDto {
  burndown: { date: string; remaining: number; ideal: number | null }[];
  throughput: { week: string; completed: number; effort: number }[];
  /** From daily snapshots; empty until snapshots have been collected. */
  flow: { date: string; counts: Partial<Record<TaskStatus, number>> }[];
  onTime: { completed: number; onTime: number; late: number; noDueDate: number };
  avgCycleDays: number | null;
  health: ProjectHealthDto;
}

export const hoursQuerySchema = analyticsQuerySchema.extend({
  groupBy: z.enum(['project', 'user', 'category', 'week']).default('project'),
});
export interface HoursRowDto {
  key: string;
  label: string;
  hours: number;
  entries: number;
}

export const snapshotQuerySchema = analyticsQuerySchema.extend({
  format: z.enum(['json', 'pdf', 'xlsx']).default('json'),
});

export interface ManagementSnapshotDto {
  generatedAt: string;
  generatedBy: string;
  period: { from: string; to: string };
  scope: OverviewDto['scope'];
  summary: {
    projectsActive: number;
    projectsDelayed: number;
    tasksCompleted: number;
    tasksPending: number;
    tasksOverdue: number;
    hoursLogged: number;
  };
  completed: {
    key: string;
    title: string;
    project: string;
    assignee: string;
    completedAt: string;
  }[];
  overdue: {
    key: string;
    title: string;
    project: string;
    assignee: string;
    dueDate: string;
    priority: Priority;
  }[];
  delayedProjects: {
    key: string;
    name: string;
    endDate: string;
    progress: number;
    manager: string;
  }[];
  health: { key: string; name: string; score: number; band: HealthBand; topIssue: string }[];
  contributions: { name: string; hours: number; tasksCompleted: number }[];
  departments: OverviewDto['departments'];
  blockers: { source: string; project: string; title: string; detail: string }[];
  upcoming: { kind: 'project' | 'task'; key: string; title: string; date: string }[];
  changes: { project: string; at: string; by: string; change: string }[];
}
