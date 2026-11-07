import {
  AlertOctagon,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  HeartPulse,
  OctagonAlert,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { EarlyWarningDto, HealthBand, ProjectHealthDto } from '@arihant/shared';
import { HealthBadge } from '@/components/charts/HealthBadge';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDay } from '@/features/work/format';
import { ProgressBar } from '@/features/work/projects/ProgressBar';
import { AnalyticsFilters, useAnalyticsFilters } from './AnalyticsFilters';
import { ExplainHealthButton } from '@/features/intelligence/ai-actions';
import { ForecastBadge, ForecastDetail, RiskScanButton, useForecasts } from './Forecast';
import { useHealth } from './hooks';

const WARNING_STYLE: Record<
  EarlyWarningDto['severity'],
  { icon: typeof AlertTriangle; color: string; label: string }
> = {
  warning: { icon: AlertTriangle, color: 'var(--status-warning)', label: 'Warning' },
  serious: { icon: OctagonAlert, color: 'var(--status-serious)', label: 'Serious' },
  critical: { icon: AlertOctagon, color: 'var(--status-critical)', label: 'Critical' },
};

export function WarningItem({ w, showProject }: { w: EarlyWarningDto; showProject?: boolean }) {
  const s = WARNING_STYLE[w.severity];
  return (
    <li className="flex items-start gap-2 text-sm">
      <s.icon className="mt-0.5 size-4 shrink-0" style={{ color: s.color }} aria-hidden />
      <span>
        <span className="sr-only">{s.label}: </span>
        {showProject ? (
          <Link to={`/projects/${w.project.id}`} className="mr-1 font-mono text-xs hover:underline">
            {w.project.key}
          </Link>
        ) : null}
        {w.message}
      </span>
    </li>
  );
}

/** Factor breakdown: each factor's contribution to the 0–100 score, with the reason. */
export function HealthFactors({ health }: { health: ProjectHealthDto }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-muted-foreground">
        <tr>
          <th className="py-1 text-left font-medium">Factor</th>
          <th className="py-1 text-right font-medium">Weight</th>
          <th className="w-32 py-1 pl-3 text-left font-medium">Score</th>
          <th className="py-1 pl-3 text-left font-medium">Why</th>
        </tr>
      </thead>
      <tbody>
        {health.factors.map((f) => (
          <tr key={f.key} className="border-t">
            <td className="py-1.5">{f.label}</td>
            <td className="py-1.5 text-right tabular">{Math.round(f.weight * 100)}%</td>
            <td className="py-1.5 pl-3">
              <span className="flex items-center gap-2">
                <ProgressBar value={Math.round(f.value * 100)} className="flex-1" />
                <span className="w-8 text-right tabular">{Math.round(f.value * 100)}</span>
              </span>
            </td>
            <td className="py-1.5 pl-3 text-muted-foreground">{f.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ProjectHealthPage() {
  const { state, setState, query } = useAnalyticsFilters();
  const health = useHealth({ departmentId: query.departmentId, projectId: query.projectId });
  const forecasts = useForecasts({ departmentId: query.departmentId, projectId: query.projectId });
  const forecastOf = new Map((forecasts.data ?? []).map((f) => [f.project.id, f]));
  const [band, setBand] = useState<HealthBand | 'all'>('all');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const rows = (health.data ?? []).filter((h) => band === 'all' || h.band === band);
  const counts = { healthy: 0, watch: 0, at_risk: 0 };
  for (const h of health.data ?? []) counts[h.band] += 1;
  const warnings = (health.data ?? []).flatMap((h) => h.warnings);

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Project Health"
        description="Scores from schedule, effort, overdue work, open risks and blocked time. Scores suggest; managers decide status."
        actions={<AnalyticsFilters state={state} onChange={setState} showPeriod={false} />}
      />
      {health.error ? (
        <ErrorState error={health.error} onRetry={() => void health.refetch()} />
      ) : health.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : !health.data?.length ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={HeartPulse}
            title="No active projects to score"
            description="Health is computed for projects that are not completed or cancelled."
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by health">
            <Button
              size="sm"
              variant={band === 'all' ? 'secondary' : 'ghost'}
              aria-pressed={band === 'all'}
              onClick={() => setBand('all')}
            >
              All <span className="tabular text-muted-foreground">{health.data.length}</span>
            </Button>
            {(['at_risk', 'watch', 'healthy'] as const).map((b) => (
              <Button
                key={b}
                size="sm"
                variant={band === b ? 'secondary' : 'ghost'}
                aria-pressed={band === b}
                onClick={() => setBand(b)}
              >
                <HealthBadge band={b} className="border-0 px-0" />{' '}
                <span className="tabular text-muted-foreground">{counts[b]}</span>
              </Button>
            ))}
          </div>

          {warnings.length ? (
            <section className="rounded-xl border bg-card p-4" aria-label="Early warnings">
              <h3 className="mb-2 text-sm font-semibold">Early warnings ({warnings.length})</h3>
              <ul className="max-h-56 space-y-1.5 overflow-auto">
                {warnings.map((w, i) => (
                  <WarningItem key={`${w.project.id}-${w.type}-${i}`} w={w} showProject />
                ))}
              </ul>
            </section>
          ) : null}

          <section className="rounded-xl border bg-card" aria-label="Projects by health">
            <ul className="divide-y">
              {rows.map((h) => {
                const expanded = open.has(h.project.id);
                return (
                  <li key={h.project.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50"
                      aria-expanded={expanded}
                      onClick={() => toggle(h.project.id)}
                    >
                      {expanded ? (
                        <ChevronDown className="size-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          <span className="font-mono text-xs text-muted-foreground">
                            {h.project.key}
                          </span>{' '}
                          {h.project.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {h.manager?.name ?? 'No manager'} · ends {formatDay(h.project.endDate)}
                          {h.warnings.length
                            ? ` · ${h.warnings.length} warning${h.warnings.length === 1 ? '' : 's'}`
                            : ''}
                        </span>
                      </span>
                      <StatusBadge status={h.project.status} />
                      <span className="hidden w-28 sm:block">
                        <ProgressBar value={h.progress} />
                      </span>
                      <span className="hidden w-44 md:block">
                        {forecastOf.get(h.project.id) ? (
                          <ForecastBadge f={forecastOf.get(h.project.id)!} />
                        ) : null}
                      </span>
                      <HealthBadge band={h.band} score={h.score} />
                    </button>
                    {expanded ? (
                      <div className="grid gap-4 border-t bg-muted/20 px-4 py-3 lg:grid-cols-2">
                        <div className="space-y-4">
                          <HealthFactors health={h} />
                          {forecastOf.get(h.project.id) ? (
                            <ForecastDetail f={forecastOf.get(h.project.id)!} />
                          ) : null}
                        </div>
                        <div>
                          {h.warnings.length ? (
                            <ul className="space-y-1.5">
                              {h.warnings.map((w, i) => (
                                <WarningItem key={i} w={w} />
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-muted-foreground">No early warnings.</p>
                          )}
                          <div className="mt-3 flex items-center gap-3">
                            <ExplainHealthButton projectId={h.project.id} />
                            <RiskScanButton projectId={h.project.id} />
                            <Link
                              to={`/projects/${h.project.id}`}
                              className="mt-3 inline-block text-xs text-primary hover:underline"
                            >
                              Open project
                            </Link>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
