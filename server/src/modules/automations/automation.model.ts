import mongoose, { Schema, type Types } from 'mongoose';
import {
  AUTOMATION_RUN_STATUSES,
  AUTOMATION_TRIGGERS,
  type AutomationAction,
  type AutomationActionType,
  type AutomationRunStatus,
  type AutomationSchedule,
  type AutomationTrigger,
  type ConditionGroup,
} from '@arihant/shared';

export interface IAutomationRule {
  _id: Types.ObjectId;
  name: string;
  description?: string | null;
  /** null = organisation-wide. */
  projectId: Types.ObjectId | null;
  trigger: AutomationTrigger;
  conditions: ConditionGroup;
  actions: AutomationAction[];
  enabled: boolean;
  schedule?: AutomationSchedule | null;
  /** Last schedule slot run (claimed atomically so a slot runs once). */
  lastScheduledSlot?: string | null;
  /** Actions run with this person's permissions. */
  ownerId: Types.ObjectId;
  runCount: number;
  lastRunAt?: Date | null;
  lastStatus?: AutomationRunStatus | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ruleSchema = new Schema<IAutomationRule>(
  {
    name: { type: String, required: true, maxlength: 120 },
    description: { type: String, maxlength: 500, default: null },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    trigger: { type: String, enum: AUTOMATION_TRIGGERS, required: true },
    conditions: { type: Schema.Types.Mixed, default: () => ({ match: 'all', conditions: [] }) },
    actions: { type: Schema.Types.Mixed, required: true },
    enabled: { type: Boolean, default: true },
    schedule: { type: Schema.Types.Mixed, default: null },
    lastScheduledSlot: { type: String, default: null },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    runCount: { type: Number, default: 0 },
    lastRunAt: { type: Date, default: null },
    lastStatus: { type: String, enum: AUTOMATION_RUN_STATUSES, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'automationRules', minimize: false },
);
ruleSchema.index({ trigger: 1, enabled: 1, deletedAt: 1 });
ruleSchema.index({ projectId: 1, deletedAt: 1 });

export const AutomationRule =
  (mongoose.models.AutomationRule as mongoose.Model<IAutomationRule> | undefined) ??
  mongoose.model<IAutomationRule>('AutomationRule', ruleSchema);

export interface IAutomationRun {
  _id: Types.ObjectId;
  ruleId: Types.ObjectId;
  eventId: string;
  trigger: AutomationTrigger;
  projectId?: Types.ObjectId | null;
  status: AutomationRunStatus | 'running';
  subject?: string | null;
  actions: { type: AutomationActionType; ok: boolean; detail: string }[];
  error?: string | null;
  durationMs: number;
  createdAt: Date;
}

const runSchema = new Schema<IAutomationRun>(
  {
    ruleId: { type: Schema.Types.ObjectId, ref: 'AutomationRule', required: true },
    eventId: { type: String, required: true },
    trigger: { type: String, enum: AUTOMATION_TRIGGERS, required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    status: { type: String, enum: [...AUTOMATION_RUN_STATUSES, 'running'], required: true },
    subject: { type: String, default: null },
    actions: { type: Schema.Types.Mixed, default: () => [] },
    error: { type: String, default: null },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'automationRuns' },
);
// Each rule handles each event at most once.
runSchema.index({ ruleId: 1, eventId: 1 }, { unique: true });
runSchema.index({ ruleId: 1, createdAt: -1 });
// Retention: 90 days.
runSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

export const AutomationRun =
  (mongoose.models.AutomationRun as mongoose.Model<IAutomationRun> | undefined) ??
  mongoose.model<IAutomationRun>('AutomationRun', runSchema);
