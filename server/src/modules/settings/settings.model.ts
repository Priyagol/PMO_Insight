import mongoose, { Schema, type Types } from 'mongoose';

/** Key/value configuration documents. The organisation profile is stored under key "org". */
export interface ISetting {
  _id: Types.ObjectId;
  key: string;
  value: unknown;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const settingSchema = new Schema<ISetting>(
  {
    key: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'settings' },
);
settingSchema.index({ key: 1 }, { unique: true });

export const Setting =
  (mongoose.models.Setting as mongoose.Model<ISetting> | undefined) ??
  mongoose.model<ISetting>('Setting', settingSchema);
