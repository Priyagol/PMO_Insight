import mongoose, { Schema, type Types } from 'mongoose';

export interface IDepartment {
  _id: Types.ObjectId;
  name: string;
  code: string;
  description?: string;
  headId: Types.ObjectId | null;
  parentId: Types.ObjectId | null;
  /** Soft delete: archived departments keep history but free their code for reuse. */
  archived: boolean;
  archivedAt?: Date | null;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const departmentSchema = new Schema<IDepartment>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 10 },
    description: { type: String, trim: true, maxlength: 500 },
    headId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    parentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    archived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'departments' },
);

// Codes are unique among active departments only.
departmentSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { archived: false } });
departmentSchema.index({ archived: 1, name: 1 });

export const Department =
  (mongoose.models.Department as mongoose.Model<IDepartment> | undefined) ??
  mongoose.model<IDepartment>('Department', departmentSchema);
