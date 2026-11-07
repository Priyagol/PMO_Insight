import { randomUUID } from 'node:crypto';
import mongoose, { Schema } from 'mongoose';
import { ConflictError } from './errors';

/**
 * Distributed mutual exclusion backed by MongoDB (works across API replicas and the worker,
 * and needs no extra infrastructure). A lock is a document keyed by name with an expiry,
 * so a crashed holder never blocks others for longer than `ttlMs`.
 */
interface LockDoc {
  _id: string;
  owner: string;
  expiresAt: Date;
}

const lockSchema = new Schema<LockDoc>(
  {
    _id: { type: String, required: true },
    owner: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false, collection: 'locks' },
);
lockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Lock =
  (mongoose.models.Lock as mongoose.Model<LockDoc> | undefined) ??
  mongoose.model<LockDoc>('Lock', lockSchema);

async function tryAcquire(key: string, owner: string, ttlMs: number): Promise<boolean> {
  const now = new Date();
  try {
    // Take the lock if it is free or expired; the unique _id makes this atomic.
    const res = await Lock.findOneAndUpdate(
      { _id: key, expiresAt: { $lt: now } },
      { $set: { owner, expiresAt: new Date(now.getTime() + ttlMs) } },
      { upsert: true, returnDocument: 'after' },
    ).lean();
    return res?.owner === owner;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false; // held by someone else
    throw err;
  }
}

export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  { ttlMs = 120_000, waitMs = 30_000 }: { ttlMs?: number; waitMs?: number } = {},
): Promise<T> {
  const owner = randomUUID();
  const deadline = Date.now() + waitMs;
  let delay = 25;
  while (!(await tryAcquire(key, owner, ttlMs))) {
    if (Date.now() > deadline)
      throw new ConflictError(
        'Another assignment run is in progress for this team. Try again shortly.',
      );
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 500);
  }
  try {
    return await fn();
  } finally {
    await Lock.deleteOne({ _id: key, owner });
  }
}
