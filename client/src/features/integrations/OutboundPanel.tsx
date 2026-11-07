import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  HOOK_EVENTS,
  HOOK_EVENT_LABELS,
  HOOK_KINDS,
  HOOK_KIND_LABELS,
  type HookEvent,
  type HookKind,
  type OutboundHookDto,
} from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ErrorState } from '@/components/common/ErrorState';
import { FormField } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjects } from '@/features/work/hooks';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import * as ob from '@/services/api/outbound';

const KEY = ['integrations', 'outgoing'] as const;
const onError = (e: unknown) => toast.error(errorMessage(e));

const HINT: Record<HookKind, string> = {
  webhook:
    'Any receiver: Zapier "Catch Hook", Power Automate, Jenkins, Azure DevOps or your own service. Requests are signed (X-Arihant-Signature: sha256=HMAC of the body).',
  slack: 'In Slack: Apps → Incoming Webhooks → Add to a channel, and paste the webhook URL.',
  teams:
    'In Teams: the channel’s ⋯ → Workflows → "Post to a channel when a webhook request is received", and paste the URL.',
};

function SecretNotice({ secret, onClose }: { secret: string; onClose: () => void }) {
  return (
    <div
      role="status"
      className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
    >
      <p>Signing secret (shown once): give it to the receiver to check X-Arihant-Signature.</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">
          {secret}
        </code>
        <Button
          size="sm"
          variant="outline"
          aria-label="Copy secret"
          onClick={() =>
            void navigator.clipboard?.writeText(secret).then(() => toast.success('Copied'))
          }
        >
          <Copy />
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function AddDialog({ onClose, onSecret }: { onClose: () => void; onSecret: (s: string) => void }) {
  const qc = useQueryClient();
  const projects = useProjects({ limit: 100, sort: 'name' });
  const [kind, setKind] = useState<HookKind>('slack');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<HookEvent[]>(['task.created', 'task.status_changed']);
  const [projectId, setProjectId] = useState('all');
  const save = useMutation({
    mutationFn: () =>
      ob.createHook({
        name: name.trim(),
        kind,
        url: url.trim(),
        events,
        projectIds: projectId === 'all' ? [] : [projectId],
      }),
    onSuccess: async (h) => {
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success(`Added ${h.name}`);
      if (h.secret) onSecret(h.secret);
      onClose();
    },
    onError,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add outgoing integration</DialogTitle>
          <DialogDescription>{HINT[kind]}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={kind} onValueChange={(v) => setKind(v as HookKind)}>
            <SelectTrigger aria-label="Type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOOK_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {HOOK_KIND_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormField label="Name">
            <Input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Address (URL)">
            <Input value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
          </FormField>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Events</legend>
            <div className="flex flex-wrap gap-1.5">
              {HOOK_EVENTS.map((ev) => {
                const on = events.includes(ev);
                return (
                  <button
                    key={ev}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setEvents((xs) => (on ? xs.filter((x) => x !== ev) : [...xs, ev]))
                    }
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-xs',
                      on
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {HOOK_EVENT_LABELS[ev]}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger aria-label="Projects">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects.data?.items.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  Only {p.key} · {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Restricted tasks and confidential projects are never sent.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              !name.trim() || !/^https?:\/\//.test(url.trim()) || !events.length || save.isPending
            }
            onClick={() => save.mutate()}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HookRow({ h }: { h: OutboundHookDto }) {
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const toggle = useMutation({
    mutationFn: (active: boolean) => ob.updateHook(h.id, { active }),
    onSuccess: refresh,
    onError,
  });
  const test = useMutation({
    mutationFn: () => ob.testHook(h.id),
    onSuccess: async (d) => {
      await refresh();
      if (d.status === 'delivered') toast.success('Test message delivered');
      else toast.error(`Test failed: ${d.error ?? d.status}`);
    },
    onError,
  });
  const log = useQuery({
    queryKey: [...KEY, h.id, 'log'],
    queryFn: () => ob.fetchDeliveries(h.id),
    enabled: showLog,
  });
  return (
    <li className="space-y-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {h.name}{' '}
            <span className="text-xs font-normal text-muted-foreground">
              · {HOOK_KIND_LABELS[h.kind]}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {h.urlPreview} · {h.events.map((e) => HOOK_EVENT_LABELS[e]).join(', ')}
            {h.projects.length ? ` · only ${h.projects.map((p) => p.key).join(', ')}` : ''}
          </p>
          {h.disabledReason ? <p className="text-xs text-destructive">{h.disabledReason}</p> : null}
          {h.lastDelivery ? (
            <p className="text-xs text-muted-foreground">
              Last: {new Date(h.lastDelivery.at).toLocaleString('en-IN')} · {h.lastDelivery.status}
              {h.lastDelivery.httpStatus ? ` (${h.lastDelivery.httpStatus})` : ''}
            </p>
          ) : null}
        </div>
        <label className="flex items-center gap-1 text-xs">
          <Checkbox
            checked={h.active}
            onCheckedChange={(c) => toggle.mutate(c === true)}
            aria-label={`${h.name} active`}
          />
          Active
        </label>
        <Button size="sm" variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
          <Send /> Test
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowLog((v) => !v)}>
          {showLog ? 'Hide log' : 'Log'}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={`Delete ${h.name}`}
          onClick={() => setDeleting(true)}
        >
          <Trash2 />
        </Button>
      </div>
      {showLog ? (
        <table className="w-full text-xs">
          <tbody>
            {(log.data ?? []).map((d) => (
              <tr key={d.id} className="border-t">
                <td className="py-1">{new Date(d.createdAt).toLocaleString('en-IN')}</td>
                <td>{d.event}</td>
                <td className={d.status === 'failed' ? 'text-destructive' : ''}>
                  {d.status}
                  {d.attempts > 1 ? ` (${d.attempts} tries)` : ''}
                </td>
                <td>{d.httpStatus ?? d.error ?? ''}</td>
              </tr>
            ))}
            {log.data && !log.data.length ? (
              <tr>
                <td className="py-1 text-muted-foreground">Nothing sent yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Remove ${h.name}?`}
        description="Nothing more is sent to this address. Its delivery log is deleted."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          await ob.deleteHook(h.id);
          await refresh();
        }}
      />
    </li>
  );
}

/** Administration: outgoing webhooks and Slack / Teams channels. */
export function OutboundPanel() {
  const q = useQuery({ queryKey: KEY, queryFn: ob.fetchHooks });
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Outgoing integrations">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Outgoing integrations</h2>
          <p className="text-xs text-muted-foreground">
            Send task and project events to Slack, Microsoft Teams or any webhook receiver. Failed
            deliveries are retried (1, 5, 30 and 120 minutes); ten failures in a row switch the
            destination off.
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus /> Add
        </Button>
      </div>
      {secret ? <SecretNotice secret={secret} onClose={() => setSecret(null)} /> : null}
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-24" />
      ) : q.data.length ? (
        <ul className="divide-y rounded-lg border text-sm">
          {q.data.map((h) => (
            <HookRow key={h.id} h={h} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">None yet.</p>
      )}
      {adding ? <AddDialog onClose={() => setAdding(false)} onSecret={setSecret} /> : null}
    </section>
  );
}
