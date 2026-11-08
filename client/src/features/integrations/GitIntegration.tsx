import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, GitCommitHorizontal, GitMerge, GitPullRequest, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { GitLinkDto, GitSettingsDto } from '@arihant/shared';
import { ErrorState } from '@/components/common/ErrorState';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';
import * as gitApi from '@/services/api/integrations';

const KEY = ['integrations', 'github'] as const;

function Editor({ data }: { data: GitSettingsDto }) {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(data.enabled);
  const [moveOnFix, setMoveOnFix] = useState(data.moveOnFix);
  const [smartCommits, setSmartCommits] = useState(data.smartCommits);
  const [repos, setRepos] = useState(data.repos);
  const [draft, setDraft] = useState('');
  const save = useMutation({
    mutationFn: () => gitApi.saveGitSettings({ enabled, moveOnFix, smartCommits, repos }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success('GitHub integration saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const url = `${window.location.origin}${data.webhookPath}`;
  // owner/repository, or GitLab group/subgroup/repository
  const validRepo = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+){1,4}$/.test(draft.trim());
  const edit = data.canEdit;
  return (
    <div className="space-y-4">
      {!data.secretConfigured ? (
        <p role="status" className="rounded-lg border border-dashed p-3 text-sm">
          Not configured on the server: set <code className="font-mono">GITHUB_WEBHOOK_SECRET</code>{' '}
          (16+ characters) on the API and use the same value as the webhook secret in GitHub. Until
          then every delivery is refused.
        </p>
      ) : null}
      <div className="space-y-1 text-sm">
        <p className="font-medium">Webhook address</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">
            {url}
          </code>
          <Button
            size="sm"
            variant="outline"
            aria-label="Copy webhook address"
            onClick={() =>
              void navigator.clipboard?.writeText(url).then(() => toast.success('Copied'))
            }
          >
            <Copy />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          In GitHub: repository Settings → Webhooks → Add webhook. Content type{' '}
          <strong>application/json</strong>, the shared secret, and the events{' '}
          <strong>Pushes</strong> and <strong>Pull requests</strong>. GitHub must be able to reach
          this address (the deployed app, not a laptop). GitLab and Bitbucket use{' '}
          <code className="font-mono">…/integrations/gitlab/webhook</code> (secret token{' '}
          <code className="font-mono">GITLAB_WEBHOOK_SECRET</code>; Push and Merge request events)
          and <code className="font-mono">…/integrations/bitbucket/webhook</code> (secret{' '}
          <code className="font-mono">BITBUCKET_WEBHOOK_SECRET</code>; Repository push and Pull
          request events), with the same repository list.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={enabled}
          disabled={!edit}
          onCheckedChange={(c) => setEnabled(c === true)}
        />
        Link commits and pull requests that mention a task key (for example TRD-42)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={moveOnFix}
          disabled={!edit}
          onCheckedChange={(c) => setMoveOnFix(c === true)}
        />
        Move the task to <strong>In review</strong> when a commit or pull request says &quot;fixes
        TRD-42&quot; (also closes / resolves)
      </label>
      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={smartCommits}
            disabled={!edit}
            onCheckedChange={(c) => setSmartCommits(c === true)}
          />
          Smart commits: carry out <code className="font-mono">#comment</code>,{' '}
          <code className="font-mono">#time</code> and status commands in commit messages
        </label>
        <p className="pl-6 text-xs text-muted-foreground">
          Example:{' '}
          <code className="font-mono">
            TRD-42 #comment Fixed the timeout #time 1h 30m #in-review
          </code>
          . A status command is the name of a workflow move or of the status it leads to, with
          hyphens for spaces (<code className="font-mono">#in-progress</code>,{' '}
          <code className="font-mono">#testing</code>, <code className="font-mono">#done</code>).
          Commands run as the person whose commit e-mail address (git config user.email) matches
          their account, with that person&apos;s permissions; anything that cannot be done is sent
          to them as a notification. Each commit is carried out once, even when pushed to several
          branches.
        </p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Repositories accepted</p>
        <ul className="flex flex-wrap gap-1.5">
          {repos.map((r) => (
            <li
              key={r}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs"
            >
              {r}
              {edit ? (
                <button
                  type="button"
                  aria-label={`Remove ${r}`}
                  onClick={() => setRepos((xs) => xs.filter((x) => x !== r))}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </li>
          ))}
          {!repos.length ? (
            <li className="text-xs text-muted-foreground">None: all deliveries are ignored.</li>
          ) : null}
        </ul>
        {edit ? (
          <div className="flex max-w-md gap-2">
            <Input
              className="h-8"
              placeholder="owner/repository"
              aria-label="Repository"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!validRepo || repos.includes(draft.trim().toLowerCase())}
              onClick={() => {
                setRepos((xs) => [...xs, draft.trim().toLowerCase()]);
                setDraft('');
              }}
            >
              <Plus /> Add
            </Button>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {data.lastDelivery
          ? `Last delivery ${new Date(data.lastDelivery.at).toLocaleString('en-IN')}: ${data.lastDelivery.event} from ${data.lastDelivery.repo || 'unknown repository'} (${data.lastDelivery.outcome}).`
          : 'No deliveries received yet.'}
      </p>
      {edit ? (
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          Save GitHub settings
        </Button>
      ) : null}
    </div>
  );
}

/** Administration: GitHub webhook settings. */
export function GitIntegrationPanel() {
  const q = useQuery({ queryKey: KEY, queryFn: gitApi.fetchGitSettings });
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="GitHub integration">
      <div>
        <h2 className="text-sm font-semibold">GitHub integration</h2>
        <p className="text-xs text-muted-foreground">
          Show commits and pull requests on the tasks they mention.
        </p>
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <Editor key={JSON.stringify(q.data)} data={q.data} />
      ) : (
        <Skeleton className="h-40" />
      )}
    </section>
  );
}

const ICON = { commit: GitCommitHorizontal, pull_request: GitPullRequest } as const;

function LinkRow({ l }: { l: GitLinkDto }) {
  const Icon = l.state === 'merged' ? GitMerge : ICON[l.kind];
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <a
          href={l.url}
          target="_blank"
          rel="noreferrer noopener"
          className="block truncate hover:underline"
        >
          <span className="font-mono text-xs text-muted-foreground">{l.ref}</span> {l.title}
        </a>
        <p className="text-xs text-muted-foreground">
          {l.repo}
          {l.branch ? ` · ${l.branch}` : ''}
          {l.author ? ` · ${l.author}` : ''} · {new Date(l.at).toLocaleString('en-IN')}
          {l.state ? ` · ${l.state}` : ''}
          {l.movedTask ? ' · moved this task to In review' : ''}
        </p>
        {l.actions.length ? (
          <p className="text-xs text-muted-foreground">Smart commit: {l.actions.join(' · ')}</p>
        ) : null}
      </div>
    </li>
  );
}

/** Task panel: commits and pull requests that mention the task. Hidden when there are none. */
export function TaskDevelopment({ taskId }: { taskId: string }) {
  const q = useQuery({
    queryKey: ['tasks', 'git', taskId],
    queryFn: () => gitApi.fetchTaskGitLinks(taskId),
  });
  if (!q.data?.length) return null;
  return (
    <section className="space-y-2" aria-label="Development">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Development
      </h3>
      <ul className="space-y-2">
        {q.data.map((l) => (
          <LinkRow key={l.id} l={l} />
        ))}
      </ul>
    </section>
  );
}
