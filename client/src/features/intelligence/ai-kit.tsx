import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { AiSettings } from '@arihant/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/hooks/use-permission';
import { errorMessage } from '@/lib/errors';
import * as api from '@/services/api/intelligence';

export const aiKeys = { status: ['ai', 'status'] as const };

/** AI features are shown only when switched on, configured, and allowed for this person. */
export function useAiAvailable(): boolean {
  const canUse = useCan('ai:use');
  const status = useQuery({
    queryKey: aiKeys.status,
    queryFn: api.fetchAiStatus,
    enabled: canUse,
    staleTime: 60_000,
  });
  return canUse && Boolean(status.data?.enabled && status.data.configured);
}

/** Wraps an AI call: errors become toasts; usage count refreshes. */
export function useAiCall<TVars, TResult>(fn: (v: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => void qc.invalidateQueries({ queryKey: aiKeys.status }),
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function AiBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet/10 px-2 py-0.5 text-xs font-medium text-violet">
      <Sparkles className="size-3" aria-hidden /> AI proposal
    </span>
  );
}

export function AiButton({
  busy,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { busy?: boolean }) {
  return (
    <Button variant="outline" {...props} disabled={busy || props.disabled}>
      {busy ? <Loader2 className="animate-spin" /> : <Sparkles className="text-violet" />}{' '}
      {children}
    </Button>
  );
}

/** Proposal display with the standard disclaimer. */
export function AiResultDialog({
  title,
  model,
  disclaimer,
  onClose,
  children,
}: {
  title: string;
  model: string;
  disclaimer: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {title} <AiBadge />
          </DialogTitle>
          <DialogDescription>
            {disclaimer} Model: {model}.
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function BulletList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section>
      <h4 className="text-sm font-semibold">{title}</h4>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </section>
  );
}

/* ============================ Admin settings ============================ */

export function AiSettingsPanel() {
  const canEdit = useCan('settings:manage', 'org');
  const qc = useQueryClient();
  const status = useQuery({ queryKey: aiKeys.status, queryFn: api.fetchAiStatus });
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const save = useMutation({
    mutationFn: (s: AiSettings) => api.saveAiSettings(s),
    onSuccess: (s) => {
      qc.setQueryData(aiKeys.status, s);
      setDraft(null);
      toast.success(s.enabled ? 'AI assistant enabled' : 'AI assistant disabled');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (!status.data) return <Skeleton className="h-28" />;
  const value = draft ?? {
    enabled: status.data.enabled,
    dailyLimitPerUser: status.data.dailyLimitPerUser,
  };
  return (
    <section className="space-y-3 rounded-xl border bg-card p-6" aria-label="AI assistant settings">
      <div>
        <h2 className="text-sm font-semibold">AI assistant</h2>
        <p className="text-sm text-muted-foreground">
          Uses Anthropic Claude. Only the minimum project text needed for a request is sent (no
          e-mail addresses or employee IDs), and every answer is a proposal people review before
          anything changes. Each request is recorded in the audit log.
        </p>
      </div>
      <p className="text-sm">
        Server configuration:{' '}
        {status.data.configured ? (
          <strong>ready</strong>
        ) : (
          <strong className="text-destructive">
            no API key configured (set ANTHROPIC_API_KEY on the API server)
          </strong>
        )}
      </p>
      <fieldset disabled={!canEdit} className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.enabled}
            onCheckedChange={(c) => setDraft({ ...value, enabled: c === true })}
          />
          Enable the AI assistant for this organisation
        </label>
        <label className="flex items-center gap-2 text-sm">
          Requests per person per day
          <Input
            type="number"
            min={1}
            max={1000}
            className="h-8 w-24"
            value={value.dailyLimitPerUser}
            onChange={(e) => setDraft({ ...value, dailyLimitPerUser: Number(e.target.value) })}
          />
        </label>
        {canEdit ? (
          <Button
            size="sm"
            disabled={!draft || save.isPending || value.dailyLimitPerUser < 1}
            onClick={() => draft && save.mutate(draft)}
          >
            Save AI settings
          </Button>
        ) : null}
      </fieldset>
    </section>
  );
}
