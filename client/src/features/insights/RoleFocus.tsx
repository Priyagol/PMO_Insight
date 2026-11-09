import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { PERSONA_LABELS, type AnalyticsQuery, type DashboardKpiDto } from '@arihant/shared';
import { ErrorState } from '@/components/common/ErrorState';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { fetchRoleDashboard } from '@/services/api/insights';

const TONE: Record<NonNullable<DashboardKpiDto['tone']>, string> = {
  good: 'border-l-success',
  warning: 'border-l-warning',
  bad: 'border-l-destructive',
};

function Kpi({ k }: { k: DashboardKpiDto }) {
  const body = (
    <div
      className={cn(
        'h-full rounded-xl border border-l-4 bg-card p-3 shadow-xs',
        k.tone ? TONE[k.tone] : 'border-l-border',
        k.link && 'transition-colors hover:bg-muted/40',
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{k.label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular">{k.value}</p>
      {k.hint ? <p className="mt-0.5 text-xs text-muted-foreground">{k.hint}</p> : null}
    </div>
  );
  return k.link ? (
    <Link
      to={k.link}
      className="block h-full rounded-xl focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * Top of the Overview: figures and to-dos picked for the viewer's role (organisation,
 * technology, department, project, team, quality or own work). All computed by the API from
 * records inside the viewer's access.
 */
export function RoleFocus({ query }: { query: Partial<AnalyticsQuery> }) {
  const range = { from: query.from, to: query.to };
  const q = useQuery({
    queryKey: ['insights', 'my-dashboard', range],
    queryFn: () => fetchRoleDashboard(range),
    placeholderData: keepPreviousData,
  });
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-48 w-full" />;
  const d = q.data;
  return (
    <section className="space-y-3" aria-label={PERSONA_LABELS[d.persona]}>
      <div>
        <h2 className="text-sm font-semibold">{PERSONA_LABELS[d.persona]}</h2>
        <p className="text-xs text-muted-foreground">{d.focus}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {d.kpis.map((k) => (
          <Kpi key={k.label} k={k} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-4 shadow-xs" aria-label="Needs attention">
          <h3 className="mb-2 text-sm font-semibold">Needs your attention</h3>
          {d.attention.length ? (
            <ul className="divide-y text-sm">
              {d.attention.map((a) => {
                const inner = (
                  <>
                    <AlertCircle
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        a.tone === 'bad'
                          ? 'text-destructive'
                          : a.tone === 'warning'
                            ? 'text-warning'
                            : 'text-muted-foreground',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block">{a.text}</span>
                      {a.detail ? (
                        <span className="block text-xs text-muted-foreground">{a.detail}</span>
                      ) : null}
                    </span>
                    {a.link ? (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : null}
                  </>
                );
                return (
                  <li key={a.text}>
                    {a.link ? (
                      <Link to={a.link} className="flex gap-2 py-2 hover:bg-muted/40">
                        {inner}
                      </Link>
                    ) : (
                      <div className="flex gap-2 py-2">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-success" aria-hidden /> Nothing needs your
              attention right now.
            </p>
          )}
        </section>
        {d.lists.map((l) => (
          <section
            key={l.title}
            className="rounded-xl border bg-card p-4 shadow-xs"
            aria-label={l.title}
          >
            <h3 className="mb-2 text-sm font-semibold">{l.title}</h3>
            {l.rows.length ? (
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card text-muted-foreground">
                    <tr>
                      {l.columns.map((c, i) => (
                        <th
                          key={c}
                          className={cn('px-2 py-1.5 font-medium', i ? 'text-right' : 'text-left')}
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {l.rows.map((r, ri) => (
                      <tr key={ri}>
                        {r.cells.map((c, i) => (
                          <td
                            key={i}
                            className={cn('px-2 py-1.5', i ? 'text-right tabular' : 'text-left')}
                          >
                            {i === 0 && r.link ? (
                              <Link to={r.link} className="hover:underline">
                                {c}
                              </Link>
                            ) : (
                              c
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing to show.</p>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}
