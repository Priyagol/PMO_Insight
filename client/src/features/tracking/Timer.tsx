import { Pause, Play, Square, Timer as TimerIcon, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  WORK_CATEGORIES,
  WORK_CATEGORY_LABELS,
  type TimerDto,
  type WorkCategory,
} from '@arihant/shared';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProjects, useTasks } from '@/features/work/hooks';
import { useCan } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';
import * as t from '@/services/api/tracking';
import { formatClock, useElapsed } from './elapsed';
import { useTimer, useTrackMutation } from './hooks';

const NONE = '__none__';

/** Start a timer on a project (and optionally a task). Mounted only while open. */
export function StartTimerDialog({
  onClose,
  defaults,
}: {
  onClose: () => void;
  defaults?: { projectId?: string; taskId?: string };
}) {
  const [projectId, setProjectId] = useState(defaults?.projectId ?? '');
  const [taskId, setTaskId] = useState(defaults?.taskId ?? NONE);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<WorkCategory>('development');
  const projects = useProjects({ mine: 'true', limit: 100, sort: 'name' });
  const tasks = useTasks(
    { projectId: projectId ? [projectId] : undefined, limit: 100, sort: 'key' },
    Boolean(projectId),
  );
  const start = useTrackMutation(
    () =>
      t.startTimer({
        projectId,
        taskId: taskId === NONE ? null : taskId,
        description: description || undefined,
        category,
      }),
    { success: 'Timer started' },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !start.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a timer</DialogTitle>
          <DialogDescription>
            Stopping the timer turns the tracked time into a work log.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Project" required>
            <Select
              value={projectId}
              onValueChange={(v) => {
                setProjectId(v);
                setTaskId(NONE);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.data?.items.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.key} · {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Task">
            <Select value={taskId} onValueChange={setTaskId} disabled={!projectId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No specific task</SelectItem>
                {tasks.data?.items.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.key} · {x.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Category">
            <Select value={category} onValueChange={(v) => setCategory(v as WorkCategory)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORK_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {WORK_CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField
            label="What are you working on?"
            hint="You can also describe it when you stop."
          >
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={start.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!projectId || start.isPending}
            onClick={() => start.mutate(undefined, { onSuccess: onClose })}
          >
            <Play /> Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Running-timer controls: used in the top bar and on My Workspace / Work Logs. */
export function TimerControls({ timer, compact }: { timer: TimerDto; compact?: boolean }) {
  const elapsed = useElapsed(timer);
  const [desc, setDesc] = useState(timer.description ?? '');
  const pause = useTrackMutation(() => (timer.running ? t.pauseTimer() : t.resumeTimer()));
  const stop = useTrackMutation(() => t.stopTimer({ description: desc || undefined }), {
    success: (r) =>
      r.worklog ? `Logged ${Math.round(r.worklog.minutes)} min on ${r.worklog.project.key}` : null,
  });
  const discard = useTrackMutation(() => t.stopTimer({ discard: true }), {
    success: 'Timer discarded',
  });
  return (
    <div className={cn('space-y-3', compact && 'w-72')}>
      <div>
        <p
          className={cn(
            'font-mono text-2xl font-semibold tabular',
            !timer.running && 'text-muted-foreground',
          )}
        >
          {formatClock(elapsed)}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {timer.project.key}
          {timer.task ? ` · ${timer.task.key} ${timer.task.title}` : ` · ${timer.project.name}`}
          {timer.running ? '' : ' · paused'}
        </p>
      </div>
      <Input
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Describe the work…"
        aria-label="Timer description"
        className="h-8"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pause.isPending}
          onClick={() => pause.mutate(undefined)}
        >
          {timer.running ? (
            <>
              <Pause /> Pause
            </>
          ) : (
            <>
              <Play /> Resume
            </>
          )}
        </Button>
        <Button size="sm" disabled={stop.isPending} onClick={() => stop.mutate(undefined)}>
          <Square /> Stop &amp; log
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto size-8"
          aria-label="Discard timer"
          onClick={() => discard.mutate(undefined)}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

/** Top-bar chip: shows the running timer anywhere in the app. */
export function TimerChip() {
  const canLog = useCan('worklog:write');
  const timer = useTimer(canLog);
  const elapsed = useElapsed(timer.data);
  const [starting, setStarting] = useState(false);
  if (!canLog) return null;
  if (!timer.data) {
    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Start a timer"
          onClick={() => setStarting(true)}
        >
          <TimerIcon className="size-4" />
        </Button>
        {starting ? <StartTimerDialog onClose={() => setStarting(false)} /> : null}
      </>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Timer"
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-md border px-2 font-mono text-xs tabular',
            timer.data.running
              ? 'border-success/40 bg-success/10 text-success'
              : 'text-muted-foreground',
          )}
        >
          <span
            className={cn(
              'size-1.5 rounded-full',
              timer.data.running ? 'animate-pulse bg-success' : 'bg-muted-foreground',
            )}
          />
          {formatClock(elapsed)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto">
        <TimerControls timer={timer.data} compact />
      </PopoverContent>
    </Popover>
  );
}
