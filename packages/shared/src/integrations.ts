import { z } from 'zod';

/* ============================================================================
 * Git integration (GitHub): commits and pull requests that mention task keys.
 * ========================================================================= */

/** Task keys look like TRD-42: 2–6 capitals/digits starting with a letter, then a number. */
const KEY = '[A-Z][A-Z0-9]{1,5}-\\d{1,7}';
const KEY_RE = new RegExp(`(?<![A-Za-z0-9-])(${KEY})(?![A-Za-z0-9])`, 'g');
/** "fixes TRD-1", "Closes: TRD-1, TRD-2 and TRD-3", "resolved TRD-9". */
const FIX_RE = new RegExp(
  `\\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\\b\\s*:?\\s*((?:${KEY})(?:\\s*(?:,|and|&)\\s*(?:${KEY}))*)`,
  'gi',
);

export interface GitReferences {
  /** Every task key mentioned (in order of first appearance). */
  keys: string[];
  /** Keys preceded by fix / close / resolve keywords. */
  fixes: string[];
}

/** Finds task keys and "fixes KEY" commands in a commit message, PR title/body or branch name. */
export function parseGitReferences(...texts: (string | null | undefined)[]): GitReferences {
  const keys: string[] = [];
  const fixes: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(KEY_RE)) if (!keys.includes(m[1]!)) keys.push(m[1]!);
    for (const m of text.matchAll(FIX_RE)) {
      for (const k of m[1]!.matchAll(KEY_RE)) {
        const key = k[1]!.toUpperCase();
        if (!fixes.includes(key)) fixes.push(key);
      }
    }
  }
  return { keys, fixes: fixes.filter((f) => keys.includes(f)) };
}

/* ---------- Smart commits (same grammar as Jira) ---------- */

/*
 * "TRD-42 #comment Fixed the timeout #time 1h 30m #in-review"
 *
 * - Task keys and commands on the same line belong together; a command never spans lines.
 * - Several keys on a line all get the line's commands ("TRD-1 TRD-2 #done").
 * - #comment <text> adds a comment, #time <1w 2d 4h 30m> [text] logs work, and any other
 *   #word runs the workflow transition with that name (hyphens stand for spaces, e.g.
 *   #start-progress) or into the status with that name (#in-review); text after it becomes the
 *   transition comment.
 * - "#TRD-42" is a key, not a command.
 */

export type SmartCommand =
  | { kind: 'comment'; text: string }
  | { kind: 'time'; minutes: number; text: string }
  | { kind: 'transition'; name: string; text: string };

export interface SmartCommitLine {
  keys: string[];
  commands: SmartCommand[];
}

/** Durations in #time: a day is 8 hours and a week 5 days (Jira's defaults). */
const UNIT_MINUTES = { w: 5 * 8 * 60, d: 8 * 60, h: 60, m: 1 } as const;
const DURATION_RE = /^\s*(\d+(?:\.\d+)?)\s*([wdhm])(?![a-z])/i;
const COMMAND_RE = /(?<![^\s(,;])#([A-Za-z][A-Za-z0-9_-]{0,59})(?![A-Za-z0-9_-])/g;
const KEY_ONLY_RE = new RegExp(`^${KEY}$`);

/** Splits a commit message into smart-commit lines. Lines without both a key and a command are left out. */
export function parseSmartCommits(message: string | null | undefined): SmartCommitLine[] {
  const out: SmartCommitLine[] = [];
  for (const line of (message ?? '').split(/\r?\n/)) {
    const tokens = [...line.matchAll(COMMAND_RE)].filter((m) => !KEY_ONLY_RE.test(m[1]!));
    if (!tokens.length) continue;
    const keys = [...line.matchAll(KEY_RE)]
      .map((m) => m[1]!)
      .filter((k, i, a) => a.indexOf(k) === i);
    if (!keys.length) continue;
    const commands: SmartCommand[] = [];
    tokens.forEach((m, i) => {
      const end = i + 1 < tokens.length ? tokens[i + 1]!.index : line.length;
      let args = line.slice(m.index + m[0].length, end).trim();
      const name = m[1]!.toLowerCase();
      if (name === 'comment') {
        if (args) commands.push({ kind: 'comment', text: args });
        return;
      }
      if (name === 'time') {
        let minutes = 0;
        for (let d = DURATION_RE.exec(args); d; d = DURATION_RE.exec(args)) {
          minutes += Number(d[1]) * UNIT_MINUTES[d[2]!.toLowerCase() as keyof typeof UNIT_MINUTES];
          args = args.slice(d[0].length);
        }
        if (minutes > 0)
          commands.push({ kind: 'time', minutes: Math.round(minutes), text: args.trim() });
        return;
      }
      commands.push({ kind: 'transition', name, text: args });
    });
    if (commands.length) out.push({ keys, commands });
  }
  return out;
}

/** "start-progress", "Start progress" and "start_progress" compare equal. */
export const normaliseTransitionName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[-_\s]+/g, ' ')
    .trim();

/* ---------- Settings ---------- */

const repoName = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+){1,4}$/,
    'Use owner/repository, e.g. arihant/trading-platform',
  );

export const gitSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  /** Only events from these repositories are accepted (owner/name, case-insensitive). */
  repos: z.array(repoName).max(50),
  /** "fixes KEY" in a commit or pull request moves the task to In review. */
  moveOnFix: z.boolean(),
  /**
   * Smart commits: #comment, #time and #<transition> in commit messages, run as the person whose
   * commit e-mail matches their Arihant Workspace account, with that person's permissions.
   */
  smartCommits: z.boolean().default(true),
});
export type GitSettingsInput = z.infer<typeof gitSettingsSchema>;

export interface GitSettingsDto extends GitSettingsInput {
  /** True when GITHUB_WEBHOOK_SECRET is set on the API server. */
  secretConfigured: boolean;
  /** Path of the webhook on the API (prefix it with the API's public address). */
  webhookPath: string;
  lastDelivery: { at: string; event: string; repo: string; outcome: string } | null;
  canEdit: boolean;
}

/* ---------- Links on tasks ---------- */

export const GIT_LINK_KINDS = ['commit', 'pull_request'] as const;
export type GitLinkKind = (typeof GIT_LINK_KINDS)[number];

export interface GitLinkDto {
  id: string;
  kind: GitLinkKind;
  repo: string;
  /** Short SHA for commits, "#12" for pull requests. */
  ref: string;
  title: string;
  url: string;
  author: string;
  branch?: string;
  /** Pull requests: open, merged or closed. */
  state?: 'open' | 'merged' | 'closed';
  /** The task was moved by this event ("fixes"). */
  movedTask: boolean;
  /** Smart-commit commands carried out on this task, e.g. "Comment added", "Logged 1h 30m". */
  actions: string[];
  at: string;
}
