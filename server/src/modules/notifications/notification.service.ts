import { Types } from 'mongoose';
import {
  NOTIFICATION_CATALOGUE,
  NOTIFICATION_TYPES,
  notificationPrefsSchema,
  notificationQuerySchema,
  type NotificationDto,
  type NotificationPrefs,
  type NotificationQuery,
  type NotificationType,
  type PageMeta,
} from '@arihant/shared';
import { publicAppUrl } from '../../config/env';
import { logger } from '../../config/logger';
import { NotFoundError } from '../../core/errors';
import { toPageMeta, toPageWindow } from '../../core/pagination';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { notificationEmail, sendEmail } from '../../services/email';
import { emitTo, rooms } from '../../sockets/io';
import { User } from '../users/user.model';
import { Notification, NotificationPref, type INotification } from './notification.model';

type Id = Types.ObjectId | string;

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  actorId?: Id | null;
}

/**
 * Delivers one notification to each recipient: stored in-app, pushed over Socket.IO, and
 * e-mailed when the person's preferences allow. The actor never notifies themselves;
 * inactive users are skipped. Never throws (notifications must not break business actions).
 */
export async function notify(
  recipients: (Id | null | undefined)[],
  input: NotifyInput,
): Promise<number> {
  try {
    const actor = input.actorId ? String(input.actorId) : null;
    const ids = [...new Set(recipients.filter((r): r is Id => Boolean(r)).map(String))].filter(
      (id) => id !== actor && Types.ObjectId.isValid(id),
    );
    if (!ids.length) return 0;
    const users = await User.find({ _id: { $in: ids }, status: 'active' })
      .select('name email')
      .lean();
    if (!users.length) return 0;
    const docs = await Notification.insertMany(
      users.map((u) => ({
        userId: u._id,
        type: input.type,
        title: input.title.slice(0, 300),
        body: input.body?.slice(0, 1000) ?? null,
        link: input.link ?? null,
        actorId: actor ? new Types.ObjectId(actor) : null,
      })),
    );
    const actorName = actor
      ? ((await User.findById(actor).select('name').lean())?.name ?? null)
      : null;
    for (const d of docs) {
      emitTo(rooms.user(d.userId.toString()), 'notification', present(d.toObject(), actorName));
    }

    const prefs = new Map(
      (await NotificationPref.find({ userId: { $in: users.map((u) => u._id) } }).lean()).map(
        (p) => [p.userId.toString(), p],
      ),
    );
    for (const u of users) {
      const p = prefs.get(u._id.toString());
      const wants =
        (p?.emailEnabled ?? true) &&
        (p?.email?.[input.type] ?? NOTIFICATION_CATALOGUE[input.type].email);
      if (!wants) continue;
      await sendEmail({
        to: u.email,
        ...notificationEmail(
          u.name,
          input.title,
          input.body,
          input.link ? `${publicAppUrl}${input.link}` : publicAppUrl,
        ),
      });
    }
    return docs.length;
  } catch (err) {
    logger.error({ err, type: input.type }, 'Failed to deliver notification');
    return 0;
  }
}

function present(n: INotification, actorName: string | null): NotificationDto {
  return {
    id: n._id.toString(),
    type: n.type,
    title: n.title,
    body: n.body ?? undefined,
    link: n.link ?? undefined,
    actor: n.actorId && actorName ? { id: n.actorId.toString(), name: actorName } : null,
    read: Boolean(n.readAt),
    createdAt: n.createdAt.toISOString(),
  };
}

export async function listNotifications(
  rc: RequestContext,
  raw: NotificationQuery,
): Promise<{ items: NotificationDto[]; meta: PageMeta & { unread: number } }> {
  const auth = requireAuth(rc);
  const q = notificationQuerySchema.parse(raw);
  const filter: Record<string, unknown> = { userId: auth.userObjectId };
  if (q.unread === 'true') filter.readAt = null;
  const win = toPageWindow(q, ['createdAt'], { createdAt: -1, _id: -1 });
  const [docs, total, unread] = await Promise.all([
    Notification.find(filter).sort(win.sort).skip(win.skip).limit(win.limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId: auth.userObjectId, readAt: null }),
  ]);
  const actors = await User.find({
    _id: { $in: docs.map((d) => d.actorId).filter((a): a is Types.ObjectId => Boolean(a)) },
  })
    .select('name')
    .lean();
  const names = new Map(actors.map((a) => [a._id.toString(), a.name]));
  return {
    items: docs.map((d) =>
      present(d, d.actorId ? (names.get(d.actorId.toString()) ?? null) : null),
    ),
    meta: { ...toPageMeta(q, total), unread },
  };
}

export async function unreadCount(rc: RequestContext): Promise<number> {
  const auth = requireAuth(rc);
  return Notification.countDocuments({ userId: auth.userObjectId, readAt: null });
}

export async function markRead(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Notification');
  const res = await Notification.updateOne(
    { _id: id, userId: auth.userObjectId },
    { $set: { readAt: new Date() } },
  );
  if (!res.matchedCount) throw new NotFoundError('Notification');
}

export async function markAllRead(rc: RequestContext): Promise<number> {
  const auth = requireAuth(rc);
  const res = await Notification.updateMany(
    { userId: auth.userObjectId, readAt: null },
    { $set: { readAt: new Date() } },
  );
  return res.modifiedCount;
}

export async function getPrefs(rc: RequestContext): Promise<NotificationPrefs> {
  const auth = requireAuth(rc);
  const p = await NotificationPref.findOne({ userId: auth.userObjectId }).lean();
  const email = Object.fromEntries(
    NOTIFICATION_TYPES.map((t) => [t, p?.email?.[t] ?? NOTIFICATION_CATALOGUE[t].email]),
  ) as NotificationPrefs['email'];
  return { emailEnabled: p?.emailEnabled ?? true, email };
}

export async function setPrefs(rc: RequestContext, raw: unknown): Promise<NotificationPrefs> {
  const auth = requireAuth(rc);
  const input = notificationPrefsSchema.parse(raw);
  await NotificationPref.updateOne(
    { userId: auth.userObjectId },
    { $set: { emailEnabled: input.emailEnabled, email: input.email } },
    { upsert: true },
  );
  return getPrefs(rc);
}
