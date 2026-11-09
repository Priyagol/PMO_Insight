import { z } from 'zod';
import { objectIdSchema } from './api';
import type { TaskStatus } from './enums';
import type { UserRef } from './dto';

/* ============================================================================
 * Agile delivery (Phase 9A): issue types, bug details, issue links, components,
 * WIP limits, sprints and sprint / flow / defect reports.
 * ========================================================================= */

export const ISSUE_TYPES = ['task', 'story', 'bug', 'enhancement', 'epic'] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];
export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  task: 'Task',
  story: 'Story',
  bug: 'Bug',
  enhancement: 'Enhancement',
  epic: 'Epic',
};

export const BUG_SEVERITIES = ['blocker', 'critical', 'major', 'minor', 'trivial'] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];
export const BUG_SEVERITY_LABELS: Record<BugSeverity, string> = {
  blocker: 'Blocker',
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
  trivial: 'Trivial',
};

/** Defect details, kept only on tasks of type "bug". */
export const bugDetailsSchema = z.strictObject({
  severity: z.enum(BUG_SEVERITIES).default('major'),
  stepsToReproduce: z.string().trim().max(10_000).nullable().optional(),
  expectedResult: z.string().trim().max(5000).nullable().optional(),
  actualResult: z.string().trim().max(5000).nullable().optional(),
  environment: z.string().trim().max(500).nullable().optional(),
  /** Worked before and broke again. */
  regression: z.boolean().default(false),
  /** Release the bug was found in (same project). */
  foundInReleaseId: objectIdSchema.nullable().optional(),
});
export type BugDetailsInput = z.input<typeof bugDetailsSchema>;
export interface BugDetailsDto {
  severity: BugSeverity;
  stepsToReproduce?: string;
  expectedResult?: string;
  actualResult?: string;
  environment?: string;
  regression: boolean;
  foundInRelease: { id: string; version: string } | null;
}

/** Story points: 0–100 in steps of 0.5 (teams usually use 1, 2, 3, 5, 8, 13…). */
export const storyPointsSchema = z
  .number()
  .min(0)
  .max(100)
  .refine((n) => Number.isInteger(n * 2), 'Use whole or half points')
  .nullable();
export const STORY_POINT_SUGGESTIONS = [0.5, 1, 2, 3, 5, 8, 13, 21] as const;

/* ---------- Issue links (dependencies cover "blocks") ---------- */

export const LINK_TYPES = ['relates', 'duplicates', 'clones'] as const;
export type LinkType = (typeof LINK_TYPES)[number];
/** Label as seen from the task that holds the link, and from the linked task. */
export const LINK_LABELS: Record<LinkType, { outward: string; inward: string }> = {
  relates: { outward: 'relates to', inward: 'relates to' },
  duplicates: { outward: 'duplicates', inward: 'is duplicated by' },
  clones: { outward: 'is a clone of', inward: 'was cloned as' },
};
export const addLinkSchema = z.strictObject({
  type: z.enum(LINK_TYPES),
  taskId: objectIdSchema,
});
export type AddLinkInput = z.infer<typeof addLinkSchema>;
export interface TaskLinkDto {
  type: LinkType;
  /** "outward" when this task holds the link, "inward" when the other task does. */
  direction: 'outward' | 'inward';
  label: string;
  task: { id: string; key: string; title: string; status: TaskStatus };
}

/* ---------- Clone / move ---------- */

export const cloneTaskSchema = z.strictObject({
  title: z.string().trim().min(2).max(200).optional(),
  includeSubtasks: z.boolean().default(true),
});
export type CloneTaskInput = z.input<typeof cloneTaskSchema>;
export const moveTaskToProjectSchema = z.strictObject({ projectId: objectIdSchema });

/* ---------- Project agile settings ---------- */

const componentSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).nullable().optional(),
  leadId: objectIdSchema.nullable().optional(),
});
export const projectAgileSettingsSchema = z
  .strictObject({
    components: z.array(componentSchema).max(50),
    /** Maximum tasks per board column; omitted or 0 means no limit. */
    wipLimits: z.record(z.string(), z.number().int().min(0).max(999)),
  })
  .partial()
  .refine(
    (v) =>
      !v.components ||
      new Set(v.components.map((c) => c.name.toLowerCase())).size === v.components.length,
    { message: 'Component names must be unique', path: ['components'] },
  );
export type ProjectAgileSettingsInput = z.input<typeof projectAgileSettingsSchema>;
export interface ComponentDto {
  name: string;
  description?: string;
  lead: UserRef | null;
  openTasks: number;
}
export interface ProjectAgileSettingsDto {
  components: ComponentDto[];
  wipLimits: Partial<Record<TaskStatus, number>>;
  canEdit: boolean;
}

/* ---------- Sprints ---------- */

export const SPRINT_STATUSES = ['planned', 'active', 'completed'] as const;
export type SprintStatus = (typeof SPRINT_STATUSES)[number];
const dateString = z.iso.date('Use a valid date');

export const createSprintSchema = z
  .strictObject({
    projectId: objectIdSchema,
    name: z.string().trim().min(1).max(80).optional(),
    goal: z.string().trim().max(1000).optional(),
    startDate: dateString.nullable().optional(),
    endDate: dateString.nullable().optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });
export type CreateSprintInput = z.input<typeof createSprintSchema>;
export const updateSprintSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80),
    goal: z.string().trim().max(1000).nullable(),
    startDate: dateString.nullable(),
    endDate: dateString.nullable(),
  })
  .partial();
export type UpdateSprintInput = z.input<typeof updateSprintSchema>;
export const startSprintSchema = z
  .strictObject({
    startDate: dateString,
    endDate: dateString,
    goal: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });
export type StartSprintInput = z.input<typeof startSprintSchema>;
export const completeSprintSchema = z.strictObject({
  /** Where unfinished work goes: the backlog, or a planned sprint of the same project. */
  moveOpenTo: z.union([z.literal('backlog'), objectIdSchema]).default('backlog'),
});
export type CompleteSprintInput = z.input<typeof completeSprintSchema>;
/** Put tasks into a sprint (or back to the backlog with sprintId null). */
export const sprintScopeSchema = z.strictObject({
  taskIds: z.array(objectIdSchema).min(1).max(200),
  sprintId: objectIdSchema.nullable(),
});
export type SprintScopeInput = z.infer<typeof sprintScopeSchema>;
/** Backlog ordering: place a task between two neighbours. */
export const backlogRankSchema = z.strictObject({
  beforeId: objectIdSchema.nullable().optional(),
  afterId: objectIdSchema.nullable().optional(),
});

export interface SprintDto {
  id: string;
  project: { id: string; key: string; name: string };
  name: string;
  goal?: string;
  status: SprintStatus;
  startDate?: string;
  endDate?: string;
  startedAt?: string;
  completedAt?: string;
  /** Live totals for the tasks currently in the sprint. */
  taskCount: number;
  doneCount: number;
  points: number;
  donePoints: number;
  /** Snapshot when the sprint started / finished (null before). */
  committedPoints: number | null;
  completedPoints: number | null;
  daysLeft: number | null;
  can: { edit: boolean };
}

export interface EpicSummaryDto {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  childCount: number;
  childDone: number;
  points: number;
  donePoints: number;
  /** 0..100 by points when estimated, else by count. */
  percent: number;
}

/* ---------- Reports ---------- */

export interface VelocityDto {
  sprints: { id: string; name: string; committed: number; completed: number }[];
  /** Mean completed points over the sprints shown (null without completed sprints). */
  average: number | null;
}

export interface SprintChartDto {
  sprint: { id: string; name: string; startDate: string; endDate: string; status: SprintStatus };
  /** One row per day of the sprint (up to today for an active sprint). */
  days: { date: string; remaining: number; completed: number; scope: number; ideal: number }[];
  committed: number;
  notes: string[];
}

export interface CycleTimeDto {
  /** Days from first "in progress" to done. */
  cycle: { median: number | null; average: number | null; count: number };
  /** Days from creation to done. */
  lead: { median: number | null; average: number | null; count: number };
  byType: { type: IssueType; median: number | null; count: number }[];
  items: {
    id: string;
    key: string;
    title: string;
    type: IssueType;
    cycleDays: number | null;
    leadDays: number;
  }[];
  days: number;
}

export interface DefectReportDto {
  open: number;
  openBySeverity: Record<BugSeverity, number>;
  regressionsOpen: number;
  /** Weekly created vs resolved bugs, oldest first. */
  weeks: { weekStart: string; created: number; resolved: number }[];
  averageResolutionDays: number | null;
  oldestOpen: { id: string; key: string; title: string; severity: BugSeverity; ageDays: number }[];
}

export const agileReportQuerySchema = z.strictObject({
  projectId: objectIdSchema,
  days: z.coerce.number().int().min(7).max(365).default(90),
});

/* ---------- Pure helpers (shared by server and tests) ---------- */

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
