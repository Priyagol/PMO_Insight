import { useSearchParams } from 'react-router';
import {
  TIMELINE_STATE_LABELS,
  type ProjectDelayDto,
  type TimelineProjectDto,
  type TimelineState,
  type UserRef,
} from '@arihant/shared';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDay } from '@/features/work/format';
import { cn } from '@/lib/utils';
import { useProjectDelays } from './hooks';

export const STATE_STYLE: Record<TimelineState, { bar: string; badge: string }> = {
  on_track: {
    bar: 'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  },
  at_risk: {
    bar: 'bg-amber-500',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  },
  late: {
    bar: 'bg-red-500',
    badge: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200',
  },
  done_on_time: {
    bar: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200',
  },
  done_late: {
    bar: 'bg-rose-400',
    badge: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  },
  no_dates: {
    bar: 'bg-slate-300',
    badge: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300',
  },
};

export function StateBadge({ state }: { state: TimelineState }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
        STATE_STYLE[state].badge,
      )}
    >
      {TIMELINE_STATE_LABELS[state]}
    </span>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const dayText = (n: number) => plural(Math.round(n * 10) / 10, 'day');
const name = (u: UserRef | null) => u?.name ?? '—';

/** Opens the task panel (it listens to ?task=) without leaving the page. */
function TaskLink({ id, label }: { id: string; label: string }) {
  const [params, setParams] = useSearchParams();
  return (
    <button
      type="button"
      className="font-mono text-xs text-primary hover:underline"
      onClick={() => {
        const next = new URLSearchParams(params);
        next.set('task', id);
        setParams(next);
      }}
    >
      {label}
    </button>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2" aria-label={title}>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">{children}</table>
      </div>
    </section>
  );
}
const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th
    className={cn(
      'bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground',
      right ? 'text-right' : 'text-left',
    )}
  >
    {children}
  </th>
);
const Td = ({
  children,
  right,
  className,
}: {
  children: React.ReactNode;
  right?: boolean;
  className?: string;
}) => (
  <td className={cn('border-t px-3 py-2 align-top', right && 'text-right tabular', className)}>
    {children}
  </td>
);

/** Baseline, current plan, forecast and how late, as a row of figures. */
export function DelaySummary({ t }: { t: TimelineProjectDto }) {
  const items = [
    { label: 'First planned end', value: formatDay(t.baselineEndDate) },
    { label: 'Current end date', value: formatDay(t.endDate) },
    t.finishedOn
      ? { label: 'Finished on', value: formatDay(t.finishedOn) }
      : {
          label: 'Forecast finish',
          value: t.forecastDate ? formatDay(t.forecastDate) : 'Not enough history',
        },
    { label: 'Late against the first plan', value: t.lateDays ? dayText(t.lateDays) : 'Not late' },
    {
      label: 'End date moved later',
      value: t.slips ? `${plural(t.slips, 'time')} (+${dayText(t.slipDays)})` : 'Never',
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((i) => (
        <div key={i.label} className="rounded-lg border bg-card p-3">
          <dt className="text-xs text-muted-foreground">{i.label}</dt>
          <dd className="mt-1 text-sm font-semibold">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Breakdown({ d }: { d: ProjectDelayDto }) {
  const empty =
    !d.slipHistory.length &&
    !d.lateTasks.length &&
    !d.blocked.length &&
    !d.slowHandoffs.length &&
    !d.approvalWaits.length &&
    !d.dueDatePushes.length &&
    !d.upstream.length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge state={d.timeline.state} />
        {!d.showPeople ? (
          <span className="text-xs text-muted-foreground">
            You see the project picture and your own tasks. Managers also see who was involved.
          </span>
        ) : null}
      </div>
      <DelaySummary t={d.timeline} />
      {empty ? (
        <EmptyState
          compact
          title="No delays recorded"
          description="No late tasks, blocked time, missed approval deadlines or moved dates so far."
        />
      ) : null}

      {d.people.length ? (
        <Section
          title="Where time was lost, by person"
          hint="Facts, not a rating: days tasks finished late, days approvals ran past their deadline and days due dates were moved later. Ask before you judge: the cause is often upstream."
        >
          <thead>
            <tr>
              <Th>Person</Th>
              <Th right>Late tasks</Th>
              <Th right>Days late</Th>
              <Th right>Approval days overdue</Th>
              <Th right>Due dates moved (days)</Th>
            </tr>
          </thead>
          <tbody>
            {d.people.map((p) => (
              <tr key={p.user.id}>
                <Td>{p.user.name}</Td>
                <Td right>{p.lateTasks}</Td>
                <Td right>{p.lateTaskDays}</Td>
                <Td right>{Math.round(p.approvalOverdueDays * 10) / 10}</Td>
                <Td right>{p.dueDatePushDays}</Td>
              </tr>
            ))}
          </tbody>
        </Section>
      ) : null}

      {d.slipHistory.length ? (
        <Section
          title="End date moves"
          hint="Every time the project's end date was moved later, with the reason given."
        >
          <thead>
            <tr>
              <Th>When</Th>
              <Th>From</Th>
              <Th>To</Th>
              <Th right>Days</Th>
              <Th>Reason</Th>
              {d.showPeople ? <Th>Moved by</Th> : null}
            </tr>
          </thead>
          <tbody>
            {d.slipHistory.map((s) => (
              <tr key={s.at}>
                <Td>{formatDay(s.at.slice(0, 10))}</Td>
                <Td>{formatDay(s.from)}</Td>
                <Td>{formatDay(s.to)}</Td>
                <Td right>+{s.days}</Td>
                <Td>
                  {s.reason ?? (
                    <span className="text-muted-foreground">
                      Not recorded (moved before reasons were asked for)
                    </span>
                  )}
                </Td>
                {d.showPeople ? <Td>{name(s.by)}</Td> : null}
              </tr>
            ))}
          </tbody>
        </Section>
      ) : null}

      {d.lateTasks.length ? (
        <Section title="Late tasks" hint="Finished after their due date, or still open past it.">
          <thead>
            <tr>
              <Th>Task</Th>
              <Th>Due</Th>
              <Th>Finished</Th>
              <Th right>Days late</Th>
              {d.showPeople ? <Th>Assignee</Th> : null}
            </tr>
          </thead>
          <tbody>
            {d.lateTasks.map((t) => (
              <tr key={t.id}>
                <Td>
                  <TaskLink id={t.id} label={t.key} /> {t.title}
                </Td>
                <Td>{formatDay(t.dueDate)}</Td>
                <Td>
                  {t.finishedOn ? (
                    formatDay(t.finishedOn)
                  ) : (
                    <span className="text-red-600">Still open</span>
                  )}
                </Td>
                <Td right>{t.daysLate}</Td>
                {d.showPeople ? <Td>{name(t.assignee)}</Td> : null}
              </tr>
            ))}
          </tbody>
        </Section>
      ) : null}

      {d.blocked.length ? (
        <Section
          title="Blocked time"
          hint="How long tasks sat in Blocked, and the note left when they were blocked."
        >
          <thead>
            <tr>
              <Th>Task</Th>
              <Th>Since</Th>
              <Th right>Days</Th>
              <Th>Note</Th>
              {d.showPeople ? <Th>Marked blocked by</Th> : null}
            </tr>
          </thead>
          <tbody>
            {d.blocked.map((b) => (
              <tr key={`${b.id}-${b.since}`}>
                <Td>
                  <TaskLink id={b.id} label={b.key} /> {b.title}
                </Td>
                <Td>{formatDay(b.since.slice(0, 10))}</Td>
                <Td right>
                  {b.days}
                  {b.current ? ' (still blocked)' : ''}
                </Td>
                <Td>{b.comment ?? '—'}</Td>
                {d.showPeople ? <Td>{name(b.markedBy)}</Td> : null}
              </tr>
            ))}
          </tbody>
        </Section>
      ) : null}

      {d.slowHandoffs.length ? (
        <Section
          title="Waiting for review or testing"
          hint="Tasks that waited more than 2 days in In review or Testing before moving on."
        >
          <thead>
            <tr>
              <Th>Task</Th>
              <Th>Stage</Th>
              <Th right>Days</Th>
              {d.showPeople ? <Th>Assignee now</Th> : null}
            </tr>
          </thead>
          <tbody>
            {d.slowHandoffs.map((h, i) => (
              <tr key={`${h.id}-${i}`}>
                <Td>
                  <TaskLink id={h.id} label={h.key} /> {h.title}
                </Td>
                <Td>{h.stage === 'in_review' ? 'In review' : 'Testing'}</Td>
                <Td right>{h.days}</Td>
                {d.showPeople ? <Td>{name(h.assignee)}</Td> : null}
              </tr>
            ))}
          </tbody>
        </Section>
      ) : null}

      {d.approvalWaits.length ? (
        <Section
          title="Approvals past their deadline"
          hint="Approval stages decided after their deadline, or still waiting past it."
        >
          <thead>
            <tr>
              <Th>Request</Th>
              <Th>Stage</Th>
              <Th right>Waited (days)</Th>
              <Th right>Past deadline (days)</Th>
              {d.showPeople ? <Th>Approver</Th> : null}
            </tr>
          </thead>
          <tbody>
            {d.approvalWaits.map((a) => (
              <tr key={`${a.id}-${a.stage}`}>
                <Td>
                  <span className="font-mono text-xs">{a.key}</span> {a.title}
                </Td>
                <Td>
                  {a.stage}
                  {a.pending ? ' (waiting)' : ''}
                </Td>
                <Td right>{a.waitedDays}</Td>
                <Td right>{a.overdueDays}</Td>
                {d.showPeople ? <Td>{a.approvers.map((u) => u.name).join(', ') || '—'}</Td> : null}
              </tr>
            ))}
          </tbody>
        </Section>
      ) : null}

      {d.dueDatePushes.length ? (
        <Section
          title="Task due dates moved later"
          hint="Each time a task's due date was pushed back."
        >
          <thead>
            <tr>
              <Th>Task</Th>
              <Th>From</Th>
              <Th>To</Th>
              <Th right>Days</Th>
              {d.showPeople ? <Th>Moved by</Th> : null}
            </tr>
          </thead>
          <tbody>
            {d.dueDatePushes.map((p, i) => (
              <tr key={`${p.id}-${i}`}>
                <Td>
                  <TaskLink id={p.id} label={p.key} /> {p.title}
                </Td>
                <Td>{formatDay(p.from)}</Td>
                <Td>{formatDay(p.to)}</Td>
                <Td right>+{p.days}</Td>
                {d.showPeople ? <Td>{name(p.by)}</Td> : null}
              </tr>
            ))}
          </tbody>
        </Section>
      ) : null}

      {d.upstream.length ? (
        <Section
          title="Late projects this one waits on"
          hint="Upstream projects past their end date and not finished."
        >
          <thead>
            <tr>
              <Th>Project</Th>
              <Th>End date</Th>
              <Th right>Days late</Th>
            </tr>
          </thead>
          <tbody>
            {d.upstream.map((u) => (
              <tr key={u.id}>
                <Td>
                  <span className="font-mono text-xs">{u.key}</span> {u.name}
                </Td>
                <Td>{formatDay(u.endDate)}</Td>
                <Td right>{u.lateDays}</Td>
              </tr>
            ))}
          </tbody>
        </Section>
      ) : null}
    </div>
  );
}

/** Delay analysis for one project (project page tab and the timeline's expanded row). */
export function DelayAnalysis({ projectId }: { projectId: string }) {
  const q = useProjectDelays(projectId);
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64" />;
  return <Breakdown d={q.data} />;
}
