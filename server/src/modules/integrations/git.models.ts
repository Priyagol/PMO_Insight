import mongoose, { Schema, type Types } from 'mongoose';
import { GIT_LINK_KINDS, type GitLinkKind } from '@arihant/shared';

/** A commit or pull request that mentions a task. */
export interface IGitLink {
  _id: Types.ObjectId;
  provider: 'github' | 'gitlab' | 'bitbucket';
  kind: GitLinkKind;
  /** owner/name, lower-cased. */
  repo: string;
  /** Full commit SHA, or "#<number>" for pull requests. */
  ref: string;
  taskId: Types.ObjectId;
  projectId: Types.ObjectId;
  title: string;
  url: string;
  author: string;
  branch?: string | null;
  state?: 'open' | 'merged' | 'closed' | null;
  movedTask: boolean;
  /** Smart-commit commands carried out on the task. */
  actions?: string[];
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const linkSchema = new Schema<IGitLink>(
  {
    provider: { type: String, enum: ['github', 'gitlab', 'bitbucket'], default: 'github' },
    kind: { type: String, enum: GIT_LINK_KINDS, required: true },
    repo: { type: String, required: true },
    ref: { type: String, required: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true, maxlength: 300 },
    url: { type: String, required: true, maxlength: 500 },
    author: { type: String, default: '', maxlength: 120 },
    branch: { type: String, default: null, maxlength: 250 },
    state: { type: String, enum: ['open', 'merged', 'closed', null], default: null },
    movedTask: { type: Boolean, default: false },
    actions: { type: [String], default: [] },
    occurredAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'gitLinks' },
);
// The same commit or pull request is linked to a task once (redelivered webhooks are harmless).
linkSchema.index({ provider: 1, kind: 1, repo: 1, ref: 1, taskId: 1 }, { unique: true });
linkSchema.index({ taskId: 1, occurredAt: -1 });

export const GitLink =
  (mongoose.models.GitLink as mongoose.Model<IGitLink> | undefined) ??
  mongoose.model<IGitLink>('GitLink', linkSchema);

/** Received webhook deliveries (dedupe and "last delivery" status); kept 30 days. */
export interface IGitDelivery {
  _id: Types.ObjectId;
  deliveryId: string;
  event: string;
  repo: string;
  outcome: string;
  createdAt: Date;
}
const deliverySchema = new Schema<IGitDelivery>(
  {
    deliveryId: { type: String, required: true },
    event: { type: String, required: true },
    repo: { type: String, default: '' },
    outcome: { type: String, default: 'received' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'gitDeliveries' },
);
deliverySchema.index({ deliveryId: 1 }, { unique: true });
deliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export const GitDelivery =
  (mongoose.models.GitDelivery as mongoose.Model<IGitDelivery> | undefined) ??
  mongoose.model<IGitDelivery>('GitDelivery', deliverySchema);
