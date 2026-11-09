import mongoose, { Schema, type Types } from 'mongoose';
import {
  CUSTOM_FIELD_TYPES,
  PRIORITIES,
  PROJECT_MEMBER_ROLES,
  PROJECT_STATUSES,
  type CustomFieldDef,
  type Priority,
  type ProjectMemberRole,
  type ProjectStatus,
} from '@arihant/shared';

export interface IProjectMember {
  userId: Types.ObjectId;
  role: ProjectMemberRole;
}

/** Date-only fields are stored as `YYYY-MM-DD` strings (organisation calendar days), avoiding timezone drift. */
export interface IProject {
  _id: Types.ObjectId;
  key: string;
  name: string;
  description?: string;
  category?: string;
  departmentId: Types.ObjectId | null;
  managerId: Types.ObjectId;
  ownerId: Types.ObjectId | null;
  members: IProjectMember[];
  priority: Priority;
  status: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
  estimatedHours?: number | null;
  budget?: { amount: number; currency: 'INR' } | null;
  objectives: string[];
  archived: boolean;
  archivedAt?: Date | null;
  /** Smart-assign new unassigned tasks automatically (Phase 4). */
  autoAssign: boolean;
  /** Task custom field definitions (Phase 5B). */
  customFields: CustomFieldDef[];
  /** Upstream projects this project waits on (finish-to-start). */
  dependsOn: { projectId: Types.ObjectId; note?: string }[];
  templateId?: Types.ObjectId | null;
  /* Phase 9A */
  components: { name: string; description?: string | null; leadId?: Types.ObjectId | null }[];
  wipLimits: Record<string, number>;
  /* Phase 9C: custom workflow (null = standard workflow) */
  workflowId?: Types.ObjectId | null;
  /** Phase 9G: service desk. */
  serviceDesk?: {
    enabled: boolean;
    agentIds: Types.ObjectId[];
    autoAssign: 'none' | 'round_robin';
    nextAgent: number;
  };
  /** Phase 9E: visible only to participants and super administrators. */
  confidential?: boolean;
  /** Set while the project is on hold. */
  hold?: { reason: string; since: Date; byId: Types.ObjectId; until?: string | null } | null;
  version: number;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<IProject>(
  {
    key: { type: String, required: true, uppercase: true, trim: true, maxlength: 6 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, maxlength: 5000 },
    category: { type: String, maxlength: 60 },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    managerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    members: {
      type: [
        new Schema<IProjectMember>(
          {
            userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            role: { type: String, enum: PROJECT_MEMBER_ROLES, default: 'member' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    status: { type: String, enum: PROJECT_STATUSES, default: 'planning' },
    startDate: { type: String, default: null },
    endDate: { type: String, default: null },
    estimatedHours: { type: Number, default: null, min: 0 },
    budget: {
      type: new Schema(
        { amount: { type: Number, min: 0 }, currency: { type: String, default: 'INR' } },
        { _id: false },
      ),
      default: null,
    },
    objectives: { type: [String], default: [] },
    archived: { type: Boolean, default: false },
    autoAssign: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
    components: {
      type: [
        {
          name: { type: String, required: true, maxlength: 60 },
          description: { type: String, default: null },
          leadId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          _id: false,
        },
      ],
      default: [],
    },
    wipLimits: { type: Schema.Types.Mixed, default: () => ({}) },
    workflowId: { type: Schema.Types.ObjectId, ref: 'TaskWorkflow', default: null },
    confidential: { type: Boolean, default: false },
    hold: {
      type: new Schema(
        {
          reason: { type: String, required: true, maxlength: 500 },
          since: { type: Date, required: true },
          byId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          until: { type: String, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    serviceDesk: {
      type: new Schema(
        {
          enabled: { type: Boolean, default: false },
          agentIds: { type: [Schema.Types.ObjectId], default: [] },
          autoAssign: { type: String, enum: ['none', 'round_robin'], default: 'none' },
          nextAgent: { type: Number, default: 0 },
        },
        { _id: false },
      ),
      default: null,
    },
    customFields: {
      type: [
        new Schema<CustomFieldDef>(
          {
            key: { type: String, required: true },
            label: { type: String, required: true },
            type: { type: String, enum: CUSTOM_FIELD_TYPES, required: true },
            options: { type: [String], default: [] },
            required: { type: Boolean, default: false },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    dependsOn: {
      type: [
        new Schema<{ projectId: Types.ObjectId; note?: string }>(
          {
            projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
            note: { type: String, maxlength: 300 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    templateId: { type: Schema.Types.ObjectId, ref: 'ProjectTemplate', default: null },
    version: { type: Number, default: 1 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'projects' },
);

projectSchema.index({ key: 1 }, { unique: true });
projectSchema.index({ 'members.userId': 1, archived: 1 });
projectSchema.index({ departmentId: 1, archived: 1, status: 1 });
projectSchema.index({ managerId: 1 });
projectSchema.index({ 'dependsOn.projectId': 1 });
projectSchema.index({ archived: 1, updatedAt: -1 });

export const Project =
  (mongoose.models.Project as mongoose.Model<IProject> | undefined) ??
  mongoose.model<IProject>('Project', projectSchema);

/* ---------- Version history ---------- */

export interface IProjectVersion {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  version: number;
  changes: { field: string; from: unknown; to: unknown }[];
  changedBy: Types.ObjectId | null;
  /** Why the end date moved later (asked for when it does). */
  reason?: string | null;
  createdAt: Date;
}

const projectVersionSchema = new Schema<IProjectVersion>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    version: { type: Number, required: true },
    changes: {
      type: [{ field: String, from: Schema.Types.Mixed, to: Schema.Types.Mixed, _id: false }],
      default: [],
    },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reason: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'projectVersions' },
);
projectVersionSchema.index({ projectId: 1, version: -1 }, { unique: true });

export const ProjectVersion =
  (mongoose.models.ProjectVersion as mongoose.Model<IProjectVersion> | undefined) ??
  mongoose.model<IProjectVersion>('ProjectVersion', projectVersionSchema);
