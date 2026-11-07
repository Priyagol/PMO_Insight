import type { DatesSetArg, EventClickArg, EventDropArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type DateClickArg } from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import { format, subDays } from 'date-fns';
import { useMemo, useState } from 'react';
import type { TaskListQuery } from '@arihant/shared';
import { ErrorState } from '@/components/common/ErrorState';
import * as work from '@/services/api/work';
import { useTasks, useWorkMutation } from '../../hooks';
import { useTaskDrawer } from '../use-task-drawer';

const PRIORITY_COLOR: Record<string, string> = {
  critical: 'var(--destructive)',
  high: 'var(--warning)',
  medium: 'var(--primary)',
  low: 'var(--muted-foreground)',
};
const MAX_EVENTS = 100;

/** Month calendar of task due dates. Drag a task to another day to reschedule it. */
export function CalendarView({
  query,
  onCreateOn,
}: {
  query: Partial<TaskListQuery>;
  onCreateOn?: (date: string) => void;
}) {
  const drawer = useTaskDrawer();
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const fullQuery = useMemo(
    () => ({
      ...query,
      dueFrom: range?.from,
      dueTo: range?.to,
      limit: MAX_EVENTS,
      sort: 'dueDate',
    }),
    [query, range],
  );
  const tasks = useTasks(fullQuery, Boolean(range));
  const reschedule = useWorkMutation(
    ({ id, due }: { id: string; due: string }) => work.updateTask(id, { dueDate: due }),
    {
      success: (t) => `${t.key} moved to ${t.dueDate}`,
    },
  );

  const events = (tasks.data?.items ?? []).map((t) => ({
    id: t.id,
    title: `${t.key} ${t.title}`,
    start: t.dueDate!,
    allDay: true,
    editable: t.can.update && t.status !== 'done' && t.status !== 'cancelled',
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    textColor: 'inherit',
    extendedProps: { overdue: t.overdue, priority: t.priority, done: t.status === 'done' },
  }));

  return (
    <div className="space-y-2">
      {tasks.error ? <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} /> : null}
      {tasks.data && tasks.data.meta.total > MAX_EVENTS ? (
        <p className="text-xs text-warning">
          Showing the first {MAX_EVENTS} of {tasks.data.meta.total} tasks due this month. Narrow the
          filters to see all.
        </p>
      ) : null}
      <div className="aw-calendar rounded-xl border bg-card p-3">
        <FullCalendar
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          firstDay={1}
          height="auto"
          dayMaxEvents={4}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
          events={events}
          datesSet={(arg: DatesSetArg) =>
            setRange({
              from: format(arg.start, 'yyyy-MM-dd'),
              to: format(subDays(arg.end, 1), 'yyyy-MM-dd'),
            })
          }
          eventClick={(arg: EventClickArg) => drawer.open(arg.event.id)}
          eventDrop={(arg: EventDropArg) => {
            const due = format(arg.event.start!, 'yyyy-MM-dd');
            reschedule.mutate({ id: arg.event.id, due }, { onError: () => arg.revert() });
          }}
          dateClick={onCreateOn ? (arg: DateClickArg) => onCreateOn(arg.dateStr) : undefined}
          eventContent={(arg) => (
            <div
              className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-[11px]"
              style={{
                borderLeft: `3px solid ${PRIORITY_COLOR[arg.event.extendedProps.priority as string]}`,
              }}
            >
              <span
                className={
                  arg.event.extendedProps.done
                    ? 'line-through opacity-60'
                    : arg.event.extendedProps.overdue
                      ? 'font-medium text-destructive'
                      : ''
                }
              >
                {arg.event.title}
              </span>
            </div>
          )}
        />
      </div>
    </div>
  );
}
