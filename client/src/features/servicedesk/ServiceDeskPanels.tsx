import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  FORM_FIELD_TYPES,
  PRIORITIES,
  PRIORITY_LABELS,
  QUEUE_VIEWS,
  QUEUE_VIEW_LABELS,
  REQUEST_KINDS,
  REQUEST_KIND_LABELS,
  requestTypeSchema,
  type FormFieldInput,
  type Priority,
  type ProjectDto,
  type QueueView,
  type RequestKind,
  type RequestTypeDto,
} from '@arihant/shared';
import { StatCard } from '@/components/common/StatCard';
import { StatusBadge } from '@/components/common/StatusBadge';
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
import { errorMessage } from '@/lib/errors';
import * as sd from '@/services/api/servicedesk';
import { RequestDetail, SlaBadge } from './request-ui';

const onError = (e: unknown) => toast.error(errorMessage(e));

/* ============================ Agents ============================ */

/** Project tab: the request queue with SLA clocks, the conversation, and the numbers. */
export function ServiceDeskQueue({ projectId }: { projectId: string }) {
  const [view, setView] = useState<QueueView>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['service-desk', 'queue', projectId, view],
    queryFn: () => sd.fetchQueue(projectId, view),
  });
  const report = useQuery({
    queryKey: ['service-desk', 'report', projectId],
    queryFn: () => sd.fetchDeskReport(projectId),
  });
  const r = report.data;
  return (
    <div className="space-y-4">
      {r ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Open requests" value={r.open} />
          <StatCard label="Resolved (30 days)" value={r.resolvedLast30} />
          <StatCard
            label="Resolution SLA met"
            value={r.resolutionSlaMetPercent === null ? '—' : `${r.resolutionSlaMetPercent}%`}
          />
          <StatCard
            label="Satisfaction"
            value={r.averageRating === null ? '—' : `${r.averageRating} / 5`}
            hint={`${r.ratings} rating(s)`}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Queues">
        {QUEUE_VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${view === v ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}
          >
            {QUEUE_VIEW_LABELS[v]}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <ul className="divide-y rounded-xl border bg-card text-sm" aria-label="Requests">
          {(q.data ?? []).map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => setOpenId(x.id)}
                className={`w-full space-y-1 px-3 py-2 text-left hover:bg-muted ${openId === x.id ? 'bg-muted' : ''}`}
              >
                <p className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{x.key}</span>
                  <span className="min-w-0 flex-1 truncate">{x.summary}</span>
                  <span className="text-xs text-muted-foreground">{x.requester?.name}</span>
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  <StatusBadge status={x.status} label={x.statusLabel} />
                  <span className="text-xs text-muted-foreground">
                    {REQUEST_KIND_LABELS[x.kind]} · {PRIORITY_LABELS[x.priority]} ·{' '}
                    {x.assignee?.name ?? 'unassigned'}
                  </span>
                  <SlaBadge label="Response" clock={x.sla.response} />
                  <SlaBadge label="Resolution" clock={x.sla.resolution} />
                </div>
              </button>
            </li>
          ))}
          {q.data && !q.data.length ? (
            <li className="px-3 py-2 text-muted-foreground">Nothing here.</li>
          ) : null}
        </ul>
        <div className="rounded-xl border bg-card p-4">
          {openId ? (
            <RequestDetail id={openId} asTeam />
          ) : (
            <p className="text-sm text-muted-foreground">Choose a request.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================ Setup ============================ */

const emptyType = (): RequestTypeDto => ({
  id: '',
  project: { id: '', key: '', name: '' },
  name: '',
  description: null,
  kind: 'service_request',
  fields: [],
  defaultPriority: 'medium',
  requesterSetsPriority: false,
  sla: { responseHours: 4, resolutionHours: 24 },
  approvalRequired: false,
  helpLinks: [],
  active: true,
});

function RequestTypeEditor({
  projectId,
  existing,
  onClose,
}: {
  projectId: string;
  existing: RequestTypeDto | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [t, setT] = useState<RequestTypeDto>(existing ?? emptyType());
  const input = {
    name: t.name,
    description: t.description,
    kind: t.kind,
    fields: t.fields,
    defaultPriority: t.defaultPriority,
    requesterSetsPriority: t.requesterSetsPriority,
    sla: t.sla,
    approvalRequired: t.approvalRequired,
    helpLinks: t.helpLinks,
    active: t.active,
  };
  const check = requestTypeSchema.safeParse(input);
  const save = useMutation({
    mutationFn: () =>
      existing ? sd.updateRequestType(existing.id, input) : sd.createRequestType(projectId, input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['service-desk'] });
      toast.success('Request type saved');
      onClose();
    },
    onError,
  });
  const setField = (i: number, patch: Partial<FormFieldInput>) =>
    setT((x) => ({
      ...x,
      fields: x.fields.map((f, j) =>
        j === i ? { ...f, ...patch } : f,
      ) as RequestTypeDto['fields'],
    }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${existing.name}` : 'New request type'}</DialogTitle>
          <DialogDescription>
            The form people fill in the Help Center, its SLA and whether it needs approval.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              aria-label="Request type name"
              placeholder="Name, e.g. Laptop problem"
              value={t.name}
              onChange={(e) => setT({ ...t, name: e.target.value })}
            />
            <Select value={t.kind} onValueChange={(v) => setT({ ...t, kind: v as RequestKind })}>
              <SelectTrigger aria-label="Kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REQUEST_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {REQUEST_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            aria-label="Description"
            placeholder="Description (optional)"
            value={t.description ?? ''}
            onChange={(e) => setT({ ...t, description: e.target.value || null })}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5">
              <Checkbox
                checked={Boolean(t.sla)}
                onCheckedChange={(c) =>
                  setT({ ...t, sla: c === true ? { responseHours: 4, resolutionHours: 24 } : null })
                }
              />
              SLA
            </label>
            {t.sla ? (
              <>
                <label className="flex items-center gap-1">
                  first response within
                  <Input
                    className="h-8 w-16"
                    type="number"
                    min={0.25}
                    aria-label="Response hours"
                    value={t.sla.responseHours}
                    onChange={(e) =>
                      setT({ ...t, sla: { ...t.sla!, responseHours: Number(e.target.value) } })
                    }
                  />
                  h
                </label>
                <label className="flex items-center gap-1">
                  resolved within
                  <Input
                    className="h-8 w-16"
                    type="number"
                    min={0.25}
                    aria-label="Resolution hours"
                    value={t.sla.resolutionHours}
                    onChange={(e) =>
                      setT({ ...t, sla: { ...t.sla!, resolutionHours: Number(e.target.value) } })
                    }
                  />
                  h
                </label>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={t.defaultPriority}
              onValueChange={(v) => setT({ ...t, defaultPriority: v as Priority })}
            >
              <SelectTrigger className="w-40" aria-label="Default priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_LABELS[p]} priority
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5">
              <Checkbox
                checked={t.requesterSetsPriority}
                onCheckedChange={(c) => setT({ ...t, requesterSetsPriority: c === true })}
              />
              Requester chooses urgency
            </label>
            <label className="flex items-center gap-1.5">
              <Checkbox
                checked={t.approvalRequired}
                onCheckedChange={(c) => setT({ ...t, approvalRequired: c === true })}
              />
              Needs approval
            </label>
            <label className="flex items-center gap-1.5">
              <Checkbox
                checked={t.active}
                onCheckedChange={(c) => setT({ ...t, active: c === true })}
              />
              Shown in the Help Center
            </label>
          </div>
          <fieldset className="space-y-2">
            <legend className="font-medium">Form fields</legend>
            {t.fields.map((f, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg border p-2">
                <Input
                  className="h-8 w-40"
                  aria-label={`Label of field ${i + 1}`}
                  value={f.label}
                  onChange={(e) => setField(i, { label: e.target.value })}
                />
                <Input
                  className="h-8 w-32 font-mono"
                  aria-label={`Key of field ${i + 1}`}
                  value={f.key}
                  onChange={(e) => setField(i, { key: e.target.value })}
                />
                <Select
                  value={f.type}
                  onValueChange={(v) => setField(i, { type: v as FormFieldInput['type'] })}
                >
                  <SelectTrigger size="sm" className="w-28" aria-label={`Type of field ${i + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORM_FIELD_TYPES.map((ft) => (
                      <SelectItem key={ft} value={ft}>
                        {ft}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={f.required}
                    onCheckedChange={(c) => setField(i, { required: c === true })}
                  />{' '}
                  required
                </label>
                {f.type === 'select' ? (
                  <Input
                    className="h-8 w-56"
                    aria-label={`Choices of field ${i + 1}`}
                    placeholder="Choices, separated by commas"
                    value={f.options.join(', ')}
                    onChange={(e) =>
                      setField(i, {
                        options: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                ) : null}
                <Input
                  className="h-8 w-56"
                  aria-label={`Show field ${i + 1} only when`}
                  placeholder="Show only when key=value (optional)"
                  value={f.showIf ? `${f.showIf.field}=${f.showIf.equals}` : ''}
                  onChange={(e) => {
                    const [field, ...rest] = e.target.value.split('=');
                    setField(i, {
                      showIf: field?.trim()
                        ? { field: field.trim(), equals: rest.join('=').trim() }
                        : null,
                    });
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-auto size-7"
                  aria-label={`Remove field ${i + 1}`}
                  onClick={() =>
                    setT((x) => ({ ...x, fields: x.fields.filter((_, j) => j !== i) }))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setT((x) => ({
                  ...x,
                  fields: [
                    ...x.fields,
                    {
                      key: `field_${x.fields.length + 1}`,
                      label: 'New field',
                      type: 'text',
                      required: false,
                      options: [],
                    },
                  ],
                }))
              }
            >
              <Plus /> Add field
            </Button>
          </fieldset>
          {!check.success ? (
            <ul role="alert" className="list-inside list-disc text-xs text-destructive">
              {check.error.issues.map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!check.success || save.isPending} onClick={() => save.mutate()}>
            Save request type
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Project setup: switch the service desk on, choose agents and request types. */
export function ServiceDeskSetup({ project }: { project: ProjectDto }) {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['service-desk', 'settings', project.id],
    queryFn: () => sd.fetchDeskSettings(project.id),
  });
  const types = useQuery({
    queryKey: ['service-desk', 'types', project.id],
    queryFn: () => sd.fetchRequestTypes(project.id),
  });
  const [editing, setEditing] = useState<RequestTypeDto | 'new' | null>(null);
  const s = settings.data;
  const save = useMutation({
    mutationFn: (input: {
      enabled: boolean;
      agentIds: string[];
      autoAssign: 'none' | 'round_robin';
    }) => sd.saveDeskSettings(project.id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-desk'] }),
    onError,
  });
  if (!s) return null;
  const agentIds = s.agents.map((a) => a.id);
  const update = (
    patch: Partial<{ enabled: boolean; agentIds: string[]; autoAssign: 'none' | 'round_robin' }>,
  ) => save.mutate({ enabled: s.enabled, agentIds, autoAssign: s.autoAssign, ...patch });
  return (
    <section aria-label="Service desk" className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <LifeBuoy className="size-4" /> Service desk
      </h2>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={s.enabled}
          disabled={!s.canEdit}
          onCheckedChange={(c) => update({ enabled: c === true })}
        />
        Run a service desk: anyone in the organisation can raise requests from the Help Center
      </label>
      {s.enabled ? (
        <>
          <div className="space-y-1 text-sm">
            <p className="font-medium">Agents (empty = every member)</p>
            <div className="flex flex-wrap gap-2">
              {project.members.map((m) => (
                <label key={m.user.id} className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={agentIds.includes(m.user.id)}
                    disabled={!s.canEdit}
                    onCheckedChange={(c) =>
                      update({
                        agentIds:
                          c === true
                            ? [...agentIds, m.user.id]
                            : agentIds.filter((x) => x !== m.user.id),
                      })
                    }
                  />
                  {m.user.name}
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={s.autoAssign === 'round_robin'}
                disabled={!s.canEdit}
                onCheckedChange={(c) => update({ autoAssign: c === true ? 'round_robin' : 'none' })}
              />
              Assign new requests to agents in turn
            </label>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Request types</p>
              {s.canEdit ? (
                <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
                  <Plus /> New request type
                </Button>
              ) : null}
            </div>
            <ul className="divide-y rounded-lg border text-sm">
              {(types.data ?? []).map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate">
                    {t.name}{' '}
                    <span className="text-xs text-muted-foreground">
                      · {REQUEST_KIND_LABELS[t.kind]} · {t.fields.length} field(s)
                      {t.sla ? ` · SLA ${t.sla.responseHours} h / ${t.sla.resolutionHours} h` : ''}
                      {t.approvalRequired ? ' · approval' : ''}
                      {t.active ? '' : ' · hidden'}
                    </span>
                  </span>
                  {s.canEdit ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={`Edit ${t.name}`}
                      onClick={() => setEditing(t)}
                    >
                      <Pencil />
                    </Button>
                  ) : null}
                </li>
              ))}
              {types.data && !types.data.length ? (
                <li className="px-3 py-1.5 text-muted-foreground">None yet.</li>
              ) : null}
            </ul>
          </div>
        </>
      ) : null}
      {editing ? (
        <RequestTypeEditor
          projectId={project.id}
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}
