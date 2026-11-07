import mongoose, { Schema, type Types } from 'mongoose';
import { EMPLOYMENT_STATUSES, type EmploymentStatus } from '@arihant/shared';

export interface UserSkill {
  name: string;
  level: number;
}

export interface IUser {
  _id: Types.ObjectId;
  employeeId: string;
  name: string;
  email: string;
  /** Null until the employee accepts the invite. Never selected by default. */
  passwordHash: string | null;
  phone?: string;
  departmentId: Types.ObjectId | null;
  designation?: string;
  managerId: Types.ObjectId | null;
  roleIds: Types.ObjectId[];
  skills: UserSkill[];
  weeklyCapacityHours: number;
  status: EmploymentStatus;
  joinedAt?: Date;
  /** Bumped to invalidate every access token for this user (logout-all, password change, deactivation). */
  tokenVersion: number;
  failedLoginCount: number;
  lockedUntil?: Date | null;
  lastLoginAt?: Date;
  passwordChangedAt?: Date;
  /** Two-step verification (secrets are encrypted and never selected by default). */
  mfa?: {
    enabled: boolean;
    secretEnc: string | null;
    pendingSecretEnc: string | null;
    enabledAt: Date | null;
    lastUsedStep: number | null;
    recoveryCodeHashes: string[];
  };
  /** Subject of the person at the single sign-on provider. */
  ssoSubject?: string | null;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const skillSchema = new Schema<UserSkill>(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    level: { type: Number, required: true, min: 1, max: 5 },
  },
  { _id: false },
);

const userSchema = new Schema<IUser>(
  {
    employeeId: { type: String, required: true, trim: true, maxlength: 30 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, default: null, select: false },
    phone: { type: String, trim: true, maxlength: 30 },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    designation: { type: String, trim: true, maxlength: 100 },
    managerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    roleIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Role' }], default: [] },
    skills: { type: [skillSchema], default: [] },
    weeklyCapacityHours: { type: Number, default: 40, min: 0, max: 80 },
    status: { type: String, enum: EMPLOYMENT_STATUSES, default: 'active' },
    joinedAt: { type: Date },
    tokenVersion: { type: Number, default: 0 },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date },
    passwordChangedAt: { type: Date },
    mfa: {
      type: new Schema(
        {
          enabled: { type: Boolean, default: false },
          secretEnc: { type: String, default: null },
          pendingSecretEnc: { type: String, default: null },
          enabledAt: { type: Date, default: null },
          lastUsedStep: { type: Number, default: null },
          recoveryCodeHashes: { type: [String], default: [] },
        },
        { _id: false },
      ),
      default: () => ({}),
      select: false,
    },
    ssoSubject: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'users' },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ employeeId: 1 }, { unique: true });
userSchema.index({ departmentId: 1, status: 1 });
userSchema.index({ managerId: 1 });
userSchema.index({ roleIds: 1 });
userSchema.index({ name: 1 });

export const User =
  (mongoose.models.User as mongoose.Model<IUser> | undefined) ??
  mongoose.model<IUser>('User', userSchema);
