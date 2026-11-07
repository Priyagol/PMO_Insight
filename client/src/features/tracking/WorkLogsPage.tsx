import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Lock,
  Pencil,
  Plus,
  Timer as TimerIcon,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { WORK_CATEGORY_LABELS, type WorklogDto } from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import * as t from '@/services/api/tracking';
import { formatMinutes, useTimer, useTrackMutation, useWorklogs } from './hooks';
import { LogWorkDialog } from './LogWorkDialog';
import { StartTimerDialog, TimerControls } from './Timer';

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

export function WeekNavigator({
  weekStart,
  onChange,
}: {
  weekStart: string;
  onChange: (w: string) => void;
}) {
  const start = parseISO(weekStart);
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        aria-label="Previous week"
        onClick={() => onChange(iso(addDays(start, -7)))}
      >
        <ChevronLeft />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange(iso(startOfWeek(new Date(), { weekStartsOn: 1 })))}
      >
        This week
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        aria-label="Next week"
        onClick={() => onChange(iso(addDays(start, 7)))}
      >
        <ChevronRight />
      </Button>
      <span className="text-sm font-medium">
        {format(start, 'd MMM')} – {format(addDays(start, 6), 'd MMM yyyy')}
      </span>
    </div>
  );
}

export function WorkLogsPage() {
  const [weekStart, setWeekStart] = useState(() =>
    iso(startOfWeek(new Date(), { weekStartsOn: 1 })),
  );
  const [editing, setEditing] = useState<WorklogDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<WorklogDto | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useTimer();
  const logs = useWorklogs({
    from: weekStart,
    to: iso(addDays(parseISO(weekStart), 6)),
    limit: 100,
  });
  const remove = useTrackMutation((id: string) => t.deleteWorklog(id), {
    success: 'Work log deleted',
  });

  const days = Array.from({ length: 7 }, (_, i) => iso(addDays(parseISO(weekStart), i)));
  const byDay = new Map(days.map((d) => [d, (logs.data?.items ?? []).filter((l) => l.date === d)]));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Work Logs"
        description="Record what you worked on. Time flows into task actuals and your weekly timesheet."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> Log work
          </Button>
        }
      />
      <section className="rounded-xl border bg-card p-4">
        {timer.data ? (
          <TimerControls timer={timer.data} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm">
              <TimerIcon className="size-5 text-muted-foreground" />
              <span>No timer running. Start one when you begin a piece of work.</span>
            </div>
            <Button variant="outline" onClick={() => setStarting(true)}>
              <TimerIcon /> Start timer
            </Button>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <WeekNavigator weekStart={weekStart} onChange={setWeekStart} />
        <span className="text-sm text-muted-foreground">
          Week total{' '}
          <strong className="text-foreground tabular">
            {formatMinutes(logs.data?.meta.totalMinutes ?? 0)}
          </strong>
        </span>
      </div>

      {logs.error ? (
        <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
      ) : logs.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : logs.data?.items.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={Clock3}
            title="Nothing logged this week"
            action={
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus /> Log work
              </Button>
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {days.map((d) => {
            const entries = byDay.get(d) ?? [];
            if (!entries.length) return null;
            return (
              <section key={d} className="rounded-xl border bg-card">
                <header className="flex items-center justify-between border-b px-4 py-2 text-sm">
                  <span className="font-medium">{format(parseISO(d), 'EEEE, d MMM')}</span>
                  <span className="text-muted-foreground tabular">
                    {formatMinutes(entries.reduce((s, l) => s + l.minutes, 0))}
                  </span>
                </header>
                <ul className="divide-y">
                  {entries.map((l) => (
                    <li key={l.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                      <span className="w-16 shrink-0 font-medium tabular">
                        {formatMinutes(l.minutes)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{l.description}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {l.project.key}
                          {l.task ? ` · ${l.task.key} ${l.task.title}` : ''} ·{' '}
                          {WORK_CATEGORY_LABELS[l.category]}
                          {l.startTime ? ` · ${l.startTime}–${l.endTime}` : ''}
                          {l.source === 'timer' ? ' · timer' : ''}
                        </p>
                      </div>
                      {l.locked ? (
                        <span
                          title="Locked by a submitted timesheet"
                          className="text-muted-foreground"
                        >
                          <Lock className="size-4" />
                        </span>
                      ) : (
                        <span className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label="Edit entry"
                            onClick={() => setEditing(l)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label="Delete entry"
                            onClick={() => setDeleting(l)}
                          >
                            <Trash2 />
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <LogWorkDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        log={editing && editing !== 'new' ? editing : undefined}
      />
      {starting ? <StartTimerDialog onClose={() => setStarting(false)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this entry?"
        description={
          deleting
            ? `${formatMinutes(deleting.minutes)} on ${deleting.project.key}: ${deleting.description}`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await remove.mutateAsync(deleting!.id);
        }}
      />
    </div>
  );
}
