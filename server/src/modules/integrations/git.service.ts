import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Types } from 'mongoose';
import {
  STATUS_LABELS,
  gitSettingsSchema,
  parseGitReferences,
  rankBetween,
  type GitLinkDto,
  type GitSettingsDto,
  type GitSettingsInput,
  type TaskStatus,
} from '@arihant/shared';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { eventBus } from '../../core/events';
import { ForbiddenError, ServiceUnavailableError, UnauthenticatedError } from '../../core/errors';
import { can } from '../../core/rbac/policy';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { recordAudit } from '../audit/audit.service';
import { recordActivity } from '../collab/activity.service';
import { notify } from '../notifications/notification.service';
import { Project } from '../projects/project.model';
import { Setting } from '../settings/settings.model';
import { Task, type ITask } from '../tasks/task.model';
import { lastRankIn, loadTask } from '../tasks/task.service';
import { GitDelivery, GitLink } from './git.models';
import { recordTransition, workflowOf } from '../workflows/workflow.service';

export const WEBHOOK_PATH = '/api/v1/integrations/github/webhook';
export const GITLAB_WEBHOOK_PATH = '/api/v1/integrations/gitlab/webhook';
export const BITBUCKET_WEBHOOK_PATH = '/api/v1/integrations/bitbucket/webhook';

export type GitProvider = 'github' | 'gitlab' | 'bitbucket';
const PROVIDER_LABELS: Record<GitProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
};
const providerScope = new AsyncLocalStorage<GitProvider>();
const provider = (): GitProvider => providerScope.getStore() ?? 'github';
const providerLabel = () => PROVIDER_LABELS[provider()];
const SETTINGS_KEY = 'git';
const DEFAULTS: GitSettingsInput = { enabled: false, repos: [], moveOnFix: true };

async function settings(): Promise<GitSettingsInput> {
  const doc = await Setting.findOne({ key: SETTINGS_KEY }).lean();
  return { ...DEFAULTS, ...((doc?.value as Partial<GitSettingsInput> | undefined) ?? {}) };
}

/* ---------- Settings (administrators) ---------- */

export async function getGitSettings(rc: RequestContext): Promise<GitSettingsDto> {
  const auth = requireAuth(rc);
  const last = await GitDelivery.findOne().sort({ createdAt: -1 }).lean();
  return {
    ...(await settings()),
    secretConfigured: Boolean(env.GITHUB_WEBHOOK_SECRET),
    webhookPath: WEBHOOK_PATH,
    lastDelivery: last
      ? {
          at: last.createdAt.toISOString(),
          event: last.event,
          repo: last.repo,
          outcome: last.outcome,
        }
      : null,
    canEdit: can(auth, 'settings:manage', 'org'),
  };
}

export async function saveGitSettings(rc: RequestContext, raw: unknown): Promise<GitSettingsDto> {
  const auth = requireAuth(rc);
  if (!can(auth, 'settings:manage', 'org')) throw new ForbiddenError();
  const input = gitSettingsSchema.parse(raw);
  const value = { ...input, repos: [...new Set(input.repos.map((r) => r.toLowerCase()))] };
  const before = await settings();
  await Setting.updateOne(
    { key: SETTINGS_KEY },
    { $set: { value, updatedBy: auth.userObjectId } },
    { upsert: true },
  );
  await recordAudit(rc, {
    action: 'settings.git_updated',
    entityType: 'settings',
    summary: `${value.enabled ? 'Enabled' : 'Disabled'} the GitHub integration for ${value.repos.length} repositor${value.repos.length === 1 ? 'y' : 'ies'}`,
    before,
    after: value,
  });
  return getGitSettings(rc);
}

/* ---------- Task view ---------- */

export async function listTaskGitLinks(rc: RequestContext, taskId: string): Promise<GitLinkDto[]> {
  const auth = requireAuth(rc);
  const { task } = await loadTask(auth, taskId); // 404 unless the caller may see the task
  const links = await GitLink.find({ taskId: task._id }).sort({ occurredAt: -1 }).limit(100).lean();
  return links.map((l) => ({
    id: l._id.toString(),
    kind: l.kind,
    repo: l.repo,
    ref: l.kind === 'commit' ? l.ref.slice(0, 7) : l.ref,
    title: l.title,
    url: l.url,
    author: l.author,
    branch: l.branch ?? undefined,
    state: l.state ?? undefined,
    movedTask: l.movedTask,
    at: l.occurredAt.toISOString(),
  }));
}

/* ---------- Webhook ---------- */

export function verifySignature(rawBody: Buffer, signature: string | undefined): void {
  const secret = env.GITHUB_WEBHOOK_SECRET;
  if (!secret)
    throw new ServiceUnavailableError('The GitHub integration is not configured on this server');
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(signature ?? '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new UnauthenticatedError('Invalid webhook signature');
}

interface PushPayload {
  ref?: string;
  repository?: { full_name?: string };
  commits?: {
    id: string;
    message: string;
    url: string;
    timestamp?: string;
    author?: { name?: string; username?: string };
  }[];
}
interface PullRequestPayload {
  action?: string;
  repository?: { full_name?: string };
  pull_request?: {
    number: number;
    title: string;
    body?: string | null;
    html_url: string;
    state: 'open' | 'closed';
    merged?: boolean;
    updated_at?: string;
    user?: { login?: string };
    head?: { ref?: string };
  };
}

export interface WebhookResult {
  outcome: string;
  linked: number;
  moved: string[];
}

/** System request context: actions are recorded without a user (shown as "GitHub"). */
const systemRc = (requestId?: string): RequestContext => ({
  auth: null,
  requestId,
  userAgent: providerLabel(),
});

const OPEN_FOR_REVIEW: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'blocked'];

/**
 * Moves a task to In review because a commit or pull request says it fixes it. Backlog and To do
 * pass through In progress (the workflow does not allow skipping it); tasks already in review,
 * testing, done or cancelled are left alone.
 */
async function moveToReview(task: ITask, source: string, requestId?: string): Promise<boolean> {
  if (!OPEN_FOR_REVIEW.includes(task.status)) return false;
  // Projects whose workflow has no In review status are left alone.
  const project = await Project.findById(task.projectId).select('workflowId').lean();
  if (!project || !(await workflowOf(project)).def.statuses.includes('in_review')) return false;
  const now = new Date();
  const set: Record<string, unknown> = {
    status: 'in_review',
    rank: rankBetween(await lastRankIn(task.projectId, 'in_review'), null),
    blockedSince: null,
  };
  if (!task.startedAt) set.startedAt = now;
  const updated = await Task.findOneAndUpdate(
    { _id: task._id, status: task.status, deletedAt: null },
    { $set: set },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) return false; // changed concurrently: leave it
  const rc = systemRc(requestId);
  await recordTransition(rc, {
    task,
    from: task.status,
    to: 'in_review',
    transition: `${providerLabel()}: ${source}`.slice(0, 60),
    via: 'git',
    actorId: null,
  });
  const via = task.status === 'backlog' || task.status === 'todo' ? ' (via In progress)' : '';
  await recordActivity(rc, {
    projectId: task.projectId,
    entityType: 'task',
    entityId: task._id,
    entityLabel: `${task.key} ${task.title}`,
    verb: 'status_changed',
    summary: `${providerLabel()} moved ${task.key} from ${STATUS_LABELS[task.status]} to In review${via}: ${source}`,
    changes: [{ field: 'status', from: task.status, to: 'in_review' }],
  });
  await recordAudit(rc, {
    action: 'task.status_changed_by_git',
    entityType: 'task',
    entityId: task._id,
    summary: `${providerLabel()} moved ${task.key} to In review (${source})`,
    before: { status: task.status },
    after: { status: 'in_review' },
  });
  await notify([task.assigneeId, task.reporterId, ...task.watcherIds], {
    type: 'task_status',
    title: `${task.key} moved to In review by ${providerLabel()}`,
    body: source,
    link: `/my-tasks?task=${task._id.toString()}`,
  });
  eventBus.publish(
    'task.status_changed',
    { taskId: task._id.toString(), from: task.status, to: 'in_review' },
    { requestId },
  );
  return true;
}

/** Finds tasks by key (or by a key they had before moving projects), skipping archived projects. */
async function tasksByKey(keys: string[]): Promise<Map<string, ITask>> {
  if (!keys.length) return new Map();
  const tasks = await Task.find({
    $or: [{ key: { $in: keys } }, { previousKeys: { $in: keys } }],
    deletedAt: null,
  }).lean();
  const archived = new Set(
    (
      await Project.find({ _id: { $in: tasks.map((t) => t.projectId) }, archived: true })
        .select('_id')
        .lean()
    ).map((p) => p._id.toString()),
  );
  const out = new Map<string, ITask>();
  for (const t of tasks) {
    if (archived.has(t.projectId.toString())) continue;
    for (const k of [t.key, ...(t.previousKeys ?? [])])
      if (keys.includes(k) && !out.has(k)) out.set(k, t);
  }
  return out;
}

interface LinkFields {
  kind: 'commit' | 'pull_request';
  repo: string;
  ref: string;
  title: string;
  url: string;
  author: string;
  branch: string | null;
  state?: 'open' | 'merged' | 'closed';
  occurredAt: Date;
}

async function upsertLink(task: ITask, link: LinkFields): Promise<boolean> {
  const res = await GitLink.updateOne(
    { provider: provider(), kind: link.kind, repo: link.repo, ref: link.ref, taskId: task._id },
    {
      $set: { ...link, projectId: task.projectId },
      $setOnInsert: { provider: provider(), taskId: task._id, movedTask: false },
    },
    { upsert: true },
  );
  if (res.upsertedCount) {
    await recordActivity(systemRc(), {
      projectId: task.projectId,
      entityType: 'task',
      entityId: task._id,
      entityLabel: `${task.key} ${task.title}`,
      verb: 'git_linked',
      summary: `${providerLabel()} ${link.kind === 'commit' ? `commit ${link.ref.slice(0, 7)}` : `pull request ${link.ref}`} mentions ${task.key}`,
    });
  }
  return res.upsertedCount > 0;
}

async function markMoved(
  kind: 'commit' | 'pull_request',
  repo: string,
  ref: string,
  taskId: Types.ObjectId,
) {
  await GitLink.updateOne(
    { provider: provider(), kind, repo, ref, taskId },
    { $set: { movedTask: true } },
  );
}

/** Processes one verified webhook delivery. Redeliveries are recognised and ignored. */
export async function handleGithubEvent(
  event: string,
  deliveryId: string,
  payload: unknown,
  requestId?: string,
): Promise<WebhookResult> {
  const body = (payload ?? {}) as PushPayload & PullRequestPayload;
  const repo = (body.repository?.full_name ?? '').toLowerCase();
  try {
    await GitDelivery.create({ deliveryId, event, repo });
  } catch (err) {
    if ((err as { code?: number }).code === 11000)
      return { outcome: 'duplicate', linked: 0, moved: [] };
    throw err;
  }
  const finish = async (r: WebhookResult) => {
    await GitDelivery.updateOne({ deliveryId }, { $set: { outcome: r.outcome } });
    return r;
  };
  if (event === 'ping') return finish({ outcome: 'ping', linked: 0, moved: [] });
  const cfg = await settings();
  if (!cfg.enabled)
    return finish({ outcome: 'ignored: integration switched off', linked: 0, moved: [] });
  if (!repo || !cfg.repos.includes(repo))
    return finish({ outcome: 'ignored: repository not allowed', linked: 0, moved: [] });

  let linked = 0;
  const moved: string[] = [];

  if (event === 'push') {
    const branch = body.ref?.startsWith('refs/heads/') ? body.ref.slice(11) : null;
    for (const c of (body.commits ?? []).slice(0, 100)) {
      const refs = parseGitReferences(c.message);
      const tasks = await tasksByKey(refs.keys);
      const firstLine = c.message.split('\n')[0]!.slice(0, 300) || c.id.slice(0, 7);
      for (const [key, task] of tasks) {
        if (
          await upsertLink(task, {
            kind: 'commit',
            repo,
            ref: c.id,
            title: firstLine,
            url: c.url,
            author: (c.author?.username ?? c.author?.name ?? '').slice(0, 120),
            branch,
            occurredAt: c.timestamp ? new Date(c.timestamp) : new Date(),
          })
        )
          linked++;
        if (cfg.moveOnFix && refs.fixes.includes(key)) {
          const fresh = await Task.findById(task._id).lean();
          if (
            fresh &&
            (await moveToReview(fresh, `commit ${c.id.slice(0, 7)} "${firstLine}"`, requestId))
          ) {
            moved.push(fresh.key);
            await markMoved('commit', repo, c.id, task._id);
          }
        }
      }
    }
    return finish({ outcome: `push: ${linked} link(s), ${moved.length} moved`, linked, moved });
  }

  if (event === 'pull_request' && body.pull_request) {
    const pr = body.pull_request;
    const refs = parseGitReferences(pr.title, pr.body, pr.head?.ref);
    const tasks = await tasksByKey(refs.keys);
    const state = pr.merged ? 'merged' : pr.state;
    const ref = `#${pr.number}`;
    for (const [key, task] of tasks) {
      if (
        await upsertLink(task, {
          kind: 'pull_request',
          repo,
          ref,
          title: pr.title.slice(0, 300),
          url: pr.html_url,
          author: (pr.user?.login ?? '').slice(0, 120),
          branch: pr.head?.ref ?? null,
          state,
          occurredAt: pr.updated_at ? new Date(pr.updated_at) : new Date(),
        })
      )
        linked++;
      // A closed-without-merge pull request does not move anything.
      if (cfg.moveOnFix && refs.fixes.includes(key) && state !== 'closed') {
        const fresh = await Task.findById(task._id).lean();
        if (
          fresh &&
          (await moveToReview(fresh, `pull request ${ref} "${pr.title.slice(0, 120)}"`, requestId))
        ) {
          moved.push(fresh.key);
          await markMoved('pull_request', repo, ref, task._id);
        }
      }
    }
    return finish({
      outcome: `pull_request ${body.action ?? ''}: ${linked} link(s), ${moved.length} moved`,
      linked,
      moved,
    });
  }

  logger.debug({ event }, 'GitHub event ignored');
  return finish({ outcome: `ignored: ${event} events are not used`, linked: 0, moved: [] });
}

/* ---------- GitLab and Bitbucket ---------- */

/** GitLab sends the shared secret as-is in X-Gitlab-Token. */
export function verifyGitlabToken(token: string | undefined): void {
  const secret = env.GITLAB_WEBHOOK_SECRET;
  if (!secret)
    throw new ServiceUnavailableError('The GitLab integration is not configured on this server');
  const a = Buffer.from(token ?? '');
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new UnauthenticatedError('Invalid webhook token');
}

/** Bitbucket signs the body with HMAC-SHA256 (X-Hub-Signature: sha256=…). */
export function verifyBitbucketSignature(rawBody: Buffer, signature: string | undefined): void {
  const secret = env.BITBUCKET_WEBHOOK_SECRET;
  if (!secret)
    throw new ServiceUnavailableError('The Bitbucket integration is not configured on this server');
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(signature ?? '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new UnauthenticatedError('Invalid webhook signature');
}

type Normalised = { event: string; payload: PushPayload & PullRequestPayload };

interface GitlabPayload {
  object_kind?: string;
  ref?: string;
  project?: { path_with_namespace?: string };
  commits?: {
    id: string;
    message: string;
    url: string;
    timestamp?: string;
    author?: { name?: string };
  }[];
  user?: { username?: string };
  object_attributes?: {
    iid: number;
    title: string;
    description?: string | null;
    url: string;
    state: string;
    action?: string;
    source_branch?: string;
    updated_at?: string;
  };
}

export function fromGitlab(header: string, raw: unknown): Normalised {
  const b = (raw ?? {}) as GitlabPayload;
  const repository = { full_name: b.project?.path_with_namespace };
  if (header === 'Push Hook' || b.object_kind === 'push')
    return {
      event: 'push',
      payload: {
        ref: b.ref,
        repository,
        commits: (b.commits ?? []).map((c) => ({ ...c, author: { name: c.author?.name } })),
      },
    };
  if (
    (header === 'Merge Request Hook' || b.object_kind === 'merge_request') &&
    b.object_attributes
  ) {
    const mr = b.object_attributes;
    return {
      event: 'pull_request',
      payload: {
        action: mr.action,
        repository,
        pull_request: {
          number: mr.iid,
          title: mr.title,
          body: mr.description ?? null,
          html_url: mr.url,
          state: mr.state === 'opened' ? 'open' : 'closed',
          merged: mr.state === 'merged',
          updated_at: mr.updated_at,
          user: { login: b.user?.username },
          head: { ref: mr.source_branch },
        },
      },
    };
  }
  return {
    event: header === 'System Hook' ? 'ping' : header || 'unknown',
    payload: { repository },
  };
}

interface BitbucketPayload {
  repository?: { full_name?: string };
  push?: {
    changes?: {
      new?: { name?: string; type?: string } | null;
      commits?: {
        hash: string;
        message: string;
        date?: string;
        links?: { html?: { href?: string } };
        author?: { raw?: string; user?: { display_name?: string } };
      }[];
    }[];
  };
  pullrequest?: {
    id: number;
    title: string;
    description?: string | null;
    state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
    updated_on?: string;
    links?: { html?: { href?: string } };
    author?: { display_name?: string; nickname?: string };
    source?: { branch?: { name?: string } };
  };
}

export function fromBitbucket(eventKey: string, raw: unknown): Normalised {
  const b = (raw ?? {}) as BitbucketPayload;
  const repository = { full_name: b.repository?.full_name };
  if (eventKey === 'repo:push') {
    const commits = (b.push?.changes ?? []).flatMap((ch) =>
      (ch.commits ?? []).map((c) => ({
        id: c.hash,
        message: c.message,
        url: c.links?.html?.href ?? '',
        timestamp: c.date,
        author: { name: c.author?.user?.display_name ?? c.author?.raw?.replace(/\s*<.*>$/, '') },
      })),
    );
    const branch = b.push?.changes?.find((ch) => ch.new?.type === 'branch')?.new?.name;
    return {
      event: 'push',
      payload: { ref: branch ? `refs/heads/${branch}` : undefined, repository, commits },
    };
  }
  if (eventKey.startsWith('pullrequest:') && b.pullrequest) {
    const pr = b.pullrequest;
    return {
      event: 'pull_request',
      payload: {
        action: eventKey.slice('pullrequest:'.length),
        repository,
        pull_request: {
          number: pr.id,
          title: pr.title,
          body: pr.description ?? null,
          html_url: pr.links?.html?.href ?? '',
          state: pr.state === 'OPEN' ? 'open' : 'closed',
          merged: pr.state === 'MERGED',
          updated_at: pr.updated_on,
          user: { login: pr.author?.nickname ?? pr.author?.display_name },
          head: { ref: pr.source?.branch?.name },
        },
      },
    };
  }
  return {
    event: eventKey === 'diagnostics:ping' ? 'ping' : eventKey || 'unknown',
    payload: { repository },
  };
}

/** Processes a GitLab or Bitbucket delivery with the same rules as GitHub. */
export function handleProviderEvent(
  p: GitProvider,
  n: Normalised,
  deliveryId: string,
  requestId?: string,
): Promise<WebhookResult> {
  return providerScope.run(p, () =>
    handleGithubEvent(n.event, `${p}:${deliveryId}`, n.payload, requestId),
  );
}
