import { useQuery } from '@tanstack/react-query';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  BOARD_COLUMNS,
  STATUS_LABELS,
  type ProjectAgileSettingsDto,
  type TaskStatus,
} from '@arihant/shared';
import { ErrorState } from '@/components/common/ErrorState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDay } from '@/features/work/format';
import * as agileApi from '@/services/api/agile';
import { IssueTypeIcon, agileKeys, useAgileMutation } from './agile-ui';

function SettingsEditor({ projectId, data }: { projectId: string; data: ProjectAgileSettingsDto }) {
  const [components, setComponents] = useState(
    data.components.map((c) => ({
      name: c.name,
      description: c.description ?? '',
      leadId: c.lead?.id ?? null,
      openTasks: c.openTasks,
    })),
  );
  const [limits, setLimits] = useState<Partial<Record<TaskStatus, string>>>(
    Object.fromEntries(Object.entries(data.wipLimits).map(([k, v]) => [k, String(v)])),
  );
  const [draft, setDraft] = useState('');
  const save = useAgileMutation(
    () =>
      agileApi.saveAgileSettings(projectId, {
        components: components.map((c) => ({
          name: c.name,
          description: c.description || null,
          leadId: c.leadId,
        })),
        wipLimits: Object.fromEntries(
          BOARD_COLUMNS.map((s) => [s, Number(limits[s] || 0)]).filter(([, v]) => Number(v) > 0),
        ),
      }),
    { success: 'Board settings saved' },
  );
  const duplicate =
    draft.trim() && components.some((c) => c.name.toLowerCase() === draft.trim().toLowerCase());
  const editable = data.canEdit;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Components">
        <div>
          <h3 className="text-sm font-semibold">Components</h3>
          <p className="text-xs text-muted-foreground">
            Parts of the product (for example API, Web, Reports) that tasks can be tagged with.
          </p>
        </div>
        <ul className="space-y-1.5">
          {components.map((c, i) => (
            <li key={c.name} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 font-medium">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.openTasks} open</span>
              {editable ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Remove component ${c.name}`}
                  onClick={() => setComponents((xs) => xs.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          ))}
          {!components.length ? <li className="text-xs text-muted-foreground">None yet.</li> : null}
        </ul>
        {editable ? (
          <div className="flex gap-2">
            <Input
              className="h-8"
              placeholder="New component"
              aria-label="New component"
              value={draft}
              maxLength={60}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!draft.trim() || Boolean(duplicate)}
              onClick={() => {
                setComponents((xs) => [
                  ...xs,
                  { name: draft.trim(), description: '', leadId: null, openTasks: 0 },
                ]);
                setDraft('');
              }}
            >
              <Plus /> Add
            </Button>
          </div>
        ) : null}
        {editable ? (
          <p className="text-xs text-muted-foreground">
            Removing a component also removes it from its tasks when you save.
          </p>
        ) : null}
      </section>
      <section
        className="space-y-3 rounded-xl border bg-card p-4"
        aria-label="Work-in-progress limits"
      >
        <div>
          <h3 className="text-sm font-semibold">Work-in-progress limits</h3>
          <p className="text-xs text-muted-foreground">
            The board shows a column's count in red when it holds more tasks than its limit. Leave
            empty for no limit.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {BOARD_COLUMNS.map((s) => (
            <label key={s} className="flex items-center justify-between gap-2 text-sm">
              {STATUS_LABELS[s]}
              <Input
                type="number"
                min={0}
                max={999}
                className="h-8 w-20"
                aria-label={`WIP limit for ${STATUS_LABELS[s]}`}
                disabled={!editable}
                value={limits[s] ?? ''}
                onChange={(e) => setLimits((l) => ({ ...l, [s]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      </section>
      {editable ? (
        <div className="lg:col-span-2">
          <Button disabled={save.isPending} onClick={() => save.mutate(undefined)}>
            Save board settings
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DeletedTasks({ projectId }: { projectId: string }) {
  const q = useQuery({
    queryKey: agileKeys.deleted(projectId),
    queryFn: () => agileApi.fetchDeletedTasks(projectId),
    retry: false,
  });
  const restore = useAgileMutation((id: string) => agileApi.restoreTask(id), {
    success: (t) => `${t.key} restored`,
  });
  // People who cannot manage the project get 403 here; the section is simply not shown to them.
  if (q.error) return null;
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4" aria-label="Deleted tasks">
      <h3 className="text-sm font-semibold">Deleted tasks</h3>
      {!q.data ? (
        <Skeleton className="h-16" />
      ) : !q.data.length ? (
        <p className="text-xs text-muted-foreground">Nothing deleted.</p>
      ) : (
        <ul className="divide-y">
          {q.data.map((t) => (
            <li key={t.id} className="flex items-center gap-2 py-1.5 text-sm">
              <IssueTypeIcon type={t.type} />
              <span className="font-mono text-xs text-muted-foreground">{t.key}</span>
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className="text-xs text-muted-foreground">
                deleted {formatDay(t.updatedAt.slice(0, 10))}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={restore.isPending}
                onClick={() => restore.mutate(t.id)}
              >
                <RotateCcw /> Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AgileSetupPanel({ projectId }: { projectId: string }) {
  const q = useQuery({
    queryKey: agileKeys.settings(projectId),
    queryFn: () => agileApi.fetchAgileSettings(projectId),
  });
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <div className="space-y-4">
      {q.data ? (
        <SettingsEditor key={JSON.stringify(q.data)} projectId={projectId} data={q.data} />
      ) : (
        <Skeleton className="h-40" />
      )}
      <DeletedTasks projectId={projectId} />
    </div>
  );
}
