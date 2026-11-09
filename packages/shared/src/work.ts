import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema, withoutDefaults } from './api';
import {
  customValuesSchema,
  recurrenceSchema,
  type CustomFieldDef,
  type CustomValues,
  type MilestoneRef,
  type RecurrenceDto,
} from './planning';
import {
  PRIORITIES,
  PROJECT_STATUSES,
  TASK_STATUSES,
  type Priority,
  type ProjectStatus,
  type TaskStatus,
} from './enums';
import type { UserRef } from './dto';
import {
  ISSUE_TYPES,
  bugDetailsSchema,
  storyPointsSchema,
  type BugDetailsDto,
  type IssueType,
  type TaskLinkDto,
} from './agile';

/* ============================================================================
 * Projects & tasks: domain rules, validation schemas and response types.
 * ========================================================================= */

export const PROJECT_MEMBER_ROLES = ['manager', 'lead', 'member', 'viewer'] as const;
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

export const PROJECT_CATEGORIES = [
  'Software Development',
  'Testing & QA',
  'Infrastructure',
  'Compliance & Regulatory',
  'Research',
  'Operations',
  'Business Initiative',
  'Other',
] as const;

/**
 * Allowed task status changes. Done/Cancelled can be reopened. Anything else is rejected
 * with 422 so boards, lists and the API all enforce the same workflow.
 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  backlog: ['todo', 'in_progress', 'cancelled'],
  todo: ['backlog', 'in_progress', 'blocked', 'cancelled'],
  in_progress: ['todo', 'in_review', 'testing', 'blocked', 'done', 'cancelled'],
  in_review: ['in_progress', 'testing', 'blocked', 'done', 'cancelled'],
  testing: ['in_progress', 'in_review', 'blocked', 'done', 'cancelled'],
  blocked: ['todo', 'in_progress', 'in_review', 'testing', 'cancelled'],
  done: ['in_progress', 'testing'],
  cancelled: ['backlog', 'todo'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || TASK_TRANSITIONS[from].includes(to);
}

/** Board columns, left to right. Cancelled tasks are shown only when filtered for. */
export const BOARD_COLUMNS: readonly TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'testing',
  'blocked',
  'done',
];

export const COMPLEXITY_LABELS = [
  '',
  'Trivial',
  'Simple',
  'Moderate',
  'Complex',
  'Very complex',
] as const;

/** Unestimated tasks count as 1 hour when computing effort-weighted progress. */
export const DEFAULT_TASK_EFFORT_HOURS = 1;

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** MIME types accepted for attachments, after server-side content sniffing. */
export const ALLOWED_ATTACHMENT_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG image',
  'image/jpeg': 'JPEG image',
  'image/gif': 'GIF image',
  'image/webp': 'WebP image',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel workbook',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint deck',
  'text/plain': 'Text file',
  'text/csv': 'CSV file',
  'application/zip': 'ZIP archive',
};

/* ---------- Projects ---------- */

const dateString = z.iso.date('Use a valid date');
const projectKey = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,5}$/, 'Use 2–6 letters/numbers, starting with a letter');

const projectBase = z.strictObject({
  key: projectKey,
  name: z.string().trim().min(2, 'Enter a project name').max(120),
  description: z.string().trim().max(5000).optional(),
  category: z.string().trim().max(60).optional(),
  departmentId: objectIdSchema.nullable().optional(),
  managerId: objectIdSchema,
  ownerId: objectIdSchema.nullable().optional(),
  memberIds: z.array(objectIdSchema).max(200).default([]),
  priority: z.enum(PRIORITIES).default('medium'),
  status: z.enum(PROJECT_STATUSES).default('planning'),
  startDate: dateString.nullable().optional(),
  endDate: dateString.nullable().optional(),
  estimatedHours: z.number().min(0).max(1_000_000).nullable().optional(),
  budget: z.number().min(0).max(1e12).nullable().optional(),
  objectives: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  /** Smart-assign new unassigned tasks automatically. */
  autoAssign: z.boolean().default(false),
  /** Create the project from a template (milestones, tasks, custom fields). */
  templateId: objectIdSchema.optional(),
});

const datesInOrder = (v: { startDate?: string | null; endDate?: string | null }) =>
  !v.startDate || !v.endDate || v.startDate <= v.endDate;

export const createProjectSchema = projectBase.refine(datesInOrder, {
  message: 'End date must be on or after the start date',
  path: ['endDate'],
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z
  .strictObject(withoutDefaults(projectBase.shape))
  .omit({ key: true, memberIds: true, templateId: true })
  .extend({
    /** Required when the end date moves later: why the project slipped (kept in its history). */
    dateChangeReason: z.string().trim().min(3, 'Give a short reason').max(500),
  })
  .partial()
  .refine(datesInOrder, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const projectMembersSchema = z.strictObject({
  members: z
    .array(z.strictObject({ userId: objectIdSchema, role: z.enum(PROJECT_MEMBER_ROLES) }))
    .max(200),
});

export const duplicateProjectSchema = z.strictObject({
  key: projectKey,
  name: z.string().trim().min(2).max(120),
  includeTasks: z.boolean().default(true),
  includeMembers: z.boolean().default(true),
});
export type DuplicateProjectInput = z.input<typeof duplicateProjectSchema>;

/** Accepts `a,b,c` (query string) or an array, and validates each item. */
const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(item));

export const projectListQuerySchema = paginationQuerySchema.extend({
  status: csv(z.enum(PROJECT_STATUSES)).optional(),
  departmentId: objectIdSchema.optional(),
  managerId: objectIdSchema.optional(),
  archived: z.enum(['true', 'false']).optional(),
  mine: z.enum(['true', 'false']).optional(),
});
export type ProjectListQuery = z.input<typeof projectListQuerySchema>;

/* ---------- Tasks ---------- */

const requiredSkill = z.strictObject({
  name: z.string().trim().min(1).max(60),
  minLevel: z.number().int().min(1).max(5).default(1),
});

const checklistItem = z.strictObject({
  id: z.string().max(40).optional(),
  text: z.string().trim().min(1).max(300),
  done: z.boolean().default(false),
});

const taskFields = {
  title: z.string().trim().min(2, 'Enter a task title').max(200),
  description: z.string().trim().max(20000).optional(),
  assigneeId: objectIdSchema.nullable().optional(),
  priority: z.enum(PRIORITIES).default('medium'),
  status: z.enum(TASK_STATUSES).default('todo'),
  startDate: dateString.nullable().optional(),
  dueDate: dateString.nullable().optional(),
  estimatedHours: z.number().min(0).max(10_000).nullable().optional(),
  complexity: z.number().int().min(1).max(5).nullable().optional(),
  requiredSkills: z.array(requiredSkill).max(20).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  milestoneId: objectIdSchema.nullable().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  customFields: customValuesSchema.optional(),
  /* Phase 9A */
  type: z.enum(ISSUE_TYPES).default('task'),
  storyPoints: storyPointsSchema.optional(),
  epicId: objectIdSchema.nullable().optional(),
  sprintId: objectIdSchema.nullable().optional(),
  components: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  fixReleaseId: objectIdSchema.nullable().optional(),
  acceptanceCriteria: z.string().trim().max(10_000).nullable().optional(),
  /** Manual remaining estimate; when empty, remaining = estimate − logged (not below 0). */
  remainingHours: z.number().min(0).max(10_000).nullable().optional(),
  bug: bugDetailsSchema.nullable().optional(),
};

const taskDatesInOrder = (v: { startDate?: string | null; dueDate?: string | null }) =>
  !v.startDate || !v.dueDate || v.startDate <= v.dueDate;

export const createTaskSchema = z
  .strictObject({
    projectId: objectIdSchema,
    parentId: objectIdSchema.nullable().optional(),
    ...taskFields,
    checklist: z.array(checklistItem).max(100).default([]),
  })
  .refine(taskDatesInOrder, {
    message: 'Due date must be on or after the start date',
    path: ['dueDate'],
  })
  .refine((v) => !v.recurrence || Boolean(v.dueDate), {
    message: 'A repeating task needs a due date',
    path: ['dueDate'],
  })
  .refine((v) => !v.recurrence || !v.parentId, {
    message: 'Subtasks cannot repeat',
    path: ['recurrence'],
  })
  .refine((v) => v.type !== 'epic' || (!v.parentId && !v.epicId), {
    message: 'An epic cannot be a subtask or belong to another epic',
    path: ['type'],
  })
  .refine((v) => !v.bug || v.type === 'bug', {
    message: 'Bug details apply to bugs only',
    path: ['bug'],
  });
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const updateTaskSchema = z
  .strictObject({
    title: taskFields.title,
    description: z.string().trim().max(20000).nullable(),
    assigneeId: taskFields.assigneeId,
    priority: z.enum(PRIORITIES),
    status: z.enum(TASK_STATUSES),
    startDate: taskFields.startDate,
    dueDate: taskFields.dueDate,
    estimatedHours: taskFields.estimatedHours,
    complexity: taskFields.complexity,
    requiredSkills: z.array(requiredSkill).max(20),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
    checklist: z.array(checklistItem).max(100),
    dependencyIds: z.array(objectIdSchema).max(50),
    milestoneId: taskFields.milestoneId,
    recurrence: taskFields.recurrence,
    customFields: customValuesSchema,
    type: z.enum(ISSUE_TYPES),
    storyPoints: storyPointsSchema,
    epicId: objectIdSchema.nullable(),
    sprintId: objectIdSchema.nullable(),
    components: z.array(z.string().trim().min(1).max(60)).max(10),
    fixReleaseId: objectIdSchema.nullable(),
    acceptanceCriteria: z.string().trim().max(10_000).nullable(),
    remainingHours: z.number().min(0).max(10_000).nullable(),
    bug: bugDetailsSchema.nullable(),
    /** Comment recorded with a status change (required by some workflow transitions). */
    transitionComment: z.string().trim().min(1).max(5000),
  })
  .partial()
  .refine(taskDatesInOrder, {
    message: 'Due date must be on or after the start date',
    path: ['dueDate'],
  });
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

export const moveTaskSchema = z.strictObject({
  status: z.enum(TASK_STATUSES),
  /** Neighbours in the destination column after the move (either may be omitted). */
  beforeId: objectIdSchema.nullable().optional(),
  afterId: objectIdSchema.nullable().optional(),
  transitionComment: z.string().trim().min(1).max(5000).optional(),
});
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;

export const bulkTaskSchema = z.strictObject({
  ids: z.array(objectIdSchema).min(1).max(200),
  set: z
    .strictObject({
      status: z.enum(TASK_STATUSES),
      priority: z.enum(PRIORITIES),
      assigneeId: objectIdSchema.nullable(),
      dueDate: dateString.nullable(),
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, 'Choose at least one change'),
});
export type BulkTaskInput = z.infer<typeof bulkTaskSchema>;

export const bulkDeleteSchema = z.strictObject({ ids: z.array(objectIdSchema).min(1).max(200) });

export const taskListQuerySchema = paginationQuerySchema.extend({
  projectId: csv(objectIdSchema).optional(),
  /** User id, or "me", or "none" for unassigned. */
  assigneeId: z.union([objectIdSchema, z.enum(['me', 'none'])]).optional(),
  status: csv(z.enum(TASK_STATUSES)).optional(),
  priority: csv(z.enum(PRIORITIES)).optional(),
  tag: z.string().trim().max(40).optional(),
  /** "none" = top-level tasks only; an id = subtasks of that task. Omit for all. */
  parentId: z.union([objectIdSchema, z.literal('none')]).optional(),
  dueFrom: dateString.optional(),
  dueTo: dateString.optional(),
  overdue: z.enum(['true', 'false']).optional(),
  watching: z.enum(['true', 'false']).optional(),
  /** A milestone id, or "none" for tasks without a milestone. */
  milestoneId: z.union([objectIdSchema, z.literal('none')]).optional(),
  type: csv(z.enum(ISSUE_TYPES)).optional(),
  /** A sprint id, "active" (the project's running sprint) or "none" (backlog). */
  sprintId: z.union([objectIdSchema, z.enum(['active', 'none'])]).optional(),
  epicId: z.union([objectIdSchema, z.literal('none')]).optional(),
  component: z.string().trim().max(60).optional(),
  fixReleaseId: z.union([objectIdSchema, z.literal('none')]).optional(),
  /** Tasks changed within the last N days (board quick filter). */
  updatedWithin: z.coerce.number().int().min(1).max(365).optional(),
  /** A query in the Arihant query language, combined with the other filters. */
  aql: z.string().trim().max(2000).optional(),
});
export type TaskListQuery = z.input<typeof taskListQuerySchema>;

export const boardQuerySchema = taskListQuerySchema.omit({ page: true, limit: true, sort: true });

/* ---------- Comments ---------- */

/** Mentions are written as @[Display Name](userId) in comment text. */
export const MENTION_PATTERN = /@\[([^\]]{1,120})\]\(([a-f\d]{24})\)/gi;

export const commentSchema = z.strictObject({
  body: z.string().trim().min(1, 'Write a comment').max(10000),
  parentId: objectIdSchema.nullable().optional(),
});
export const updateCommentSchema = z.strictObject({ body: commentSchema.shape.body });

/* ---------- Saved views ---------- */

export const SAVED_VIEW_MODULES = ['tasks'] as const;
export const savedViewSchema = z.strictObject({
  module: z.enum(SAVED_VIEW_MODULES),
  name: z.string().trim().min(1).max(60),
  /** Filter state as query parameters; validated again when applied. */
  filters: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
  view: z.enum(['board', 'list', 'calendar', 'timeline']).default('list'),
});
export type SavedViewInput = z.input<typeof savedViewSchema>;

/* ---------- Response types ---------- */

export interface ProjectMemberDto {
  user: UserRef;
  role: ProjectMemberRole;
}

export interface ProjectProgress {
  totalTasks: number;
  doneTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  /** 0..100, effort-weighted (see DEFAULT_TASK_EFFORT_HOURS). */
  percent: number;
  byStatus: Partial<Record<TaskStatus, number>>;
}

export interface ProjectDto {
  id: string;
  key: string;
  name: string;
  description?: string;
  category?: string;
  department: { id: string; name: string; code: string } | null;
  manager: UserRef | null;
  owner: UserRef | null;
  members: ProjectMemberDto[];
  priority: Priority;
  status: ProjectStatus;
  startDate?: string;
  endDate?: string;
  estimatedHours?: number;
  budget?: { amount: number; currency: 'INR' };
  objectives: string[];
  archived: boolean;
  autoAssign: boolean;
  /** Task custom field definitions (Phase 5B). */
  customFields: CustomFieldDef[];
  /** Number of upstream projects this one depends on. */
  dependsOnCount: number;
  version: number;
  progress: ProjectProgress;
  /** What the current user may do (UI hints; the API enforces the same rules). */
  can: { update: boolean; archive: boolean; createTask: boolean; manageMembers: boolean };
  /** Board column limits (Phase 9A). */
  wipLimits: Partial<Record<TaskStatus, number>>;
  components: string[];
  /** Phase 9E: only members and super administrators can see it. */
  confidential: boolean;
  /** Task workflow (Phase 9C): statuses in board order and their display names. */
  workflow: {
    id: string | null;
    name: string;
    statuses: TaskStatus[];
    labels: Partial<Record<TaskStatus, string>>;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ProjectVersionDto {
  version: number;
  changedBy: UserRef | null;
  changedAt: string;
  changes: { field: string; from: unknown; to: unknown }[];
  /** Why the end date moved later. */
  reason?: string;
}

export interface TaskRef {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
}

export interface ChecklistItemDto {
  id: string;
  text: string;
  done: boolean;
}

export interface TaskDto {
  id: string;
  key: string;
  project: { id: string; key: string; name: string };
  parent: TaskRef | null;
  title: string;
  description?: string;
  status: TaskStatus;
  /** Status name in the project's workflow. */
  statusLabel: string;
  /** Phase 9E: visible only to the listed people, assignee, reporter and project managers. */
  restricted: boolean;
  allowedUserIds: string[];
  /** A workflow move waiting for approval. */
  pendingTransition: { to: TaskStatus; approvalId: string } | null;
  priority: Priority;
  assignee: UserRef | null;
  reporter: UserRef | null;
  watcherIds: string[];
  startDate?: string;
  dueDate?: string;
  estimatedHours?: number;
  actualHours: number;
  complexity?: number;
  requiredSkills: { name: string; minLevel: number }[];
  tags: string[];
  checklist: ChecklistItemDto[];
  dependencies: TaskRef[];
  milestone: MilestoneRef | null;
  recurrence: RecurrenceDto | null;
  customFields: CustomValues;
  /* Phase 9A */
  type: IssueType;
  storyPoints?: number;
  epic: TaskRef | null;
  sprint: { id: string; name: string; status: string } | null;
  components: string[];
  fixRelease: { id: string; version: string } | null;
  acceptanceCriteria?: string;
  /** Manual value when set, else estimate − logged (not below 0); undefined without an estimate. */
  remainingHours?: number;
  remainingIsManual: boolean;
  bug: BugDetailsDto | null;
  links: TaskLinkDto[];
  startedAt?: string;
  previousKeys: string[];
  subtaskCount: number;
  subtasksDone: number;
  commentCount: number;
  attachmentCount: number;
  rank: string;
  overdue: boolean;
  blockedSince?: string;
  completedAt?: string;
  can: { update: boolean; delete: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface BoardColumnDto {
  status: TaskStatus;
  total: number;
  tasks: TaskDto[];
}

export interface CommentDto {
  id: string;
  author: UserRef | null;
  body: string;
  mentions: UserRef[];
  parentId: string | null;
  edited: boolean;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AttachmentDto {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedBy: UserRef | null;
  canDelete: boolean;
  createdAt: string;
}

export interface ActivityDto {
  id: string;
  actor: UserRef | null;
  entityType: 'project' | 'task';
  entity: { id: string; label: string };
  verb: string;
  summary: string;
  changes: { field: string; from: unknown; to: unknown }[];
  createdAt: string;
}

export interface SavedViewDto {
  id: string;
  module: (typeof SAVED_VIEW_MODULES)[number];
  name: string;
  view: 'board' | 'list' | 'calendar' | 'timeline';
  filters: Record<string, string | string[]>;
  createdAt: string;
}
