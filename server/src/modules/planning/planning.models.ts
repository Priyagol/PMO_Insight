import mongoose, { Schema, type Types } from 'mongoose';
import {
  MILESTONE_STATUSES,
  PRIORITIES,
  type CustomFieldDef,
  type MilestoneStatus,
  type Priority,
  type TemplateMilestone,
  type TemplateTask,
} from '@arihant/shared';

/* ---------- Milestones ---------- */

export interface IMilestone {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  name: string;
  description?: string | null;
  /** Organisation calendar date, YYYY-MM-DD. */
  dueDate: string;
  status: MilestoneStatus;
  completedAt?: Date | null;
  createdBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const milestoneSchema = new Schema<IMilestone>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, maxlength: 2000, default: null },
    dueDate: { type: String, required: true },
    status: { type: String, enum: MILESTONE_STATUSES, default: 'open' },
    completedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, collection: 'milestones' },
);
milestoneSchema.index({ projectId: 1, dueDate: 1 });
milestoneSchema.index({ status: 1, dueDate: 1 });

export const Milestone =
  (mongoose.models.Milestone as mongoose.Model<IMilestone> | undefined) ??
  mongoose.model<IMilestone>('Milestone', milestoneSchema);

/* ---------- Project templates ---------- */

export interface IProjectTemplate {
  _id: Types.ObjectId;
  name: string;
  description?: string | null;
  category?: string | null;
  priority: Priority;
  objectives: string[];
  durationDays?: number | null;
  estimatedHours?: number | null;
  customFields: CustomFieldDef[];
  milestones: TemplateMilestone[];
  tasks: TemplateTask[];
  usageCount: number;
  sourceProjectId?: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Template bodies are validated by the shared Zod schema; stored as plain data. */
const templateSchema = new Schema<IProjectTemplate>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, maxlength: 2000, default: null },
    category: { type: String, maxlength: 60, default: null },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    objectives: { type: [String], default: [] },
    durationDays: { type: Number, default: null },
    estimatedHours: { type: Number, default: null },
    customFields: { type: Schema.Types.Mixed, default: () => [] },
    milestones: { type: Schema.Types.Mixed, default: () => [] },
    tasks: { type: Schema.Types.Mixed, default: () => [] },
    usageCount: { type: Number, default: 0 },
    sourceProjectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'projectTemplates' },
);
templateSchema.index({ archived: 1, name: 1 });

export const ProjectTemplate =
  (mongoose.models.ProjectTemplate as mongoose.Model<IProjectTemplate> | undefined) ??
  mongoose.model<IProjectTemplate>('ProjectTemplate', templateSchema);
