import { normaliseTransitionName, type SmartCommand, type SmartCommitLine } from '@arihant/shared';
import { logger } from '../../config/logger';
import { AppError, UnprocessableError } from '../../core/errors';
import { loadAuthContext, type RequestContext } from '../../core/rbac/context';
import { orgToday, toOrgDate } from '../../core/time';
import { addComment } from '../collab/comment.service';
import { notify } from '../notifications/notification.service';
import { loadTask, updateTask } from '../tasks/task.service';
import type { ITask } from '../tasks/task.model';
import { createWorklog } from '../tracking/worklog.service';
import { User } from '../users/user.model';
import { availableTransitions } from '../workflows/workflow.service';

/*
 * Smart commits, modelled on Jira: commands in a commit message are carried out as the person
 * whose commit e-mail address matches exactly one active account, with that person's own
 * permissions and the project's workflow rules. A commit is processed once per task, however
 * many branches it is pushed to. Commands that cannot be carried out are reported to the
 * committer (Jira e-mails them; here they get a notification, e-mailed by default).
 */

export interface Committer {
  email: string | null;
  name: string;
}

export interface SmartCommitContext {
  providerLabel: string;
  requestId?: string;
  commit: { sha: string; firstLine: string; at: Date };
}

/** The account a commit belongs to, or null (unknown, ambiguous or inactive). */
export async function resolveCommitter(c: Committer): Promise<RequestContext['auth']> {
  const email = c.email?.trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  const users = await User.find({ email, status: 'active' }).select('_id tokenVersion').limit(2);
  if (users.length !== 1) return null;
  try {
    return await loadAuthContext(users[0]!._id.toString(), users[0]!.tokenVersion);
  } catch {
    return null;
  }
}

export const formatMinutes = (m: number) => {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return [h ? `${h}h` : '', min ? `${min}m` : ''].filter(Boolean).join(' ') || '0m';
};

const messageOf = (err: unknown) =>
  err instanceof AppError
    ? err.message
    : err && typeof err === 'object' && 'issues' in err
      ? ((err as { issues: { message: string }[] }).issues[0]?.message ?? 'Invalid input')
      : 'Unexpected error';

/** Runs one command on one task. Returns what was done; throws a readable error otherwise. */
async function runCommand(
  rc: RequestContext,
  task: ITask,
  cmd: SmartCommand,
  ctx: SmartCommitContext,
): Promise<string> {
  const id = task._id.toString();
  const short = ctx.commit.sha.slice(0, 7);
  if (cmd.kind === 'comment') {
    await addComment(rc, id, { body: cmd.text });
    return 'Comment added';
  }
  if (cmd.kind === 'time') {
    const day = toOrgDate(ctx.commit.at);
    await createWorklog(rc, {
      date: day > orgToday() ? orgToday() : day,
      projectId: task.projectId.toString(),
      taskId: id,
      description: (cmd.text || `Commit ${short}: ${ctx.commit.firstLine}`).slice(0, 2000),
      category: 'development',
      minutes: cmd.minutes,
    });
    return `Logged ${formatMinutes(cmd.minutes)}`;
  }

  // Transition: by transition name or by the name of the status it leads to.
  const { task: fresh, project } = await loadTask(rc.auth!, id);
  const offered = await availableTransitions(rc.auth!, fresh, project);
  const wanted = normaliseTransitionName(cmd.name);
  const words = (s: string) => normaliseTransitionName(s).split(' ');
  const exact = offered.transitions.filter(
    (t) =>
      normaliseTransitionName(t.name) === wanted || normaliseTransitionName(t.toLabel) === wanted,
  );
  // Like Jira, the start of a name is enough ("#start" for "Start progress") when it is unambiguous.
  const matches = exact.length
    ? exact
    : offered.transitions.filter((t) =>
        [t.name, t.toLabel].some((n) => {
          const w = words(n);
          const q = wanted.split(' ');
          return q.every((part, i) => w[i] === part);
        }),
      );
  const targets = [...new Set(matches.map((t) => t.to))];
  if (!targets.length) {
    const names = offered.transitions.map(
      (t) => `#${t.toLabel.toLowerCase().replace(/\s+/g, '-')}`,
    );
    throw new UnprocessableError(
      `"#${cmd.name}" is not a move ${task.key} can make from ${offered.workflow.labels[fresh.status] ?? fresh.status.replace('_', ' ')}` +
        (names.length ? `. Possible: ${names.join(', ')}` : ''),
    );
  }
  if (targets.length > 1)
    throw new UnprocessableError(`"#${cmd.name}" matches more than one move; write the full name`);
  const usable = matches.filter((t) => t.to === targets[0] && !t.blockers.length);
  if (!usable.length) throw new UnprocessableError(matches[0]!.blockers.join('; '));
  const t = usable[0]!;
  const done = await updateTask(
    rc,
    id,
    { status: t.to, ...(cmd.text ? { transitionComment: cmd.text } : {}) },
    { via: 'git' },
  );
  return done.status === t.to
    ? `Moved to ${t.toLabel}`
    : `Asked for approval to move to ${t.toLabel}`;
}

/**
 * Carries out the smart-commit lines that mention this task. Returns the actions done; failures
 * are sent to the committer.
 */
export async function runSmartCommit(
  auth: NonNullable<RequestContext['auth']>,
  task: ITask,
  lines: SmartCommitLine[],
  ctx: SmartCommitContext,
): Promise<string[]> {
  const rc: RequestContext = {
    auth,
    requestId: ctx.requestId,
    userAgent: `${ctx.providerLabel} smart commit ${ctx.commit.sha.slice(0, 7)}`,
  };
  const done: string[] = [];
  const failed: string[] = [];
  for (const line of lines) {
    if (
      !line.keys.includes(task.key) &&
      !(task.previousKeys ?? []).some((k) => line.keys.includes(k))
    )
      continue;
    for (const cmd of line.commands) {
      const label = cmd.kind === 'transition' ? `#${cmd.name}` : `#${cmd.kind}`;
      try {
        done.push(await runCommand(rc, task, cmd, ctx));
      } catch (err) {
        const msg = messageOf(err);
        failed.push(`${label}: ${msg}`);
        logger.info({ task: task.key, command: label, err: msg }, 'Smart commit command failed');
      }
    }
  }
  if (failed.length) {
    await notify([auth.userId], {
      type: 'smart_commit',
      title: `Commit ${ctx.commit.sha.slice(0, 7)}: ${failed.length} command(s) on ${task.key} not carried out`,
      body: failed.join('\n'),
      link: `/tasks/mine?task=${task._id.toString()}`,
    });
  }
  return done;
}
