import { Types } from 'mongoose';
import type { ActivityDto, PageMeta } from '@arihant/shared';
import { logger } from '../../config/logger';
import { toPageMeta } from '../../core/pagination';
import type { RequestContext } from '../../core/rbac/context';
import { toUserRef } from '../users/user.mapper';
import { User } from '../users/user.model';
import { Activity } from './collab.models';

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

const normalize = (v: unknown): unknown => {
  if (v instanceof Types.ObjectId) return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalize);
  return v ?? null;
};

/** Field-by-field diff of two plain objects, limited to the given keys. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: string[],
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const key of keys) {
    const from = normalize(before[key]);
    const to = normalize(after[key]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ field: key, from, to });
  }
  return changes;
}

/** Records a user-facing activity entry. Never throws (activity is informational). */
export async function recordActivity(
  rc: RequestContext,
  entry: {
    projectId: Types.ObjectId;
    entityType: 'project' | 'task';
    entityId: Types.ObjectId;
    entityLabel: string;
    verb: string;
    summary: string;
    changes?: FieldChange[];
  },
): Promise<void> {
  try {
    await Activity.create({
      ...entry,
      actorId: rc.auth?.userObjectId ?? null,
      changes: entry.changes ?? [],
    });
  } catch (err) {
    logger.error({ err, verb: entry.verb }, 'Failed to record activity');
  }
}

export async function listActivity(
  filter: {
    projectId?: Types.ObjectId;
    entityType?: 'project' | 'task';
    entityId?: Types.ObjectId;
  },
  page: { page: number; limit: number },
  /** Entries about these records are left out (restricted tasks the reader may not see). */
  hidden: Types.ObjectId[] = [],
): Promise<{ items: ActivityDto[]; meta: PageMeta }> {
  if (hidden.length) filter = { ...filter, entityId: { $nin: hidden } } as unknown as typeof filter;
  const [docs, total] = await Promise.all([
    Activity.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page.page - 1) * page.limit)
      .limit(page.limit)
      .lean(),
    Activity.countDocuments(filter),
  ]);
  const actorIds = [...new Set(docs.map((d) => d.actorId?.toString()).filter(Boolean))] as string[];
  const actors = new Map(
    (
      await User.find({ _id: { $in: actorIds } })
        .select('name email employeeId designation')
        .lean()
    ).map((u) => [u._id.toString(), toUserRef(u)]),
  );
  return {
    items: docs.map((d) => ({
      id: d._id.toString(),
      actor: d.actorId ? (actors.get(d.actorId.toString()) ?? null) : null,
      entityType: d.entityType,
      entity: { id: d.entityId.toString(), label: d.entityLabel },
      verb: d.verb,
      summary: d.summary,
      changes: d.changes,
      createdAt: d.createdAt.toISOString(),
    })),
    meta: toPageMeta(page, total),
  };
}
