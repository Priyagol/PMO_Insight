import mongoose, { Schema, type Types } from 'mongoose';
import {
  CHANGE_IMPACTS,
  CHANGE_REQUEST_STATUSES,
  DEPLOYMENT_STATUSES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_STATUSES,
  ENVIRONMENTS,
  FEEDBACK_CATEGORIES,
  INFLUENCE_LEVELS,
  PRIORITIES,
  RELEASE_STATUSES,
  STAKEHOLDER_TYPES,
  type ChangeRequestStatus,
  type DeploymentStatus,
  type DocumentCategory,
  type DocumentStatus,
  type Environment,
  type Priority,
  type ReleaseStatus,
  type StakeholderType,
} from '@arihant/shared';

const model = <T>(name: string, schema: Schema<T>) =>
  (mongoose.models[name] as mongoose.Model<T> | undefined) ?? mongoose.model<T>(name, schema);

/* ============================ Documents ============================ */

export interface IDocumentVersion {
  version: number;
  storageKey: string;
  fileName: string;
  mime: string;
  size: number;
  note?: string | null;
  uploadedBy: Types.ObjectId;
  uploadedAt: Date;
}
export interface IDocument {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  title: string;
  category: DocumentCategory;
  description?: string | null;
  tags: string[];
  status: DocumentStatus;
  sharedWithStakeholders: boolean;
  versions: IDocumentVersion[];
  currentVersion: number;
  /** The approved version (what external stakeholders may download). */
  publishedVersion: number | null;
  publishedAt?: Date | null;
  createdBy: Types.ObjectId;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
const documentSchema = new Schema<IDocument>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true, maxlength: 160 },
    category: { type: String, enum: DOCUMENT_CATEGORIES, default: 'other' },
    description: { type: String, maxlength: 2000, default: null },
    tags: { type: [String], default: [] },
    status: { type: String, enum: DOCUMENT_STATUSES, default: 'draft' },
    sharedWithStakeholders: { type: Boolean, default: false },
    versions: {
      type: [
        new Schema<IDocumentVersion>(
          {
            version: { type: Number, required: true },
            storageKey: { type: String, required: true },
            fileName: { type: String, required: true },
            mime: { type: String, required: true },
            size: { type: Number, required: true },
            note: { type: String, default: null },
            uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            uploadedAt: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    currentVersion: { type: Number, default: 1 },
    publishedVersion: { type: Number, default: null },
    publishedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'documents' },
);
documentSchema.index({ projectId: 1, deletedAt: 1, updatedAt: -1 });
documentSchema.index({ title: 'text', description: 'text', tags: 'text' });
export const DocumentModel = model<IDocument>('Document', documentSchema);

/* ============================ Releases ============================ */

export interface IDeployment {
  environment: Environment;
  status: DeploymentStatus;
  build?: string | null;
  at?: Date | null;
  by?: Types.ObjectId | null;
}
export interface IRelease {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  version: string;
  name?: string | null;
  notes?: string | null;
  status: ReleaseStatus;
  targetDate?: string | null;
  releasedAt?: Date | null;
  taskIds: Types.ObjectId[];
  environments: IDeployment[];
  history: {
    at: Date;
    by: Types.ObjectId | null;
    action: string;
    environment?: Environment | null;
    notes?: string | null;
  }[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
const releaseSchema = new Schema<IRelease>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    version: { type: String, required: true, maxlength: 40 },
    name: { type: String, maxlength: 120, default: null },
    notes: { type: String, maxlength: 20_000, default: null },
    status: { type: String, enum: RELEASE_STATUSES, default: 'planned' },
    targetDate: { type: String, default: null },
    releasedAt: { type: Date, default: null },
    taskIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Task' }], default: [] },
    environments: {
      type: [
        new Schema<IDeployment>(
          {
            environment: { type: String, enum: ENVIRONMENTS, required: true },
            status: { type: String, enum: DEPLOYMENT_STATUSES, default: 'not_deployed' },
            build: { type: String, default: null },
            at: { type: Date, default: null },
            by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          },
          { _id: false },
        ),
      ],
      default: () => ENVIRONMENTS.map((environment) => ({ environment, status: 'not_deployed' })),
    },
    history: {
      type: [
        new Schema(
          {
            at: { type: Date, required: true },
            by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
            action: { type: String, required: true },
            environment: { type: String, default: null },
            notes: { type: String, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'releases' },
);
releaseSchema.index({ projectId: 1, version: 1 }, { unique: true });
releaseSchema.index({ status: 1, targetDate: 1 });
export const Release = model<IRelease>('Release', releaseSchema);

/* ============================ Stakeholders ============================ */

export interface IStakeholder {
  _id: Types.ObjectId;
  name: string;
  organisation?: string | null;
  role?: string | null;
  type: StakeholderType;
  email?: string | null;
  phone?: string | null;
  influence: (typeof INFLUENCE_LEVELS)[number];
  interest: (typeof INFLUENCE_LEVELS)[number];
  projectIds: Types.ObjectId[];
  notes?: string | null;
  createdBy: Types.ObjectId;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
const stakeholderSchema = new Schema<IStakeholder>(
  {
    name: { type: String, required: true, maxlength: 120 },
    organisation: { type: String, maxlength: 120, default: null },
    role: { type: String, maxlength: 120, default: null },
    type: { type: String, enum: STAKEHOLDER_TYPES, default: 'client' },
    email: { type: String, maxlength: 200, default: null },
    phone: { type: String, maxlength: 40, default: null },
    influence: { type: String, enum: INFLUENCE_LEVELS, default: 'medium' },
    interest: { type: String, enum: INFLUENCE_LEVELS, default: 'medium' },
    projectIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Project' }], default: [] },
    notes: { type: String, maxlength: 5000, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'stakeholders' },
);
stakeholderSchema.index({ projectIds: 1, deletedAt: 1 });
stakeholderSchema.index({ name: 1 });
export const Stakeholder = model<IStakeholder>('Stakeholder', stakeholderSchema);

export interface IChangeRequest {
  _id: Types.ObjectId;
  key: string;
  projectId: Types.ObjectId;
  stakeholderId?: Types.ObjectId | null;
  title: string;
  description?: string | null;
  reason?: string | null;
  impacts: (typeof CHANGE_IMPACTS)[number][];
  priority: Priority;
  estimatedHours?: number | null;
  costImpact?: number | null;
  scheduleImpactDays?: number | null;
  status: ChangeRequestStatus;
  implementationTaskId?: Types.ObjectId | null;
  raisedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
const crSchema = new Schema<IChangeRequest>(
  {
    key: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    stakeholderId: { type: Schema.Types.ObjectId, ref: 'Stakeholder', default: null },
    title: { type: String, required: true, maxlength: 160 },
    description: { type: String, maxlength: 10_000, default: null },
    reason: { type: String, maxlength: 5000, default: null },
    impacts: { type: [{ type: String, enum: CHANGE_IMPACTS }], default: [] },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    estimatedHours: { type: Number, default: null },
    costImpact: { type: Number, default: null },
    scheduleImpactDays: { type: Number, default: null },
    status: { type: String, enum: CHANGE_REQUEST_STATUSES, default: 'draft' },
    implementationTaskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    raisedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'changeRequests' },
);
crSchema.index({ key: 1 }, { unique: true });
crSchema.index({ projectId: 1, status: 1, createdAt: -1 });
crSchema.index({ stakeholderId: 1 });
export const ChangeRequest = model<IChangeRequest>('ChangeRequest', crSchema);

export interface IFeedback {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  stakeholderId: Types.ObjectId;
  rating: number;
  category: (typeof FEEDBACK_CATEGORIES)[number];
  comment?: string | null;
  receivedOn: string;
  recordedBy: Types.ObjectId;
  createdAt: Date;
}
const feedbackSchema = new Schema<IFeedback>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    stakeholderId: { type: Schema.Types.ObjectId, ref: 'Stakeholder', required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    category: { type: String, enum: FEEDBACK_CATEGORIES, default: 'other' },
    comment: { type: String, maxlength: 5000, default: null },
    receivedOn: { type: String, required: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'feedback' },
);
feedbackSchema.index({ projectId: 1, createdAt: -1 });
feedbackSchema.index({ stakeholderId: 1 });
export const Feedback = model<IFeedback>('Feedback', feedbackSchema);
