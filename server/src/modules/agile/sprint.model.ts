import mongoose, { Schema, type Types } from 'mongoose';
import { SPRINT_STATUSES, type SprintStatus } from '@arihant/shared';

export interface ISprint {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  /** Sequence within the project ("TRD Sprint 3"). */
  number: number;
  name: string;
  goal?: string | null;
  status: SprintStatus;
  /** Organisation calendar dates, YYYY-MM-DD. */
  startDate?: string | null;
  endDate?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  /** Snapshot at start: the tasks and points the team committed to. */
  committedTaskIds: Types.ObjectId[];
  committedPoints?: number | null;
  /** Snapshot at completion. */
  completedTaskIds: Types.ObjectId[];
  completedPoints?: number | null;
  /** Unfinished tasks at completion and where they went. */
  carriedOverTaskIds: Types.ObjectId[];
  createdBy: Types.ObjectId;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const sprintSchema = new Schema<ISprint>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    number: { type: Number, required: true },
    name: { type: String, required: true, maxlength: 80 },
    goal: { type: String, maxlength: 1000, default: null },
    status: { type: String, enum: SPRINT_STATUSES, default: 'planned' },
    startDate: { type: String, default: null },
    endDate: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    committedTaskIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Task' }], default: [] },
    committedPoints: { type: Number, default: null },
    completedTaskIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Task' }], default: [] },
    completedPoints: { type: Number, default: null },
    carriedOverTaskIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Task' }], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'sprints' },
);

sprintSchema.index({ projectId: 1, number: 1 }, { unique: true });
sprintSchema.index({ projectId: 1, status: 1 });
// At most one running sprint per project.
sprintSchema.index(
  { projectId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);

export const Sprint =
  (mongoose.models.Sprint as mongoose.Model<ISprint> | undefined) ??
  mongoose.model<ISprint>('Sprint', sprintSchema);
