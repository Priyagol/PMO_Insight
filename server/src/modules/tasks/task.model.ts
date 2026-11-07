import mongoose, { Schema, type Types } from 'mongoose';
import {
  BUG_SEVERITIES,
  ISSUE_TYPES,
  LINK_TYPES,
  PRIORITIES,
  RECURRENCE_FREQUENCIES,
  TASK_STATUSES,
  type BugSeverity,
  type CustomValues,
  type IssueType,
  type LinkType,
  type Priority,
  type RecurrenceRule,
  type TaskStatus,
} from '@arihant/shared';

export const PRIORITY_ORDER: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface IChecklistItem {
  _id: Types.ObjectId;
  text: string;
  done: boolean;
}

export interface ITask {
  _id: Types.ObjectId;
  key: string;
  projectId: Types.ObjectId;
  parentId: Types.ObjectId | null;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: Priority;
  /** Numeric priority for sorting (critical = 0). */
  priorityOrder: number;
  assigneeId: Types.ObjectId | null;
  reporterId: Types.ObjectId;
  watcherIds: Types.ObjectId[];
  /** Organisation calendar dates, YYYY-MM-DD. */
  startDate?: string | null;
  dueDate?: string | null;
  estimatedHours?: number | null;
  /** Denormalised from work logs (Phase 4). */
  actualHours: number;
  complexity?: number | null;
  requiredSkills: { name: string; minLevel: number }[];
  tags: string[];
  checklist: IChecklistItem[];
  /** Tasks this task depends on (finish-to-start). */
  dependencyIds: Types.ObjectId[];
  /** Fractional index for manual ordering within a status column. */
  rank: string;
  /** Incremented on every assignee change; used for optimistic concurrency by smart assignment. */
  assignmentVersion: number;
  blockedSince?: Date | null;
  completedAt?: Date | null;
  /* Phase 5B */
  milestoneId?: Types.ObjectId | null;
  /** Repeat rule; the next occurrence is created when this one is completed. */
  recurrence?: RecurrenceRule | null;
  /** First task of the series (its own id for the first occurrence). */
  recurrenceSeriesId?: Types.ObjectId | null;
  recurrenceIndex?: number | null;
  /** Set atomically when the next occurrence is created (prevents duplicates). */
  nextOccurrenceId?: Types.ObjectId | null;
  customFields?: CustomValues;
  /* Phase 9A */
  type: IssueType;
  storyPoints?: number | null;
  epicId?: Types.ObjectId | null;
  sprintId?: Types.ObjectId | null;
  /** Order in the project backlog (fractional index; unset sorts after ranked items). */
  backlogRank?: string | null;
  components: string[];
  fixReleaseId?: Types.ObjectId | null;
  acceptanceCriteria?: string | null;
  remainingHours?: number | null;
  bug?: {
    severity: BugSeverity;
    stepsToReproduce?: string | null;
    expectedResult?: string | null;
    actualResult?: string | null;
    environment?: string | null;
    regression: boolean;
    foundInReleaseId?: Types.ObjectId | null;
  } | null;
  links: { type: LinkType; taskId: Types.ObjectId }[];
  /** First time the task entered "in progress" (cycle time). */
  startedAt?: Date | null;
  /** Keys the task had before being moved to another project. */
  previousKeys: string[];
  /** Raised through a service desk (Phase 9G). */
  serviceRequest?: {
    requestTypeId: Types.ObjectId;
    kind: 'service_request' | 'incident' | 'problem' | 'change';
    requesterId: Types.ObjectId;
    answers: Record<string, string | number | boolean | null>;
    responseDueAt: Date | null;
    resolutionDueAt: Date | null;
    firstResponseAt: Date | null;
    awaitingApproval: boolean;
    alerts: string[];
    feedback: { rating: number; comment: string | null; at: Date } | null;
  } | null;
  /** Visible only to allowedUserIds, assignee, reporter and project managers (Phase 9E). */
  restricted?: boolean;
  allowedUserIds?: Types.ObjectId[];
  /** A workflow transition waiting for approval (Phase 9C). */
  pendingTransition?: {
    to: TaskStatus;
    transitionId: string;
    approvalId: Types.ObjectId;
    requestedBy: Types.ObjectId;
    comment: string | null;
  } | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<ITask>(
  {
    key: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 20000, default: null },
    status: { type: String, enum: TASK_STATUSES, default: 'todo' },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    priorityOrder: { type: Number, default: 2 },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    watcherIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    startDate: { type: String, default: null },
    dueDate: { type: String, default: null },
    estimatedHours: { type: Number, default: null, min: 0 },
    actualHours: { type: Number, default: 0, min: 0 },
    complexity: { type: Number, default: null, min: 1, max: 5 },
    requiredSkills: {
      type: [
        {
          name: { type: String, required: true },
          minLevel: { type: Number, default: 1 },
          _id: false,
        },
      ],
      default: [],
    },
    tags: { type: [String], default: [] },
    checklist: {
      type: [
        {
          text: { type: String, required: true, maxlength: 300 },
          done: { type: Boolean, default: false },
        },
      ],
      default: [],
    },
    dependencyIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Task' }], default: [] },
    rank: { type: String, required: true },
    assignmentVersion: { type: Number, default: 0 },
    blockedSince: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    milestoneId: { type: Schema.Types.ObjectId, ref: 'Milestone', default: null },
    recurrence: {
      type: new Schema(
        {
          frequency: { type: String, enum: RECURRENCE_FREQUENCIES, required: true },
          interval: { type: Number, min: 1, max: 30, default: 1 },
          workdaysOnly: { type: Boolean, default: false },
          until: { type: String, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    recurrenceSeriesId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    recurrenceIndex: { type: Number, default: null },
    nextOccurrenceId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    customFields: { type: Schema.Types.Mixed, default: () => ({}) },
    type: { type: String, enum: ISSUE_TYPES, default: 'task' },
    storyPoints: { type: Number, default: null, min: 0, max: 100 },
    epicId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    sprintId: { type: Schema.Types.ObjectId, ref: 'Sprint', default: null },
    backlogRank: { type: String, default: null },
    components: { type: [String], default: [] },
    fixReleaseId: { type: Schema.Types.ObjectId, ref: 'Release', default: null },
    acceptanceCriteria: { type: String, maxlength: 10000, default: null },
    remainingHours: { type: Number, default: null, min: 0 },
    bug: {
      type: new Schema(
        {
          severity: { type: String, enum: BUG_SEVERITIES, default: 'major' },
          stepsToReproduce: { type: String, maxlength: 10000, default: null },
          expectedResult: { type: String, maxlength: 5000, default: null },
          actualResult: { type: String, maxlength: 5000, default: null },
          environment: { type: String, maxlength: 500, default: null },
          regression: { type: Boolean, default: false },
          foundInReleaseId: { type: Schema.Types.ObjectId, ref: 'Release', default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    links: {
      type: [
        // typeKey: the link has its own field called "type".
        new Schema(
          {
            type: { $type: String, enum: LINK_TYPES, required: true },
            taskId: { $type: Schema.Types.ObjectId, ref: 'Task', required: true },
          },
          { _id: false, typeKey: '$type' },
        ),
      ],
      default: [],
    },
    startedAt: { type: Date, default: null },
    previousKeys: { type: [String], default: [] },
    serviceRequest: {
      type: new Schema(
        {
          requestTypeId: { type: Schema.Types.ObjectId, ref: 'RequestType', required: true },
          kind: { type: String, required: true },
          requesterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          answers: { type: Schema.Types.Mixed, default: {} },
          responseDueAt: { type: Date, default: null },
          resolutionDueAt: { type: Date, default: null },
          firstResponseAt: { type: Date, default: null },
          awaitingApproval: { type: Boolean, default: false },
          // SLA alerts already sent (response_risk, response_breach, …).
          alerts: { type: [String], default: [] },
          feedback: {
            type: new Schema(
              { rating: Number, comment: { type: String, default: null }, at: Date },
              { _id: false },
            ),
            default: null,
          },
        },
        { _id: false, minimize: false },
      ),
      default: null,
    },
    restricted: { type: Boolean, default: false },
    allowedUserIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    pendingTransition: {
      type: new Schema(
        {
          to: { type: String, enum: TASK_STATUSES, required: true },
          transitionId: { type: String, required: true },
          approvalId: { type: Schema.Types.ObjectId, ref: 'Approval', required: true },
          requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          comment: { type: String, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'tasks' },
);

taskSchema.pre('save', function () {
  this.priorityOrder = PRIORITY_ORDER[this.priority];
});

taskSchema.index({ key: 1 }, { unique: true });
taskSchema.index({ projectId: 1, status: 1, rank: 1 });
taskSchema.index({ assigneeId: 1, status: 1 });
taskSchema.index({ dueDate: 1, status: 1 });
taskSchema.index({ parentId: 1 });
taskSchema.index({ milestoneId: 1, status: 1 });
taskSchema.index({ recurrenceSeriesId: 1 });
taskSchema.index({ dependencyIds: 1 });
taskSchema.index({ watcherIds: 1 });
taskSchema.index({ tags: 1 });
taskSchema.index({ deletedAt: 1, updatedAt: -1 });
taskSchema.index({ sprintId: 1, status: 1 });
taskSchema.index({ epicId: 1 });
taskSchema.index({ projectId: 1, type: 1, status: 1 });
taskSchema.index({ 'links.taskId': 1 });
taskSchema.index({ fixReleaseId: 1 });
taskSchema.index({ previousKeys: 1 });
taskSchema.index({ 'serviceRequest.requesterId': 1, createdAt: -1 }, { sparse: true });

export const Task =
  (mongoose.models.Task as mongoose.Model<ITask> | undefined) ??
  mongoose.model<ITask>('Task', taskSchema);
