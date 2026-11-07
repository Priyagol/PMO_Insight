import { z } from 'zod';
import { SYSTEM_ROLES, STATUS_LABELS, TASK_STATUSES, type TaskStatus } from './enums';

/*
 * Task workflows (Jira group C). A workflow chooses which of the built-in statuses a project
 * uses (and may rename them), which status changes ("transitions") are allowed, who may make
 * them, what must be true first, and what happens afterwards. Projects without a custom
 * workflow use DEFAULT_WORKFLOW, which matches the original fixed rules.
 */

/** Fields that can be made mandatory for a status. */
export const WORKFLOW_FIELDS = [
  'assignee',
  'dueDate',
  'estimatedHours',
  'storyPoints',
  'fixRelease',
  'description',
  'components',
] as const;
export type WorkflowField = (typeof WORKFLOW_FIELDS)[number];
export const WORKFLOW_FIELD_LABELS: Record<WorkflowField, string> = {
  assignee: 'Assignee',
  dueDate: 'Due date',
  estimatedHours: 'Estimate',
  storyPoints: 'Story points',
  fixRelease: 'Fix release',
  description: 'Description',
  components: 'Component',
};

/** Checks ("validators") that must pass before a transition. */
export const WORKFLOW_CONDITIONS = [
  'subtasks_done',
  'checklist_done',
  'dependencies_done',
] as const;
export type WorkflowCondition = (typeof WORKFLOW_CONDITIONS)[number];
export const WORKFLOW_CONDITION_LABELS: Record<WorkflowCondition, string> = {
  subtasks_done: 'All subtasks are done',
  checklist_done: 'The checklist is complete',
  dependencies_done: 'Tasks it depends on are done',
};

/** Automatic actions after a transition ("post functions"). */
export const WORKFLOW_ACTIONS = [
  'assign_reporter',
  'assign_actor',
  'unassign',
  'notify_watchers',
] as const;
export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];
export const WORKFLOW_ACTION_LABELS: Record<WorkflowAction, string> = {
  assign_reporter: 'Assign to the reporter',
  assign_actor: 'Assign to the person moving it',
  unassign: 'Clear the assignee',
  notify_watchers: 'Notify watchers',
};

const statusEnum = z.enum(TASK_STATUSES);

export const workflowTransitionSchema = z.strictObject({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'Use lower-case letters, digits, - or _'),
  name: z.string().trim().min(1).max(60),
  /** Source statuses; "*" means any status. */
  from: z
    .array(z.union([statusEnum, z.literal('*')]))
    .min(1)
    .max(TASK_STATUSES.length),
  to: statusEnum,
  /** System roles allowed to use it; empty = anyone who may edit the task. */
  roles: z.array(z.enum(SYSTEM_ROLES)).max(SYSTEM_ROLES.length).default([]),
  /** Only the assignee (or the project's managers) may use it. */
  assigneeOnly: z.boolean().default(false),
  conditions: z.array(z.enum(WORKFLOW_CONDITIONS)).max(WORKFLOW_CONDITIONS.length).default([]),
  requireComment: z.boolean().default(false),
  /** The move waits for approval (Approvals module) before it happens. */
  approval: z.boolean().default(false),
  actions: z.array(z.enum(WORKFLOW_ACTIONS)).max(WORKFLOW_ACTIONS.length).default([]),
});
export type WorkflowTransition = z.output<typeof workflowTransitionSchema>;
export type WorkflowTransitionInput = z.input<typeof workflowTransitionSchema>;

export const workflowDefinitionSchema = z
  .strictObject({
    /** Statuses used, in board order. */
    statuses: z.array(statusEnum).min(2).max(TASK_STATUSES.length),
    /** Display names that replace the built-in ones in this workflow. */
    labels: z.partialRecord(statusEnum, z.string().trim().min(1).max(30)).default({}),
    /** Fields that must be filled for a task to enter (and stay in) a status. */
    required: z.partialRecord(statusEnum, z.array(z.enum(WORKFLOW_FIELDS)).max(7)).default({}),
    transitions: z.array(workflowTransitionSchema).min(1).max(80),
  })
  .superRefine((d, ctx) => {
    const used = new Set(d.statuses);
    if (used.size !== d.statuses.length)
      ctx.addIssue({ code: 'custom', path: ['statuses'], message: 'A status is listed twice' });
    if (!used.has('done'))
      ctx.addIssue({ code: 'custom', path: ['statuses'], message: 'A workflow needs Done' });
    for (const k of Object.keys(d.labels) as TaskStatus[])
      if (!used.has(k))
        ctx.addIssue({
          code: 'custom',
          path: ['labels', k],
          message: `${k} is not in this workflow`,
        });
    for (const k of Object.keys(d.required) as TaskStatus[])
      if (!used.has(k))
        ctx.addIssue({
          code: 'custom',
          path: ['required', k],
          message: `${k} is not in this workflow`,
        });
    const ids = new Set<string>();
    d.transitions.forEach((t, i) => {
      if (ids.has(t.id))
        ctx.addIssue({
          code: 'custom',
          path: ['transitions', i, 'id'],
          message: 'Duplicate transition id',
        });
      ids.add(t.id);
      if (!used.has(t.to))
        ctx.addIssue({
          code: 'custom',
          path: ['transitions', i, 'to'],
          message: `${STATUS_LABELS[t.to]} is not in this workflow`,
        });
      for (const f of t.from)
        if (f !== '*' && !used.has(f))
          ctx.addIssue({
            code: 'custom',
            path: ['transitions', i, 'from'],
            message: `${STATUS_LABELS[f]} is not in this workflow`,
          });
    });
    // Every status other than the first must be reachable.
    const reach = new Set<TaskStatus>([d.statuses[0]!]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of d.transitions)
        if (!reach.has(t.to) && t.from.some((f) => f === '*' || reach.has(f))) {
          reach.add(t.to);
          grew = true;
        }
    }
    const unreachable = d.statuses.filter((s) => !reach.has(s));
    if (unreachable.length)
      ctx.addIssue({
        code: 'custom',
        path: ['transitions'],
        message: `No transition leads to ${unreachable.map((s) => d.labels[s] ?? STATUS_LABELS[s]).join(', ')}`,
      });
  });
export type WorkflowDefinition = z.output<typeof workflowDefinitionSchema>;
export type WorkflowDefinitionInput = z.input<typeof workflowDefinitionSchema>;

export const createWorkflowSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  definition: workflowDefinitionSchema,
});
export type CreateWorkflowInput = z.input<typeof createWorkflowSchema>;
export const updateWorkflowSchema = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  definition: workflowDefinitionSchema.optional(),
});

export const assignWorkflowSchema = z.strictObject({
  /** null = back to the standard workflow. */
  workflowId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .nullable(),
  /** Where tasks go when their status is not in the new workflow. */
  statusMap: z.partialRecord(statusEnum, statusEnum).default({}),
});
export type AssignWorkflowInput = z.input<typeof assignWorkflowSchema>;

/* ---------- The standard workflow (same rules as before workflows existed) ---------- */

const BUILT_IN: Record<TaskStatus, readonly TaskStatus[]> = {
  backlog: ['todo', 'in_progress', 'cancelled'],
  todo: ['backlog', 'in_progress', 'blocked', 'cancelled'],
  in_progress: ['todo', 'in_review', 'testing', 'blocked', 'done', 'cancelled'],
  in_review: ['in_progress', 'testing', 'blocked', 'done', 'cancelled'],
  testing: ['in_progress', 'in_review', 'blocked', 'done', 'cancelled'],
  blocked: ['todo', 'in_progress', 'in_review', 'testing', 'cancelled'],
  done: ['in_progress', 'testing'],
  cancelled: ['backlog', 'todo'],
};

const TRANSITION_NAMES: Record<TaskStatus, string> = {
  backlog: 'Move to backlog',
  todo: 'To do',
  in_progress: 'Start progress',
  in_review: 'Send to review',
  testing: 'Send to testing',
  blocked: 'Mark blocked',
  done: 'Done',
  cancelled: 'Cancel',
};

export const DEFAULT_WORKFLOW: WorkflowDefinition = {
  statuses: [...TASK_STATUSES],
  labels: {},
  required: {},
  transitions: TASK_STATUSES.map((to) => ({
    id: `to-${to.replace('_', '-')}`,
    name: TRANSITION_NAMES[to],
    from: TASK_STATUSES.filter((from) => BUILT_IN[from].includes(to)),
    to,
    roles: [],
    assigneeOnly: false,
    conditions: [],
    requireComment: false,
    approval: false,
    actions: [],
  })).filter((t) => t.from.length > 0),
};

/** Display name of a status in a workflow. */
export const statusLabel = (
  def: Pick<WorkflowDefinition, 'labels'> | null | undefined,
  s: TaskStatus,
) => def?.labels[s] ?? STATUS_LABELS[s];

/** Transitions that lead out of a status. */
export const transitionsFrom = (def: WorkflowDefinition, from: TaskStatus) =>
  def.transitions.filter((t) => t.to !== from && t.from.some((f) => f === '*' || f === from));

/* ---------- DTOs ---------- */

export interface WorkflowDto {
  id: string;
  name: string;
  description: string | null;
  definition: WorkflowDefinition;
  projects: { id: string; key: string; name: string }[];
  canEdit: boolean;
  updatedAt: string;
}

/** A transition as offered on a task, with the reasons it cannot be used right now. */
export interface AvailableTransitionDto {
  id: string;
  name: string;
  to: TaskStatus;
  toLabel: string;
  requireComment: boolean;
  approval: boolean;
  /** Empty when the transition can be used. */
  blockers: string[];
}

export interface TaskTransitionsDto {
  workflow: {
    id: string | null;
    name: string;
    statuses: TaskStatus[];
    labels: Partial<Record<TaskStatus, string>>;
  };
  current: TaskStatus;
  pending: { to: TaskStatus; approvalId: string; approvalKey: string; requestedBy: string } | null;
  transitions: AvailableTransitionDto[];
}

export interface TransitionHistoryDto {
  id: string;
  from: TaskStatus | null;
  to: TaskStatus;
  transition: string | null;
  via: 'user' | 'board' | 'bulk' | 'git' | 'approval' | 'automation' | 'workflow_change' | 'create';
  by: { id: string; name: string } | null;
  comment: string | null;
  /** Time spent in the previous status, in milliseconds. */
  durationMs: number | null;
  at: string;
}
