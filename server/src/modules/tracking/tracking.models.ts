import mongoose, { Schema, type Types } from 'mongoose';
import {
  AVAILABILITY_STATUSES,
  AVAILABILITY_TYPES,
  PLAN_KINDS,
  PLAN_STATUSES,
  TIMESHEET_STATUSES,
  WORK_CATEGORIES,
  type AvailabilityStatus,
  type PlanStatus,
  type TimesheetStatus,
  type WorkCategory,
} from '@arihant/shared';

const model = <T>(name: string, schema: Schema<T>) =>
  (mongoose.models[name] as mongoose.Model<T> | undefined) ?? mongoose.model<T>(name, schema);

/* ---------- Work logs ---------- */

export interface IWorklog {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  projectId: Types.ObjectId;
  taskId: Types.ObjectId | null;
  /** Organisation calendar day, YYYY-MM-DD. */
  date: string;
  description: string;
  category: WorkCategory;
  minutes: number;
  /** Present when the entry has a time range (timer or manual with times). */
  startedAt?: Date | null;
  endedAt?: Date | null;
  source: 'timer' | 'manual';
  createdAt: Date;
  updatedAt: Date;
}

const worklogSchema = new Schema<IWorklog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    date: { type: String, required: true },
    description: { type: String, required: true, maxlength: 2000 },
    category: { type: String, enum: WORK_CATEGORIES, default: 'development' },
    minutes: { type: Number, required: true, min: 1, max: 1440 },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    source: { type: String, enum: ['timer', 'manual'], default: 'manual' },
  },
  { timestamps: true, collection: 'worklogs' },
);
worklogSchema.index({ userId: 1, date: 1 });
worklogSchema.index({ taskId: 1 });
worklogSchema.index({ projectId: 1, date: 1 });
worklogSchema.index({ userId: 1, startedAt: 1, endedAt: 1 });

export const Worklog = model<IWorklog>('Worklog', worklogSchema);

/* ---------- Timers (at most one per user: unique userId) ---------- */

export interface ITimer {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  projectId: Types.ObjectId;
  taskId: Types.ObjectId | null;
  description?: string;
  category: WorkCategory;
  /** Start of the first segment (for the work log's start time). */
  firstStartedAt: Date;
  /** Start of the current running segment, or null while paused. */
  runningSince: Date | null;
  accumulatedMs: number;
  createdAt: Date;
}

const timerSchema = new Schema<ITimer>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    description: String,
    category: { type: String, enum: WORK_CATEGORIES, default: 'development' },
    firstStartedAt: { type: Date, required: true },
    runningSince: { type: Date, default: null },
    accumulatedMs: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'timers' },
);
timerSchema.index({ userId: 1 }, { unique: true });

export const Timer = model<ITimer>('Timer', timerSchema);

/* ---------- Timesheets ---------- */

export interface ITimesheet {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  weekStart: string;
  status: TimesheetStatus;
  totalMinutes: number;
  submittedAt?: Date | null;
  decidedBy?: Types.ObjectId | null;
  decidedAt?: Date | null;
  comment?: string;
  history: { status: TimesheetStatus; by: Types.ObjectId; at: Date; comment?: string }[];
  createdAt: Date;
  updatedAt: Date;
}

const timesheetSchema = new Schema<ITimesheet>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    weekStart: { type: String, required: true },
    status: { type: String, enum: TIMESHEET_STATUSES, default: 'draft' },
    totalMinutes: { type: Number, default: 0 },
    submittedAt: { type: Date, default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    comment: String,
    history: {
      type: [{ status: String, by: Schema.Types.ObjectId, at: Date, comment: String, _id: false }],
      default: [],
    },
  },
  { timestamps: true, collection: 'timesheets' },
);
timesheetSchema.index({ userId: 1, weekStart: 1 }, { unique: true });
timesheetSchema.index({ status: 1, weekStart: -1 });

export const Timesheet = model<ITimesheet>('Timesheet', timesheetSchema);

/* ---------- Daily journal ---------- */

export interface IJournal {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  date: string;
  completed: string;
  inProgress: string;
  blockers: string;
  tomorrow: string;
  createdAt: Date;
  updatedAt: Date;
}

const journalSchema = new Schema<IJournal>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    completed: { type: String, default: '', maxlength: 4000 },
    inProgress: { type: String, default: '', maxlength: 4000 },
    blockers: { type: String, default: '', maxlength: 4000 },
    tomorrow: { type: String, default: '', maxlength: 4000 },
  },
  { timestamps: true, collection: 'journals' },
);
journalSchema.index({ userId: 1, date: -1 }, { unique: true });

export const Journal = model<IJournal>('Journal', journalSchema);

/* ---------- Availability / leave ---------- */

export interface IAvailability {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: (typeof AVAILABILITY_TYPES)[number];
  from: string;
  to: string;
  hoursPerDay?: number | null;
  reason?: string;
  status: AvailabilityStatus;
  decidedBy?: Types.ObjectId | null;
  decidedAt?: Date | null;
  createdAt: Date;
}

const availabilitySchema = new Schema<IAvailability>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: AVAILABILITY_TYPES, default: 'leave' },
    from: { type: String, required: true },
    to: { type: String, required: true },
    hoursPerDay: { type: Number, default: null },
    reason: { type: String, maxlength: 500 },
    status: { type: String, enum: AVAILABILITY_STATUSES, default: 'pending' },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'availability' },
);
availabilitySchema.index({ userId: 1, status: 1, from: 1, to: 1 });
availabilitySchema.index({ status: 1, from: 1 });

export const Availability = model<IAvailability>('Availability', availabilitySchema);

/* ---------- Assignment plans (preview → approve → execute) ---------- */

export interface IPlanProposal {
  taskId: Types.ObjectId;
  fromUserId: Types.ObjectId | null;
  toUserId: Types.ObjectId | null;
  /** Task assignmentVersion when the plan was made (optimistic concurrency at execution). */
  assignmentVersion: number;
  effortHours: number;
  score: number;
  reason: string;
}

export interface IAssignmentPlan {
  _id: Types.ObjectId;
  kind: (typeof PLAN_KINDS)[number];
  status: PlanStatus;
  projectId: Types.ObjectId | null;
  /** Lock key for the candidate pool (project or person). */
  poolKey: string;
  idempotencyKey: string;
  candidateIds: Types.ObjectId[];
  proposals: IPlanProposal[];
  skipped: { taskId: Types.ObjectId; reason: string }[];
  manualReview: { taskId: Types.ObjectId; reason: string }[];
  createdBy: Types.ObjectId;
  approvedBy?: Types.ObjectId | null;
  result?: { assigned: number; conflicts: { taskId: Types.ObjectId; reason: string }[] } | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const planSchema = new Schema<IAssignmentPlan>(
  {
    kind: { type: String, enum: PLAN_KINDS, required: true },
    status: { type: String, enum: PLAN_STATUSES, default: 'draft' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    poolKey: { type: String, required: true },
    idempotencyKey: { type: String, required: true },
    candidateIds: { type: [Schema.Types.ObjectId], default: [] },
    proposals: {
      type: [
        {
          taskId: Schema.Types.ObjectId,
          fromUserId: Schema.Types.ObjectId,
          toUserId: Schema.Types.ObjectId,
          assignmentVersion: Number,
          effortHours: Number,
          score: Number,
          reason: String,
          _id: false,
        },
      ],
      default: [],
    },
    skipped: { type: [{ taskId: Schema.Types.ObjectId, reason: String, _id: false }], default: [] },
    manualReview: {
      type: [{ taskId: Schema.Types.ObjectId, reason: String, _id: false }],
      default: [],
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    result: {
      type: new Schema(
        {
          assigned: Number,
          conflicts: [{ taskId: Schema.Types.ObjectId, reason: String, _id: false }],
        },
        { _id: false },
      ),
      default: null,
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'assignmentPlans' },
);
planSchema.index({ idempotencyKey: 1 }, { unique: true });
planSchema.index({ createdBy: 1, createdAt: -1 });
planSchema.index({ projectId: 1, createdAt: -1 });

export const AssignmentPlan = model<IAssignmentPlan>('AssignmentPlan', planSchema);
