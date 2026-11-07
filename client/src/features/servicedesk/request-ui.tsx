import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Star } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  REQUEST_KIND_LABELS,
  fieldVisible,
  validateAnswers,
  type AnswerValue,
  type Priority,
  type RequestTypeDto,
  type ServiceRequestDto,
  type SlaClockDto,
} from '@arihant/shared';
import { FormField } from '@/components/common/FormField';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { ApiClientError } from '@/services/api/client';
import * as sd from '@/services/api/servicedesk';

export const deskKeys = {
  portal: ['service-desk', 'portal'] as const,
  mine: ['service-desk', 'mine'] as const,
  request: (id: string) => ['service-desk', 'request', id] as const,
  comments: (id: string) => ['service-desk', 'comments', id] as const,
};

const SLA_STYLE: Record<SlaClockDto['state'], string> = {
  running: 'bg-muted text-muted-foreground',
  at_risk: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
  breached: 'bg-destructive/15 text-destructive',
  met: 'bg-success/15 text-success',
  missed: 'bg-destructive/10 text-destructive',
};
const SLA_TEXT: Record<SlaClockDto['state'], string> = {
  running: 'due',
  at_risk: 'due soon',
  breached: 'breached',
  met: 'met',
  missed: 'missed',
};

export function SlaBadge({ label, clock }: { label: string; clock: SlaClockDto | null }) {
  if (!clock) return null;
  const when = new Date(clock.doneAt ?? clock.dueAt).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
        SLA_STYLE[clock.state],
      )}
    >
      <Clock className="size-3" aria-hidden /> {label} {SLA_TEXT[clock.state]} · {when}
    </span>
  );
}

/** The form for one request type, with conditional fields and the same checks as the server. */
export function RequestForm({
  type,
  onDone,
}: {
  type: RequestTypeDto;
  onDone: (r: ServiceRequestDto) => void;
}) {
  const qc = useQueryClient();
  const [summary, setSummary] = useState('');
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [priority, setPriority] = useState<Priority>(type.defaultPriority);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = useMutation({
    mutationFn: () =>
      sd.submitRequest({
        requestTypeId: type.id,
        summary: summary.trim(),
        answers,
        ...(type.requesterSetsPriority ? { priority } : {}),
      }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: deskKeys.mine });
      toast.success(`Request ${r.key} raised`);
      onDone(r);
    },
    onError: (e) => {
      const fields =
        e instanceof ApiClientError
          ? (e.details as { fields?: Record<string, string> })?.fields
          : undefined;
      if (fields) setErrors(fields);
      else toast.error(errorMessage(e));
    },
  });
  const set = (k: string, v: AnswerValue) => setAnswers((a) => ({ ...a, [k]: v }));
  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const check = validateAnswers(type.fields, answers);
        if (!check.ok) return setErrors(check.errors);
        setErrors({});
        if (summary.trim().length >= 3) submit.mutate();
      }}
    >
      {type.helpLinks.length ? (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="mb-1 font-medium">This might already help</p>
          <ul className="list-inside list-disc">
            {type.helpLinks.map((l) => (
              <li key={l.url}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary hover:underline"
                >
                  {l.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <FormField
        label="Summary"
        error={summary && summary.trim().length < 3 ? 'Describe it in a few words' : undefined}
      >
        <Input maxLength={200} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </FormField>
      {type.fields
        .filter((f) => fieldVisible(f, answers))
        .map((f) => (
          <div key={f.key}>
            {f.type === 'checkbox' ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={answers[f.key] === true}
                  onCheckedChange={(c) => set(f.key, c === true)}
                />
                {f.label}
                {f.required ? ' *' : ''}
              </label>
            ) : (
              <FormField
                label={`${f.label}${f.required ? ' *' : ''}`}
                error={errors[f.key]}
                hint={f.helpText}
              >
                {f.type === 'textarea' ? (
                  <Textarea
                    rows={3}
                    value={String(answers[f.key] ?? '')}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                ) : f.type === 'select' ? (
                  <Select value={String(answers[f.key] ?? '')} onValueChange={(v) => set(f.key, v)}>
                    <SelectTrigger aria-label={f.label}>
                      <SelectValue placeholder="Choose…" />
                    </SelectTrigger>
                    <SelectContent>
                      {f.options.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    value={String(answers[f.key] ?? '')}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
              </FormField>
            )}
            {f.type === 'checkbox' && errors[f.key] ? (
              <p className="text-xs text-destructive">{errors[f.key]}</p>
            ) : null}
          </div>
        ))}
      {type.requesterSetsPriority ? (
        <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
          <SelectTrigger aria-label="Urgency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Button type="submit" disabled={submit.isPending}>
        {type.approvalRequired ? 'Submit for approval' : 'Raise request'}
      </Button>
    </form>
  );
}

/** A request with its answers, SLA clocks and the conversation with the team. */
export function RequestDetail({ id, asTeam = false }: { id: string; asTeam?: boolean }) {
  const qc = useQueryClient();
  const req = useQuery({ queryKey: deskKeys.request(id), queryFn: () => sd.fetchRequest(id) });
  const comments = useQuery({
    queryKey: deskKeys.comments(id),
    queryFn: () => sd.fetchRequestComments(id),
  });
  const [body, setBody] = useState('');
  const [rating, setRating] = useState(0);
  const send = useMutation({
    mutationFn: () => sd.addRequestComment(id, body.trim()),
    onSuccess: async () => {
      setBody('');
      await qc.invalidateQueries({ queryKey: ['service-desk'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rate = useMutation({
    mutationFn: () => sd.rateRequest(id, rating),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-desk'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const r = req.data;
  if (!r) return null;
  return (
    <section aria-label={`Request ${r.key}`} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{r.key}</span>
        <h3 className="font-semibold">{r.summary}</h3>
        <StatusBadge status={r.status} label={r.statusLabel} />
      </div>
      <p className="text-xs text-muted-foreground">
        {REQUEST_KIND_LABELS[r.kind]} · {r.requestType?.name} · {PRIORITY_LABELS[r.priority]} ·{' '}
        {r.assignee ? `with ${r.assignee.name}` : 'not assigned yet'}
        {asTeam && r.requester ? ` · raised by ${r.requester.name}` : ''}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <SlaBadge label="Response" clock={r.sla.response} />
        <SlaBadge label="Resolution" clock={r.sla.resolution} />
        {r.awaitingApproval ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-200">
            Waiting for approval
          </span>
        ) : null}
      </div>
      {r.answers.length ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {r.answers.map((a) => (
            <div key={a.key} className="contents">
              <dt className="text-muted-foreground">{a.label}</dt>
              <dd>
                {a.value === null
                  ? '—'
                  : typeof a.value === 'boolean'
                    ? a.value
                      ? 'Yes'
                      : 'No'
                    : String(a.value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <ol className="space-y-2" aria-label="Conversation">
        {(comments.data ?? []).map((c) => (
          <li
            key={c.id}
            className={cn('rounded-lg px-3 py-2 text-sm', c.fromTeam ? 'bg-primary/5' : 'bg-muted')}
          >
            <p className="text-xs text-muted-foreground">
              {c.author?.name ?? 'Someone'}
              {c.fromTeam ? ' (team)' : ''} · {new Date(c.createdAt).toLocaleString('en-IN')}
            </p>
            <p className="whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
      </ol>
      {r.status !== 'done' && r.status !== 'cancelled' ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) send.mutate();
          }}
        >
          <Textarea
            aria-label={asTeam ? 'Reply to the requester' : 'Add a message'}
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={!body.trim() || send.isPending}>
            {asTeam ? 'Reply to requester' : 'Send'}
          </Button>
          {asTeam ? (
            <p className="text-xs text-muted-foreground">
              Replies are visible to the requester. Comments in the task panel stay internal.
            </p>
          ) : null}
        </form>
      ) : null}
      {!asTeam && r.status === 'done' ? (
        r.feedback ? (
          <p className="text-sm">You rated this {r.feedback.rating} / 5. Thank you.</p>
        ) : (
          <div className="flex items-center gap-2" role="group" aria-label="Rate the help you got">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                onClick={() => setRating(n)}
              >
                <Star
                  className={cn(
                    'size-5',
                    n <= rating ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground',
                  )}
                />
              </button>
            ))}
            <Button
              size="sm"
              variant="outline"
              disabled={!rating || rate.isPending}
              onClick={() => rate.mutate()}
            >
              Send rating
            </Button>
          </div>
        )
      ) : null}
    </section>
  );
}
