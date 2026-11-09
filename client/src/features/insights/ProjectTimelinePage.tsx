import {
  addDays,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfMonth,
  addMonths,
} from 'date-fns';
import { ChevronDown, ChevronRight, GanttChart } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  TIMELINE_STATES,
  TIMELINE_STATE_LABELS,
  type TimelineProjectDto,
  type TimelineState,
} from '@arihant/shared';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDay } from '@/features/work/format';
import { cn } from '@/lib/utils';
import { AnalyticsFilters, useAnalyticsFilters } from './AnalyticsFilters';
import { DelayAnalysis, STATE_STYLE, StateBadge } from './DelayAnalysis';
import { useTimeline } from './hooks';

const todayIso = () => format(new Date(), 'yyyy-MM-dd');

/** The dates a row needs on the chart. */
function datesOf(r: TimelineProjectDto): string[] {
  return [
    r.startDate,
    r.baselineEndDate,
    r.endDate,
    r.forecastDate,
    r.finishedOn,
    ...r.milestones.map((m) => m.dueDate),
  ].filter((d): d is string => Boolean(d));
}

function useRange(rows: TimelineProjectDto[]) {
  return useMemo(() => {
    const all = [...rows.flatMap(datesOf), todayIso()].sort();
    const start = startOfMonth(parseISO(all[0]!));
    const end = addMonths(startOfMonth(parseISO(all.at(-1)!)), 1);
    const total = Math.max(1, differenceInCalendarDays(end, start));
    const months: { label: string; left: number; width: number }[] = [];
    for (let m = start; m < end; m = addMonths(m, 1)) {
      const next = addMonths(m, 1);
      months.push({
        label: format(m, months.length === 0 || m.getMonth() === 0 ? 'MMM yyyy' : 'MMM'),
        left: (differenceInCalendarDays(m, start) / total) * 100,
        width: (differenceInCalendarDays(next, m) / total) * 100,
      });
    }
    const pos = (iso: string) => (differenceInCalendarDays(parseISO(iso), start) / total) * 100;
    return {
      months,
      pos,
      end: (iso: string) => pos(format(addDays(parseISO(iso), 1), 'yyyy-MM-dd')),
    };
  }, [rows]);
}

function Bars({
  r,
  pos,
  end,
}: {
  r: TimelineProjectDto;
  pos: (d: string) => number;
  end: (d: string) => number;
}) {
  const start = r.startDate ?? r.baselineEndDate ?? r.endDate;
  if (!start || !r.endDate)
    return <span className="pl-2 text-xs text-muted-foreground">No dates set</span>;
  const planLeft = pos(start);
  const planEnd = end(r.endDate);
  const baseEnd = r.baselineEndDate ? end(r.baselineEndDate) : planEnd;
  const finish =
    r.finishedOn ?? (r.forecastDate && r.forecastDate > r.endDate ? r.forecastDate : null);
  const style = STATE_STYLE[r.state];
  const title = [
    `${r.project.key}: ${TIMELINE_STATE_LABELS[r.state]}`,
    `Start ${formatDay(r.startDate)}`,
    `First planned end ${formatDay(r.baselineEndDate)}`,
    `Current end ${formatDay(r.endDate)}`,
    r.finishedOn
      ? `Finished ${formatDay(r.finishedOn)}`
      : r.forecastDate
        ? `Forecast ${formatDay(r.forecastDate)}`
        : '',
    `${r.progress}% done`,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <div className="relative h-full" title={title}>
      {/* Plan up to the first planned end. */}
      <div
        className={cn('absolute top-2 h-4 rounded-sm opacity-90', style.bar)}
        style={{
          left: `${planLeft}%`,
          width: `${Math.max(0.4, Math.min(baseEnd, planEnd) - planLeft)}%`,
        }}
      >
        <div className="h-full rounded-sm bg-black/20" style={{ width: `${r.progress}%` }} />
      </div>
      {/* Extension: end date moved later than first planned. */}
      {planEnd > baseEnd ? (
        <div
          className="absolute top-2 h-4 rounded-r-sm border border-amber-500 bg-[repeating-linear-gradient(45deg,var(--color-amber-300)_0_4px,transparent_4px_8px)]"
          style={{ left: `${baseEnd}%`, width: `${planEnd - baseEnd}%` }}
        />
      ) : null}
      {/* Forecast or actual finish beyond the plan. */}
      {finish && end(finish) > planEnd ? (
        <div
          className="absolute top-[15px] h-0 border-t-2 border-dotted border-red-500"
          style={{ left: `${planEnd}%`, width: `${end(finish) - planEnd}%` }}
        />
      ) : null}
      {finish ? (
        <div
          className={cn(
            'absolute top-[10px] size-2.5 rotate-45',
            r.finishedOn
              ? 'bg-slate-700 dark:bg-slate-200'
              : 'border-2 border-red-500 bg-background',
          )}
          style={{ left: `calc(${end(finish)}% - 5px)` }}
        />
      ) : null}
      {r.milestones.map((m) => (
        <div
          key={`${m.name}-${m.dueDate}`}
          title={`Milestone: ${m.name} (${formatDay(m.dueDate)})${m.late ? ', late' : ''}`}
          className={cn(
            'absolute bottom-0.5 size-2 rotate-45',
            m.late ? 'bg-red-500' : m.status === 'completed' ? 'bg-emerald-600' : 'bg-sky-500',
          )}
          style={{ left: `calc(${pos(m.dueDate)}% - 4px)` }}
        />
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {(['on_track', 'at_risk', 'late', 'done_late', 'done_on_time'] as TimelineState[]).map(
        (s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn('h-2.5 w-4 rounded-sm', STATE_STYLE[s].bar)} />{' '}
            {TIMELINE_STATE_LABELS[s]}
          </span>
        ),
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm border border-amber-500 bg-[repeating-linear-gradient(45deg,var(--color-amber-300)_0_3px,transparent_3px_6px)]" />{' '}
        End date moved later
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-4 border-t-2 border-dotted border-red-500" /> Forecast past the plan
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rotate-45 bg-sky-500" /> Milestone
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-px bg-primary" /> Today
      </span>
    </div>
  );
}

/** Management → Project Timeline: every project on one time axis, with what slipped and why. */
export function ProjectTimelinePage() {
  const { state, setState, query } = useAnalyticsFilters();
  const q = useTimeline({ departmentId: query.departmentId });
  const [filter, setFilter] = useState<TimelineState | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(
    () => (q.data ?? []).filter((r) => filter === 'all' || r.state === filter),
    [q.data, filter],
  );
  const { months, pos, end } = useRange(rows.length ? rows : (q.data ?? []));
  const counts = useMemo(() => {
    const c: Partial<Record<TimelineState, number>> = {};
    for (const r of q.data ?? []) c[r.state] = (c[r.state] ?? 0) + 1;
    return c;
  }, [q.data]);
  const todayLeft = pos(todayIso());

  return (
    <div className="space-y-5">
      <PageHeader
        title="Project Timeline"
        description="Every project on one time line: the first planned end, every time the end date moved, the forecast and what caused the delay."
        actions={
          <AnalyticsFilters
            state={state}
            onChange={setState}
            showPeriod={false}
            showProject={false}
          />
        }
      />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-96" />
      ) : !q.data.length ? (
        <EmptyState
          icon={GanttChart}
          title="No projects to show"
          description="Projects you can see appear here once they have dates."
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
            {(['all', ...TIMELINE_STATES] as const).map((s) =>
              s !== 'all' && !counts[s] ? null : (
                <button
                  key={s}
                  type="button"
                  aria-pressed={filter === s}
                  onClick={() => setFilter(s)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium',
                    filter === s
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-card hover:bg-muted',
                  )}
                >
                  {s === 'all'
                    ? `All (${q.data.length})`
                    : `${TIMELINE_STATE_LABELS[s]} (${counts[s]})`}
                </button>
              ),
            )}
          </div>
          <Legend />
          <div className="overflow-x-auto rounded-xl border bg-card">
            <div className="min-w-[900px]">
              <div className="flex border-b text-xs text-muted-foreground">
                <div className="w-72 shrink-0 px-3 py-2 font-medium">Project</div>
                <div className="relative h-8 flex-1">
                  {months.map((m) => (
                    <div
                      key={m.left}
                      className="absolute top-0 h-full border-l px-1.5 py-2"
                      style={{ left: `${m.left}%`, width: `${m.width}%` }}
                    >
                      {m.label}
                    </div>
                  ))}
                </div>
              </div>
              <ul>
                {rows.map((r) => {
                  const expanded = open === r.project.id;
                  return (
                    <li key={r.project.id} className="border-b last:border-b-0">
                      <div className="flex">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => setOpen(expanded ? null : r.project.id)}
                          className="flex w-72 shrink-0 items-start gap-1.5 px-3 py-2 text-left hover:bg-muted/50"
                        >
                          {expanded ? (
                            <ChevronDown className="mt-0.5 size-4 shrink-0" />
                          ) : (
                            <ChevronRight className="mt-0.5 size-4 shrink-0" />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              <span className="font-mono text-xs text-muted-foreground">
                                {r.project.key}
                              </span>{' '}
                              {r.project.name}
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <StateBadge state={r.state} />
                              {r.lateDays ? (
                                <span className="text-red-600">{r.lateDays} d late</span>
                              ) : null}
                              {r.slips ? <span>moved {r.slips}×</span> : null}
                            </span>
                          </span>
                        </button>
                        <div className="relative flex-1 border-l">
                          {months.map((m) => (
                            <div
                              key={m.left}
                              className="absolute top-0 h-full border-l border-dashed border-border/60"
                              style={{ left: `${m.left}%` }}
                            />
                          ))}
                          <div
                            className="absolute top-0 z-10 h-full w-px bg-primary"
                            style={{ left: `${todayLeft}%` }}
                            aria-hidden
                          />
                          <div className="absolute inset-x-0 top-2 h-8">
                            <Bars r={r} pos={pos} end={end} />
                          </div>
                        </div>
                      </div>
                      {expanded ? (
                        <div className="space-y-3 border-t bg-muted/20 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span>
                              Manager: <strong>{r.manager?.name ?? '—'}</strong> · {r.progress}%
                              done
                              {r.dependsOn.length
                                ? ` · waits on ${r.dependsOn.map((d) => d.key).join(', ')}`
                                : ''}
                            </span>
                            <Link
                              to={`/projects/${r.project.id}?tab=delays`}
                              className="text-primary hover:underline"
                            >
                              Open the project
                            </Link>
                          </div>
                          <DelayAnalysis projectId={r.project.id} />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
