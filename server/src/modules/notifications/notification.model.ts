import mongoose, { Schema, type Types } from 'mongoose';
import { NOTIFICATION_TYPES, type NotificationType } from '@arihant/shared';

export interface INotification {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  actorId?: Types.ObjectId | null;
  readAt?: Date | null;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 300 },
    body: { type: String, maxlength: 1000, default: null },
    link: { type: String, maxlength: 300, default: null },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'notifications' },
);
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
// Retention: 180 days.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

export const Notification =
  (mongoose.models.Notification as mongoose.Model<INotification> | undefined) ??
  mongoose.model<INotification>('Notification', notificationSchema);

export interface INotificationPref {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  emailEnabled: boolean;
  email: Partial<Record<NotificationType, boolean>>;
}

const prefSchema = new Schema<INotificationPref>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    emailEnabled: { type: Boolean, default: true },
    email: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true, collection: 'notificationPrefs', minimize: false },
);
prefSchema.index({ userId: 1 }, { unique: true });

export const NotificationPref =
  (mongoose.models.NotificationPref as mongoose.Model<INotificationPref> | undefined) ??
  mongoose.model<INotificationPref>('NotificationPref', prefSchema);
