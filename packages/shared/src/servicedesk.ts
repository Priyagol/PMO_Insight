import { z } from 'zod';
import { objectIdSchema } from './api';
import { PRIORITIES, type Priority, type TaskStatus } from './enums';

/*
 * Service desk and request forms (Jira groups G / "Forms and Request Management").
 * A project can run a service desk: request types with their own forms, a help centre where
 * anyone in the organisation raises requests, agent queues, SLA clocks, approvals for
 * requests that need them, and satisfaction ratings. Requests are tasks of that project.
 */

export const REQUEST_KINDS = ['service_request', 'incident', 'problem', 'change'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  service_request: 'Service request',
  incident: 'Incident',
  problem: 'Problem',
  change: 'Change',
};

export const FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'select',
  'number',
  'date',
  'checkbox',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const formFieldSchema = z.strictObject({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lower-case letters, digits and _'),
  label: z.string().trim().min(1).max(80),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  helpText: z.string().trim().max(200).optional(),
  /** Show the field only when another field has this value (conditional field). */
  showIf: z
    .strictObject({ field: z.string().trim().min(1).max(40), equals: z.string().trim().max(80) })
    .nullable()
    .optional(),
});
export type FormField = z.output<typeof formFieldSchema>;
export type FormFieldInput = z.input<typeof formFieldSchema>;

export const slaSchema = z.strictObject({
  /** Hours until someone on the team first responds. */
  responseHours: z.number().min(0.25).max(720),
  /** Hours until the request is resolved. */
  resolutionHours: z.number().min(0.25).max(2160),
});

export const requestTypeSchema = z
  .strictObject({
    name: z.string().trim().min(1, 'Name it').max(80),
    description: z.string().trim().max(500).nullable().optional(),
    kind: z.enum(REQUEST_KINDS).default('service_request'),
    fields: z.array(formFieldSchema).max(20).default([]),
    defaultPriority: z.enum(PRIORITIES).default('medium'),
    /** People raising the request may choose its urgency (useful for incidents). */
    requesterSetsPriority: z.boolean().default(false),
    sla: slaSchema.nullable().default(null),
    /** The request waits for the project manager's approval before work starts. */
    approvalRequired: z.boolean().default(false),
    /** Knowledge-base articles shown on the form. */
    helpLinks: z
      .array(
        z.strictObject({
          title: z.string().trim().min(1).max(120),
          url: z.string().url().max(500),
        }),
      )
      .max(5)
      .default([]),
    active: z.boolean().default(true),
  })
  .superRefine((t, ctx) => {
    const keys = new Set<string>();
    t.fields.forEach((f, i) => {
      if (keys.has(f.key))
        ctx.addIssue({
          code: 'custom',
          path: ['fields', i, 'key'],
          message: 'Duplicate field key',
        });
      keys.add(f.key);
      if (f.type === 'select' && f.options.length < 2)
        ctx.addIssue({
          code: 'custom',
          path: ['fields', i, 'options'],
          message: 'Give at least two choices',
        });
      if (f.showIf && (!keys.has(f.showIf.field) || f.showIf.field === f.key))
        ctx.addIssue({
          code: 'custom',
          path: ['fields', i, 'showIf'],
          message: 'A condition must refer to a field above it',
        });
    });
    if (t.sla && t.sla.responseHours > t.sla.resolutionHours)
      ctx.addIssue({
        code: 'custom',
        path: ['sla'],
        message: 'Response must come before resolution',
      });
  });
export type RequestTypeInput = z.input<typeof requestTypeSchema>;

export const serviceDeskSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  /** People who work the queue (project members). Empty = all members. */
  agentIds: z.array(objectIdSchema).max(100).default([]),
  /** Spread new requests across the agents in turn. */
  autoAssign: z.enum(['none', 'round_robin']).default('none'),
});
export type ServiceDeskSettingsInput = z.input<typeof serviceDeskSettingsSchema>;

export type AnswerValue = string | number | boolean | null;

export const submitRequestSchema = z.strictObject({
  requestTypeId: objectIdSchema,
  summary: z.string().trim().min(3, 'Describe it in a few words').max(200),
  answers: z
    .record(z.string(), z.union([z.string().max(5000), z.number(), z.boolean(), z.null()]))
    .default({}),
  priority: z.enum(PRIORITIES).optional(),
});
export type SubmitRequestInput = z.input<typeof submitRequestSchema>;

export const requestCommentSchema = z.strictObject({ body: z.string().trim().min(1).max(5000) });
export const requestFeedbackSchema = z.strictObject({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

/** Whether a field is shown for these answers. */
export const fieldVisible = (f: Pick<FormField, 'showIf'>, answers: Record<string, AnswerValue>) =>
  !f.showIf || String(answers[f.showIf.field] ?? '') === f.showIf.equals;

/**
 * Checks answers against a form. Hidden fields are dropped; returns the cleaned answers or the
 * problems by field key. Used by the form in the browser and again on the server.
 */
export function validateAnswers(
  fields: FormField[],
  raw: Record<string, AnswerValue>,
):
  | { ok: true; answers: Record<string, AnswerValue> }
  | { ok: false; errors: Record<string, string> } {
  const answers: Record<string, AnswerValue> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (!fieldVisible(f, { ...raw, ...answers })) continue;
    const v = raw[f.key];
    const empty =
      v === undefined || v === null || v === '' || (f.type === 'checkbox' && v === false);
    if (empty) {
      if (f.required) errors[f.key] = f.type === 'checkbox' ? 'Please confirm' : 'Required';
      else answers[f.key] = f.type === 'checkbox' ? false : null;
      continue;
    }
    switch (f.type) {
      case 'select':
        if (!f.options.includes(String(v))) errors[f.key] = 'Choose one of the options';
        else answers[f.key] = String(v);
        break;
      case 'number': {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n)) errors[f.key] = 'Enter a number';
        else answers[f.key] = n;
        break;
      }
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errors[f.key] = 'Enter a date';
        else answers[f.key] = String(v);
        break;
      case 'checkbox':
        answers[f.key] = v === true || v === 'true';
        break;
      default:
        answers[f.key] = String(v).slice(0, f.type === 'text' ? 500 : 5000);
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, answers };
}

/* ---------- DTOs ---------- */

export interface RequestTypeDto {
  id: string;
  project: { id: string; key: string; name: string };
  name: string;
  description: string | null;
  kind: RequestKind;
  fields: FormField[];
  defaultPriority: Priority;
  requesterSetsPriority: boolean;
  sla: { responseHours: number; resolutionHours: number } | null;
  approvalRequired: boolean;
  helpLinks: { title: string; url: string }[];
  active: boolean;
}

export interface ServiceDeskSettingsDto {
  enabled: boolean;
  agents: { id: string; name: string }[];
  autoAssign: 'none' | 'round_robin';
  canEdit: boolean;
}

export type SlaState = 'running' | 'at_risk' | 'breached' | 'met' | 'missed';
export interface SlaClockDto {
  dueAt: string;
  /** When it was met (response or resolution), if it was. */
  doneAt: string | null;
  state: SlaState;
}

export interface ServiceRequestDto {
  id: string;
  key: string;
  summary: string;
  kind: RequestKind;
  requestType: { id: string; name: string } | null;
  project: { id: string; key: string; name: string };
  status: TaskStatus;
  statusLabel: string;
  priority: Priority;
  requester: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  answers: { key: string; label: string; value: AnswerValue }[];
  sla: { response: SlaClockDto | null; resolution: SlaClockDto | null };
  awaitingApproval: boolean;
  feedback: { rating: number; comment: string | null } | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface RequestCommentDto {
  id: string;
  author: { id: string; name: string } | null;
  fromTeam: boolean;
  body: string;
  createdAt: string;
}

export const QUEUE_VIEWS = [
  'open',
  'unassigned',
  'mine',
  'at_risk',
  'breached',
  'awaiting_approval',
  'resolved',
] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];
export const QUEUE_VIEW_LABELS: Record<QueueView, string> = {
  open: 'All open',
  unassigned: 'Unassigned',
  mine: 'Assigned to me',
  at_risk: 'SLA at risk',
  breached: 'SLA breached',
  awaiting_approval: 'Awaiting approval',
  resolved: 'Resolved',
};

export interface ServiceDeskReportDto {
  open: number;
  resolvedLast30: number;
  responseSlaMetPercent: number | null;
  resolutionSlaMetPercent: number | null;
  averageRating: number | null;
  ratings: number;
  byKind: { kind: RequestKind; open: number }[];
}
