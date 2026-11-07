import { Types, type QueryFilter } from 'mongoose';
import type { AuditLogDto, AuditQuery, PageMeta } from '@arihant/shared';
import { logger } from '../../config/logger';
import { escapeRegex, toPageMeta, toPageWindow } from '../../core/pagination';
import type { RequestContext } from '../../core/rbac/context';
import { startOfOrgDay } from '../../core/time';
import { User } from '../users/user.model';
import { AuditLog, type IAuditLog } from './audit-log.model';

const SENSITIVE_KEYS = new Set([
  'passwordHash',
  'password',
  'tokenHash',
  'token',
  'refreshToken',
  'tokenVersion',
]);

/** Removes secrets and internal noise from before/after snapshots. */
function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > 6) return value;
  if (value instanceof Types.ObjectId) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k) || k === '__v') continue;
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: Types.ObjectId | string;
  summary: string;
  before?: unknown;
  after?: unknown;
  /** Overrides the request actor (e.g. a failed login has no authenticated actor). */
  actorId?: Types.ObjectId | string | null;
}

/**
 * Records an audit event. Never throws: an audit write failure is logged at error level
 * but does not undo the business action that already succeeded.
 */
export async function recordAudit(rc: RequestContext, entry: AuditEntry): Promise<void> {
  try {
    const actor = entry.actorId !== undefined ? entry.actorId : (rc.auth?.userObjectId ?? null);
    await AuditLog.create({
      action: entry.action,
      actorId: actor ? new Types.ObjectId(actor.toString()) : null,
      entityType: entry.entityType,
      entityId: entry.entityId ? new Types.ObjectId(entry.entityId.toString()) : undefined,
      summary: entry.summary.slice(0, 500),
      before: redact(entry.before),
      after: redact(entry.after),
      ip: rc.ip,
      userAgent: rc.userAgent,
      requestId: rc.requestId,
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'Failed to write audit log');
  }
}

export async function listAuditLogs(
  query: AuditQuery,
): Promise<{ items: AuditLogDto[]; meta: PageMeta }> {
  const filter: QueryFilter<IAuditLog> = {};
  if (query.action) filter.action = new RegExp(`^${escapeRegex(query.action)}`);
  if (query.actorId) filter.actorId = new Types.ObjectId(query.actorId);
  if (query.entityType) filter.entityType = query.entityType;
  if (query.entityId) filter.entityId = new Types.ObjectId(query.entityId);
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = startOfOrgDay(query.from);
    if (query.to)
      filter.createdAt.$lt = new Date(startOfOrgDay(query.to).getTime() + 24 * 3600_000);
  }
  if (query.q) filter.summary = new RegExp(escapeRegex(query.q), 'i');

  const win = toPageWindow(query, ['createdAt', 'action'], { createdAt: -1, _id: -1 });
  const [docs, total] = await Promise.all([
    AuditLog.find(filter).sort(win.sort).skip(win.skip).limit(win.limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  const actorIds = [...new Set(docs.map((d) => d.actorId?.toString()).filter(Boolean))] as string[];
  const actors = await User.find({ _id: { $in: actorIds } })
    .select('name email employeeId designation')
    .lean();
  const byId = new Map(actors.map((a) => [a._id.toString(), a]));

  const items: AuditLogDto[] = docs.map((d) => {
    const a = d.actorId ? byId.get(d.actorId.toString()) : undefined;
    return {
      id: d._id.toString(),
      action: d.action,
      actor: a
        ? {
            id: a._id.toString(),
            name: a.name,
            email: a.email,
            employeeId: a.employeeId,
            designation: a.designation,
          }
        : null,
      entityType: d.entityType,
      entityId: d.entityId?.toString(),
      summary: d.summary,
      before: d.before,
      after: d.after,
      ip: d.ip,
      userAgent: d.userAgent,
      requestId: d.requestId,
      createdAt: d.createdAt.toISOString(),
    };
  });
  return { items, meta: toPageMeta(query, total) };
}
