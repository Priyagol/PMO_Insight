import mongoose, { Schema, type Types } from 'mongoose';
import {
  APPROVAL_ENTITY_TYPES,
  APPROVAL_STAGE_STATUSES,
  APPROVAL_STATUSES,
  APPROVER_TYPES,
  type ApprovalEntityType,
  type ApprovalStageDef,
  type ApprovalStageStatus,
  type ApprovalStatus,
  type ApproverType,
} from '@arihant/shared';

export interface IApprovalWorkflow {
  _id: Types.ObjectId;
  entityType: ApprovalEntityType;
  name: string;
  description?: string | null;
  stages: ApprovalStageDef[];
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const workflowSchema = new Schema<IApprovalWorkflow>(
  {
    entityType: { type: String, enum: APPROVAL_ENTITY_TYPES, required: true },
    name: { type: String, required: true, maxlength: 80 },
    description: { type: String, maxlength: 500, default: null },
    stages: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, collection: 'approvalWorkflows' },
);
workflowSchema.index({ entityType: 1 }, { unique: true });

export const ApprovalWorkflow =
  (mongoose.models.ApprovalWorkflow as mongoose.Model<IApprovalWorkflow> | undefined) ??
  mongoose.model<IApprovalWorkflow>('ApprovalWorkflow', workflowSchema);

export interface IApprovalStage {
  name: string;
  approverType: ApproverType;
  roleKey?: string | null;
  userIds?: Types.ObjectId[];
  slaHours: number;
  fallbackOnly?: boolean;
  status: ApprovalStageStatus;
  /** Resolved when the stage starts (requester excluded); delegation swaps people here. */
  approverIds: Types.ObjectId[];
  note?: string | null;
  decidedBy?: Types.ObjectId | null;
  comment?: string | null;
  decidedAt?: Date | null;
  startedAt?: Date | null;
  dueAt?: Date | null;
  remindedAt?: Date | null;
}

export interface IApproval {
  _id: Types.ObjectId;
  key: string;
  entityType: ApprovalEntityType;
  projectId: Types.ObjectId;
  entityId?: Types.ObjectId | null;
  title: string;
  description?: string | null;
  amount?: number | null;
  requestedBy: Types.ObjectId;
  status: ApprovalStatus;
  currentStage: number;
  stages: IApprovalStage[];
  /** Approvers of the current stage (indexed for the inbox). */
  pendingApproverIds: Types.ObjectId[];
  history: { at: Date; by: Types.ObjectId | null; action: string; comment?: string | null }[];
  decidedAt?: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const stageSchema = new Schema<IApprovalStage>(
  {
    name: { type: String, required: true },
    approverType: { type: String, enum: APPROVER_TYPES, required: true },
    roleKey: { type: String, default: null },
    userIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    slaHours: { type: Number, default: 48 },
    fallbackOnly: { type: Boolean, default: false },
    status: { type: String, enum: APPROVAL_STAGE_STATUSES, default: 'waiting' },
    approverIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    note: { type: String, default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    comment: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    dueAt: { type: Date, default: null },
    remindedAt: { type: Date, default: null },
  },
  { _id: false },
);

const approvalSchema = new Schema<IApproval>(
  {
    key: { type: String, required: true },
    entityType: { type: String, enum: APPROVAL_ENTITY_TYPES, required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    entityId: { type: Schema.Types.ObjectId, default: null },
    title: { type: String, required: true, maxlength: 160 },
    description: { type: String, maxlength: 5000, default: null },
    amount: { type: Number, default: null },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: APPROVAL_STATUSES, default: 'pending' },
    currentStage: { type: Number, default: 0 },
    stages: { type: [stageSchema], default: [] },
    pendingApproverIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    history: {
      type: [
        new Schema(
          {
            at: { type: Date, required: true },
            by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
            action: { type: String, required: true },
            comment: { type: String, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    decidedAt: { type: Date, default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'approvals' },
);
approvalSchema.index({ key: 1 }, { unique: true });
approvalSchema.index({ pendingApproverIds: 1, status: 1, createdAt: -1 });
approvalSchema.index({ requestedBy: 1, createdAt: -1 });
approvalSchema.index({ projectId: 1, entityType: 1, status: 1 });
approvalSchema.index({ entityType: 1, entityId: 1, status: 1 });
approvalSchema.index({ status: 1, 'stages.dueAt': 1 });

export const Approval =
  (mongoose.models.Approval as mongoose.Model<IApproval> | undefined) ??
  mongoose.model<IApproval>('Approval', approvalSchema);
