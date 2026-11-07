import { CopyPlus, LayoutTemplate, Repeat, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PRIORITY_LABELS, type TemplateSummaryDto } from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { FormField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchInput } from '@/components/common/SearchInput';
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
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ProjectFormDialog } from '@/features/work/projects/ProjectFormDialog';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import * as api from '@/services/api/planning';
import { usePlanningMutation, useTemplate, useTemplates } from './hooks';

/** "Save as template" from a project. Mounted only while open. */
export function SaveAsTemplateDialog({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(`${projectName} template`);
  const [description, setDescription] = useState('');
  const [includeTasks, setIncludeTasks] = useState(true);
  const save = usePlanningMutation(
    () =>
      api.saveAsTemplate(projectId, {
        name: name.trim(),
        description: description.trim() || undefined,
        includeTasks,
      }),
    {
      success: (t) =>
        `Template "${t.name}" saved (${t.taskCount} tasks, ${t.milestoneCount} milestones)`,
    },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>
            Keeps the structure: task fields, milestones and (optionally) tasks with their timing
            relative to the project start. People, statuses, logged time and comments are not
            copied.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField
            label="Template name"
            required
            error={name && name.trim().length < 2 ? 'Enter a template name' : undefined}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </FormField>
          <FormField label="Description">
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={includeTasks} onCheckedChange={(c) => setIncludeTasks(c === true)} />
            Include tasks and subtasks (cancelled tasks are skipped)
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            disabled={name.trim().length < 2 || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateDetail({
  id,
  onUse,
  onClose,
}: {
  id: string;
  onUse: () => void;
  onClose: () => void;
}) {
  const t = useTemplate(id);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {!t.data ? (
          t.error ? (
            <ErrorState error={t.error} />
          ) : (
            <Skeleton className="m-4 h-64" />
          )
        ) : (
          <div className="space-y-5 p-4">
            <div>
              <SheetTitle>{t.data.name}</SheetTitle>
              <SheetDescription>{t.data.description || 'No description'}</SheetDescription>
              <p className="mt-1 text-xs text-muted-foreground">
                {t.data.category ? `${t.data.category} · ` : ''}
                {PRIORITY_LABELS[t.data.priority]} priority
                {t.data.durationDays != null ? ` · ${t.data.durationDays} days` : ''} · used{' '}
                {t.data.usageCount} time
                {t.data.usageCount === 1 ? '' : 's'}
              </p>
            </div>
            <Button onClick={onUse}>
              <CopyPlus /> Create project from template
            </Button>
            {t.data.customFields.length ? (
              <section>
                <h4 className="mb-1 text-sm font-semibold">Task fields</h4>
                <ul className="flex flex-wrap gap-1.5 text-xs">
                  {t.data.customFields.map((f) => (
                    <li key={f.key} className="rounded border px-2 py-0.5">
                      {f.label} <span className="text-muted-foreground">({f.type})</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section>
              <h4 className="mb-1 text-sm font-semibold">
                Milestones ({t.data.milestones.length})
              </h4>
              {t.data.milestones.length ? (
                <ul className="space-y-1 text-sm">
                  {t.data.milestones.map((m) => (
                    <li key={m.ref}>
                      {m.name}{' '}
                      <span className="text-xs text-muted-foreground">· day {m.dueOffsetDays}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">None</p>
              )}
            </section>
            <section>
              <h4 className="mb-1 text-sm font-semibold">Tasks ({t.data.tasks.length})</h4>
              {t.data.tasks.length ? (
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1 text-left font-medium">Task</th>
                      <th className="py-1 text-left font-medium">Priority</th>
                      <th className="py-1 text-right font-medium">Estimate</th>
                      <th className="py-1 text-right font-medium">Due (day)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.data.tasks.map((x) => (
                      <tr key={x.ref} className="border-t">
                        <td className={x.parentRef ? 'py-1 pl-4' : 'py-1'}>
                          {x.title}
                          {x.recurrence ? (
                            <Repeat
                              className="ml-1 inline size-3 text-muted-foreground"
                              aria-label="Repeats"
                            />
                          ) : null}
                        </td>
                        <td className="py-1">{PRIORITY_LABELS[x.priority]}</td>
                        <td className="py-1 text-right tabular">
                          {x.estimatedHours != null ? `${x.estimatedHours} h` : '—'}
                        </td>
                        <td className="py-1 text-right tabular">{x.dueOffsetDays ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted-foreground">None</p>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function TemplatesPage() {
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q, 250);
  const templates = useTemplates(search);
  const [viewing, setViewing] = useState<string | null>(null);
  const [using, setUsing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TemplateSummaryDto | null>(null);
  const remove = usePlanningMutation((id: string) => api.deleteTemplate(id), {
    success: 'Template deleted',
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Project Templates"
        description="Reusable project structures: task fields, milestones and tasks. Save one from any project with “Save as template”."
      />
      <SearchInput value={q} onChange={setQ} placeholder="Search templates…" />
      {templates.error ? (
        <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />
      ) : templates.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : !templates.data?.length ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={LayoutTemplate}
            title={search ? 'No templates match' : 'No templates yet'}
            description="Open a project and choose “Save as template” to create the first one."
          />
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.data.map((t) => (
            <li key={t.id} className="flex flex-col rounded-xl border bg-card p-4">
              <button type="button" className="text-left" onClick={() => setViewing(t.id)}>
                <h3 className="font-semibold hover:underline">{t.name}</h3>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {t.description || 'No description'}
                </p>
              </button>
              <p className="mt-2 text-xs text-muted-foreground">
                {t.taskCount} tasks · {t.milestoneCount} milestones · {t.customFieldCount} fields
                {t.durationDays != null ? ` · ${t.durationDays} days` : ''}
              </p>
              <p className="text-xs text-muted-foreground">
                By {t.createdBy?.name ?? '—'} · used {t.usageCount}×
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => setUsing(t.id)}>
                  <CopyPlus /> Use
                </Button>
                <Button size="sm" variant="outline" onClick={() => setViewing(t.id)}>
                  Preview
                </Button>
                {t.canEdit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    aria-label={`Delete ${t.name}`}
                    onClick={() => setDeleting(t)}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {viewing ? (
        <TemplateDetail
          id={viewing}
          onClose={() => setViewing(null)}
          onUse={() => {
            setUsing(viewing);
            setViewing(null);
          }}
        />
      ) : null}
      <ProjectFormDialog
        open={using !== null}
        onOpenChange={(o) => !o && setUsing(null)}
        initialTemplateId={using ?? undefined}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name ?? ''}"?`}
        description="It disappears from the library. Projects already created from it are not affected."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting.id);
        }}
      />
    </div>
  );
}
