import mongoose, { Schema, type Types } from 'mongoose';

/** Append-only record of critical actions. There is no update or delete path in the API. */
export interface IAuditLog {
  _id: Types.ObjectId;
  action: string;
  actorId: Types.ObjectId | null;
  entityType: string;
  entityId?: Types.ObjectId;
  summary: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    action: { type: String, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId },
    summary: { type: String, required: true, maxlength: 500 },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    ip: String,
    userAgent: String,
    requestId: String,
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'auditLogs', minimize: true },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

// Block accidental mutation through Mongoose.
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const) {
  auditLogSchema.pre(op, function () {
    throw new Error('Audit logs are append-only');
  });
}

export const AuditLog =
  (mongoose.models.AuditLog as mongoose.Model<IAuditLog> | undefined) ??
  mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
