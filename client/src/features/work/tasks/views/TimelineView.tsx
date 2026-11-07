import {
  addDays,
  differenceInCalendarDays,
  format,
  isWeekend,
  parseISO,
  startOfWeek,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Link2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { TaskDto, TaskListQuery } from '@arihant/shared';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import * as work from '@/services/api/work';
import { useTasks, useWorkMutation } from '../../hooks';
import { useTaskDrawer } from '../use-task-drawer';

const DAY = 32; // px per day
const DAYS = 42; // six weeks visible
const iso = (d: Date) => format(d, 'yyyy-MM-dd');

const BAR_TONE: Record<string, string> = {
  done: 'bg-success/80',
  blocked: 'bg-destructive/80',
  in_progress: 'bg-primary',
  in_review: 'bg-violet',
  testing: 'bg-info',
};

interface DragState {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  delta: number;
}

/** Gantt-style timeline: drag a bar to shift its dates, drag its right edge to change the due date. */
export function TimelineView({ query }: { query: Partial<TaskListQuery> }) {
  const drawer = useTaskDrawer();
  const [windowStart, setWindowStart] = useState(() =>
    startOfWeek(addDays(new Date(), -7), { weekStartsOn: 1 }),
  );
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const tasks = useTasks({ ...query, limit: 100, sort: 'startDate' });
  const save = useWorkMutation(
    ({ id, start, due }: { id: string; start: string | null; due: string | null }) =>
      work.updateTask(id, { startDate: start, dueDate: due }),
    { success: (t) => `${t.key} rescheduled` },
  );

  const days = useMemo(
    () => Array.from({ length: DAYS }, (_, i) => addDays(windowStart, i)),
    [windowStart],
  );
  const scheduled = (tasks.data?.items ?? []).filter((t) => t.startDate || t.dueDate);
  const unscheduled = (tasks.data?.items.length ?? 0) - scheduled.length;
  const todayOffset = differenceInCalendarDays(new Date(), windowStart);

  const span = (t: TaskDto, d?: DragState | null) => {
    let start = parseISO(t.startDate ?? t.dueDate!);
    let end = parseISO(t.dueDate ?? t.startDate!);
    if (d?.id === t.id) {
      if (d.mode === 'move') start = addDays(start, d.delta);
      end = addDays(end, d.delta);
      if (end < start) end = start;
    }
    return {
      start,
      end,
      left: differenceInCalendarDays(start, windowStart),
      length: differenceInCalendarDays(end, start) + 1,
    };
  };

  const beginDrag = (e: React.PointerEvent, t: TaskDto, mode: DragState['mode']) => {
    if (!t.can.update) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: t.id, mode, startX: e.clientX, delta: 0 };
    setDrag(dragRef.current);
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const delta = Math.round((e.clientX - dragRef.current.startX) / DAY);
    if (delta !== dragRef.current.delta) {
      dragRef.current = { ...dragRef.current, delta };
      setDrag(dragRef.current);
    }
  };
  const endDrag = (t: TaskDto) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (d.delta === 0) return drawer.open(t.id);
    const { start, end } = span(t, d);
    save.mutate({
      id: t.id,
      start: t.startDate || d.mode === 'move' ? iso(start) : (t.startDate ?? null),
      due: iso(end),
    });
  };

  if (tasks.error) return <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          aria-label="Previous weeks"
          onClick={() => setWindowStart((d) => addDays(d, -28))}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setWindowStart(startOfWeek(addDays(new Date(), -7), { weekStartsOn: 1 }))}
        >
          Today
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          aria-label="Next weeks"
          onClick={() => setWindowStart((d) => addDays(d, 28))}
        >
          <ChevronRight />
        </Button>
        <span className="text-sm font-medium">
          {format(days[0]!, 'd MMM')} – {format(days[DAYS - 1]!, 'd MMM yyyy')}
        </span>
        {unscheduled > 0 ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {unscheduled} task(s) without dates are not shown
          </span>
        ) : null}
      </div>

      {!tasks.data ? (
        <Skeleton className="h-80 w-full" />
      ) : scheduled.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            title="Nothing scheduled"
            description="Give tasks a start or due date to see them on the timeline."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <div style={{ width: 280 + DAYS * DAY }} className="relative">
            {/* Header */}
            <div className="sticky top-0 z-10 flex border-b bg-card">
              <div className="sticky left-0 z-20 w-[280px] shrink-0 border-r bg-card px-3 py-2 text-xs font-medium text-muted-foreground">
                Task
              </div>
              {days.map((d) => (
                <div
                  key={d.toISOString()}
                  style={{ width: DAY }}
                  className={cn(
                    'shrink-0 py-1 text-center text-[10px] leading-tight',
                    isWeekend(d) && 'bg-muted/50',
                  )}
                >
                  <div className="text-muted-foreground">{format(d, 'EEEEE')}</div>
                  <div
                    className={cn(
                      'font-medium tabular',
                      iso(d) === iso(new Date()) && 'text-primary',
                    )}
                  >
                    {format(d, 'd')}
                  </div>
                </div>
              ))}
            </div>
            {/* Rows */}
            {scheduled.map((t) => {
              const s = span(t, drag);
              const visible = s.left + s.length > 0 && s.left < DAYS;
              return (
                <div key={t.id} className="flex h-10 items-center border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => drawer.open(t.id)}
                    className="sticky left-0 z-10 flex h-full w-[280px] shrink-0 items-center gap-2 border-r bg-card px-3 text-left hover:bg-muted/50"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">{t.key}</span>
                    <span className="truncate text-sm">{t.title}</span>
                    {t.dependencies.length ? (
                      <span
                        title={`Depends on ${t.dependencies.map((d) => d.key).join(', ')}`}
                        className="ml-auto text-muted-foreground"
                      >
                        <Link2 className="size-3.5" />
                      </span>
                    ) : null}
                  </button>
                  <div className="relative h-full" style={{ width: DAYS * DAY }}>
                    {days.map((d, i) =>
                      isWeekend(d) ? (
                        <div
                          key={i}
                          className="absolute inset-y-0 bg-muted/40"
                          style={{ left: i * DAY, width: DAY }}
                        />
                      ) : null,
                    )}
                    {visible ? (
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`${t.key} ${format(s.start, 'd MMM')} to ${format(s.end, 'd MMM')}`}
                        onPointerDown={(e) => beginDrag(e, t, 'move')}
                        onPointerMove={moveDrag}
                        onPointerUp={() => endDrag(t)}
                        onKeyDown={(e) => e.key === 'Enter' && drawer.open(t.id)}
                        className={cn(
                          'absolute top-2 flex h-6 items-center overflow-hidden rounded-md px-2 text-[11px] text-white shadow-xs select-none',
                          BAR_TONE[t.status] ?? 'bg-slate-400',
                          t.can.update ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                          t.overdue && 'ring-2 ring-destructive',
                          drag?.id === t.id && 'opacity-80 shadow-md',
                        )}
                        style={{
                          left: Math.max(s.left, 0) * DAY + 2,
                          width:
                            Math.max(Math.min(s.left + s.length, DAYS) - Math.max(s.left, 0), 1) *
                              DAY -
                            4,
                        }}
                      >
                        <span className="truncate">{t.title}</span>
                        {t.can.update ? (
                          <span
                            aria-hidden
                            onPointerDown={(e) => beginDrag(e, t, 'resize')}
                            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/30"
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {todayOffset >= 0 && todayOffset < DAYS ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-px bg-primary"
                style={{ left: 280 + todayOffset * DAY + DAY / 2 }}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
