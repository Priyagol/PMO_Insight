import { HealthBadge } from '@/components/charts/HealthBadge';
import { ErrorState } from '@/components/common/ErrorState';
import { StatCard } from '@/components/common/StatCard';
import { BurndownChart, CumulativeFlowChart, ThroughputChart } from './charts';
import { useProjectAnalytics } from './hooks';
import { HealthFactors, WarningItem } from './ProjectHealthPage';

export function ProjectAnalyticsTab({ projectId }: { projectId: string }) {
  const a = useProjectAnalytics(projectId);
  if (a.error) return <ErrorState error={a.error} onRetry={() => void a.refetch()} />;
  const d = a.data;
  const loading = a.isLoading;
  const onTimePct =
    d && d.onTime.onTime + d.onTime.late > 0
      ? Math.round((d.onTime.onTime / (d.onTime.onTime + d.onTime.late)) * 100)
      : null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Health"
          value={
            d ? (
              <HealthBadge band={d.health.band} score={d.health.score} className="text-sm" />
            ) : undefined
          }
          isLoading={loading}
        />
        <StatCard
          label="Tasks completed"
          value={d?.onTime.completed}
          isLoading={loading}
          hint={d ? `${d.onTime.noDueDate} had no due date` : undefined}
        />
        <StatCard
          label="On-time delivery"
          value={d ? (onTimePct === null ? '—' : `${onTimePct}%`) : undefined}
          isLoading={loading}
          hint={d ? `${d.onTime.onTime} on time · ${d.onTime.late} late` : undefined}
        />
        <StatCard
          label="Avg cycle time"
          value={d ? (d.avgCycleDays === null ? '—' : `${d.avgCycleDays} d`) : undefined}
          isLoading={loading}
          hint="Created to done"
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <BurndownChart data={d?.burndown} isLoading={loading} />
        <ThroughputChart data={d?.throughput} isLoading={loading} />
      </div>
      <CumulativeFlowChart data={d?.flow} isLoading={loading} />
      {d ? (
        <section
          className="grid gap-4 rounded-xl border bg-card p-4 lg:grid-cols-2"
          aria-label="Health breakdown"
        >
          <div>
            <h3 className="mb-2 text-sm font-semibold">Health breakdown</h3>
            <HealthFactors health={d.health} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Early warnings</h3>
            {d.health.warnings.length ? (
              <ul className="space-y-1.5">
                {d.health.warnings.map((w, i) => (
                  <WarningItem key={i} w={w} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No early warnings.</p>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
