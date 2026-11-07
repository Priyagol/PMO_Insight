import mongoose, { Schema, type Types } from 'mongoose';
import {
  MEETING_STATUSES,
  MEETING_TYPES,
  PRIORITIES,
  type MeetingStatus,
  type MeetingType,
  type Priority,
} from '@arihant/shared';

export interface IActionItem {
  _id: Types.ObjectId;
  text: string;
  assigneeId?: Types.ObjectId | null;
  dueDate?: string | null;
  priority: Priority;
  taskId?: Types.ObjectId | null;
}

export interface IMeeting {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  title: string;
  type: MeetingType;
  status: MeetingStatus;
  startAt: Date;
  endAt: Date;
  location?: string | null;
  organizerId: Types.ObjectId;
  participantIds: Types.ObjectId[];
  agenda: string[];
  minutes?: string | null;
  decisions: string[];
  actionItems: IActionItem[];
  minutesPublishedAt?: Date | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const meetingSchema = new Schema<IMeeting>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true, maxlength: 160 },
    type: { type: String, enum: MEETING_TYPES, default: 'other' },
    status: { type: String, enum: MEETING_STATUSES, default: 'scheduled' },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    location: { type: String, maxlength: 300, default: null },
    organizerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    participantIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    agenda: { type: [String], default: [] },
    minutes: { type: String, maxlength: 50_000, default: null },
    decisions: { type: [String], default: [] },
    actionItems: {
      type: [
        new Schema<IActionItem>({
          text: { type: String, required: true, maxlength: 500 },
          assigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          dueDate: { type: String, default: null },
          priority: { type: String, enum: PRIORITIES, default: 'medium' },
          taskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
        }),
      ],
      default: [],
    },
    minutesPublishedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'meetings' },
);
meetingSchema.index({ projectId: 1, startAt: -1 });
meetingSchema.index({ participantIds: 1, startAt: -1 });
meetingSchema.index({ organizerId: 1, startAt: -1 });

export const Meeting =
  (mongoose.models.Meeting as mongoose.Model<IMeeting> | undefined) ??
  mongoose.model<IMeeting>('Meeting', meetingSchema);
