import { format, startOfWeek } from 'date-fns';
import { CalendarOff, ListTodo, NotebookPen, Plus, Timer as TimerIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { JournalDto } from '@arihant/shared';
import { EmptyState } from '@/components/common/EmptyState';
import { FormField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
import { PriorityIndicator } from '@/components/common/PriorityIndicator';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { formatDay, relativeDue, todayIso } from '@/features/work/format';
import { useTasks } from '@/features/work/hooks';
import { useTaskDrawer } from '@/features/work/tasks/use-task-drawer';
import { cn } from '@/lib/utils';
import * as t from '@/services/api/tracking';
import { useAppSelector } from '@/store';
import {
  formatMinutes,
  useAvailability,
  useJournals,
  useTimer,
  useTimesheetWeek,
  useTrackMutation,
  useWorklogs,
} from './hooks';
import { AvailabilityBadge, LeaveDialog } from './LeaveDialog';
import { LogWorkDialog } from './LogWorkDialog';
import { StartTimerDialog, TimerControls } from './Timer';
import { TimesheetStatusBadge } from './TimesheetsPage';

const FIELDS: {
  key: keyof Pick<JournalDto, 'completed' | 'inProgress' | 'blockers' | 'tomorrow'>;
  label: string;
}[] = [
  { key: 'completed', label: 'What did you complete today?' },
  { key: 'inProgress', label: 'What are you working on?' },
  { key: 'blockers', label: 'Any blockers?' },
  { key: 'tomorrow', label: 'What will you work on tomorrow?' },
];

/** Today's journal; keyed by the saved entry so the form resets after loading. */
function JournalForm({ entry }: { entry: JournalDto | undefined }) {
  const [draft, setDraft] = useState({
    completed: entry?.completed ?? '',
    inProgress: entry?.inProgress ?? '',
    blockers: entry?.blockers ?? '',
    tomorrow: entry?.tomorrow ?? '',
  });
  const save = useTrackMutation(() => t.saveJournal({ date: todayIso(), ...draft }), {
    success: 'Journal saved',
  });
  const empty = !Object.values(draft).some((v) => v.trim());
  return (
    <div className="space-y-3">
      {FIELDS.map((f) => (
        <FormField key={f.key} label={f.label}>
          <Textarea
            rows={2}
            value={draft[f.key]}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
          />
        </FormField>
      ))}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {entry
            ? `Last saved ${format(new Date(entry.updatedAt), 'HH:mm')}`
            : 'Not saved yet today'}
        </span>
        <Button size="sm" disabled={empty || save.isPending} onClick={() => save.mutate(undefined)}>
          Save journal
        </Button>
      </div>
    </div>
  );
}

function Card({
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string;
  icon: typeof ListTodo;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border bg-card p-4', className)}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-muted-foreground" /> {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function MyWorkspacePage() {
  const user = useAppSelector((s) => s.session.user);
  const drawer = useTaskDrawer();
  const today = todayIso();
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const timer = useTimer();
  const tasks = useTasks({
    assigneeId: 'me',
    status: ['todo', 'in_progress', 'in_review', 'testing', 'blocked'],
    sort: 'dueDate',
    limit: 8,
  });
  const todayLogs = useWorklogs({ from: today, to: today, limit: 50 });
  const week = useTimesheetWeek(weekStart);
  const journal = useJournals({ from: today, to: today, limit: 1 });
  const leave = useAvailability({ scope: 'mine' });
  const [logging, setLogging] = useState(false);
  const [starting, setStarting] = useState(false);
  const [requestingLeave, setRequestingLeave] = useState(false);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${user?.name.split(' ')[0] ?? ''}`}
        description={format(new Date(), 'EEEE, d MMMM yyyy')}
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card
            title="My open tasks"
            icon={ListTodo}
            action={
              <Link to="/tasks/mine" className="text-xs font-medium text-primary hover:underline">
                View all
              </Link>
            }
          >
            {tasks.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : tasks.data?.items.length ? (
              <ul className="divide-y">
                {tasks.data.items.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => drawer.open(task.id)}
                      className="flex w-full items-center gap-3 py-2 text-left text-sm hover:bg-muted/40"
                    >
                      <PriorityIndicator priority={task.priority} showLabel={false} />
                      <span className="font-mono text-xs text-muted-foreground">{task.key}</span>
                      <span className="flex-1 truncate">{task.title}</span>
                      <StatusBadge status={task.status} />
                      <span
                        className={cn(
                          'w-28 text-right text-xs',
                          task.overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {relativeDue(task.dueDate)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon={ListTodo} title="No open tasks assigned to you" />
            )}
          </Card>
          <Card title="Daily work journal" icon={NotebookPen}>
            {journal.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <JournalForm
                key={journal.data?.items[0]?.id ?? 'new'}
                entry={journal.data?.items[0]}
              />
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Timer" icon={TimerIcon}>
            {timer.data ? (
              <TimerControls timer={timer.data} />
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Not tracking.</span>
                <Button size="sm" variant="outline" onClick={() => setStarting(true)}>
                  <TimerIcon /> Start
                </Button>
              </div>
            )}
          </Card>
          <Card
            title="Today"
            icon={TimerIcon}
            action={
              <Button size="sm" variant="ghost" onClick={() => setLogging(true)}>
                <Plus /> Log work
              </Button>
            }
          >
            <p className="text-2xl font-semibold tabular">
              {formatMinutes(todayLogs.data?.meta.totalMinutes ?? 0)}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {todayLogs.data?.items.slice(0, 5).map((l) => (
                <li key={l.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {l.project.key} · {l.description}
                  </span>
                  <span className="tabular">{formatMinutes(l.minutes)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card
            title="This week's timesheet"
            icon={NotebookPen}
            action={
              <Link to="/timesheets" className="text-xs font-medium text-primary hover:underline">
                Open
              </Link>
            }
          >
            {week.data ? (
              <div className="flex items-center justify-between">
                <span className="text-2xl font-semibold tabular">
                  {formatMinutes(week.data.totalMinutes)}
                </span>
                <TimesheetStatusBadge status={week.data.status} />
              </div>
            ) : (
              <Skeleton className="h-8 w-full" />
            )}
          </Card>
          <Card
            title="Leave & availability"
            icon={CalendarOff}
            action={
              <Button size="sm" variant="ghost" onClick={() => setRequestingLeave(true)}>
                <Plus /> Request
              </Button>
            }
          >
            {leave.data?.items.length ? (
              <ul className="space-y-2 text-sm">
                {leave.data.items.slice(0, 4).map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <span>
                      {formatDay(l.from, 'd MMM')}
                      {l.to !== l.from ? ` – ${formatDay(l.to, 'd MMM')}` : ''}{' '}
                      <span className="text-xs text-muted-foreground capitalize">· {l.type}</span>
                    </span>
                    <AvailabilityBadge status={l.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No requests.</p>
            )}
          </Card>
        </div>
      </div>
      <LogWorkDialog open={logging} onOpenChange={setLogging} />
      {starting ? <StartTimerDialog onClose={() => setStarting(false)} /> : null}
      {requestingLeave ? <LeaveDialog onClose={() => setRequestingLeave(false)} /> : null}
    </div>
  );
}
