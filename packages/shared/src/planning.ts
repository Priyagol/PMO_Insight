import { z } from 'zod';
import { objectIdSchema } from './api';
import { PRIORITIES, type Priority, type ProjectStatus } from './enums';

/*
 * Phase 5B: milestones, project-to-project dependencies, recurring tasks, custom fields and
 * project templates. Shared by the API (validation) and the web client (forms, display).
 */

const dateString = z.iso.date('Use a valid date');

/* ---------- Custom fields ---------- */

export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'select', 'checkbox'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  select: 'Dropdown',
  checkbox: 'Checkbox',
};
export const MAX_CUSTOM_FIELDS = 20;

export const customFieldDefSchema = z
  .strictObject({
    key: z
      .string()
      .trim()
      .regex(
        /^[a-z][a-z0-9_]{0,29}$/,
        'Use lower-case letters, numbers and _ (start with a letter)',
      ),
    label: z.string().trim().min(1, 'Enter a label').max(60),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
    required: z.boolean().default(false),
  })
  .refine((f) => f.type !== 'select' || f.options.length >= 2, {
    message: 'A dropdown needs at least two options',
    path: ['options'],
  })
  .refine((f) => new Set(f.options).size === f.options.length, {
    message: 'Options must be unique',
    path: ['options'],
  });
export type CustomFieldDef = z.output<typeof customFieldDefSchema>;

export const projectCustomFieldsSchema = z.strictObject({
  fields: z
    .array(customFieldDefSchema)
    .max(MAX_CUSTOM_FIELDS, `At most ${MAX_CUSTOM_FIELDS} fields per project`)
    .refine((fs) => new Set(fs.map((f) => f.key)).size === fs.length, 'Field keys must be unique'),
});
export type ProjectCustomFieldsInput = z.input<typeof projectCustomFieldsSchema>;

export type CustomFieldValue = string | number | boolean | null;
/** Values keyed by field key; `null` clears a value. */
export const customValuesSchema = z.record(
  z.string().max(30),
  z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]),
);
export type CustomValues = Record<string, CustomFieldValue>;

/** Turns a label into a field key ("Client ref #" → "client_ref"). */
export function fieldKeyFromLabel(label: string): string {
  const k = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 30);
  return k || 'field';
}

/**
 * Validates submitted values against a project's field definitions.
 * Unknown keys are rejected; values are normalised (trimmed text, finite numbers).
 * `existing` is the task's current values (for updates): required fields must stay filled.
 */
export function validateCustomValues(
  defs: readonly CustomFieldDef[],
  input: CustomValues,
  existing?: CustomValues,
): { values: CustomValues; errors: Record<string, string> } {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const values: CustomValues = {};
  const errors: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input)) {
    const def = byKey.get(key);
    if (!def) {
      errors[key] = 'Unknown field';
      continue;
    }
    if (raw === null || raw === '') {
      values[key] = null;
      continue;
    }
    switch (def.type) {
      case 'text':
        if (typeof raw !== 'string') errors[key] = `${def.label} must be text`;
        else values[key] = raw.trim().slice(0, 2000);
        break;
      case 'number': {
        const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
        if (!Number.isFinite(n)) errors[key] = `${def.label} must be a number`;
        else values[key] = n;
        break;
      }
      case 'date':
        if (typeof raw !== 'string' || !dateString.safeParse(raw).success)
          errors[key] = `${def.label} must be a date`;
        else values[key] = raw;
        break;
      case 'select':
        if (typeof raw !== 'string' || !def.options.includes(raw))
          errors[key] = `Choose one of the ${def.label} options`;
        else values[key] = raw;
        break;
      case 'checkbox':
        if (typeof raw !== 'boolean') errors[key] = `${def.label} must be yes or no`;
        else values[key] = raw;
        break;
    }
  }
  const merged = { ...(existing ?? {}), ...values };
  for (const def of defs) {
    if (!def.required || errors[def.key]) continue;
    const v = merged[def.key];
    // Checkboxes are always answered (false is a value).
    if (def.type !== 'checkbox' && (v === undefined || v === null || v === ''))
      errors[def.key] = `${def.label} is required`;
  }
  return { values, errors };
}

/** Display a stored value. */
export function formatCustomValue(def: CustomFieldDef, v: CustomFieldValue | undefined): string {
  if (v === undefined || v === null || v === '') return '—';
  if (def.type === 'checkbox') return v ? 'Yes' : 'No';
  return String(v);
}

/* ---------- Milestones ---------- */

export const MILESTONE_STATUSES = ['open', 'completed'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

const milestoneFields = {
  name: z.string().trim().min(2, 'Enter a milestone name').max(120),
  description: z.string().trim().max(2000).optional(),
  dueDate: dateString,
};
export const createMilestoneSchema = z.strictObject(milestoneFields);
export type CreateMilestoneInput = z.input<typeof createMilestoneSchema>;
export const updateMilestoneSchema = z
  .strictObject({
    ...milestoneFields,
    description: z.string().trim().max(2000).nullable(),
    status: z.enum(MILESTONE_STATUSES),
  })
  .partial();
export type UpdateMilestoneInput = z.input<typeof updateMilestoneSchema>;

export interface MilestoneDto {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  dueDate: string;
  status: MilestoneStatus;
  completedAt?: string;
  /** Open and past its due date. */
  overdue: boolean;
  progress: { total: number; done: number; percent: number };
  canEdit: boolean;
  createdAt: string;
}

export interface MilestoneRef {
  id: string;
  name: string;
  dueDate: string;
  status: MilestoneStatus;
}

/* ---------- Project dependencies ---------- */

export const projectDependenciesSchema = z.strictObject({
  dependencies: z
    .array(
      z.strictObject({ projectId: objectIdSchema, note: z.string().trim().max(300).optional() }),
    )
    .max(20),
});
export type ProjectDependenciesInput = z.input<typeof projectDependenciesSchema>;

export interface ProjectDependencyDto {
  project: { id: string; key: string; name: string; status: ProjectStatus; endDate?: string };
  note?: string;
  /**
   * The upstream project threatens this one: it is not completed and either its end date has
   * passed or it ends after this project starts.
   */
  delayed: boolean;
  reason?: string;
}

export interface ProjectDependenciesDto {
  dependsOn: ProjectDependencyDto[];
  /** Upstream projects the caller cannot see (only the count is revealed). */
  hiddenUpstream: number;
  dependents: { id: string; key: string; name: string; status: ProjectStatus }[];
  canEdit: boolean;
}

/* ---------- Recurring tasks ---------- */

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export const recurrenceSchema = z.strictObject({
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  interval: z.number().int().min(1).max(30).default(1),
  /** Daily only: skip Saturdays and Sundays. */
  workdaysOnly: z.boolean().default(false),
  /** Last date an occurrence may be due on (inclusive). */
  until: dateString.nullable().optional(),
});
export type RecurrenceRule = z.output<typeof recurrenceSchema>;
export type RecurrenceInput = z.input<typeof recurrenceSchema>;

export interface RecurrenceDto extends RecurrenceRule {
  /** Plain-language summary, e.g. "Every 2 weeks until 31 Mar 2027". */
  summary: string;
  /** Position in the series (1 = first). */
  index: number;
  /** The next occurrence once created (on completion). */
  nextTask: { id: string; key: string } | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseIso = (s: string) => new Date(`${s}T00:00:00Z`);

/** The next due date after `from` (a YYYY-MM-DD calendar date), or null when past `until`. */
export function nextOccurrence(rule: RecurrenceRule, from: string): string | null {
  const d = parseIso(from);
  if (rule.frequency === 'daily') {
    let added = 0;
    while (added < rule.interval) {
      d.setUTCDate(d.getUTCDate() + 1);
      const day = d.getUTCDay();
      if (!rule.workdaysOnly || (day !== 0 && day !== 6)) added += 1;
    }
  } else if (rule.frequency === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7 * rule.interval);
  } else {
    // Same day of month, clamped to the month's last day (31 Jan → 28/29 Feb).
    const day = parseIso(from).getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + rule.interval);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  const next = isoOf(d);
  if (rule.until && next > rule.until) return null;
  return next;
}

/** Whole days between two calendar dates (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86_400_000);
}
export function addDays(date: string, days: number): string {
  const d = parseIso(date);
  d.setUTCDate(d.getUTCDate() + days);
  return isoOf(d);
}

export function describeRecurrence(
  rule: RecurrenceRule,
  formatDate: (iso: string) => string = (s) => s,
): string {
  const unit = {
    daily: rule.workdaysOnly ? 'working day' : 'day',
    weekly: 'week',
    monthly: 'month',
  }[rule.frequency];
  const every = rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;
  return rule.until ? `${every} until ${formatDate(rule.until)}` : every;
}

/* ---------- Project templates ---------- */

const offset = z.number().int().min(0).max(3650);

export const templateTaskSchema = z.strictObject({
  /** Local reference inside the template (used by parent/dependency/milestone links). */
  ref: z.string().trim().min(1).max(40),
  parentRef: z.string().max(40).nullable().optional(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(20000).optional(),
  priority: z.enum(PRIORITIES).default('medium'),
  estimatedHours: z.number().min(0).max(10_000).nullable().optional(),
  complexity: z.number().int().min(1).max(5).nullable().optional(),
  requiredSkills: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(60),
        minLevel: z.number().int().min(1).max(5),
      }),
    )
    .max(20)
    .default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  checklist: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  /** Days after the project start. */
  startOffsetDays: offset.nullable().optional(),
  dueOffsetDays: offset.nullable().optional(),
  milestoneRef: z.string().max(40).nullable().optional(),
  dependencyRefs: z.array(z.string().max(40)).max(50).default([]),
  recurrence: recurrenceSchema.omit({ until: true }).nullable().optional(),
  customFields: customValuesSchema.default({}),
});
export type TemplateTask = z.output<typeof templateTaskSchema>;

export const templateMilestoneSchema = z.strictObject({
  ref: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  dueOffsetDays: offset,
});
export type TemplateMilestone = z.output<typeof templateMilestoneSchema>;

const templateFields = {
  name: z.string().trim().min(2, 'Enter a template name').max(120),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(60).optional(),
  priority: z.enum(PRIORITIES).default('medium'),
  objectives: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  /** Planned length; sets the end date when a project is created from the template. */
  durationDays: offset.nullable().optional(),
  estimatedHours: z.number().min(0).max(1_000_000).nullable().optional(),
  customFields: z.array(customFieldDefSchema).max(MAX_CUSTOM_FIELDS).default([]),
  milestones: z.array(templateMilestoneSchema).max(50).default([]),
  tasks: z.array(templateTaskSchema).max(500).default([]),
};

/** Cross-reference checks: refs are unique and every link points at an existing ref. */
function templateRefsValid(
  t: { milestones?: { ref: string }[]; tasks?: TemplateTaskRefs[] },
  ctx: z.RefinementCtx,
) {
  const tasks = t.tasks ?? [];
  const taskRefs = new Set(tasks.map((x) => x.ref));
  const msRefs = new Set((t.milestones ?? []).map((m) => m.ref));
  if (taskRefs.size !== tasks.length)
    ctx.addIssue({ code: 'custom', message: 'Task refs must be unique', path: ['tasks'] });
  if (t.milestones && msRefs.size !== t.milestones.length)
    ctx.addIssue({
      code: 'custom',
      message: 'Milestone refs must be unique',
      path: ['milestones'],
    });
  tasks.forEach((x, i) => {
    if (x.parentRef && (!taskRefs.has(x.parentRef) || x.parentRef === x.ref))
      ctx.addIssue({ code: 'custom', message: 'Unknown parent', path: ['tasks', i, 'parentRef'] });
    if (x.milestoneRef && !msRefs.has(x.milestoneRef))
      ctx.addIssue({
        code: 'custom',
        message: 'Unknown milestone',
        path: ['tasks', i, 'milestoneRef'],
      });
    for (const d of x.dependencyRefs ?? [])
      if (!taskRefs.has(d) || d === x.ref)
        ctx.addIssue({
          code: 'custom',
          message: 'Unknown dependency',
          path: ['tasks', i, 'dependencyRefs'],
        });
  });
}
interface TemplateTaskRefs {
  ref: string;
  parentRef?: string | null;
  milestoneRef?: string | null;
  dependencyRefs?: string[];
}

export const createTemplateSchema = z.strictObject(templateFields).superRefine(templateRefsValid);
export type CreateTemplateInput = z.input<typeof createTemplateSchema>;

export const updateTemplateSchema = z
  .strictObject({
    name: templateFields.name,
    description: z.string().trim().max(2000).nullable(),
    category: z.string().trim().max(60).nullable(),
    priority: z.enum(PRIORITIES),
    objectives: z.array(z.string().trim().min(1).max(300)).max(20),
    durationDays: templateFields.durationDays,
    estimatedHours: templateFields.estimatedHours,
    customFields: z.array(customFieldDefSchema).max(MAX_CUSTOM_FIELDS),
    milestones: z.array(templateMilestoneSchema).max(50),
    tasks: z.array(templateTaskSchema).max(500),
  })
  .partial()
  .superRefine(templateRefsValid);
export type UpdateTemplateInput = z.input<typeof updateTemplateSchema>;

export const saveAsTemplateSchema = z.strictObject({
  name: templateFields.name,
  description: z.string().trim().max(2000).optional(),
  includeTasks: z.boolean().default(true),
});
export type SaveAsTemplateInput = z.input<typeof saveAsTemplateSchema>;

export interface TemplateSummaryDto {
  id: string;
  name: string;
  description?: string;
  category?: string;
  priority: Priority;
  durationDays?: number;
  taskCount: number;
  milestoneCount: number;
  customFieldCount: number;
  usageCount: number;
  createdBy: { id: string; name: string } | null;
  canEdit: boolean;
  updatedAt: string;
}

export interface TemplateDto extends TemplateSummaryDto {
  objectives: string[];
  estimatedHours?: number;
  customFields: CustomFieldDef[];
  milestones: TemplateMilestone[];
  tasks: TemplateTask[];
}
