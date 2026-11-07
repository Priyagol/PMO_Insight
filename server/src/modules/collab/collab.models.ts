import mongoose, { Schema, type Types } from 'mongoose';

/* ---------- Comments (threaded, with @mentions) ---------- */

export interface IComment {
  _id: Types.ObjectId;
  entityType: 'task';
  entityId: Types.ObjectId;
  projectId: Types.ObjectId;
  authorId: Types.ObjectId;
  body: string;
  mentions: Types.ObjectId[];
  parentId: Types.ObjectId | null;
  /** Service desk: a reply the person who raised the request can read (Phase 9G). */
  visibleToRequester?: boolean;
  editedAt?: Date | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const commentSchema = new Schema<IComment>(
  {
    entityType: { type: String, enum: ['task'], required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, maxlength: 10000 },
    mentions: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    parentId: { type: Schema.Types.ObjectId, ref: 'Comment', default: null },
    visibleToRequester: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'comments' },
);
commentSchema.index({ entityType: 1, entityId: 1, createdAt: 1 });
commentSchema.index({ mentions: 1, createdAt: -1 });

export const Comment =
  (mongoose.models.Comment as mongoose.Model<IComment> | undefined) ??
  mongoose.model<IComment>('Comment', commentSchema);

/* ---------- Attachments (metadata; bytes live in object storage) ---------- */

export interface IAttachment {
  _id: Types.ObjectId;
  entityType: 'task' | 'project';
  entityId: Types.ObjectId;
  projectId: Types.ObjectId;
  fileName: string;
  mime: string;
  size: number;
  storageKey: string;
  uploadedBy: Types.ObjectId;
  deletedAt?: Date | null;
  createdAt: Date;
}

const attachmentSchema = new Schema<IAttachment>(
  {
    entityType: { type: String, enum: ['task', 'project'], required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    fileName: { type: String, required: true, maxlength: 255 },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    storageKey: { type: String, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'attachments' },
);
attachmentSchema.index({ entityType: 1, entityId: 1, deletedAt: 1 });
attachmentSchema.index({ storageKey: 1 }, { unique: true });

export const Attachment =
  (mongoose.models.Attachment as mongoose.Model<IAttachment> | undefined) ??
  mongoose.model<IAttachment>('Attachment', attachmentSchema);

/* ---------- Activity feed (user-facing history; audit log stays separate) ---------- */

export interface IActivity {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  entityType: 'project' | 'task';
  entityId: Types.ObjectId;
  entityLabel: string;
  actorId: Types.ObjectId | null;
  verb: string;
  summary: string;
  changes: { field: string; from: unknown; to: unknown }[];
  createdAt: Date;
}

const activitySchema = new Schema<IActivity>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    entityType: { type: String, enum: ['project', 'task'], required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    entityLabel: { type: String, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verb: { type: String, required: true },
    summary: { type: String, required: true, maxlength: 500 },
    changes: {
      type: [{ field: String, from: Schema.Types.Mixed, to: Schema.Types.Mixed, _id: false }],
      default: [],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'activities' },
);
activitySchema.index({ projectId: 1, createdAt: -1 });
activitySchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

export const Activity =
  (mongoose.models.Activity as mongoose.Model<IActivity> | undefined) ??
  mongoose.model<IActivity>('Activity', activitySchema);

/* ---------- Assignment history (manual now; smart assignment in Phase 4) ---------- */

export interface IAssignmentHistory {
  _id: Types.ObjectId;
  taskId: Types.ObjectId;
  projectId: Types.ObjectId;
  fromUserId: Types.ObjectId | null;
  toUserId: Types.ObjectId | null;
  method: 'manual' | 'auto' | 'suggested' | 'batch' | 'reassign' | 'rebalance';
  score?: number | null;
  reason?: string;
  triggeredBy: 'user' | 'automation';
  actorId: Types.ObjectId | null;
  batchId?: string | null;
  createdAt: Date;
}

const assignmentHistorySchema = new Schema<IAssignmentHistory>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    fromUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    toUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    method: { type: String, required: true },
    score: { type: Number, default: null },
    reason: String,
    triggeredBy: { type: String, enum: ['user', 'automation'], default: 'user' },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    batchId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'assignmentHistories' },
);
assignmentHistorySchema.index({ taskId: 1, createdAt: -1 });
assignmentHistorySchema.index({ toUserId: 1, createdAt: -1 });

export const AssignmentHistory =
  (mongoose.models.AssignmentHistory as mongoose.Model<IAssignmentHistory> | undefined) ??
  mongoose.model<IAssignmentHistory>('AssignmentHistory', assignmentHistorySchema);

/* ---------- Saved views ---------- */

export interface ISavedView {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  module: 'tasks';
  name: string;
  view: 'board' | 'list' | 'calendar' | 'timeline';
  filters: Record<string, string | string[]>;
  createdAt: Date;
}

const savedViewSchema = new Schema<ISavedView>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    module: { type: String, enum: ['tasks'], required: true },
    name: { type: String, required: true, maxlength: 60 },
    view: { type: String, enum: ['board', 'list', 'calendar', 'timeline'], default: 'list' },
    filters: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'savedViews', minimize: false },
);
savedViewSchema.index({ userId: 1, module: 1, name: 1 }, { unique: true });

export const SavedView =
  (mongoose.models.SavedView as mongoose.Model<ISavedView> | undefined) ??
  mongoose.model<ISavedView>('SavedView', savedViewSchema);
