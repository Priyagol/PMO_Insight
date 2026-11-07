import mongoose, { Schema, type Types } from 'mongoose';
import { TASK_STATUSES, type TaskStatus, type WorkflowDefinition } from '@arihant/shared';

/** A reusable task workflow; projects point to one through `workflowId`. */
export interface ITaskWorkflow {
  _id: Types.ObjectId;
  name: string;
  description: string | null;
  definition: WorkflowDefinition;
  createdBy: Types.ObjectId;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const taskWorkflowSchema = new Schema<ITaskWorkflow>(
  {
    name: { type: String, required: true, maxlength: 80 },
    description: { type: String, maxlength: 500, default: null },
    // Validated with the shared schema before every write.
    definition: { type: Schema.Types.Mixed, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    version: { type: Number, default: 1 },
  },
  { timestamps: true, collection: 'taskWorkflows', minimize: false },
);
taskWorkflowSchema.index({ name: 1 }, { unique: true });

export const TaskWorkflow =
  (mongoose.models.TaskWorkflow as mongoose.Model<ITaskWorkflow> | undefined) ??
  mongoose.model<ITaskWorkflow>('TaskWorkflow', taskWorkflowSchema);

export type TransitionVia =
  'user' | 'board' | 'bulk' | 'git' | 'approval' | 'automation' | 'workflow_change' | 'create';

/** One status change of a task (workflow history and time in status). */
export interface ITaskTransition {
  _id: Types.ObjectId;
  taskId: Types.ObjectId;
  projectId: Types.ObjectId;
  from: TaskStatus | null;
  to: TaskStatus;
  transition: string | null;
  via: TransitionVia;
  actorId: Types.ObjectId | null;
  comment: string | null;
  durationMs: number | null;
  at: Date;
}

const taskTransitionSchema = new Schema<ITaskTransition>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    from: { type: String, enum: [...TASK_STATUSES, null], default: null },
    to: { type: String, enum: TASK_STATUSES, required: true },
    transition: { type: String, default: null, maxlength: 60 },
    via: { type: String, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    comment: { type: String, default: null, maxlength: 5000 },
    durationMs: { type: Number, default: null },
    at: { type: Date, default: () => new Date() },
  },
  { collection: 'taskTransitions' },
);
taskTransitionSchema.index({ taskId: 1, at: 1 });
taskTransitionSchema.index({ projectId: 1, at: -1 });

export const TaskTransition =
  (mongoose.models.TaskTransition as mongoose.Model<ITaskTransition> | undefined) ??
  mongoose.model<ITaskTransition>('TaskTransition', taskTransitionSchema);
