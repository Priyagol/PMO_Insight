import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema, withoutDefaults } from './api';
import type { Priority, TaskStatus } from './enums';
import type { UserRef } from './dto';

/* ============================================================================
 * Work logs, timers, timesheets, journals, availability and smart assignment.
 * ========================================================================= */

const dateString = z.iso.date('Use a valid date');
const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const WORK_CATEGORIES = [
  'development',
  'testing',
  'review',
  'meeting',
  'documentation',
  'design',
  'support',
  'research',
  'other',
] as const;
export type WorkCategory = (typeof WORK_CATEGORIES)[number];

export const WORK_CATEGORY_LABELS: Record<WorkCategory, string> = {
  development: 'Development',
  testing: 'Testing',
  review: 'Review',
  meeting: 'Meeting',
  documentation: 'Documentation',
  design: 'Design',
  support: 'Support',
  research: 'Research',
  other: 'Other',
};

/** A day can never contain more than 24 hours of logged work. */
export const MAX_MINUTES_PER_DAY = 24 * 60;

/* ---------- Work logs ---------- */

const worklogFields = {
  date: dateString,
  projectId: objectIdSchema,
  taskId: objectIdSchema.nullable().optional(),
  description: z.string().trim().min(3, 'Describe the work (at least 3 characters)').max(2000),
  category: z.enum(WORK_CATEGORIES).default('development'),
  /** Either a duration, or a start and end time on `date` (organisation timezone). */
  minutes: z.number().int().min(1).max(MAX_MINUTES_PER_DAY).optional(),
  startTime: timeString.optional(),
  endTime: timeString.optional(),
};

const durationOrRange = (v: { minutes?: number; startTime?: string; endTime?: string }) =>
  (v.startTime && v.endTime && v.startTime < v.endTime) ||
  (!v.startTime && !v.endTime && v.minutes);

export const createWorklogSchema = z.strictObject(worklogFields).refine(durationOrRange, {
  message: 'Enter a duration, or a start time before the end time',
  path: ['minutes'],
});
export type CreateWorklogInput = z.input<typeof createWorklogSchema>;

export const updateWorklogSchema = z
  .strictObject({
    ...withoutDefaults(worklogFields),
    date: dateString.optional(),
    projectId: objectIdSchema.optional(),
  })
  .partial()
  .refine(
    (v) => !(v.startTime || v.endTime) || (v.startTime && v.endTime && v.startTime < v.endTime),
    {
      message: 'Enter both times, start before end',
      path: ['endTime'],
    },
  );
export type UpdateWorklogInput = z.input<typeof updateWorklogSchema>;

export const worklogQuerySchema = paginationQuerySchema.extend({
  userId: z.union([objectIdSchema, z.literal('me')]).optional(),
  projectId: objectIdSchema.optional(),
  taskId: objectIdSchema.optional(),
  from: dateString.optional(),
  to: dateString.optional(),
});
export type WorklogQuery = z.input<typeof worklogQuerySchema>;

/* ---------- Timer ---------- */

export const startTimerSchema = z.strictObject({
  projectId: objectIdSchema,
  taskId: objectIdSchema.nullable().optional(),
  description: z.string().trim().max(2000).optional(),
  category: z.enum(WORK_CATEGORIES).default('development'),
});
export type StartTimerInput = z.input<typeof startTimerSchema>;

export const stopTimerSchema = z.strictObject({
  description: z
    .string()
    .trim()
    .min(3, 'Describe the work (at least 3 characters)')
    .max(2000)
    .optional(),
  /** Discard the timer without creating a work log. */
  discard: z.boolean().default(false),
});

/* ---------- Timesheets ---------- */

export const TIMESHEET_STATUSES = ['draft', 'submitted', 'approved', 'rejected'] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

export const timesheetWeekSchema = z.strictObject({ weekStart: dateString });
export const timesheetDecisionSchema = z.strictObject({
  comment: z.string().trim().max(1000).optional(),
});
export const timesheetRejectSchema = z.strictObject({
  comment: z.string().trim().min(3, 'Explain what needs to change').max(1000),
});
export const timesheetQuerySchema = paginationQuerySchema.extend({
  scope: z.enum(['mine', 'approvals']).default('mine'),
  status: z.enum(TIMESHEET_STATUSES).optional(),
});

/* ---------- Daily journal ---------- */

export const journalSchema = z.strictObject({
  date: dateString,
  completed: z.string().trim().max(4000).default(''),
  inProgress: z.string().trim().max(4000).default(''),
  blockers: z.string().trim().max(4000).default(''),
  tomorrow: z.string().trim().max(4000).default(''),
});
export type JournalInput = z.input<typeof journalSchema>;

export const journalQuerySchema = paginationQuerySchema.extend({
  userId: z.union([objectIdSchema, z.literal('me')]).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
});

/* ---------- Availability / leave ---------- */

export const AVAILABILITY_TYPES = ['leave', 'partial', 'training', 'other'] as const;
export const AVAILABILITY_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export const availabilitySchema = z
  .strictObject({
    type: z.enum(AVAILABILITY_TYPES).default('leave'),
    from: dateString,
    to: dateString,
    /** For partial availability: hours still available per day. */
    hoursPerDay: z.number().min(0).max(24).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.from <= v.to, {
    message: 'End date must be on or after the start date',
    path: ['to'],
  })
  .refine((v) => v.type !== 'partial' || v.hoursPerDay !== undefined, {
    message: 'Enter the hours available per day',
    path: ['hoursPerDay'],
  });
export type AvailabilityInput = z.input<typeof availabilitySchema>;

export const availabilityQuerySchema = paginationQuerySchema.extend({
  scope: z.enum(['mine', 'approvals', 'team']).default('mine'),
  status: z.enum(AVAILABILITY_STATUSES).optional(),
});

/* ---------- Smart assignment ---------- */

export const assignmentWeightsSchema = z
  .strictObject({
    workload: z.number().min(0).max(1),
    capacity: z.number().min(0).max(1),
    skill: z.number().min(0).max(1),
    priority: z.number().min(0).max(1),
    availability: z.number().min(0).max(1),
  })
  .refine(
    (w) => Math.abs(w.workload + w.capacity + w.skill + w.priority + w.availability - 1) < 0.001,
    {
      message: 'Weights must add up to 100%',
    },
  );
export type AssignmentWeights = z.infer<typeof assignmentWeightsSchema>;

export const assignmentConfigSchema = z.strictObject({
  weights: assignmentWeightsSchema,
  /** Working days ahead used to measure capacity and availability. */
  horizonDays: z.number().int().min(1).max(60),
  /** Effort assumed for tasks without an estimate. */
  defaultEffortHours: z.number().min(0.25).max(80),
  /** Allow assigning beyond capacity (flagged in previews) instead of skipping. */
  allowOverCapacity: z.boolean(),
  /** Rebalancing triggers when someone exceeds `rebalanceHigh` utilisation while another is below `rebalanceLow`. */
  rebalanceHigh: z.number().min(0.5).max(3),
  rebalanceLow: z.number().min(0).max(1),
});
export type AssignmentConfig = z.infer<typeof assignmentConfigSchema>;

export const DEFAULT_ASSIGNMENT_CONFIG: AssignmentConfig = {
  weights: { workload: 0.35, capacity: 0.25, skill: 0.2, priority: 0.1, availability: 0.1 },
  horizonDays: 10,
  defaultEffortHours: 2,
  allowOverCapacity: false,
  rebalanceHigh: 1.1,
  rebalanceLow: 0.6,
};

const candidateFilter = {
  /** Restrict candidates to people holding one of these roles (e.g. qa_tester). */
  roleKeys: z.array(z.string().max(80)).max(10).optional(),
  /** Or to an explicit list of people. */
  userIds: z.array(objectIdSchema).max(200).optional(),
};

export const batchPreviewSchema = z.strictObject({
  projectId: objectIdSchema,
  /** Specific tasks; omit to take every unassigned open task in the project. */
  taskIds: z.array(objectIdSchema).min(1).max(1000).optional(),
  ...candidateFilter,
});
export type BatchPreviewInput = z.input<typeof batchPreviewSchema>;

export const reassignPreviewSchema = z.strictObject({ userId: objectIdSchema });
export const rebalancePreviewSchema = z.strictObject({
  projectId: objectIdSchema,
  ...candidateFilter,
});

export const modifyPlanSchema = z.strictObject({
  proposals: z
    .array(z.strictObject({ taskId: objectIdSchema, toUserId: objectIdSchema.nullable() }))
    .min(1)
    .max(1000),
});

export interface ScoreBreakdown {
  workload: number;
  capacity: number;
  skill: number;
  priority: number;
  availability: number;
}

export interface CandidateScore {
  user: UserRef;
  eligible: boolean;
  /** 0..100 weighted score (eligible candidates only). */
  score: number;
  breakdown: ScoreBreakdown;
  reasons: string[];
  capacityHours: number;
  loadHours: number;
  availableDays: number;
}

export interface SuggestionDto {
  task: { id: string; key: string; title: string; effortHours: number; priority: Priority };
  candidates: CandidateScore[];
}

export interface PlanProposal {
  taskId: string;
  key: string;
  title: string;
  priority: Priority;
  effortHours: number;
  fromUser: UserRef | null;
  toUser: UserRef | null;
  score: number;
  reason: string;
}

export interface PlanWorkload {
  user: UserRef;
  capacityHours: number;
  loadBefore: number;
  loadAfter: number;
  tasksAdded: number;
  tasksRemoved: number;
  overCapacity: boolean;
}

export const PLAN_KINDS = ['batch', 'reassign', 'rebalance'] as const;
export const PLAN_STATUSES = [
  'draft',
  'approved',
  'executing',
  'executed',
  'rejected',
  'expired',
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface AssignmentPlanDto {
  id: string;
  kind: (typeof PLAN_KINDS)[number];
  status: PlanStatus;
  project: { id: string; key: string; name: string } | null;
  createdBy: UserRef | null;
  proposals: PlanProposal[];
  skipped: { taskId: string; key: string; title: string; reason: string }[];
  /** Tasks deliberately left for a manager (in progress or critical) during reassignment. */
  manualReview: {
    taskId: string;
    key: string;
    title: string;
    status: TaskStatus;
    reason: string;
  }[];
  workload: PlanWorkload[];
  result?: {
    assigned: number;
    conflicts: { taskId: string; key: string; title: string; reason: string }[];
  };
  createdAt: string;
  expiresAt: string;
}

export interface WorklogDto {
  id: string;
  user: UserRef | null;
  date: string;
  project: { id: string; key: string; name: string };
  task: { id: string; key: string; title: string } | null;
  description: string;
  category: WorkCategory;
  minutes: number;
  startTime?: string;
  endTime?: string;
  source: 'timer' | 'manual';
  locked: boolean;
  createdAt: string;
}

export interface TimerDto {
  project: { id: string; key: string; name: string };
  task: { id: string; key: string; title: string } | null;
  description?: string;
  category: WorkCategory;
  running: boolean;
  startedAt: string;
  /** Milliseconds accumulated before the current running segment. */
  accumulatedMs: number;
  /** Server time when the response was produced (for drift-free display). */
  serverNow: string;
}

export interface TimesheetDto {
  id: string | null;
  user: UserRef;
  weekStart: string;
  weekEnd: string;
  status: TimesheetStatus;
  totalMinutes: number;
  /** Minutes per day, Monday first. */
  days: { date: string; minutes: number }[];
  byProject: { project: { id: string; key: string; name: string }; minutes: number }[];
  submittedAt?: string;
  decidedBy?: UserRef | null;
  decidedAt?: string;
  comment?: string;
  canApprove: boolean;
}

export interface JournalDto {
  id: string;
  user: UserRef | null;
  date: string;
  completed: string;
  inProgress: string;
  blockers: string;
  tomorrow: string;
  updatedAt: string;
}

export interface AvailabilityDto {
  id: string;
  user: UserRef | null;
  type: (typeof AVAILABILITY_TYPES)[number];
  from: string;
  to: string;
  hoursPerDay?: number;
  reason?: string;
  status: AvailabilityStatus;
  decidedBy: UserRef | null;
  canDecide: boolean;
  createdAt: string;
}

export interface WorkloadRowDto {
  user: UserRef & { department?: string | null };
  weeklyCapacityHours: number;
  /** Capacity over the assignment horizon, after leave. */
  capacityHours: number;
  loadHours: number;
  utilization: number;
  openTasks: number;
  inProgressTasks: number;
  overdueTasks: number;
  loggedHoursThisWeek: number;
  leaveDaysInHorizon: number;
  state: 'overloaded' | 'balanced' | 'underutilized' | 'unavailable';
}

export interface WorkPassportDto {
  user: UserRef;
  skills: { name: string; level: number }[];
  totals: { loggedHours: number; tasksCompleted: number; projects: number };
  projects: {
    project: { id: string; key: string; name: string };
    hours: number;
    tasksCompleted: number;
    lastActivity: string;
  }[];
  recentCompleted: {
    id: string;
    key: string;
    title: string;
    completedAt: string;
    project: string;
  }[];
  hoursByCategory: { category: WorkCategory; hours: number }[];
}
