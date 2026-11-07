import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from './api';
import type { UserRef } from './dto';
import { PRIORITIES, type Priority, type TaskStatus } from './enums';

/*
 * Phase 6B: documents and versions, releases and deployments, stakeholders, change
 * requests and feedback.
 */

type Ref = { id: string; key: string; name: string };
const dateString = z.iso.date('Use a valid date');

/* ============================ Documents ============================ */

export const DOCUMENT_CATEGORIES = [
  'brd',
  'frd',
  'srs',
  'design',
  'test_plan',
  'test_report',
  'contract',
  'minutes',
  'policy',
  'other',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  brd: 'BRD',
  frd: 'FRD',
  srs: 'SRS',
  design: 'Design',
  test_plan: 'Test plan',
  test_report: 'Test report',
  contract: 'Contract',
  minutes: 'Minutes',
  policy: 'Policy',
  other: 'Other',
};
export const DOCUMENT_STATUSES = ['draft', 'pending_approval', 'published', 'archived'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Awaiting approval',
  published: 'Published',
  archived: 'Archived',
};

/** Metadata sent with the first upload (multipart field "meta" as JSON). */
export const createDocumentSchema = z.strictObject({
  projectId: objectIdSchema,
  title: z.string().trim().min(2, 'Enter a title').max(160),
  category: z.enum(DOCUMENT_CATEGORIES).default('other'),
  description: z.string().trim().max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  /** Visible to external stakeholders who are on the project (default: internal only). */
  sharedWithStakeholders: z.boolean().default(false),
});
export type CreateDocumentInput = z.input<typeof createDocumentSchema>;
export const updateDocumentSchema = z
  .strictObject({
    title: createDocumentSchema.shape.title,
    category: z.enum(DOCUMENT_CATEGORIES),
    description: z.string().trim().max(2000).nullable(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10),
    sharedWithStakeholders: z.boolean(),
  })
  .partial();
export type UpdateDocumentInput = z.input<typeof updateDocumentSchema>;
export const documentVersionNoteSchema = z.strictObject({
  note: z.string().trim().max(500).optional(),
});

export const documentQuerySchema = paginationQuerySchema.extend({
  projectId: objectIdSchema.optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
});
export type DocumentQuery = z.input<typeof documentQuerySchema>;

export interface DocumentVersionDto {
  version: number;
  fileName: string;
  mime: string;
  size: number;
  note?: string;
  uploadedBy: UserRef | null;
  uploadedAt: string;
}
export interface DocumentDto {
  id: string;
  project: Ref;
  title: string;
  category: DocumentCategory;
  description?: string;
  tags: string[];
  status: DocumentStatus;
  sharedWithStakeholders: boolean;
  currentVersion: number;
  versions: DocumentVersionDto[];
  publishedVersion: number | null;
  publishedAt?: string;
  approval: { id: string; key: string; status: string } | null;
  createdBy: UserRef | null;
  can: { edit: boolean; publish: boolean };
  updatedAt: string;
}

/* ============================ Releases & deployments ============================ */

export const ENVIRONMENTS = ['dev', 'qa', 'uat', 'prod'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export const ENVIRONMENT_LABELS: Record<Environment, string> = {
  dev: 'Development',
  qa: 'QA',
  uat: 'UAT',
  prod: 'Production',
};
export const RELEASE_STATUSES = [
  'planned',
  'in_progress',
  'released',
  'rolled_back',
  'cancelled',
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];
export const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  released: 'Released',
  rolled_back: 'Rolled back',
  cancelled: 'Cancelled',
};
export const DEPLOYMENT_STATUSES = ['not_deployed', 'deployed', 'failed', 'rolled_back'] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

const releaseFields = {
  projectId: objectIdSchema,
  version: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z][0-9A-Za-z.\-+_]{0,39}$/, 'Use a version such as 2.4.0 or 2026.11-r1'),
  name: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(20_000).optional(),
  targetDate: dateString.nullable().optional(),
  taskIds: z.array(objectIdSchema).max(500).default([]),
};
export const createReleaseSchema = z.strictObject(releaseFields);
export type CreateReleaseInput = z.input<typeof createReleaseSchema>;
export const updateReleaseSchema = z
  .strictObject({
    name: z.string().trim().max(120).nullable(),
    notes: z.string().trim().max(20_000).nullable(),
    targetDate: dateString.nullable(),
    taskIds: z.array(objectIdSchema).max(500),
    status: z.enum(['planned', 'in_progress', 'cancelled']),
  })
  .partial();
export type UpdateReleaseInput = z.input<typeof updateReleaseSchema>;
export const deploySchema = z.strictObject({
  environment: z.enum(ENVIRONMENTS),
  outcome: z.enum(['deployed', 'failed']).default('deployed'),
  build: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type DeployInput = z.input<typeof deploySchema>;
export const rollbackSchema = z.strictObject({
  environment: z.enum(ENVIRONMENTS),
  reason: z.string().trim().min(3, 'Give a reason').max(2000),
});
export const releaseQuerySchema = paginationQuerySchema.extend({
  projectId: objectIdSchema.optional(),
  status: z.enum(RELEASE_STATUSES).optional(),
});
export type ReleaseQuery = z.input<typeof releaseQuerySchema>;

export interface DeploymentDto {
  environment: Environment;
  status: DeploymentStatus;
  build?: string;
  at?: string;
  by: UserRef | null;
}
export interface ReleaseDto {
  id: string;
  project: Ref;
  version: string;
  name?: string;
  notes?: string;
  status: ReleaseStatus;
  targetDate?: string;
  releasedAt?: string;
  tasks: { id: string; key: string; title: string; status: TaskStatus }[];
  /** Linked tasks not yet done (a go-live readiness hint). */
  openTasks: number;
  environments: DeploymentDto[];
  history: {
    at: string;
    by: UserRef | null;
    action: string;
    environment?: Environment;
    notes?: string;
  }[];
  approval: { id: string; key: string; status: string } | null;
  can: { edit: boolean; deployProd: boolean };
  createdAt: string;
}

/* ============================ Stakeholders ============================ */

export const STAKEHOLDER_TYPES = ['client', 'vendor', 'regulator', 'internal', 'partner'] as const;
export type StakeholderType = (typeof STAKEHOLDER_TYPES)[number];
export const STAKEHOLDER_TYPE_LABELS: Record<StakeholderType, string> = {
  client: 'Client',
  vendor: 'Vendor',
  regulator: 'Regulator',
  internal: 'Internal',
  partner: 'Partner',
};
export const INFLUENCE_LEVELS = ['low', 'medium', 'high'] as const;

const stakeholderFields = {
  name: z.string().trim().min(2, 'Enter a name').max(120),
  organisation: z.string().trim().max(120).optional(),
  role: z.string().trim().max(120).optional(),
  type: z.enum(STAKEHOLDER_TYPES).default('client'),
  email: z.email('Enter a valid e-mail').max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  influence: z.enum(INFLUENCE_LEVELS).default('medium'),
  interest: z.enum(INFLUENCE_LEVELS).default('medium'),
  projectIds: z.array(objectIdSchema).max(50).default([]),
  notes: z.string().trim().max(5000).optional(),
};
export const createStakeholderSchema = z.strictObject(stakeholderFields);
export type CreateStakeholderInput = z.input<typeof createStakeholderSchema>;
export const updateStakeholderSchema = z
  .strictObject({
    name: stakeholderFields.name,
    organisation: z.string().trim().max(120).nullable(),
    role: z.string().trim().max(120).nullable(),
    type: z.enum(STAKEHOLDER_TYPES),
    email: z.email().max(200).nullable(),
    phone: z.string().trim().max(40).nullable(),
    influence: z.enum(INFLUENCE_LEVELS),
    interest: z.enum(INFLUENCE_LEVELS),
    projectIds: z.array(objectIdSchema).max(50),
    notes: z.string().trim().max(5000).nullable(),
  })
  .partial();
export type UpdateStakeholderInput = z.input<typeof updateStakeholderSchema>;
export const stakeholderQuerySchema = paginationQuerySchema.extend({
  projectId: objectIdSchema.optional(),
  type: z.enum(STAKEHOLDER_TYPES).optional(),
});
export type StakeholderQuery = z.input<typeof stakeholderQuerySchema>;

export interface StakeholderDto {
  id: string;
  name: string;
  organisation?: string;
  role?: string;
  type: StakeholderType;
  email?: string;
  phone?: string;
  influence: (typeof INFLUENCE_LEVELS)[number];
  interest: (typeof INFLUENCE_LEVELS)[number];
  projects: Ref[];
  notes?: string;
  openChangeRequests: number;
  averageRating: number | null;
  can: { edit: boolean };
  updatedAt: string;
}

/* ---------- Change requests ---------- */

export const CHANGE_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'implemented',
  'withdrawn',
] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];
export const CHANGE_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  implemented: 'Implemented',
  withdrawn: 'Withdrawn',
};
export const CHANGE_IMPACTS = ['scope', 'schedule', 'cost', 'quality', 'resources'] as const;

const crFields = {
  projectId: objectIdSchema,
  stakeholderId: objectIdSchema.nullable().optional(),
  title: z.string().trim().min(3, 'Enter a title').max(160),
  description: z.string().trim().max(10_000).optional(),
  reason: z.string().trim().max(5000).optional(),
  impacts: z.array(z.enum(CHANGE_IMPACTS)).max(5).default([]),
  priority: z.enum(PRIORITIES).default('medium'),
  estimatedHours: z.number().min(0).max(100_000).nullable().optional(),
  costImpact: z.number().min(-1e12).max(1e12).nullable().optional(),
  scheduleImpactDays: z.number().int().min(-3650).max(3650).nullable().optional(),
};
export const createChangeRequestSchema = z.strictObject(crFields);
export type CreateChangeRequestInput = z.input<typeof createChangeRequestSchema>;
export const updateChangeRequestSchema = z
  .strictObject({
    stakeholderId: objectIdSchema.nullable(),
    title: crFields.title,
    description: z.string().trim().max(10_000).nullable(),
    reason: z.string().trim().max(5000).nullable(),
    impacts: z.array(z.enum(CHANGE_IMPACTS)).max(5),
    priority: z.enum(PRIORITIES),
    estimatedHours: z.number().min(0).max(100_000).nullable(),
    costImpact: z.number().min(-1e12).max(1e12).nullable(),
    scheduleImpactDays: z.number().int().min(-3650).max(3650).nullable(),
  })
  .partial();
export type UpdateChangeRequestInput = z.input<typeof updateChangeRequestSchema>;
export const changeRequestQuerySchema = paginationQuerySchema.extend({
  projectId: objectIdSchema.optional(),
  stakeholderId: objectIdSchema.optional(),
  status: z.enum(CHANGE_REQUEST_STATUSES).optional(),
});
export type ChangeRequestQuery = z.input<typeof changeRequestQuerySchema>;

export interface ChangeRequestDto {
  id: string;
  key: string;
  project: Ref;
  stakeholder: { id: string; name: string; organisation?: string } | null;
  title: string;
  description?: string;
  reason?: string;
  impacts: (typeof CHANGE_IMPACTS)[number][];
  priority: Priority;
  estimatedHours?: number;
  costImpact?: number;
  scheduleImpactDays?: number;
  status: ChangeRequestStatus;
  approval: { id: string; key: string; status: string } | null;
  implementationTask: { id: string; key: string } | null;
  raisedBy: UserRef | null;
  can: { edit: boolean; submit: boolean };
  createdAt: string;
}

/* ---------- Feedback ---------- */

export const FEEDBACK_CATEGORIES = [
  'delivery',
  'quality',
  'communication',
  'support',
  'other',
] as const;
export const createFeedbackSchema = z.strictObject({
  projectId: objectIdSchema,
  stakeholderId: objectIdSchema,
  rating: z.number().int().min(1).max(5),
  category: z.enum(FEEDBACK_CATEGORIES).default('other'),
  comment: z.string().trim().max(5000).optional(),
  receivedOn: dateString,
});
export type CreateFeedbackInput = z.input<typeof createFeedbackSchema>;
export const feedbackQuerySchema = paginationQuerySchema.extend({
  projectId: objectIdSchema.optional(),
  stakeholderId: objectIdSchema.optional(),
});
export type FeedbackQuery = z.input<typeof feedbackQuerySchema>;
export interface FeedbackDto {
  id: string;
  project: Ref;
  stakeholder: { id: string; name: string; organisation?: string };
  rating: number;
  category: (typeof FEEDBACK_CATEGORIES)[number];
  comment?: string;
  receivedOn: string;
  recordedBy: UserRef | null;
  createdAt: string;
}
