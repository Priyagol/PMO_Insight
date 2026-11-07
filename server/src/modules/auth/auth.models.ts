import mongoose, { Schema, type Types } from 'mongoose';

/* ---------- Refresh tokens (rotation + reuse detection) ---------- */

export interface IRefreshToken {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** All tokens descending from one login share a family; reuse revokes the family. */
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason?:
    'rotated' | 'logout' | 'logout_all' | 'reuse_detected' | 'password_changed' | 'deactivated';
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    familyId: { type: String, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String },
    ip: String,
    userAgent: String,
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'refreshTokens' },
);
refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ familyId: 1 });
refreshTokenSchema.index({ userId: 1, revokedAt: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken =
  (mongoose.models.RefreshToken as mongoose.Model<IRefreshToken> | undefined) ??
  mongoose.model<IRefreshToken>('RefreshToken', refreshTokenSchema);

/* ---------- Password reset / invite tokens ---------- */

export interface IPasswordReset {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  purpose: 'invite' | 'reset';
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdBy?: Types.ObjectId;
  createdAt: Date;
}

const passwordResetSchema = new Schema<IPasswordReset>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: ['invite', 'reset'], required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'passwordResets' },
);
passwordResetSchema.index({ tokenHash: 1 }, { unique: true });
passwordResetSchema.index({ userId: 1, usedAt: 1 });
// Keep expired records for a week (support/audit), then purge.
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

export const PasswordReset =
  (mongoose.models.PasswordReset as mongoose.Model<IPasswordReset> | undefined) ??
  mongoose.model<IPasswordReset>('PasswordReset', passwordResetSchema);

/* ---------- Login history ---------- */

export interface ILoginHistory {
  _id: Types.ObjectId;
  userId: Types.ObjectId | null;
  email: string;
  success: boolean;
  reason?:
    | 'invalid_credentials'
    | 'locked'
    | 'inactive'
    | 'not_activated'
    | 'sso_required'
    | 'sso_no_account';
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

const loginHistorySchema = new Schema<ILoginHistory>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    email: { type: String, required: true, lowercase: true },
    success: { type: Boolean, required: true },
    reason: String,
    ip: String,
    userAgent: String,
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'loginHistory' },
);
loginHistorySchema.index({ userId: 1, createdAt: -1 });
loginHistorySchema.index({ createdAt: -1 });
loginHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });

export const LoginHistory =
  (mongoose.models.LoginHistory as mongoose.Model<ILoginHistory> | undefined) ??
  mongoose.model<ILoginHistory>('LoginHistory', loginHistorySchema);
