import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react';
import { Link } from 'react-router';
import { STATUS_LABELS, type AnalyticsQuery, type Rag, type TrendDirection } from '@arihant/shared';
import { ErrorState } from '@/components/common/ErrorState';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDay } from '@/features/work/format';
import { cn } from '@/lib/utils';
import { useBottlenecks, useProjectStatus, useTrends, useWorkSummary } from './hooks';

const RAG_STYLE: Record<Rag, { label: string; tone: string }> = {
  red: { label: 'Red', tone: 'bg-destructive/10 text-destructive' },
  amber: { label: 'Amber', tone: 'bg-warning/10 text-warning' },
  green: { label: 'Green', tone: 'bg-success/10 text-success' },
};

const TREND: Record<TrendDirection, { label: string; icon: typeof Minus; tone: string }> = {
  improving: { label: 'Improving', icon: ArrowUpRight, tone: 'text-success' },
  declining: { label: 'Declining', icon: ArrowDownRight, tone: 'text-destructive' },
  steady: { label: 'Steady', icon: ArrowRight, tone: 'text-muted-foreground' },
  not_enough_data: { label: 'Too little data', icon: Minus, tone: 'text-muted-foreground' },
};

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Highlights({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((h) => (
        <li key={h}>{h}</li>
      ))}
    </ul>
  );
}

function Loading<T>({
  q,
  children,
}: {
  q: { data?: T; error: unknown; isLoading: boolean; refetch: () => unknown };
  children: (data: T) => React.ReactNode;
}) {
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <Skeleton className="h-40 w-full" />;
  return <>{children(q.data)}</>;
}

const th = 'px-2 py-1.5 text-left font-medium';
const td = 'px-2 py-1.5';

/**
 * Management summaries built from the records themselves — they work without an AI service.
 * Each sentence comes from counts that can be checked on the other pages.
 */
export function SummariesTab({ query }: { query: Partial<AnalyticsQuery> }) {
  const status = useProjectStatus(query);
  const work = useWorkSummary(query);
  const trends = useTrends(query.departmentId);
  const bottlenecks = useBottlenecks(query);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Computed from tasks, work logs, journals and status history in your access scope. No AI
        service is used, so these work on every installation.
      </p>
      <Card
        title="Project status"
        description="Red, amber or green per active project, with the reasons behind each colour."
      >
        <Loading q={status}>
          {(d) => (
            <>
              <Highlights items={d.highlights} />
              {d.projects.length ? (
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card text-muted-foreground">
                      <tr>
                        <th className={th}>Project</th>
                        <th className={th}>Status</th>
                        <th className={cn(th, 'text-right')}>Health</th>
                        <th className={cn(th, 'text-right')}>Progress</th>
                        <th className={cn(th, 'text-right')}>Finished</th>
                        <th className={cn(th, 'text-right')}>Overdue</th>
                        <th className={th}>Why</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {d.projects.map((p) => (
                        <tr key={p.project.id}>
                          <td className={td}>
                            <Link className="hover:underline" to={`/projects/${p.project.id}`}>
                              <span className="font-mono">{p.project.key}</span> {p.project.name}
                            </Link>
                          </td>
                          <td className={td}>
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 font-medium',
                                RAG_STYLE[p.rag].tone,
                              )}
                            >
                              {RAG_STYLE[p.rag].label}
                            </span>
                          </td>
                          <td className={cn(td, 'text-right tabular')}>{p.healthScore}</td>
                          <td className={cn(td, 'text-right tabular')}>{p.progress}%</td>
                          <td className={cn(td, 'text-right tabular')}>{p.completedInPeriod}</td>
                          <td className={cn(td, 'text-right tabular')}>{p.overdue}</td>
                          <td className={cn(td, 'text-muted-foreground')}>{p.notes.join(' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </Loading>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Work summary"
          description="Who finished, handed over or started what in the period, and reported blockers."
        >
          <Loading q={work}>
            {(d) => (
              <>
                <p className="text-xs text-muted-foreground">
                  {formatDay(d.period.from)} – {formatDay(d.period.to)}
                </p>
                <Highlights items={d.highlights} />
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card text-muted-foreground">
                      <tr>
                        <th className={th}>Person</th>
                        <th className={cn(th, 'text-right')}>Hours</th>
                        <th className={cn(th, 'text-right')}>Finished</th>
                        <th className={cn(th, 'text-right')}>Handed over</th>
                        <th className={cn(th, 'text-right')}>Overdue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {d.people.map((p) => (
                        <tr key={p.user.id}>
                          <td className={td}>
                            {p.user.name}
                            {p.blockers.length ? (
                              <p className="text-muted-foreground">Blocker: {p.blockers[0]}</p>
                            ) : null}
                          </td>
                          <td
                            className={cn(
                              td,
                              'text-right tabular',
                              p.noTimeLogged && 'text-warning',
                            )}
                          >
                            {p.loggedHours}
                          </td>
                          <td
                            className={cn(td, 'text-right tabular')}
                            title={p.completed.map((t) => t.key).join(', ')}
                          >
                            {p.completed.length}
                          </td>
                          <td className={cn(td, 'text-right tabular')}>{p.handedOver}</td>
                          <td
                            className={cn(
                              td,
                              'text-right tabular',
                              p.overdue && 'text-destructive',
                            )}
                          >
                            {p.overdue}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Loading>
        </Card>

        <Card
          title="Delivery trends"
          description="Tasks finished per week over the last 8 full weeks: the last 4 against the 4 before. Counts tasks, not their size."
        >
          <Loading q={trends}>
            {(d) => (
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card text-muted-foreground">
                    <tr>
                      <th className={th}>Person</th>
                      <th className={th}>Per week</th>
                      <th className={th}>Trend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {d.people.map((p) => {
                      const t = TREND[p.direction];
                      const max = Math.max(1, ...p.completedPerWeek);
                      return (
                        <tr key={p.user.id}>
                          <td className={td}>{p.user.name}</td>
                          <td className={td}>
                            <div
                              className="flex h-6 items-end gap-0.5"
                              role="img"
                              aria-label={`Finished per week: ${p.completedPerWeek.join(', ')}`}
                            >
                              {p.completedPerWeek.map((n, i) => (
                                <span
                                  key={d.weeks[i]}
                                  title={`Week of ${d.weeks[i]}: ${n}`}
                                  className={cn(
                                    'w-2 rounded-sm',
                                    i === p.completedPerWeek.length - 1
                                      ? 'bg-muted-foreground/40'
                                      : 'bg-primary',
                                  )}
                                  style={{ height: `${Math.max(8, (n / max) * 100)}%` }}
                                />
                              ))}
                            </div>
                          </td>
                          <td className={td} title={p.explanation}>
                            <span className={cn('inline-flex items-center gap-1', t.tone)}>
                              <t.icon className="size-3.5" /> {t.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Loading>
        </Card>
      </div>

      <Card
        title="Recurring bottlenecks"
        description="Where work waits longest, where it is sent back, and what keeps getting stuck."
      >
        <Loading q={bottlenecks}>
          {(d) => (
            <>
              <Highlights items={d.findings} />
              <div className="grid gap-4 text-xs md:grid-cols-3">
                <div>
                  <h3 className="mb-1 font-medium">Average wait by status</h3>
                  {d.statusWaits.length ? (
                    <ul className="space-y-0.5">
                      {d.statusWaits.map((w) => (
                        <li key={w.status} className="flex justify-between gap-2">
                          <span>{STATUS_LABELS[w.status]}</span>
                          <span className="tabular text-muted-foreground">
                            {w.averageHours} h · {w.moves} moves
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">No status changes in the period.</p>
                  )}
                </div>
                <div>
                  <h3 className="mb-1 font-medium">Sent back most</h3>
                  {d.rework.length ? (
                    <ul className="space-y-0.5">
                      {d.rework.map((r) => (
                        <li key={r.project.id} className="flex justify-between gap-2">
                          <span>{r.project.key}</span>
                          <span className="tabular text-muted-foreground">{r.sentBack}×</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">Nothing sent back.</p>
                  )}
                </div>
                <div>
                  <h3 className="mb-1 font-medium">Tags on stuck work</h3>
                  {d.recurringTags.length ? (
                    <ul className="space-y-0.5">
                      {d.recurringTags.map((t) => (
                        <li key={t.tag} className="flex justify-between gap-2">
                          <span>{t.tag}</span>
                          <span className="tabular text-muted-foreground">{t.tasks} tasks</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">No tag repeats on stuck work.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </Loading>
      </Card>
    </div>
  );
}
