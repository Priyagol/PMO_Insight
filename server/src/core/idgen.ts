import mongoose, { Schema, type ClientSession } from 'mongoose';

/**
 * Atomic sequence counters, e.g. `task:TRD` -> 42 gives task key `TRD-42`.
 * `findOneAndUpdate` with `$inc` + upsert is atomic per document, so concurrent
 * callers always receive distinct numbers.
 */
interface CounterDoc {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<CounterDoc>(
  { _id: { type: String, required: true }, seq: { type: Number, required: true, default: 0 } },
  { versionKey: false, collection: 'counters' },
);

export const Counter =
  (mongoose.models.Counter as mongoose.Model<CounterDoc> | undefined) ??
  mongoose.model<CounterDoc>('Counter', counterSchema);

export async function nextSequence(name: string, session?: ClientSession): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', session },
  ).lean();
  if (!doc) throw new Error(`Counter ${name} could not be incremented`);
  return doc.seq;
}

/** Builds a human-readable key such as `TRD-42`. */
export async function nextKey(prefix: string, session?: ClientSession): Promise<string> {
  const normalized = prefix.toUpperCase();
  const seq = await nextSequence(`key:${normalized}`, session);
  return `${normalized}-${seq}`;
}
