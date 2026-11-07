import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from './api';
import { PRIORITIES, TASK_STATUSES, type TaskStatus } from './enums';

/*
 * Phase 7A: Automation Center and the AI assistant (proposals only).
 */

/* ============================ Automations ============================ */

export const AUTOMATION_TRIGGERS = [
  'task.created',
  'task.status_changed',
  'task.assigned',
  'task.overdue',
  'risk.critical',
  'project.status_changed',
  'schedule',
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];
export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  'task.created': 'A task is created',
  'task.status_changed': 'A task changes status',
  'task.assigned': 'A task is assigned or reassigned',
  'task.overdue': 'A task becomes overdue (checked daily)',
  'risk.critical': 'A risk or issue becomes critical',
  'project.status_changed': 'A project changes status',
  schedule: 'On a schedule (checks each open task)',
};

/** Fields a condition may test, per trigger. Values come from the record, never from user text. */
export const CONDITION_FIELDS = {
  'task.priority': { label: 'Task priority', type: 'enum', options: PRIORITIES },
  'task.status': { label: 'Task status', type: 'enum', options: TASK_STATUSES },
  'task.previousStatus': { label: 'Previous task status', type: 'enum', options: TASK_STATUSES },
  'task.assigned': { label: 'Task has an assignee', type: 'boolean' },
  'task.tags': { label: 'Task tags', type: 'list' },
  'task.estimatedHours': { label: 'Task estimate (h)', type: 'number' },
  'task.title': { label: 'Task title', type: 'text' },
  'task.isSubtask': { label: 'Task is a subtask', type: 'boolean' },
  'task.overdue': { label: 'Task is overdue', type: 'boolean' },
  'task.daysUntilDue': { label: 'Days until due (negative = overdue)', type: 'number' },
  'risk.type': { label: 'Risk type', type: 'enum', options: ['risk', 'issue', 'blocker'] },
  'project.status': { label: 'Project status', type: 'text' },
  'project.previousStatus': { label: 'Previous project status', type: 'text' },
} as const;
export type ConditionField = keyof typeof CONDITION_FIELDS;
export const TRIGGER_FIELDS: Record<AutomationTrigger, ConditionField[]> = {
  'task.created': [
    'task.priority',
    'task.status',
    'task.assigned',
    'task.tags',
    'task.estimatedHours',
    'task.title',
    'task.isSubtask',
  ],
  'task.status_changed': [
    'task.priority',
    'task.status',
    'task.previousStatus',
    'task.assigned',
    'task.tags',
    'task.estimatedHours',
    'task.title',
    'task.isSubtask',
  ],
  'task.assigned': [
    'task.priority',
    'task.status',
    'task.assigned',
    'task.tags',
    'task.estimatedHours',
    'task.title',
  ],
  'task.overdue': [
    'task.priority',
    'task.status',
    'task.assigned',
    'task.tags',
    'task.estimatedHours',
    'task.title',
  ],
  'risk.critical': ['risk.type'],
  'project.status_changed': ['project.status', 'project.previousStatus'],
  schedule: [
    'task.priority',
    'task.status',
    'task.assigned',
    'task.tags',
    'task.estimatedHours',
    'task.title',
    'task.isSubtask',
    'task.overdue',
    'task.daysUntilDue',
  ],
};

/** When a scheduled rule runs (organisation time zone). Weekly rules use ISO weekdays (1 = Monday). */
export const automationScheduleSchema = z.strictObject({
  frequency: z.enum(['daily', 'weekly']),
  weekday: z.number().int().min(1).max(7).nullable().default(null),
  hour: z.number().int().min(0).max(23),
});
export type AutomationSchedule = z.output<typeof automationScheduleSchema>;
export const WEEKDAY_LABELS = [
  '',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
export function describeSchedule(s: AutomationSchedule): string {
  const at = `${String(s.hour).padStart(2, '0')}:00`;
  return s.frequency === 'daily'
    ? `Every day at ${at}`
    : `Every ${WEEKDAY_LABELS[s.weekday ?? 1]} at ${at}`;
}

export const CONDITION_OPS = [
  'eq',
  'neq',
  'in',
  'nin',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'is_empty',
  'not_empty',
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];
export const CONDITION_OP_LABELS: Record<ConditionOp, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is one of',
  nin: 'is none of',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: 'contains',
  is_empty: 'is empty',
  not_empty: 'is not empty',
};

const conditionValue = z.union([
  z.string().max(200),
  z.number(),
  z.boolean(),
  z.array(z.string().max(100)).max(20),
  z.null(),
]);
export const conditionSchema = z.strictObject({
  field: z.enum(Object.keys(CONDITION_FIELDS) as [ConditionField, ...ConditionField[]]),
  op: z.enum(CONDITION_OPS),
  value: conditionValue.optional(),
});
export type Condition = z.output<typeof conditionSchema>;
export const conditionGroupSchema = z.strictObject({
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(conditionSchema).max(10).default([]),
});
export type ConditionGroup = z.output<typeof conditionGroupSchema>;

export const AUTOMATION_ACTIONS = [
  'notify',
  'set_priority',
  'add_tag',
  'add_comment',
  'assign_user',
  'smart_assign',
  'create_task',
] as const;
export type AutomationActionType = (typeof AUTOMATION_ACTIONS)[number];
export const AUTOMATION_ACTION_LABELS: Record<AutomationActionType, string> = {
  notify: 'Send a notification',
  set_priority: 'Set task priority',
  add_tag: 'Add a tag to the task',
  add_comment: 'Add a comment to the task',
  assign_user: 'Assign the task to a person',
  smart_assign: 'Smart-assign the task',
  create_task: 'Create a follow-up task',
};
/** Actions that change a task need a task in the event. */
export const TASK_ACTIONS: readonly AutomationActionType[] = [
  'set_priority',
  'add_tag',
  'add_comment',
  'assign_user',
  'smart_assign',
];

export const NOTIFY_TARGETS = [
  'assignee',
  'reporter',
  'watchers',
  'project_manager',
  'users',
] as const;
export type NotifyTarget = (typeof NOTIFY_TARGETS)[number];

export const automationActionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('notify'),
    to: z.array(z.enum(NOTIFY_TARGETS)).min(1),
    userIds: z.array(objectIdSchema).max(20).optional(),
    message: z.string().trim().min(2).max(300),
  }),
  z.strictObject({ type: z.literal('set_priority'), priority: z.enum(PRIORITIES) }),
  z.strictObject({ type: z.literal('add_tag'), tag: z.string().trim().min(1).max(40) }),
  z.strictObject({ type: z.literal('add_comment'), text: z.string().trim().min(2).max(2000) }),
  z.strictObject({ type: z.literal('assign_user'), userId: objectIdSchema }),
  z.strictObject({ type: z.literal('smart_assign') }),
  z.strictObject({
    type: z.literal('create_task'),
    title: z.string().trim().min(2).max(200),
    priority: z.enum(PRIORITIES).default('medium'),
    dueInDays: z.number().int().min(0).max(365).nullable().optional(),
    assignTo: z.enum(['none', 'same_assignee', 'project_manager']).default('none'),
  }),
]);
export type AutomationAction = z.output<typeof automationActionSchema>;

const ruleFields = {
  name: z.string().trim().min(2, 'Enter a rule name').max(120),
  description: z.string().trim().max(500).optional(),
  /** null = every project the owner can manage (organisation-wide rules need org scope). */
  projectId: objectIdSchema.nullable(),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  conditions: conditionGroupSchema,
  actions: z.array(automationActionSchema).min(1, 'Add at least one action').max(5),
  enabled: z.boolean().default(true),
  /** Required for (and only for) the schedule trigger. */
  schedule: automationScheduleSchema.nullable().optional(),
};
function actionsFitTrigger(
  r: {
    trigger?: AutomationTrigger;
    actions?: AutomationAction[];
    conditions?: ConditionGroup;
    schedule?: AutomationSchedule | null;
  },
  ctx: z.RefinementCtx,
) {
  if (!r.trigger) return;
  if (r.trigger === 'schedule' && r.schedule === null)
    ctx.addIssue({ code: 'custom', message: 'Choose when the rule runs', path: ['schedule'] });
  if (r.schedule?.frequency === 'weekly' && !r.schedule.weekday)
    ctx.addIssue({ code: 'custom', message: 'Choose a weekday', path: ['schedule', 'weekday'] });
  const taskless = r.trigger === 'risk.critical' || r.trigger === 'project.status_changed';
  r.actions?.forEach((a, i) => {
    if (taskless && TASK_ACTIONS.includes(a.type))
      ctx.addIssue({
        code: 'custom',
        message: 'This action needs a task, but the trigger has none',
        path: ['actions', i],
      });
  });
  r.conditions?.conditions.forEach((c, i) => {
    if (!TRIGGER_FIELDS[r.trigger!].includes(c.field))
      ctx.addIssue({
        code: 'custom',
        message: 'This field is not available for the trigger',
        path: ['conditions', 'conditions', i, 'field'],
      });
  });
}
export const createAutomationSchema = z.strictObject(ruleFields).superRefine((r, ctx) => {
  if (r.trigger === 'schedule' && !r.schedule)
    ctx.addIssue({ code: 'custom', message: 'Choose when the rule runs', path: ['schedule'] });
  actionsFitTrigger(r, ctx);
});
export type CreateAutomationInput = z.input<typeof createAutomationSchema>;
export const updateAutomationSchema = z
  .strictObject({ ...ruleFields, enabled: z.boolean() })
  .omit({ projectId: true })
  .partial()
  .superRefine(actionsFitTrigger);
export type UpdateAutomationInput = z.input<typeof updateAutomationSchema>;

export const AUTOMATION_RUN_STATUSES = [
  'success',
  'partial',
  'failed',
  'throttled',
  'loop_blocked',
] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

export interface AutomationRuleDto {
  id: string;
  name: string;
  description?: string;
  project: { id: string; key: string; name: string } | null;
  trigger: AutomationTrigger;
  conditions: ConditionGroup;
  actions: AutomationAction[];
  enabled: boolean;
  schedule: AutomationSchedule | null;
  owner: { id: string; name: string } | null;
  runCount: number;
  lastRunAt?: string;
  lastStatus?: AutomationRunStatus;
  canEdit: boolean;
  updatedAt: string;
}

export interface AutomationRunDto {
  id: string;
  ruleId: string;
  ruleName: string;
  trigger: AutomationTrigger;
  status: AutomationRunStatus;
  subject?: string;
  actions: { type: AutomationActionType; ok: boolean; detail: string }[];
  error?: string;
  durationMs: number;
  createdAt: string;
}

export const automationRunQuerySchema = paginationQuerySchema.extend({
  ruleId: objectIdSchema.optional(),
  status: z.enum(AUTOMATION_RUN_STATUSES).optional(),
});
export type AutomationRunQuery = z.input<typeof automationRunQuerySchema>;

export const automationTestSchema = z.strictObject({ taskId: objectIdSchema });
export interface AutomationTestResultDto {
  matched: boolean;
  checks: { field: string; op: ConditionOp; expected: unknown; actual: unknown; passed: boolean }[];
  wouldRun: string[];
}

/* ============================ AI assistant ============================ */

export const AI_FEATURES = [
  'requirements_to_tasks',
  'project_summary',
  'worklog_draft',
  'minutes_to_actions',
  'explain_health',
  'ask_data',
  'risk_scan',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  requirements_to_tasks: 'Requirements → task proposals',
  project_summary: 'Project summary',
  worklog_draft: 'Work log draft',
  minutes_to_actions: 'Minutes → decisions and action items',
  explain_health: 'Explain project health',
  ask_data: 'Ask Your Data',
  risk_scan: 'Risk scan',
};

export const aiSettingsSchema = z.strictObject({
  /** Off by default: an administrator opts in once the outbound-data policy allows it. */
  enabled: z.boolean(),
  /** Per-person daily request limit. */
  dailyLimitPerUser: z.number().int().min(1).max(1000),
});
export type AiSettings = z.output<typeof aiSettingsSchema>;
export interface AiStatusDto extends AiSettings {
  /** The server has a provider and credentials configured. */
  configured: boolean;
  usedToday: number;
}

export const requirementsToTasksSchema = z.strictObject({
  projectId: objectIdSchema,
  text: z.string().trim().min(20, 'Paste at least a few sentences of requirements').max(20_000),
});
export const projectAiSchema = z.strictObject({ projectId: objectIdSchema });
export const worklogDraftSchema = z.strictObject({ date: z.iso.date() });
export const minutesToActionsSchema = z.strictObject({
  meetingId: objectIdSchema,
  text: z.string().trim().min(20, 'Paste or write the meeting notes first').max(30_000),
});

/** Model output contracts. Kept to plain JSON-schema-friendly shapes (no refinements). */
export const aiTaskProposalSchema = z.object({
  title: z.string(),
  description: z.string(),
  priority: z.enum(PRIORITIES),
  estimatedHours: z.number().nullable(),
  tags: z.array(z.string()),
  subtasks: z.array(z.string()),
});
export const aiRequirementsOutput = z.object({
  tasks: z.array(aiTaskProposalSchema),
  assumptions: z.array(z.string()),
});
export type AiRequirementsOutput = z.output<typeof aiRequirementsOutput>;

export const aiProjectSummaryOutput = z.object({
  summary: z.string(),
  highlights: z.array(z.string()),
  concerns: z.array(z.string()),
  nextSteps: z.array(z.string()),
});
export type AiProjectSummaryOutput = z.output<typeof aiProjectSummaryOutput>;

export const aiWorklogOutput = z.object({
  entries: z.array(z.object({ taskKey: z.string().nullable(), description: z.string() })),
});
export type AiWorklogOutput = z.output<typeof aiWorklogOutput>;

export const aiMinutesOutput = z.object({
  summary: z.string(),
  decisions: z.array(z.string()),
  actionItems: z.array(
    z.object({
      text: z.string(),
      /** "P1"…"Pn" from the participant list, or null when unclear. */
      ownerRef: z.string().nullable(),
      dueDate: z.string().nullable(),
      priority: z.enum(PRIORITIES),
    }),
  ),
});
export type AiMinutesOutput = z.output<typeof aiMinutesOutput>;

export const aiHealthOutput = z.object({ explanation: z.string(), actions: z.array(z.string()) });
export type AiHealthOutput = z.output<typeof aiHealthOutput>;

/** Every AI response says what it is: a proposal, with the model that produced it. */
export interface AiResult<T> {
  feature: AiFeature;
  model: string;
  proposal: T;
  disclaimer: string;
}
export interface AiMinutesResult extends AiResult<AiMinutesOutput> {
  /** ownerRef → participant (resolved on the server). */
  owners: Record<string, { id: string; name: string }>;
}

/* ============================ Phase 7B: Ask Your Data ============================ */

export const askDataSchema = z.strictObject({
  question: z.string().trim().min(5, 'Ask a question').max(500),
});

export const ASK_INTENTS = [
  'tasks',
  'hours',
  'projects',
  'risks',
  'workload',
  'unsupported',
] as const;
export const ASK_GROUPS = [
  'none',
  'status',
  'priority',
  'assignee',
  'project',
  'user',
  'category',
  'week',
  'severity',
] as const;

/**
 * The model's only job: translate a question into this plan. The server runs the plan
 * through the normal permission-scoped queries; the model never sees the data.
 */
export const askPlanSchema = z.object({
  intent: z.enum(ASK_INTENTS),
  groupBy: z.enum(ASK_GROUPS),
  projectKeys: z.array(z.string()),
  statuses: z.array(z.enum(TASK_STATUSES)),
  priorities: z.array(z.enum(PRIORITIES)),
  assignee: z.enum(['any', 'me', 'unassigned', 'named']),
  assigneeName: z.string().nullable(),
  overdueOnly: z.boolean(),
  dueWithinDays: z.number().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  severities: z.array(z.enum(['low', 'medium', 'high', 'critical'])),
  healthBand: z.enum(['any', 'healthy', 'watch', 'at_risk']),
  explanation: z.string(),
  unsupportedReason: z.string().nullable(),
});
export type AskPlan = z.output<typeof askPlanSchema>;

export interface AskResultDto {
  question: string;
  /** Plain description of what was queried (built by the server from the plan). */
  interpretation: string;
  answer: string;
  columns: string[];
  rows: (string | number)[][];
  /** Present when the rows are a grouped count / sum suitable for a bar chart. */
  chart: { labelColumn: number; valueColumn: number } | null;
  notes: string[];
  model: string;
  plan: AskPlan;
}

/* ============================ Phase 7B: Forecast & risk scan ============================ */

export const FORECAST_LABELS = [
  'on_track',
  'at_risk',
  'likely_late',
  'no_end_date',
  'insufficient_data',
  'done',
] as const;
export type ForecastLabel = (typeof FORECAST_LABELS)[number];

export interface ProjectForecastDto {
  project: { id: string; key: string; name: string; endDate?: string };
  label: ForecastLabel;
  remainingTasks: number;
  remainingHours: number;
  /** Average completed effort per week over the last 4 weeks. */
  hoursPerWeek: number;
  weeklyHistory: { week: string; hours: number }[];
  forecastDate: string | null;
  /** Range from the best and worst of the last 4 weeks. */
  range: { optimistic: string | null; pessimistic: string | null };
  slipDays: number | null;
  explanation: string;
  tasksAtRisk: { id: string; key: string; title: string; dueDate: string; reason: string }[];
}

export const aiRiskScanOutput = z.object({
  risks: z.array(
    z.object({
      title: z.string(),
      type: z.enum(['risk', 'issue', 'blocker']),
      probability: z.number(),
      impact: z.number(),
      rationale: z.string(),
      mitigation: z.string(),
    }),
  ),
});
export type AiRiskScanOutput = z.output<typeof aiRiskScanOutput>;

/* ============================ Phase 7B: Duplicate detection ============================ */

export const similarTasksQuerySchema = z.strictObject({
  projectId: objectIdSchema,
  title: z.string().trim().min(3).max(200),
  excludeId: objectIdSchema.optional(),
});
export interface SimilarTaskDto {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  score: number;
}

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'is',
  'be',
  'at',
  'by',
  'from',
  'as',
  'it',
  'this',
  'that',
]);
/** Normalised word set (lower-case, punctuation removed, stop words dropped, simple plural folding). */
export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
      .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)),
  );
}
/** Similarity 0..1: word overlap (Jaccard) blended with character-trigram overlap for typos. */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter((x) => tb.has(x)).length;
  const words = inter / (ta.size + tb.size - inter);
  const grams = (s: string) => {
    const t = ` ${[...titleTokens(s)].sort().join(' ')} `;
    const out = new Set<string>();
    for (let i = 0; i < t.length - 2; i += 1) out.add(t.slice(i, i + 3));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  const gi = [...ga].filter((x) => gb.has(x)).length;
  const chars = gi / (ga.size + gb.size - gi);
  return Math.round((0.6 * words + 0.4 * chars) * 100) / 100;
}
