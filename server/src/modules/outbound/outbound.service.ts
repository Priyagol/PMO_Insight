import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import mongoose, { Schema, Types } from 'mongoose';
import {
  DELIVERY_STATUSES,
  HOOK_EVENTS,
  HOOK_EVENT_LABELS,
  HOOK_KINDS,
  STATUS_LABELS,
  outboundHookSchema,
  updateOutboundHookSchema,
  type CreatedOutboundHookDto,
  type DeliveryStatus,
  type HookDeliveryDto,
  type HookEvent,
  type HookKind,
  type OutboundHookDto,
  type OutboundHookInput,
  type TaskStatus,
} from '@arihant/shared';
import { env, publicAppUrl } from '../../config/env';
import { logger } from '../../config/logger';
import { openSecret, sealSecret } from '../../core/auth/totp';
import { eventBus, type DomainEvent } from '../../core/events';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../../core/errors';
import { can } from '../../core/rbac/policy';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { recordAudit } from '../audit/audit.service';
import { Project } from '../projects/project.model';
import { Task } from '../tasks/task.model';
import { User } from '../users/user.model';

/* ============================ Models ============================ */

interface IOutboundHook {
  _id: Types.ObjectId;
  name: string;
  kind: HookKind;
  urlEnc: string;
  urlPreview: string;
  secretEnc: string | null;
  events: HookEvent[];
  projectIds: Types.ObjectId[];
  active: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
const hookSchema = new Schema<IOutboundHook>(
  {
    name: { type: String, required: true, maxlength: 80 },
    kind: { type: String, enum: HOOK_KINDS, required: true },
    // Channel webhook addresses carry their own secret, so they are stored encrypted.
    urlEnc: { type: String, required: true },
    urlPreview: { type: String, required: true },
    secretEnc: { type: String, default: null },
    events: { type: [String], enum: HOOK_EVENTS, default: [] },
    projectIds: { type: [Schema.Types.ObjectId], default: [] },
    active: { type: Boolean, default: true },
    disabledReason: { type: String, default: null },
    consecutiveFailures: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'outboundHooks' },
);
hookSchema.index({ active: 1, events: 1 });
export const OutboundHook =
  (mongoose.models.OutboundHook as mongoose.Model<IOutboundHook> | undefined) ??
  mongoose.model<IOutboundHook>('OutboundHook', hookSchema);

interface IHookDelivery {
  _id: Types.ObjectId;
  hookId: Types.ObjectId;
  event: string;
  payload: unknown;
  status: DeliveryStatus;
  attempts: number;
  httpStatus: number | null;
  error: string | null;
  durationMs: number | null;
  nextAttemptAt: Date | null;
  createdAt: Date;
}
const deliverySchema = new Schema<IHookDelivery>(
  {
    hookId: { type: Schema.Types.ObjectId, ref: 'OutboundHook', required: true },
    event: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: DELIVERY_STATUSES, default: 'pending' },
    attempts: { type: Number, default: 0 },
    httpStatus: { type: Number, default: null },
    error: { type: String, default: null, maxlength: 500 },
    durationMs: { type: Number, default: null },
    nextAttemptAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'hookDeliveries',
    minimize: false,
  },
);
deliverySchema.index({ hookId: 1, createdAt: -1 });
deliverySchema.index({ status: 1, nextAttemptAt: 1 });
// Delivery history is kept for 30 days.
deliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
export const HookDelivery =
  (mongoose.models.HookDelivery as mongoose.Model<IHookDelivery> | undefined) ??
  mongoose.model<IHookDelivery>('HookDelivery', deliverySchema);

/* ============================ Address safety ============================ */

const PRIVATE = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^::1$/,
  /^f[cd]/i,
  /^fe80/i,
];

/**
 * Outgoing calls only go to public https addresses in production, so the server cannot be used
 * to reach internal systems. Plain http and local addresses are allowed in development and tests.
 */
export async function assertSafeUrl(raw: string): Promise<void> {
  const u = new URL(raw);
  if (env.NODE_ENV !== 'production') return;
  if (u.protocol !== 'https:') throw new UnprocessableError('Use an https:// address');
  const addrs = isIP(u.hostname)
    ? [u.hostname]
    : (await lookup(u.hostname, { all: true })).map((a) => a.address);
  if (addrs.some((a) => PRIVATE.some((rx) => rx.test(a))))
    throw new UnprocessableError('Internal network addresses are not allowed');
}

const preview = (raw: string) => {
  const u = new URL(raw);
  return `${u.protocol}//${u.host}${u.pathname.length > 12 ? `${u.pathname.slice(0, 12)}…` : u.pathname}`;
};

/* ============================ Administration ============================ */

const MAX_HOOKS = 50;
const DISABLE_AFTER = 10;
const RETRY_MINUTES = [1, 5, 30, 120];

function assertAdmin(rc: RequestContext) {
  const auth = requireAuth(rc);
  if (!can(auth, 'settings:manage', 'org')) throw new ForbiddenError();
  return auth;
}

async function present(rows: IOutboundHook[]): Promise<OutboundHookDto[]> {
  const projects = await Project.find({ _id: { $in: rows.flatMap((r) => r.projectIds) } })
    .select('key')
    .lean();
  const last = await HookDelivery.aggregate<{
    _id: Types.ObjectId;
    at: Date;
    status: DeliveryStatus;
    httpStatus: number | null;
  }>([
    { $match: { hookId: { $in: rows.map((r) => r._id) } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$hookId',
        at: { $first: '$createdAt' },
        status: { $first: '$status' },
        httpStatus: { $first: '$httpStatus' },
      },
    },
  ]);
  return rows.map((h) => {
    const l = last.find((x) => x._id.equals(h._id));
    return {
      id: h._id.toString(),
      name: h.name,
      kind: h.kind,
      urlPreview: h.urlPreview,
      events: h.events,
      projects: h.projectIds
        .map((pid) => projects.find((p) => p._id.equals(pid)))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .map((p) => ({ id: p._id.toString(), key: p.key })),
      active: h.active,
      disabledReason: h.disabledReason,
      consecutiveFailures: h.consecutiveFailures,
      lastDelivery: l
        ? { at: l.at.toISOString(), status: l.status, httpStatus: l.httpStatus }
        : null,
      createdAt: h.createdAt.toISOString(),
    };
  });
}

export async function listHooks(rc: RequestContext): Promise<OutboundHookDto[]> {
  assertAdmin(rc);
  return present(await OutboundHook.find().sort({ name: 1 }).lean());
}

export async function createHook(
  rc: RequestContext,
  raw: OutboundHookInput,
): Promise<CreatedOutboundHookDto> {
  const auth = assertAdmin(rc);
  const input = outboundHookSchema.parse(raw);
  await assertSafeUrl(input.url);
  if ((await OutboundHook.countDocuments()) >= MAX_HOOKS)
    throw new UnprocessableError(`At most ${MAX_HOOKS} outgoing integrations`);
  const secret = input.kind === 'webhook' ? randomBytes(32).toString('base64url') : null;
  const doc = await OutboundHook.create({
    name: input.name,
    kind: input.kind,
    urlEnc: sealSecret(input.url),
    urlPreview: preview(input.url),
    secretEnc: secret ? sealSecret(secret) : null,
    events: input.events,
    projectIds: input.projectIds.map((p) => new Types.ObjectId(p)),
    active: input.active,
    createdBy: auth.userObjectId,
  });
  await recordAudit(rc, {
    action: 'integration.hook_created',
    entityType: 'integration',
    entityId: doc._id,
    summary: `Added outgoing ${input.kind} “${input.name}” for ${input.events.length} event(s)`,
  });
  return { ...(await present([doc.toObject()]))[0]!, secret };
}

export async function updateHook(
  rc: RequestContext,
  id: string,
  raw: unknown,
): Promise<OutboundHookDto> {
  assertAdmin(rc);
  const input = updateOutboundHookSchema.parse(raw);
  const h = await OutboundHook.findById(id).lean();
  if (!h) throw new NotFoundError('Integration');
  const set: Record<string, unknown> = {};
  if (input.name) set.name = input.name;
  if (input.events) set.events = input.events;
  if (input.projectIds) set.projectIds = input.projectIds.map((p) => new Types.ObjectId(p));
  if (input.url) {
    await assertSafeUrl(input.url);
    set.urlEnc = sealSecret(input.url);
    set.urlPreview = preview(input.url);
  }
  if (input.active !== undefined) {
    set.active = input.active;
    // Switching it back on clears the automatic switch-off.
    if (input.active) Object.assign(set, { disabledReason: null, consecutiveFailures: 0 });
  }
  const next = await OutboundHook.findByIdAndUpdate(
    h._id,
    { $set: set },
    { returnDocument: 'after' },
  ).lean();
  await recordAudit(rc, {
    action: 'integration.hook_updated',
    entityType: 'integration',
    entityId: h._id,
    summary: `Changed outgoing ${h.kind} “${next!.name}”`,
  });
  return (await present([next!]))[0]!;
}

export async function deleteHook(rc: RequestContext, id: string): Promise<void> {
  assertAdmin(rc);
  const h = await OutboundHook.findById(id).lean();
  if (!h) throw new NotFoundError('Integration');
  await OutboundHook.deleteOne({ _id: h._id });
  await HookDelivery.deleteMany({ hookId: h._id });
  await recordAudit(rc, {
    action: 'integration.hook_deleted',
    entityType: 'integration',
    entityId: h._id,
    summary: `Removed outgoing ${h.kind} “${h.name}”`,
  });
}

/** New signing secret for a webhook, shown once. */
export async function rotateSecret(rc: RequestContext, id: string): Promise<{ secret: string }> {
  assertAdmin(rc);
  const h = await OutboundHook.findById(id).lean();
  if (!h || h.kind !== 'webhook') throw new NotFoundError('Webhook');
  const secret = randomBytes(32).toString('base64url');
  await OutboundHook.updateOne({ _id: h._id }, { $set: { secretEnc: sealSecret(secret) } });
  await recordAudit(rc, {
    action: 'integration.hook_secret_rotated',
    entityType: 'integration',
    entityId: h._id,
    summary: `Rotated the signing secret of “${h.name}”`,
  });
  return { secret };
}

export async function listDeliveries(rc: RequestContext, id: string): Promise<HookDeliveryDto[]> {
  assertAdmin(rc);
  const rows = await HookDelivery.find({ hookId: new Types.ObjectId(id) })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return rows.map((d) => ({
    id: d._id.toString(),
    event: d.event,
    status: d.status,
    attempts: d.attempts,
    httpStatus: d.httpStatus,
    error: d.error,
    durationMs: d.durationMs,
    createdAt: d.createdAt.toISOString(),
    nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
  }));
}

/** Sends a test message now and returns the result. */
export async function testHook(rc: RequestContext, id: string): Promise<HookDeliveryDto> {
  const auth = assertAdmin(rc);
  const h = await OutboundHook.findById(id).lean();
  if (!h) throw new NotFoundError('Integration');
  const payload = {
    event: 'test',
    occurredAt: new Date().toISOString(),
    text: `Test message from Arihant Workspace, sent by ${auth.name}`,
    data: {},
  };
  const d = await HookDelivery.create({ hookId: h._id, event: 'test', payload });
  await attempt(d._id);
  return (await listDeliveries(rc, id)).find((x) => x.id === d._id.toString())!;
}

/* ============================ Building messages ============================ */

interface Message {
  event: HookEvent;
  occurredAt: string;
  projectId: string | null;
  /** One line for chat channels. */
  text: string;
  url: string | null;
  data: Record<string, unknown>;
}

const taskUrl = (id: string) => `${publicAppUrl}/tasks/board?task=${id}`;

async function buildMessage(e: DomainEvent): Promise<Message | null> {
  const p = (e.payload ?? {}) as Record<string, string | undefined>;
  const actor = e.actorId ? await User.findById(e.actorId).select('name').lean() : null;
  const by = actor ? ` by ${actor.name}` : '';
  const base = { event: e.name as HookEvent, occurredAt: e.occurredAt.toISOString() };
  if (e.name.startsWith('task.') || e.name === 'comment.created') {
    const taskId = p.taskId ?? (e.name === 'comment.created' ? p.entityId : undefined);
    if (!taskId || !Types.ObjectId.isValid(taskId)) return null;
    const t = await Task.findById(taskId).lean();
    if (!t || t.deletedAt) return null;
    const project = await Project.findById(t.projectId).select('key name confidential').lean();
    // Restricted tasks and confidential projects never leave the system.
    if (!project || t.restricted || project.confidential) return null;
    const assignee = t.assigneeId ? await User.findById(t.assigneeId).select('name').lean() : null;
    const label = (s?: string) => (s ? (STATUS_LABELS[s as TaskStatus] ?? s) : '');
    const text =
      e.name === 'task.created'
        ? `${t.key} created${by}: ${t.title}`
        : e.name === 'task.status_changed'
          ? `${t.key} moved from ${label(p.from)} to ${label(p.to)}${by}: ${t.title}`
          : e.name === 'task.assigned'
            ? `${t.key} assigned to ${assignee?.name ?? 'nobody'}${by}: ${t.title}`
            : `New comment on ${t.key}${by}: ${t.title}`;
    return {
      ...base,
      projectId: t.projectId.toString(),
      text,
      url: taskUrl(t._id.toString()),
      data: {
        task: {
          id: t._id.toString(),
          key: t.key,
          title: t.title,
          status: t.status,
          priority: t.priority,
          type: t.type,
          assignee: assignee?.name ?? null,
          dueDate: t.dueDate ?? null,
        },
        project: { id: project._id.toString(), key: project.key, name: project.name },
        ...(e.name === 'task.status_changed' ? { from: p.from, to: p.to } : {}),
        actor: actor?.name ?? null,
      },
    };
  }
  if (e.name.startsWith('project.') || e.name.startsWith('risk.')) {
    const projectId = p.projectId;
    if (!projectId || !Types.ObjectId.isValid(projectId)) return null;
    const project = await Project.findById(projectId).select('key name status confidential').lean();
    if (!project || project.confidential) return null;
    const what =
      e.name === 'project.created'
        ? `Project ${project.key} ${project.name} created${by}`
        : e.name === 'project.status_changed'
          ? `Project ${project.key} is now ${label2(p.to)}${by}`
          : `${HOOK_EVENT_LABELS[e.name as HookEvent]} on ${project.key}${p.title ? `: ${p.title}` : ''}`;
    return {
      ...base,
      projectId,
      text: what,
      url: `${publicAppUrl}/projects/${projectId}`,
      data: {
        project: { id: projectId, key: project.key, name: project.name, status: project.status },
        ...p,
        actor: actor?.name ?? null,
      },
    };
  }
  return null;
}
const label2 = (s?: string) => (s ? (STATUS_LABELS[s as TaskStatus] ?? s.replace(/_/g, ' ')) : '');

/** The body sent for each kind of destination. */
export function formatBody(
  kind: HookKind,
  m: { event: string; occurredAt: string; text: string; url?: string | null; data: unknown },
) {
  if (kind === 'slack') {
    return { text: m.url ? `${m.text} <${m.url}|Open>` : m.text };
  }
  if (kind === 'teams') {
    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: '1.4',
            body: [{ type: 'TextBlock', text: m.text, wrap: true }],
            ...(m.url ? { actions: [{ type: 'Action.OpenUrl', title: 'Open', url: m.url }] } : {}),
          },
        },
      ],
    };
  }
  return {
    event: m.event,
    occurredAt: m.occurredAt,
    text: m.text,
    url: m.url ?? null,
    data: m.data,
  };
}

/* ============================ Delivery ============================ */

async function attempt(deliveryId: Types.ObjectId): Promise<void> {
  const d = await HookDelivery.findOneAndUpdate(
    { _id: deliveryId, status: 'pending' },
    { $inc: { attempts: 1 }, $set: { nextAttemptAt: null } },
    { returnDocument: 'after' },
  ).lean();
  if (!d) return;
  const h = await OutboundHook.findById(d.hookId).lean();
  if (!h) return;
  const body = JSON.stringify(formatBody(h.kind, d.payload as Message));
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'ArihantWorkspace-Webhook/1.0',
  };
  if (h.kind === 'webhook') {
    headers['X-Arihant-Event'] = d.event;
    headers['X-Arihant-Delivery'] = d._id.toString();
    if (h.secretEnc)
      headers['X-Arihant-Signature'] =
        `sha256=${createHmac('sha256', openSecret(h.secretEnc)).update(body).digest('hex')}`;
  }
  const started = Date.now();
  let httpStatus: number | null = null;
  let error: string | null = null;
  try {
    const url = openSecret(h.urlEnc);
    await assertSafeUrl(url);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    httpStatus = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 300) : 'Request failed';
  }
  const durationMs = Date.now() - started;
  if (!error) {
    await HookDelivery.updateOne(
      { _id: d._id },
      { $set: { status: 'delivered', httpStatus, durationMs, error: null } },
    );
    await OutboundHook.updateOne({ _id: h._id }, { $set: { consecutiveFailures: 0 } });
    return;
  }
  const retryIn = RETRY_MINUTES[d.attempts - 1];
  await HookDelivery.updateOne(
    { _id: d._id },
    {
      $set: {
        status: retryIn !== undefined && d.event !== 'test' ? 'pending' : 'failed',
        httpStatus,
        durationMs,
        error,
        nextAttemptAt:
          retryIn !== undefined && d.event !== 'test'
            ? new Date(Date.now() + retryIn * 60_000)
            : null,
      },
    },
  );
  const updated = await OutboundHook.findByIdAndUpdate(
    h._id,
    { $inc: { consecutiveFailures: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (updated && updated.active && updated.consecutiveFailures >= DISABLE_AFTER) {
    await OutboundHook.updateOne(
      { _id: h._id },
      {
        $set: {
          active: false,
          disabledReason: `Switched off after ${DISABLE_AFTER} failed deliveries in a row (last: ${error})`,
        },
      },
    );
    logger.warn(
      { hookId: h._id.toString() },
      'Outgoing integration switched off after repeated failures',
    );
  }
}

/** Retries deliveries whose next attempt is due (run by the worker every minute). */
export async function retryDueDeliveries(now = new Date()): Promise<number> {
  const due = await HookDelivery.find({
    status: 'pending',
    nextAttemptAt: { $ne: null, $lte: now },
  })
    .select('_id')
    .limit(200)
    .lean();
  for (const d of due) await attempt(d._id);
  return due.length;
}

async function dispatch(e: DomainEvent): Promise<void> {
  const hooks = await OutboundHook.find({ active: true, events: e.name as HookEvent }).lean();
  if (!hooks.length) return;
  const message = await buildMessage(e);
  if (!message) return;
  for (const h of hooks) {
    if (
      h.projectIds.length &&
      (!message.projectId || !h.projectIds.some((p) => p.equals(message.projectId!)))
    )
      continue;
    const d = await HookDelivery.create({ hookId: h._id, event: e.name, payload: message });
    await attempt(d._id);
  }
}

/** Sends matching events to the configured destinations. Returns an unsubscribe function. */
export function registerOutboundSubscribers(): () => void {
  const subs = HOOK_EVENTS.map((name) => eventBus.subscribe(name, dispatch));
  return () => subs.forEach((s) => s());
}
