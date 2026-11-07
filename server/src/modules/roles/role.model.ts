import mongoose, { Schema, type Types } from 'mongoose';
import { PERMISSIONS, SCOPES, type Permission, type Scope } from '@arihant/shared';

export interface IRole {
  _id: Types.ObjectId;
  /** System roles use the SystemRole key; custom roles use `custom_<slug>`. */
  key: string;
  name: string;
  description?: string;
  isSystem: boolean;
  grants: { permission: Permission; scope: Scope }[];
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<IRole>(
  {
    key: { type: String, required: true, trim: true, maxlength: 80 },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 300 },
    isSystem: { type: Boolean, default: false },
    grants: {
      type: [
        new Schema(
          {
            permission: { type: String, enum: PERMISSIONS, required: true },
            scope: { type: String, enum: SCOPES, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true, collection: 'roles' },
);

roleSchema.index({ key: 1 }, { unique: true });

export const Role =
  (mongoose.models.Role as mongoose.Model<IRole> | undefined) ??
  mongoose.model<IRole>('Role', roleSchema);
