import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, GitBranch, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  DEFAULT_WORKFLOW,
  ROLE_LABELS,
  STATUS_LABELS,
  SYSTEM_ROLES,
  TASK_STATUSES,
  WORKFLOW_ACTIONS,
  WORKFLOW_ACTION_LABELS,
  WORKFLOW_CONDITIONS,
  WORKFLOW_CONDITION_LABELS,
  WORKFLOW_FIELDS,
  WORKFLOW_FIELD_LABELS,
  workflowDefinitionSchema,
  type TaskStatus,
  type WorkflowDefinition,
  type WorkflowDto,
  type WorkflowTransition,
} from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/hooks/use-permission';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import * as wfApi from '@/services/api/workflows';
import { workflowKeys } from './TaskWorkflowControl';

const name = (def: Pick<WorkflowDefinition, 'labels'>, s: TaskStatus) =>
  def.labels[s] ?? STATUS_LABELS[s];

/** A small on/off chip used for multi-choice settings. */
function Chip({
  on,
  onToggle,
  children,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        'rounded-full border px-2 py-0.5 text-xs transition-colors',
        on ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

const toggle = <T,>(xs: readonly T[], x: T): T[] =>
  xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x];

function slug(s: string, taken: string[]): string {
  const base =
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'step';
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}

function TransitionEditor({
  t,
  def,
  onChange,
  onRemove,
}: {
  t: WorkflowTransition;
  def: WorkflowDefinition;
  onChange: (t: WorkflowTransition) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<WorkflowTransition>) => onChange({ ...t, ...patch });
  return (
    <li className="space-y-2 rounded-lg border p-3" aria-label={`Transition ${t.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-56"
          aria-label="Transition name"
          value={t.name}
          maxLength={60}
          onChange={(e) => set({ name: e.target.value })}
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Select value={t.to} onValueChange={(v) => set({ to: v as TaskStatus })}>
          <SelectTrigger size="sm" className="w-40" aria-label={`Target status of ${t.name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {def.statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {name(def, s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7"
          aria-label={`Remove transition ${t.name}`}
          onClick={onRemove}
        >
          <X />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-20 text-xs text-muted-foreground">From</span>
        <Chip
          on={t.from.includes('*')}
          onToggle={() => set({ from: t.from.includes('*') ? [] : ['*'] })}
        >
          Any status
        </Chip>
        {!t.from.includes('*')
          ? def.statuses
              .filter((s) => s !== t.to)
              .map((s) => (
                <Chip
                  key={s}
                  on={t.from.includes(s)}
                  onToggle={() => set({ from: toggle(t.from, s) })}
                >
                  {name(def, s)}
                </Chip>
              ))
          : null}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-20 text-xs text-muted-foreground">Who</span>
        <Chip on={!t.roles.length} onToggle={() => set({ roles: [] })}>
          Anyone who can edit
        </Chip>
        {SYSTEM_ROLES.filter((r) => r !== 'external_stakeholder').map((r) => (
          <Chip
            key={r}
            on={t.roles.includes(r)}
            onToggle={() => set({ roles: toggle(t.roles, r) })}
          >
            {ROLE_LABELS[r]}
          </Chip>
        ))}
        <Chip on={t.assigneeOnly} onToggle={() => set({ assigneeOnly: !t.assigneeOnly })}>
          Assignee only
        </Chip>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-20 text-xs text-muted-foreground">Checks</span>
        {WORKFLOW_CONDITIONS.map((c) => (
          <Chip
            key={c}
            on={t.conditions.includes(c)}
            onToggle={() => set({ conditions: toggle(t.conditions, c) })}
          >
            {WORKFLOW_CONDITION_LABELS[c]}
          </Chip>
        ))}
        <Chip on={t.requireComment} onToggle={() => set({ requireComment: !t.requireComment })}>
          Comment required
        </Chip>
        <Chip on={t.approval} onToggle={() => set({ approval: !t.approval })}>
          Needs approval
        </Chip>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-20 text-xs text-muted-foreground">Then</span>
        {WORKFLOW_ACTIONS.map((a) => (
          <Chip
            key={a}
            on={t.actions.includes(a)}
            onToggle={() => set({ actions: toggle(t.actions, a) })}
          >
            {WORKFLOW_ACTION_LABELS[a]}
          </Chip>
        ))}
      </div>
    </li>
  );
}

/** Create or edit a workflow; validated live with the same rules as the server. */
function WorkflowEditor({
  existing,
  onClose,
}: {
  existing: WorkflowDto | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [def, setDef] = useState<WorkflowDefinition>(
    structuredClone(existing?.definition ?? DEFAULT_WORKFLOW),
  );
  const check = useMemo(() => workflowDefinitionSchema.safeParse(def), [def]);
  const save = useMutation({
    mutationFn: () =>
      existing
        ? wfApi.updateWorkflow(existing.id, {
            name: title.trim(),
            description: description.trim() || null,
            definition: def,
          })
        : wfApi.createWorkflow({
            name: title.trim(),
            description: description.trim() || null,
            definition: def,
          }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workflowKeys.list });
      await qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Workflow saved');
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const unused = TASK_STATUSES.filter((s) => !def.statuses.includes(s));
  const setStatuses = (statuses: TaskStatus[]) =>
    setDef((d) => {
      const keep = (r: Partial<Record<TaskStatus, unknown>>) =>
        Object.fromEntries(Object.entries(r).filter(([k]) => statuses.includes(k as TaskStatus)));
      return {
        ...d,
        statuses,
        labels: keep(d.labels) as WorkflowDefinition['labels'],
        required: keep(d.required) as WorkflowDefinition['required'],
        transitions: d.transitions
          .filter((t) => statuses.includes(t.to))
          .map((t) => ({ ...t, from: t.from.filter((f) => f === '*' || statuses.includes(f)) })),
      };
    });
  const move = (i: number, by: number) => {
    const xs = [...def.statuses];
    const [x] = xs.splice(i, 1);
    xs.splice(i + by, 0, x!);
    setDef((d) => ({ ...d, statuses: xs }));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${existing.name}` : 'New task workflow'}</DialogTitle>
          <DialogDescription>
            {existing?.projects.length
              ? `Used by ${existing.projects.map((p) => p.key).join(', ')}. Changes apply to them at once.`
              : 'Start from the standard workflow and change what you need.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              aria-label="Workflow name"
              placeholder="Workflow name"
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Textarea
              aria-label="Description"
              placeholder="Description (optional)"
              rows={1}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <section aria-label="Statuses" className="space-y-2">
            <h3 className="text-sm font-semibold">Statuses</h3>
            <p className="text-xs text-muted-foreground">
              Board order, display names, and fields that must be filled while a task is in the
              status.
            </p>
            <ul className="space-y-1.5">
              {def.statuses.map((s, i) => (
                <li key={s} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      aria-label={`Move ${STATUS_LABELS[s]} up`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp className="size-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${STATUS_LABELS[s]} down`}
                      disabled={i === def.statuses.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown className="size-3" />
                    </button>
                  </div>
                  <span className="w-24 text-xs text-muted-foreground">{STATUS_LABELS[s]}</span>
                  <Input
                    className="h-7 w-40"
                    aria-label={`Display name for ${STATUS_LABELS[s]}`}
                    placeholder={STATUS_LABELS[s]}
                    maxLength={30}
                    value={def.labels[s] ?? ''}
                    onChange={(e) =>
                      setDef((d) => {
                        const labels = { ...d.labels };
                        if (e.target.value.trim()) labels[s] = e.target.value;
                        else delete labels[s];
                        return { ...d, labels };
                      })
                    }
                  />
                  <div className="flex flex-wrap gap-1">
                    {WORKFLOW_FIELDS.map((f) => (
                      <Chip
                        key={f}
                        label={`${WORKFLOW_FIELD_LABELS[f]} required in ${STATUS_LABELS[s]}`}
                        on={def.required[s]?.includes(f) ?? false}
                        onToggle={() =>
                          setDef((d) => {
                            const next = toggle(d.required[s] ?? [], f);
                            const required = { ...d.required };
                            if (next.length) required[s] = next;
                            else delete required[s];
                            return { ...d, required };
                          })
                        }
                      >
                        {WORKFLOW_FIELD_LABELS[f]}
                      </Chip>
                    ))}
                  </div>
                  {s !== 'done' ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-7"
                      aria-label={`Remove ${STATUS_LABELS[s]}`}
                      onClick={() => setStatuses(def.statuses.filter((x) => x !== s))}
                    >
                      <X />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {unused.length ? (
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <span className="text-muted-foreground">Add:</span>
                {unused.map((s) => (
                  <Chip key={s} on={false} onToggle={() => setStatuses([...def.statuses, s])}>
                    + {STATUS_LABELS[s]}
                  </Chip>
                ))}
              </div>
            ) : null}
          </section>

          <section aria-label="Transitions" className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Transitions</h3>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setDef((d) => ({
                    ...d,
                    transitions: [
                      ...d.transitions,
                      {
                        id: slug(
                          'new step',
                          d.transitions.map((t) => t.id),
                        ),
                        name: 'New step',
                        from: ['*'],
                        to: d.statuses[0]!,
                        roles: [],
                        assigneeOnly: false,
                        conditions: [],
                        requireComment: false,
                        approval: false,
                        actions: [],
                      },
                    ],
                  }))
                }
              >
                <Plus /> Add transition
              </Button>
            </div>
            <ul className="space-y-2">
              {def.transitions.map((t, i) => (
                <TransitionEditor
                  key={t.id}
                  t={t}
                  def={def}
                  onChange={(next) =>
                    setDef((d) => ({
                      ...d,
                      transitions: d.transitions.map((x, j) => (j === i ? next : x)),
                    }))
                  }
                  onRemove={() =>
                    setDef((d) => ({ ...d, transitions: d.transitions.filter((_, j) => j !== i) }))
                  }
                />
              ))}
            </ul>
          </section>

          {!check.success ? (
            <ul
              role="alert"
              className="list-inside list-disc rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
            >
              {check.error.issues.map((iss, i) => (
                <li key={i}>{iss.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!check.success || !title.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save workflow'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkflowCard({
  w,
  onEdit,
  onDelete,
}: {
  w: WorkflowDto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const def = w.definition;
  return (
    <section aria-label={w.name} className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 font-semibold">
            <GitBranch className="size-4" /> {w.name}
          </h2>
          {w.description ? <p className="text-sm text-muted-foreground">{w.description}</p> : null}
          <p className="text-xs text-muted-foreground">
            {w.projects.length
              ? `Used by ${w.projects.map((p) => `${p.key} ${p.name}`).join(', ')}`
              : 'Not used by any project yet'}
          </p>
        </div>
        {w.canEdit ? (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil /> Edit
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={`Delete ${w.name}`}
              onClick={onDelete}
            >
              <Trash2 />
            </Button>
          </div>
        ) : null}
      </div>
      <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="Statuses">
        {def.statuses.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            {i ? <span className="text-muted-foreground">→</span> : null}
            <span className="rounded-full border px-2 py-0.5">
              {name(def, s)}
              {def.required[s]?.length ? (
                <span className="text-muted-foreground">
                  {' '}
                  · needs{' '}
                  {def.required[s]!.map((f) => WORKFLOW_FIELD_LABELS[f].toLowerCase()).join(', ')}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 font-normal">Transition</th>
            <th className="font-normal">From → to</th>
            <th className="font-normal">Rules</th>
          </tr>
        </thead>
        <tbody>
          {def.transitions.map((t) => (
            <tr key={t.id} className="border-t align-top">
              <td className="py-1 font-medium">{t.name}</td>
              <td className="py-1">
                {t.from.includes('*')
                  ? 'Any'
                  : t.from.map((f) => name(def, f as TaskStatus)).join(', ')}{' '}
                → {name(def, t.to)}
              </td>
              <td className="py-1 text-muted-foreground">
                {[
                  t.roles.length ? t.roles.map((r) => ROLE_LABELS[r]).join(' / ') : null,
                  t.assigneeOnly ? 'assignee only' : null,
                  ...t.conditions.map((c) => WORKFLOW_CONDITION_LABELS[c].toLowerCase()),
                  t.requireComment ? 'comment' : null,
                  t.approval ? 'approval' : null,
                  ...t.actions.map((a) => WORKFLOW_ACTION_LABELS[a].toLowerCase()),
                ]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Task workflow library (Jira group C). */
export function WorkflowsPage() {
  const qc = useQueryClient();
  const canManage = useCan('project:update', 'department');
  const list = useQuery({ queryKey: workflowKeys.list, queryFn: wfApi.fetchWorkflows });
  const [editing, setEditing] = useState<WorkflowDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<WorkflowDto | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => wfApi.deleteWorkflow(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workflowKeys.list });
      toast.success('Workflow deleted');
      setDeleting(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Task Workflows"
        description="Statuses, allowed moves, who may make them, required fields, checks, approvals and automatic actions. Projects choose a workflow in their Setup tab."
        actions={
          canManage ? (
            <Button onClick={() => setEditing('new')}>
              <Plus /> New workflow
            </Button>
          ) : null
        }
      />
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <Skeleton className="h-60" />
      ) : list.data.length ? (
        <div className="space-y-4">
          {list.data.map((w) => (
            <WorkflowCard
              key={w.id}
              w={w}
              onEdit={() => setEditing(w)}
              onDelete={() => setDeleting(w)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={GitBranch}
          title="Every project uses the standard workflow"
          description={
            canManage
              ? 'Create a workflow to give projects their own statuses and rules.'
              : 'Directors, department heads and administrators can create workflows.'
          }
        />
      )}
      {editing ? (
        <WorkflowEditor
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ''}?`}
        description="Only workflows no project uses can be deleted."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleting) await del.mutateAsync(deleting.id);
        }}
      />
    </div>
  );
}
