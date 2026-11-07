import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Flag,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import type { MilestoneDto } from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { FormField } from '@/components/common/FormField';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { formatDay, relativeDue } from '@/features/work/format';
import { ProgressBar } from '@/features/work/projects/ProgressBar';
import * as api from '@/services/api/planning';
import { useMilestones, usePlanningMutation } from './hooks';

function MilestoneStatus({ m }: { m: MilestoneDto }) {
  if (m.status === 'completed')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium">
        <CheckCircle2 className="size-3.5" style={{ color: 'var(--status-good)' }} aria-hidden />{' '}
        Completed
      </span>
    );
  if (m.overdue)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium">
        <AlertTriangle
          className="size-3.5"
          style={{ color: 'var(--status-critical)' }}
          aria-hidden
        />{' '}
        Overdue
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Circle className="size-3.5" aria-hidden /> {relativeDue(m.dueDate)}
    </span>
  );
}

/** Mounted only while open. */
function MilestoneDialog({
  projectId,
  milestone,
  onClose,
}: {
  projectId: string;
  milestone?: MilestoneDto;
  onClose: () => void;
}) {
  const [name, setName] = useState(milestone?.name ?? '');
  const [dueDate, setDueDate] = useState(milestone?.dueDate ?? '');
  const [description, setDescription] = useState(milestone?.description ?? '');
  const save = usePlanningMutation(
    () =>
      milestone
        ? api.updateMilestone(milestone.id, {
            name: name.trim(),
            dueDate,
            description: description.trim() || null,
          })
        : api.createMilestone(projectId, {
            name: name.trim(),
            dueDate,
            description: description.trim() || undefined,
          }),
    { success: milestone ? 'Milestone updated' : 'Milestone added' },
  );
  const valid = name.trim().length >= 2 && Boolean(dueDate);
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{milestone ? 'Edit milestone' : 'Add milestone'}</DialogTitle>
          <DialogDescription>
            A checkpoint such as a release, sign-off or go-live. Link tasks to it from the task
            panel.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField
            label="Name"
            required
            error={name && name.trim().length < 2 ? 'Enter a milestone name' : undefined}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </FormField>
          <FormField label="Due date" required>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </FormField>
          <FormField label="Description">
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!valid || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            {milestone ? 'Save' : 'Add milestone'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MilestonesPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const milestones = useMilestones(projectId);
  const [editing, setEditing] = useState<MilestoneDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MilestoneDto | null>(null);
  const toggle = usePlanningMutation(
    (m: MilestoneDto) =>
      api.updateMilestone(m.id, { status: m.status === 'open' ? 'completed' : 'open' }),
    {
      success: (m) => (m.status === 'completed' ? `"${m.name}" completed` : `"${m.name}" reopened`),
    },
  );
  const remove = usePlanningMutation((id: string) => api.deleteMilestone(id), {
    success: 'Milestone deleted',
  });

  if (milestones.error)
    return <ErrorState error={milestones.error} onRetry={() => void milestones.refetch()} />;
  if (milestones.isLoading) return <Skeleton className="h-48 w-full" />;
  const items = milestones.data ?? [];

  return (
    <section className="rounded-xl border bg-card" aria-label="Milestones">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Milestones</h3>
        {canEdit ? (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> Add milestone
          </Button>
        ) : null}
      </header>
      {items.length === 0 ? (
        <EmptyState
          compact
          icon={Flag}
          title="No milestones yet"
          description="Add checkpoints such as UAT sign-off or go-live, then link tasks to them."
        />
      ) : (
        <ol className="divide-y">
          {items.map((m) => (
            <li
              key={m.id}
              className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_10rem_9rem_auto]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <p className="text-xs text-muted-foreground">
                  Due {formatDay(m.dueDate)}
                  {m.description ? ` · ${m.description}` : ''}
                </p>
              </div>
              <div className="hidden sm:block">
                <ProgressBar value={m.progress.percent} />
                <p className="mt-0.5 text-xs text-muted-foreground tabular">
                  {m.progress.done}/{m.progress.total} tasks done
                </p>
              </div>
              <div className="hidden sm:block">
                <MilestoneStatus m={m} />
              </div>
              {m.canEdit ? (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={
                      m.status === 'open' ? `Mark ${m.name} completed` : `Reopen ${m.name}`
                    }
                    onClick={() => toggle.mutate(m)}
                  >
                    {m.status === 'open' ? <CheckCircle2 /> : <RotateCcw />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Edit ${m.name}`}
                    onClick={() => setEditing(m)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Delete ${m.name}`}
                    onClick={() => setDeleting(m)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ) : (
                <span className="sm:hidden">
                  <MilestoneStatus m={m} />
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {editing ? (
        <MilestoneDialog
          projectId={projectId}
          milestone={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name ?? ''}"?`}
        description="Its tasks are kept and simply unlinked from the milestone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting.id);
        }}
      />
    </section>
  );
}
