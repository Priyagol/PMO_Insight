import mongoose, { Schema, type Types } from 'mongoose';
import {
  RISK_SEVERITIES,
  RISK_STATUSES,
  RISK_TYPES,
  type RiskSeverity,
  type RiskStatus,
  type RiskType,
} from '@arihant/shared';

export interface IRisk {
  _id: Types.ObjectId;
  /** Human-readable id, e.g. TRD-R3. */
  key: string;
  projectId: Types.ObjectId;
  type: RiskType;
  title: string;
  description?: string;
  probability: number;
  impact: number;
  score: number;
  severity: RiskSeverity;
  status: RiskStatus;
  ownerId: Types.ObjectId | null;
  mitigation?: string;
  dueDate?: string | null;
  linkedTaskIds: Types.ObjectId[];
  escalationLevel: number;
  history: { at: Date; by: Types.ObjectId | null; action: string; note?: string }[];
  resolvedAt?: Date | null;
  createdBy: Types.ObjectId;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const riskSchema = new Schema<IRisk>(
  {
    key: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    type: { type: String, enum: RISK_TYPES, default: 'risk' },
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, maxlength: 5000 },
    probability: { type: Number, required: true, min: 1, max: 5 },
    impact: { type: Number, required: true, min: 1, max: 5 },
    score: { type: Number, required: true },
    severity: { type: String, enum: RISK_SEVERITIES, required: true },
    status: { type: String, enum: RISK_STATUSES, default: 'open' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    mitigation: { type: String, maxlength: 5000 },
    dueDate: { type: String, default: null },
    linkedTaskIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Task' }], default: [] },
    escalationLevel: { type: Number, default: 0 },
    history: {
      type: [{ at: Date, by: Schema.Types.ObjectId, action: String, note: String, _id: false }],
      default: [],
    },
    resolvedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'risks' },
);
riskSchema.index({ key: 1 }, { unique: true });
riskSchema.index({ projectId: 1, status: 1, score: -1 });
riskSchema.index({ ownerId: 1, status: 1 });
riskSchema.index({ status: 1, severity: 1 });

export const Risk =
  (mongoose.models.Risk as mongoose.Model<IRisk> | undefined) ??
  mongoose.model<IRisk>('Risk', riskSchema);

/* ---------- Daily snapshots (for cumulative flow and historical trends) ---------- */

export interface IDailySnapshot {
  _id: Types.ObjectId;
  date: string;
  projectId: Types.ObjectId;
  byStatus: Partial<Record<string, number>>;
  totalEffort: number;
  doneEffort: number;
  overdue: number;
  openRisks: number;
  healthScore: number | null;
  createdAt: Date;
}

const snapshotSchema = new Schema<IDailySnapshot>(
  {
    date: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    byStatus: { type: Schema.Types.Mixed, default: {} },
    totalEffort: { type: Number, default: 0 },
    doneEffort: { type: Number, default: 0 },
    overdue: { type: Number, default: 0 },
    openRisks: { type: Number, default: 0 },
    healthScore: { type: Number, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'dailySnapshots',
    minimize: false,
  },
);
snapshotSchema.index({ projectId: 1, date: 1 }, { unique: true });
snapshotSchema.index({ date: 1 });

export const DailySnapshot =
  (mongoose.models.DailySnapshot as mongoose.Model<IDailySnapshot> | undefined) ??
  mongoose.model<IDailySnapshot>('DailySnapshot', snapshotSchema);
