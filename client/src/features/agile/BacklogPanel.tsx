import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CalendarRange, Flag, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { STATUS_LABELS, type SprintDto, type TaskDto } from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { FormField } from '@/components/common/FormField';
import { UserAvatar } from '@/components/common/UserAvatar';
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
import { Textarea } from '@/components/ui/textarea';
import { formatDay, todayIso } from '@/features/work/format';
import { TaskFormDialog } from '@/features/work/tasks/TaskFormDialog';
import { useTaskDrawer } from '@/features/work/tasks/use-task-drawer';
import * as agileApi from '@/services/api/agile';
import { IssueTypeIcon, NONE, PointsBadge, agileKeys, useAgileMutation } from './agile-ui';

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function TaskRow({
  task,
  canPlan,
  targets,
  selected,
  onSelect,
  onUp,
  onDown,
}: {
  task: TaskDto;
  canPlan: boolean;
  targets: { id: string | null; label: string }[];
  selected?: boolean;
  onSelect?: (on: boolean) => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const drawer = useTaskDrawer();
  const move = useAgileMutation(
    (sprintId: string | null) => agileApi.setSprintScope([task.id], sprintId),
    {
      success: `${task.key} moved`,
    },
  );
  const current = task.sprint?.id ?? null;
  return (
    <li className="flex items-center gap-2 px-3 py-2 text-sm">
      {onSelect ? (
        <Checkbox
          checked={selected}
          onCheckedChange={(c) => onSelect(c === true)}
          aria-label={`Select ${task.key}`}
        />
      ) : null}
      <IssueTypeIcon type={task.type} />
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left hover:underline"
        onClick={() => drawer.open(task.id)}
      >
        <span className="font-mono text-xs text-muted-foreground">{task.key}</span> {task.title}
      </button>
      {task.epic ? (
        <span
          className="hidden max-w-32 truncate rounded bg-violet/10 px-1.5 py-0.5 text-[10px] text-violet md:inline"
          title={task.epic.title}
        >
          {task.epic.title}
        </span>
      ) : null}
      <span className="w-24 text-xs text-muted-foreground">{STATUS_LABELS[task.status]}</span>
      <span className="w-8 text-right">
        <PointsBadge points={task.storyPoints} />
      </span>
      {task.assignee ? (
        <UserAvatar name={task.assignee.name} size="sm" />
      ) : (
        <span className="size-6" />
      )}
      {onUp || onDown ? (
        <span className="flex">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={`Move ${task.key} up`}
            disabled={!onUp}
            onClick={onUp}
          >
            <ArrowUp className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={`Move ${task.key} down`}
            disabled={!onDown}
            onClick={onDown}
          >
            <ArrowDown className="size-3.5" />
          </Button>
        </span>
      ) : null}
      {canPlan ? (
        <Select value={current ?? NONE} onValueChange={(v) => move.mutate(v === NONE ? null : v)}>
          <SelectTrigger size="sm" className="w-36" aria-label={`Sprint for ${task.key}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {targets.map((t) => (
              <SelectItem key={t.id ?? NONE} value={t.id ?? NONE}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </li>
  );
}

function StartSprintDialog({ sprint, onClose }: { sprint: SprintDto; onClose: () => void }) {
  const [start, setStart] = useState(sprint.startDate ?? todayIso());
  const [end, setEnd] = useState(sprint.endDate ?? addDays(sprint.startDate ?? todayIso(), 13));
  const [goal, setGoal] = useState(sprint.goal ?? '');
  const run = useAgileMutation(
    () =>
      agileApi.startSprint(sprint.id, {
        startDate: start,
        endDate: end,
        goal: goal.trim() || undefined,
      }),
    {
      success: `${sprint.name} started`,
    },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start {sprint.name}</DialogTitle>
          <DialogDescription>
            {sprint.taskCount} task(s), {sprint.points} story point(s) will be recorded as the
            commitment.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Start">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </FormField>
          <FormField
            label="End"
            error={end < start ? 'End must be on or after the start' : undefined}
          >
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </FormField>
          <FormField label="Sprint goal" className="col-span-2">
            <Textarea
              rows={2}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              maxLength={1000}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!start || !end || end < start || run.isPending}
            onClick={() => run.mutate(undefined, { onSuccess: onClose })}
          >
            Start sprint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompleteSprintDialog({
  sprint,
  planned,
  onClose,
}: {
  sprint: SprintDto;
  planned: SprintDto[];
  onClose: () => void;
}) {
  const [target, setTarget] = useState<string>('backlog');
  const open = sprint.taskCount - sprint.doneCount;
  const run = useAgileMutation(() => agileApi.completeSprint(sprint.id, { moveOpenTo: target }), {
    success: (r) =>
      `${sprint.name} completed: ${r.completedPoints ?? 0} points done, ${r.carriedOver} task(s) carried over`,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Complete {sprint.name}</DialogTitle>
          <DialogDescription>
            {sprint.doneCount} of {sprint.taskCount} task(s) done ({sprint.donePoints} of{' '}
            {sprint.points} points).
          </DialogDescription>
        </DialogHeader>
        {open > 0 ? (
          <FormField label={`Move the ${open} unfinished task(s) to`}>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="w-full" aria-label="Move unfinished tasks to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="backlog">Backlog</SelectItem>
                {planned.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>
            Cancel
          </Button>
          <Button
            disabled={run.isPending}
            onClick={() => run.mutate(undefined, { onSuccess: onClose })}
          >
            Complete sprint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SprintCard({
  sprint,
  canPlan,
  targets,
  planned,
}: {
  sprint: SprintDto & { tasks: TaskDto[] };
  canPlan: boolean;
  targets: { id: string | null; label: string }[];
  planned: SprintDto[];
}) {
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const remove = useAgileMutation(() => agileApi.deleteSprint(sprint.id), {
    success: `${sprint.name} deleted`,
  });
  return (
    <section className="rounded-xl border bg-card" aria-label={sprint.name}>
      <header className="flex flex-wrap items-center gap-3 border-b px-3 py-2.5">
        <h3 className="font-semibold">{sprint.name}</h3>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{
            background:
              sprint.status === 'active'
                ? 'color-mix(in oklab, var(--status-good) 15%, transparent)'
                : 'var(--muted)',
          }}
        >
          {sprint.status === 'active' ? 'Running' : 'Planned'}
        </span>
        {sprint.startDate && sprint.endDate ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CalendarRange className="size-3.5" /> {formatDay(sprint.startDate, 'd MMM')} –{' '}
            {formatDay(sprint.endDate, 'd MMM')}
            {sprint.daysLeft != null ? ` · ${sprint.daysLeft} day(s) left` : ''}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {sprint.taskCount} task(s) · {sprint.donePoints}/{sprint.points} pts done
          {sprint.committedPoints != null ? ` · committed ${sprint.committedPoints}` : ''}
        </span>
        <span className="ml-auto flex gap-1">
          {canPlan ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAdding(true)}
              aria-label={`Add task to ${sprint.name}`}
            >
              <Plus />
            </Button>
          ) : null}
          {canPlan && sprint.status === 'planned' ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={!sprint.taskCount}
                onClick={() => setStarting(true)}
              >
                <Play /> Start
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete ${sprint.name}`}
                onClick={() => setDeleting(true)}
              >
                <Trash2 />
              </Button>
            </>
          ) : null}
          {canPlan && sprint.status === 'active' ? (
            <Button size="sm" onClick={() => setCompleting(true)}>
              <Flag /> Complete
            </Button>
          ) : null}
        </span>
      </header>
      {sprint.goal ? (
        <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">Goal: {sprint.goal}</p>
      ) : null}
      {sprint.tasks.length ? (
        <ul className="divide-y">
          {sprint.tasks.map((t) => (
            <TaskRow key={t.id} task={t} canPlan={canPlan} targets={targets} />
          ))}
        </ul>
      ) : (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">
          Move tasks here from the backlog.
        </p>
      )}
      {starting ? <StartSprintDialog sprint={sprint} onClose={() => setStarting(false)} /> : null}
      {completing ? (
        <CompleteSprintDialog
          sprint={sprint}
          planned={planned}
          onClose={() => setCompleting(false)}
        />
      ) : null}
      <TaskFormDialog
        open={adding}
        onOpenChange={setAdding}
        projectId={sprint.project.id}
        defaultSprintId={sprint.id}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${sprint.name}?`}
        description="Its tasks go back to the backlog."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await remove.mutateAsync(undefined);
        }}
      />
    </section>
  );
}

/** Sprint planning: running and planned sprints, the ranked backlog and epic progress. */
export function BacklogPanel({ projectId }: { projectId: string }) {
  const q = useQuery({
    queryKey: agileKeys.backlog(projectId),
    queryFn: () => agileApi.fetchBacklog(projectId),
  });
  const epics = useQuery({
    queryKey: agileKeys.epics(projectId),
    queryFn: () => agileApi.fetchEpics(projectId),
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const createSprint = useAgileMutation(() => agileApi.createSprint({ projectId }), {
    success: (s) => `${s.name} created`,
  });
  const rank = useAgileMutation((v: { id: string; before: string | null; after: string | null }) =>
    agileApi.rankInBacklog(v.id, v.before, v.after),
  );
  const bulkMove = useAgileMutation(
    (sprintId: string | null) => agileApi.setSprintScope(selected, sprintId),
    {
      success: (r) => `${r.moved} task(s) moved`,
    },
  );

  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64" />;
  const { sprints, backlog, canPlan } = q.data;
  const planned = sprints.filter((s) => s.status === 'planned');
  const targets = [
    { id: null, label: 'Backlog' },
    ...sprints.map((s) => ({ id: s.id, label: s.name })),
  ];
  const backlogPoints = backlog.reduce((n, t) => n + (t.storyPoints ?? 0), 0);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_18rem]">
      <div className="space-y-4">
        {canPlan ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={createSprint.isPending}
              onClick={() => createSprint.mutate(undefined)}
            >
              <Plus /> New sprint
            </Button>
          </div>
        ) : null}
        {sprints.map((s) => (
          <SprintCard
            key={s.id}
            sprint={s}
            canPlan={canPlan}
            targets={targets}
            planned={planned.filter((p) => p.id !== s.id)}
          />
        ))}
        <section className="rounded-xl border bg-card" aria-label="Backlog">
          <header className="flex flex-wrap items-center gap-3 border-b px-3 py-2.5">
            <h3 className="font-semibold">Backlog</h3>
            <span className="text-xs text-muted-foreground">
              {backlog.length} open task(s) · {backlogPoints} pts · in ranked order
            </span>
            <span className="ml-auto flex items-center gap-2">
              {canPlan && selected.length ? (
                <Select
                  onValueChange={(v) =>
                    bulkMove.mutate(v === NONE ? null : v, { onSuccess: () => setSelected([]) })
                  }
                >
                  <SelectTrigger size="sm" className="w-48" aria-label="Move selected to sprint">
                    <SelectValue placeholder={`Move ${selected.length} selected to…`} />
                  </SelectTrigger>
                  <SelectContent>
                    {sprints.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                <Plus /> Task
              </Button>
            </span>
          </header>
          {backlog.length ? (
            <ul className="divide-y">
              {backlog.map((t, i) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  canPlan={canPlan}
                  targets={targets}
                  selected={selected.includes(t.id)}
                  onSelect={
                    canPlan
                      ? (on) =>
                          setSelected((xs) => (on ? [...xs, t.id] : xs.filter((x) => x !== t.id)))
                      : undefined
                  }
                  onUp={
                    t.can.update && i > 0
                      ? () =>
                          rank.mutate({
                            id: t.id,
                            before: backlog[i - 2]?.id ?? null,
                            after: backlog[i - 1]!.id,
                          })
                      : undefined
                  }
                  onDown={
                    t.can.update && i < backlog.length - 1
                      ? () =>
                          rank.mutate({
                            id: t.id,
                            before: backlog[i + 1]!.id,
                            after: backlog[i + 2]?.id ?? null,
                          })
                      : undefined
                  }
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              title="The backlog is empty"
              description="New tasks that are not in a sprint appear here."
            />
          )}
        </section>
        <TaskFormDialog open={adding} onOpenChange={setAdding} projectId={projectId} />
      </div>
      <aside className="space-y-2 rounded-xl border bg-card p-3" aria-label="Epics">
        <h3 className="text-sm font-semibold">Epics</h3>
        {!epics.data?.length ? (
          <p className="text-xs text-muted-foreground">
            No epics yet. Create a task of type Epic to group related work.
          </p>
        ) : (
          <ul className="space-y-3">
            {epics.data.map((e) => (
              <li key={e.id} className="space-y-1">
                <p className="truncate text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{e.key}</span> {e.title}
                </p>
                <div
                  className="h-1.5 rounded-full bg-muted"
                  role="progressbar"
                  aria-label={`${e.title} progress`}
                  aria-valuenow={e.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-violet"
                    style={{ width: `${e.percent}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {e.childDone}/{e.childCount} done
                  {e.points ? ` · ${e.donePoints}/${e.points} pts` : ''} · {e.percent}%
                </p>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
