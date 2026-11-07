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
  at: string;
}
