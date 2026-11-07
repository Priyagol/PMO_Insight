import mongoose, { Schema, type Types } from 'mongoose';
import { FILTER_SHARING, GADGET_CHARTS, STAT_GROUPS, type FilterSharing } from '@arihant/shared';

/* ---------- Saved filters ---------- */

export interface ISavedFilter {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  description: string | null;
  aql: string;
  sharing: FilterSharing;
  projectId: Types.ObjectId | null;
  /** People who starred the filter. */
  favouriteOf: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const savedFilterSchema = new Schema<ISavedFilter>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: 80 },
    description: { type: String, maxlength: 500, default: null },
    aql: { type: String, required: true, maxlength: 2000 },
    sharing: { type: String, enum: FILTER_SHARING, default: 'private' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    favouriteOf: { type: [Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true, collection: 'savedFilters' },
);
savedFilterSchema.index({ ownerId: 1, name: 1 }, { unique: true });
savedFilterSchema.index({ sharing: 1, projectId: 1 });

export const SavedFilter =
  (mongoose.models.SavedFilter as mongoose.Model<ISavedFilter> | undefined) ??
  mongoose.model<ISavedFilter>('SavedFilter', savedFilterSchema);

/* ---------- Search history ---------- */

export interface ISearchHistory {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  aql: string;
  resultCount: number;
  at: Date;
}

const searchHistorySchema = new Schema<ISearchHistory>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    aql: { type: String, required: true, maxlength: 2000 },
    resultCount: { type: Number, default: 0 },
    at: { type: Date, default: () => new Date() },
  },
  { collection: 'searchHistory' },
);
searchHistorySchema.index({ userId: 1, aql: 1 }, { unique: true });
searchHistorySchema.index({ userId: 1, at: -1 });
// History is kept for 90 days.
searchHistorySchema.index({ at: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

export const SearchHistory =
  (mongoose.models.SearchHistory as mongoose.Model<ISearchHistory> | undefined) ??
  mongoose.model<ISearchHistory>('SearchHistory', searchHistorySchema);

/* ---------- Dashboard gadgets built from saved filters ---------- */

export interface IFilterGadget {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  filterId: Types.ObjectId;
  chart: (typeof GADGET_CHARTS)[number];
  by: (typeof STAT_GROUPS)[number];
  position: number;
  createdAt: Date;
}

const filterGadgetSchema = new Schema<IFilterGadget>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    filterId: { type: Schema.Types.ObjectId, ref: 'SavedFilter', required: true },
    chart: { type: String, enum: GADGET_CHARTS, default: 'bar' },
    by: { type: String, enum: STAT_GROUPS, default: 'status' },
    position: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'filterGadgets' },
);
filterGadgetSchema.index({ userId: 1, position: 1 });

export const FilterGadget =
  (mongoose.models.FilterGadget as mongoose.Model<IFilterGadget> | undefined) ??
  mongoose.model<IFilterGadget>('FilterGadget', filterGadgetSchema);
