import mongoose, { Schema, type Types } from 'mongoose';

/** Skill catalogue used for autocomplete and, from Phase 4, skill matching. */
export interface ISkill {
  _id: Types.ObjectId;
  name: string;
  /** Lower-cased name for case-insensitive uniqueness. */
  normalized: string;
  createdAt: Date;
}

const skillSchema = new Schema<ISkill>(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    normalized: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'skills' },
);
skillSchema.index({ normalized: 1 }, { unique: true });

export const Skill =
  (mongoose.models.Skill as mongoose.Model<ISkill> | undefined) ??
  mongoose.model<ISkill>('Skill', skillSchema);

/** Adds any new skill names to the catalogue (idempotent). */
export async function registerSkills(names: string[]): Promise<void> {
  const unique = new Map(names.map((n) => [n.trim().toLowerCase(), n.trim()]));
  if (unique.size === 0) return;
  await Skill.bulkWrite(
    [...unique].map(([normalized, name]) => ({
      updateOne: {
        filter: { normalized },
        update: { $setOnInsert: { name, normalized } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}
