import { AlertTriangle, ArrowRight, GitBranch, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
  MAX_CUSTOM_FIELDS,
  fieldKeyFromLabel,
  projectCustomFieldsSchema,
  type CustomFieldDef,
  type CustomFieldType,
  type ProjectDto,
} from '@arihant/shared';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
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
import { Skeleton } from '@/components/ui/skeleton';
import { formatDay } from '@/features/work/format';
import { useProjects } from '@/features/work/hooks';
import * as api from '@/services/api/planning';
import { useDependencies, usePlanningMutation } from './hooks';

/* ============================ Dependencies ============================ */

export function DependenciesPanel({ project }: { project: ProjectDto }) {
  const deps = useDependencies(project.id);
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState('');
  const [note, setNote] = useState('');
  const candidates = useProjects({ limit: 100, archived: 'false' }, adding);
  const save = usePlanningMutation(
    (list: { projectId: string; note?: string }[]) =>
      api.setDependencies(project.id, { dependencies: list }),
    { success: 'Dependencies updated' },
  );

  if (deps.error) return <ErrorState error={deps.error} onRetry={() => void deps.refetch()} />;
  if (!deps.data) return <Skeleton className="h-40 w-full" />;
  const d = deps.data;
  const current = d.dependsOn.map((x) => ({
    projectId: x.project.id,
    ...(x.note ? { note: x.note } : {}),
  }));
  const taken = new Set([project.id, ...current.map((c) => c.projectId)]);

  return (
    <section className="rounded-xl border bg-card" aria-label="Project dependencies">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Depends on</h3>
          <p className="text-xs text-muted-foreground">
            Projects that must finish before this one can complete.
          </p>
        </div>
        {d.canEdit && !adding ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus /> Add
          </Button>
        ) : null}
      </header>
      <div className="space-y-3 p-4">
        {adding ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger size="sm" className="w-64" aria-label="Upstream project">
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {(candidates.data?.items ?? [])
                  .filter((p) => !taken.has(p.id))
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.key} · {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Input
              className="h-8 w-56"
              placeholder="Why (optional)"
              aria-label="Dependency note"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!choice || save.isPending}
              onClick={() =>
                save.mutate(
                  [
                    ...current,
                    { projectId: choice, ...(note.trim() ? { note: note.trim() } : {}) },
                  ],
                  {
                    onSuccess: () => {
                      setAdding(false);
                      setChoice('');
                      setNote('');
                    },
                  },
                )
              }
            >
              Add dependency
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        ) : null}
        {d.dependsOn.length === 0 && d.hiddenUpstream === 0 ? (
          <p className="text-sm text-muted-foreground">
            This project does not depend on other projects.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {d.dependsOn.map((x) => (
              <li
                key={x.project.id}
                className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
              >
                <Link
                  to={`/projects/${x.project.id}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  <span className="font-mono text-xs">{x.project.key}</span> {x.project.name}
                  {x.note ? <span className="text-muted-foreground"> · {x.note}</span> : null}
                </Link>
                <StatusBadge status={x.project.status} />
                <span className="text-xs text-muted-foreground">
                  ends {formatDay(x.project.endDate)}
                </span>
                {x.delayed ? (
                  <span
                    className="inline-flex items-center gap-1 text-xs font-medium"
                    title={x.reason}
                  >
                    <AlertTriangle
                      className="size-3.5"
                      style={{ color: 'var(--status-serious)' }}
                      aria-hidden
                    />
                    At risk of delaying this project
                  </span>
                ) : null}
                {d.canEdit ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Remove dependency on ${x.project.key}`}
                    onClick={() => save.mutate(current.filter((c) => c.projectId !== x.project.id))}
                  >
                    <X />
                  </Button>
                ) : null}
              </li>
            ))}
            {d.hiddenUpstream ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                + {d.hiddenUpstream} project{d.hiddenUpstream === 1 ? '' : 's'} you do not have
                access to
              </li>
            ) : null}
          </ul>
        )}
        {d.dependents.length ? (
          <div>
            <h4 className="mb-1 text-xs font-medium text-muted-foreground">
              Projects waiting on this one
            </h4>
            <ul className="flex flex-wrap gap-2">
              {d.dependents.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/projects/${p.id}`}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                  >
                    <ArrowRight className="size-3" aria-hidden />
                    <span className="font-mono">{p.key}</span> {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ============================ Custom task fields ============================ */

interface DraftField {
  key: string;
  label: string;
  type: CustomFieldType;
  options: string;
  required: boolean;
  isNew: boolean;
}
const toDraft = (f: CustomFieldDef): DraftField => ({
  ...f,
  options: f.options.join(', '),
  isNew: false,
});

export function CustomFieldsEditor({ project }: { project: ProjectDto }) {
  const canEdit = project.can.update;
  const [draft, setDraft] = useState<DraftField[]>(() => project.customFields.map(toDraft));
  const [error, setError] = useState<string | null>(null);
  const save = usePlanningMutation(
    (fields: CustomFieldDef[]) => api.setCustomFields(project.id, { fields }),
    {
      success: 'Task fields saved',
    },
  );
  const dirty =
    JSON.stringify(draft.map(({ isNew: _n, ...f }) => f)) !==
    JSON.stringify(project.customFields.map(toDraft).map(({ isNew: _n, ...f }) => f));
  const removedOrRetyped = project.customFields.filter((old) => {
    const now = draft.find((d) => d.key === old.key);
    return !now || now.type !== old.type;
  });

  const patch = (i: number, p: Partial<DraftField>) =>
    setDraft((ds) => ds.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const submit = () => {
    const keys = new Set<string>();
    const fields = draft.map((d) => {
      let key = d.isNew ? fieldKeyFromLabel(d.label) : d.key;
      for (let n = 2; keys.has(key); n += 1)
        key = `${fieldKeyFromLabel(d.label).slice(0, 27)}_${n}`;
      keys.add(key);
      return {
        key,
        label: d.label.trim(),
        type: d.type,
        options:
          d.type === 'select'
            ? d.options
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean)
            : [],
        required: d.required,
      };
    });
    const parsed = projectCustomFieldsSchema.safeParse({ fields });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const idx = typeof issue.path[1] === 'number' ? issue.path[1] : null;
      setError(
        idx !== null
          ? `${fields[idx]?.label || `Field ${idx + 1}`}: ${issue.message}`
          : issue.message,
      );
      return;
    }
    setError(null);
    save.mutate(parsed.data.fields, { onSuccess: (saved) => setDraft(saved.map(toDraft)) });
  };

  return (
    <section className="rounded-xl border bg-card" aria-label="Task fields">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Task fields</h3>
          <p className="text-xs text-muted-foreground">
            Extra fields shown on every task in this project (up to {MAX_CUSTOM_FIELDS}).
          </p>
        </div>
        {canEdit && draft.length < MAX_CUSTOM_FIELDS ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setDraft((ds) => [
                ...ds,
                { key: '', label: '', type: 'text', options: '', required: false, isNew: true },
              ])
            }
          >
            <Plus /> Add field
          </Button>
        ) : null}
      </header>
      <div className="space-y-3 p-4">
        {draft.length === 0 ? (
          <EmptyState
            compact
            icon={GitBranch}
            title="No custom fields"
            description="Add fields such as Client reference, Environment or Regulatory impact."
          />
        ) : (
          <ul className="space-y-2">
            {draft.map((d, i) => (
              <li
                key={d.isNew ? `new-${i}` : d.key}
                className="flex flex-wrap items-center gap-2 rounded-lg border p-2"
              >
                <Input
                  className="h-8 w-48"
                  placeholder="Label"
                  aria-label={`Field ${i + 1} label`}
                  value={d.label}
                  maxLength={60}
                  disabled={!canEdit}
                  onChange={(e) => patch(i, { label: e.target.value })}
                />
                <Select
                  value={d.type}
                  disabled={!canEdit}
                  onValueChange={(v) => patch(i, { type: v as CustomFieldType })}
                >
                  <SelectTrigger size="sm" className="w-32" aria-label={`Field ${i + 1} type`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CUSTOM_FIELD_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {CUSTOM_FIELD_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {d.type === 'select' ? (
                  <Input
                    className="h-8 min-w-48 flex-1"
                    placeholder="Options, comma-separated"
                    aria-label={`Field ${i + 1} options`}
                    value={d.options}
                    disabled={!canEdit}
                    onChange={(e) => patch(i, { options: e.target.value })}
                  />
                ) : null}
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={d.required}
                    disabled={!canEdit || d.type === 'checkbox'}
                    onCheckedChange={(c) => patch(i, { required: c === true })}
                  />
                  Required
                </label>
                {!d.isNew ? (
                  <span className="font-mono text-xs text-muted-foreground">{d.key}</span>
                ) : null}
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-7"
                    aria-label={`Remove field ${d.label || i + 1}`}
                    onClick={() => setDraft((ds) => ds.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {removedOrRetyped.length && dirty ? (
          <p className="flex items-start gap-1.5 text-xs">
            <AlertTriangle
              className="mt-0.5 size-3.5 shrink-0"
              style={{ color: 'var(--status-warning)' }}
              aria-hidden
            />
            Saving clears the values tasks hold for:{' '}
            {removedOrRetyped.map((f) => f.label).join(', ')}.
          </p>
        ) : null}
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {canEdit ? (
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!dirty || save.isPending}
              onClick={() => setDraft(project.customFields.map(toDraft))}
            >
              Discard
            </Button>
            <Button size="sm" disabled={!dirty || save.isPending} onClick={submit}>
              Save fields
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
