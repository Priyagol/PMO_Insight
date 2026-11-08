import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from './api';
import type { UserRef } from './dto';
import { PRIORITIES, type Priority, type TaskStatus } from './enums';

/*
 * Phase 6A: notifications, the approval engine, and meetings & minutes.
 */

/* ============================ Notifications ============================ */

export const NOTIFICATION_TYPES = [
  'task_assigned',
  'mentioned',
  'task_status',
  'task_comment',
  'task_due',
  'timesheet_submitted',
  'timesheet_decided',
  'leave_requested',
  'leave_decided',
  'risk_alert',
  'approval_requested',
  'approval_decided',
  'approval_reminder',
  'meeting_invite',
  'minutes_published',
  'action_item',
  'assignment_done',
  'automation',
  'smart_commit',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Catalogue shown on the preferences screen. `email` is the default e-mail setting. */
export const NOTIFICATION_CATALOGUE: Record<
  NotificationType,
  { label: string; group: string; email: boolean }
> = {
  task_assigned: { label: 'A task is assigned to me', group: 'Tasks', email: true },
  mentioned: { label: 'Someone @mentions me', group: 'Tasks', email: true },
  task_status: { label: 'A task I watch changes status', group: 'Tasks', email: false },
  task_comment: { label: 'New comment on a task I watch', group: 'Tasks', email: false },
  task_due: { label: 'My task is due tomorrow or overdue', group: 'Tasks', email: false },
  timesheet_submitted: {
    label: 'A timesheet awaits my approval',
    group: 'Time & leave',
    email: true,
  },
  timesheet_decided: {
    label: 'My timesheet is approved or rejected',
    group: 'Time & leave',
    email: true,
  },
  leave_requested: {
    label: 'A leave request awaits my approval',
    group: 'Time & leave',
    email: true,
  },
  leave_decided: { label: 'My leave request is decided', group: 'Time & leave', email: true },
  risk_alert: { label: 'Critical or escalated risk in my project', group: 'Projects', email: true },
  approval_requested: { label: 'An approval awaits my decision', group: 'Approvals', email: true },
  approval_decided: {
    label: 'My request is approved or rejected',
    group: 'Approvals',
    email: true,
  },
  approval_reminder: {
    label: 'An approval I owe is past its deadline',
    group: 'Approvals',
    email: true,
  },
  meeting_invite: { label: 'I am invited to a meeting', group: 'Meetings', email: true },
  minutes_published: {
    label: 'Minutes of my meeting are published',
    group: 'Meetings',
    email: false,
  },
  action_item: { label: 'An action item is assigned to me', group: 'Meetings', email: true },
  automation: { label: 'An automation rule sends me a message', group: 'Projects', email: false },
  assignment_done: {
    label: 'My assignment plan has been executed',
    group: 'Projects',
    email: false,
  },
  smart_commit: {
    label: 'A command in my commit message could not be carried out',
    group: 'Tasks',
    email: true,
  },
};

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  /** In-app path, e.g. /projects/123. */
  link?: string;
  actor: { id: string; name: string } | null;
  read: boolean;
  createdAt: string;
}

export const notificationQuerySchema = paginationQuerySchema.extend({
  unread: z.enum(['true', 'false']).optional(),
});
export type NotificationQuery = z.input<typeof notificationQuerySchema>;

export const notificationPrefsSchema = z.strictObject({
  /** Per-type e-mail switch; in-app notifications are always kept. */
  email: z.partialRecord(z.enum(NOTIFICATION_TYPES), z.boolean()),
  /** Master switch for all e-mail notifications. */
  emailEnabled: z.boolean(),
});
export type NotificationPrefs = z.output<typeof notificationPrefsSchema>;

/* ============================ Approvals ============================ */

export const APPROVAL_ENTITY_TYPES = [
  'general',
  'project_closure',
  'document_publish',
  'release_deploy',
  'change_request',
  'task_transition',
  'service_request',
] as const;
export type ApprovalEntityType = (typeof APPROVAL_ENTITY_TYPES)[number];
export const APPROVAL_ENTITY_LABELS: Record<ApprovalEntityType, string> = {
  general: 'General request',
  project_closure: 'Project closure',
  document_publish: 'Document publication',
  release_deploy: 'Production deployment',
  change_request: 'Change request',
  task_transition: 'Task status change',
  service_request: 'Service request',
};
/** Types people raise directly; the others are raised by their modules (documents, releases, change requests). */
export const USER_APPROVAL_TYPES = ['general', 'project_closure'] as const;

export const APPROVER_TYPES = [
  'project_manager',
  'department_head',
  'reporting_manager',
  'role',
  'users',
] as const;
export type ApproverType = (typeof APPROVER_TYPES)[number];
export const APPROVER_TYPE_LABELS: Record<ApproverType, string> = {
  project_manager: 'Project manager',
  department_head: "Project's department head",
  reporting_manager: "Requester's reporting manager",
  role: 'Everyone with a role',
  users: 'Named people',
};

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const APPROVAL_STAGE_STATUSES = [
  'waiting',
  'pending',
  'approved',
  'rejected',
  'skipped',
] as const;
export type ApprovalStageStatus = (typeof APPROVAL_STAGE_STATUSES)[number];

export const approvalStageSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(80),
    approverType: z.enum(APPROVER_TYPES),
    roleKey: z.string().trim().max(60).optional(),
    userIds: z.array(objectIdSchema).max(20).optional(),
    /** Time allowed for a decision before reminders are sent. */
    slaHours: z.number().int().min(1).max(720).default(48),
    /** Runs only when every earlier stage was skipped (e.g. the requester was the approver). */
    fallbackOnly: z.boolean().default(false),
  })
  .refine((s) => s.approverType !== 'role' || Boolean(s.roleKey), {
    message: 'Choose a role',
    path: ['roleKey'],
  })
  .refine((s) => s.approverType !== 'users' || (s.userIds?.length ?? 0) > 0, {
    message: 'Choose at least one person',
    path: ['userIds'],
  });
export type ApprovalStageDef = z.output<typeof approvalStageSchema>;

export const approvalWorkflowSchema = z.strictObject({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  stages: z.array(approvalStageSchema).min(1, 'Add at least one stage').max(5),
});
export type ApprovalWorkflowInput = z.input<typeof approvalWorkflowSchema>;

export interface ApprovalWorkflowDto {
  id: string;
  entityType: ApprovalEntityType;
  name: string;
  description?: string;
  stages: ApprovalStageDef[];
  updatedAt: string;
}

export const createApprovalSchema = z.strictObject({
  entityType: z.enum(USER_APPROVAL_TYPES),
  projectId: objectIdSchema,
  title: z.string().trim().min(3, 'Enter a short title').max(160),
  description: z.string().trim().max(5000).optional(),
  /** Optional amount in INR (e.g. a budget change). */
  amount: z.number().min(0).max(1e12).nullable().optional(),
});
export type CreateApprovalInput = z.input<typeof createApprovalSchema>;

export const approvalDecisionSchema = z.strictObject({
  comment: z.string().trim().max(2000).optional(),
});
export const approvalRejectSchema = z.strictObject({
  comment: z.string().trim().min(3, 'Give a reason').max(2000),
});
export const approvalDelegateSchema = z.strictObject({
  toUserId: objectIdSchema,
  comment: z.string().trim().max(2000).optional(),
});

export const approvalQuerySchema = paginationQuerySchema.extend({
  box: z.enum(['inbox', 'mine', 'all']).default('inbox'),
  status: z.enum(APPROVAL_STATUSES).optional(),
  projectId: objectIdSchema.optional(),
});
export type ApprovalQuery = z.input<typeof approvalQuerySchema>;

export interface ApprovalStageDto {
  name: string;
  approverType: ApproverType;
  status: ApprovalStageStatus;
  approvers: UserRef[];
  /** Why the stage was skipped (e.g. nobody eligible). */
  note?: string;
  decidedBy: UserRef | null;
  comment?: string;
  decidedAt?: string;
  dueAt?: string;
  overdue: boolean;
}

export interface ApprovalDto {
  id: string;
  key: string;
  entityType: ApprovalEntityType;
  /** The record the request is about (document, release, change request). */
  entityId?: string;
  title: string;
  description?: string;
  amount?: number;
  project: { id: string; key: string; name: string };
  requestedBy: UserRef | null;
  status: ApprovalStatus;
  currentStage: number;
  stages: ApprovalStageDto[];
  history: { at: string; by: UserRef | null; action: string; comment?: string }[];
  can: { act: boolean; cancel: boolean };
  createdAt: string;
  decidedAt?: string;
}

/* ============================ Meetings ============================ */

export const MEETING_TYPES = [
  'standup',
  'planning',
  'review',
  'client',
  'retrospective',
  'other',
] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];
export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  standup: 'Stand-up',
  planning: 'Planning',
  review: 'Review',
  client: 'Client meeting',
  retrospective: 'Retrospective',
  other: 'Other',
};
export const MEETING_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

const isoDateTime = z.iso.datetime({ offset: true, message: 'Use a valid date and time' });

const meetingFields = {
  projectId: objectIdSchema,
  title: z.string().trim().min(2, 'Enter a title').max(160),
  type: z.enum(MEETING_TYPES).default('other'),
  startAt: isoDateTime,
  endAt: isoDateTime,
  location: z.string().trim().max(300).optional(),
  participantIds: z.array(objectIdSchema).max(100).default([]),
  agenda: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
};
const timesInOrder = (v: { startAt?: string; endAt?: string }) =>
  !v.startAt || !v.endAt || v.startAt < v.endAt;

export const createMeetingSchema = z
  .strictObject(meetingFields)
  .refine(timesInOrder, { message: 'End must be after the start', path: ['endAt'] });
export type CreateMeetingInput = z.input<typeof createMeetingSchema>;

export const updateMeetingSchema = z
  .strictObject({
    title: meetingFields.title,
    type: z.enum(MEETING_TYPES),
    startAt: isoDateTime,
    endAt: isoDateTime,
    location: z.string().trim().max(300).nullable(),
    participantIds: z.array(objectIdSchema).max(100),
    agenda: z.array(z.string().trim().min(1).max(300)).max(50),
    status: z.enum(MEETING_STATUSES),
  })
  .partial()
  .refine(timesInOrder, { message: 'End must be after the start', path: ['endAt'] });
export type UpdateMeetingInput = z.input<typeof updateMeetingSchema>;

export const actionItemSchema = z.strictObject({
  /** Present for existing items (kept stable so converted tasks stay linked). */
  id: z.string().max(40).optional(),
  text: z.string().trim().min(2).max(500),
  assigneeId: objectIdSchema.nullable().optional(),
  dueDate: z.iso.date().nullable().optional(),
  priority: z.enum(PRIORITIES).default('medium'),
});

export const meetingMinutesSchema = z.strictObject({
  minutes: z.string().trim().max(50_000),
  decisions: z.array(z.string().trim().min(1).max(500)).max(100),
  actionItems: z.array(actionItemSchema).max(100),
  /** Publishing notifies participants and marks the meeting completed. */
  publish: z.boolean().default(false),
});
export type MeetingMinutesInput = z.input<typeof meetingMinutesSchema>;

export const meetingQuerySchema = paginationQuerySchema.extend({
  projectId: objectIdSchema.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  mine: z.enum(['true', 'false']).optional(),
  status: z.enum(MEETING_STATUSES).optional(),
});
export type MeetingQuery = z.input<typeof meetingQuerySchema>;

export interface ActionItemDto {
  id: string;
  text: string;
  assignee: UserRef | null;
  dueDate?: string;
  priority: Priority;
  task: { id: string; key: string; status: TaskStatus } | null;
}

export interface MeetingDto {
  id: string;
  project: { id: string; key: string; name: string };
  title: string;
  type: MeetingType;
  status: MeetingStatus;
  startAt: string;
  endAt: string;
  location?: string;
  organizer: UserRef | null;
  participants: UserRef[];
  agenda: string[];
  minutes?: string;
  decisions: string[];
  actionItems: ActionItemDto[];
  minutesPublishedAt?: string;
  can: { edit: boolean };
  createdAt: string;
}
