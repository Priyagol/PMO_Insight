import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FolderKanban,
  ListTodo,
  Users,
} from 'lucide-react';
import { Link } from 'react-router';
import { PRIORITY_LABELS } from '@arihant/shared';
import { HealthBadge } from '@/components/charts/HealthBadge';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { Skeleton } from '@/components/ui/skeleton';
import { AnalyticsFilters, useAnalyticsFilters } from '@/features/insights/AnalyticsFilters';
import {
  CompletionTrendChart,
  PlannedVsActualChart,
  TaskStatusChart,
  WorkloadChart,
} from '@/features/insights/charts';
import { useDashboardActivity, useOverview } from '@/features/insights/hooks';
import { RoleFocus } from '@/features/insights/RoleFocus';
import { ActivityList } from '@/features/work/collab/ActivityList';
import { formatDay, relativeDue } from '@/features/work/format';
import { ProgressBar } from '@/features/work/projects/ProgressBar';
import { PlatformStatusCard } from '@/features/system/components/PlatformStatusCard';
import { useCan } from '@/hooks/use-permission';

const SCOPE_LABEL = {
  organisation: 'Whole organisation',
  department: 'Your department',
  projects: 'Projects you take part in',
  personal: 'Your own work',
} as const;

const num = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 1 });

/**
 * Executive dashboard. Every number is computed by the API from real records inside the
 * viewer's permission scope; nothing here is sample data.
 */
export function OverviewPage() {
  const { state, setState, query } = useAnalyticsFilters();
  const overview = useOverview(query);
  const activity = useDashboardActivity();
  const isAdmin = useCan('settings:manage', 'org');
  const d = overview.data;
  const loading = overview.isLoading;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description={
          d ? (
            <>
              {SCOPE_LABEL[d.scope]} · {formatDay(d.period.from)} – {formatDay(d.period.to)}
            </>
          ) : (
            'One Platform. Every Project. Every Task. Every Hour. Complete Visibility.'
          )
        }
        actions={<AnalyticsFilters state={state} onChange={setState} />}
      />

      {overview.error ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <>
          <RoleFocus query={query} />
          <h2 className="pt-2 text-sm font-semibold">All figures</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <StatCard
              label="Active projects"
              icon={FolderKanban}
              value={d?.projects.active}
              isLoading={loading}
              hint={d ? `${d.projects.total} total` : undefined}
            />
            <StatCard
              label="Delayed projects"
              icon={AlertTriangle}
              value={d?.projects.delayed}
              isLoading={loading}
              hint={d ? `${d.projects.atRisk} at risk` : undefined}
            />
            <StatCard
              label="Open tasks"
              icon={ListTodo}
              value={d?.tasks.open}
              isLoading={loading}
              hint={d ? `${d.tasks.createdInPeriod} created in period` : undefined}
            />
            <StatCard
              label="Completed"
              icon={CheckCircle2}
              value={d?.tasks.completedInPeriod}
              isLoading={loading}
              hint="in period"
            />
            <StatCard
              label="Overdue tasks"
              icon={CalendarClock}
              value={d?.tasks.overdue}
              isLoading={loading}
            />
            <StatCard
              label="Blocked tasks"
              icon={Ban}
              value={d?.tasks.blocked}
              isLoading={loading}
            />
            <StatCard
              label="Hours logged"
              icon={Clock3}
              value={d ? num(d.hours.loggedInPeriod) : undefined}
              isLoading={loading}
              hint={d ? `${num(d.hours.estimatedOpen)} h open estimate` : undefined}
            />
            <StatCard
              label="Avg utilisation"
              icon={Users}
              value={
                d
                  ? d.people?.avgUtilization != null
                    ? `${Math.round(d.people.avgUtilization)}%`
                    : '—'
                  : undefined
              }
              isLoading={loading}
              hint={
                d?.people
                  ? `${d.people.overloaded} overloaded · ${d.people.onLeave} on leave`
                  : d
                    ? 'Not in your scope'
                    : undefined
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <CompletionTrendChart data={d?.completionTrend} isLoading={loading} />
            <TaskStatusChart data={d?.taskStatus} isLoading={loading} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <PlannedVsActualChart data={d?.plannedVsActual} isLoading={loading} />
            {d?.people !== null ? (
              <WorkloadChart data={d?.workload} isLoading={loading} />
            ) : (
              <ProjectHealthSummary health={d?.health} />
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {d?.people !== null ? <ProjectHealthSummary health={d?.health} /> : null}
            <section className="rounded-xl border bg-card p-4 shadow-xs" aria-label="Departments">
              <h3 className="mb-3 text-sm font-semibold">Departments</h3>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : !d?.departments.length ? (
                <p className="text-sm text-muted-foreground">No departments in scope.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1 text-left font-medium">Department</th>
                      <th className="py-1 text-right font-medium">Projects</th>
                      <th className="py-1 text-right font-medium">Open</th>
                      <th className="py-1 text-right font-medium">Overdue</th>
                      <th className="py-1 text-right font-medium">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.departments.map((dep) => (
                      <tr key={dep.id ?? 'none'} className="border-t">
                        <td className="py-1.5">{dep.name}</td>
                        <td className="py-1.5 text-right tabular">{dep.projects}</td>
                        <td className="py-1.5 text-right tabular">{dep.openTasks}</td>
                        <td className="py-1.5 text-right tabular">{dep.overdue}</td>
                        <td className="py-1.5 text-right tabular">{num(dep.loggedHours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section
              className="rounded-xl border bg-card p-4 shadow-xs"
              aria-label="Assignment methods"
            >
              <h3 className="mb-3 text-sm font-semibold">How work was assigned</h3>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : !d?.assignmentMethods.length ? (
                <p className="text-sm text-muted-foreground">No assignments in this period.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {d.assignmentMethods.map((m) => {
                    const total = d.assignmentMethods.reduce((s, x) => s + x.count, 0);
                    return (
                      <li key={m.method}>
                        <div className="flex justify-between text-xs">
                          <span className="capitalize">{m.method}</span>
                          <span className="tabular text-muted-foreground">
                            {m.count} ({Math.round((m.count / total) * 100)}%)
                          </span>
                        </div>
                        <ProgressBar value={Math.round((m.count / total) * 100)} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <section
              className="rounded-xl border bg-card p-4 shadow-xs lg:col-span-2"
              aria-label="Upcoming deadlines"
            >
              <h3 className="mb-3 text-sm font-semibold">Upcoming deadlines (next 14 days)</h3>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : !d || (d.upcoming.projects.length === 0 && d.upcoming.tasks.length === 0) ? (
                <p className="text-sm text-muted-foreground">Nothing due in the next two weeks.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {d.upcoming.projects.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-2">
                      <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <Link
                        to={`/projects/${p.id}`}
                        className="min-w-0 flex-1 truncate hover:underline"
                      >
                        <span className="font-mono text-xs">{p.key}</span> {p.name}
                      </Link>
                      <span className="w-20">
                        <ProgressBar value={p.progress} />
                      </span>
                      <span className="w-32 text-right text-xs text-muted-foreground">
                        {relativeDue(p.endDate)}
                      </span>
                    </li>
                  ))}
                  {d.upcoming.tasks.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 py-2">
                      <ListTodo className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-mono text-xs">{t.key}</span> {t.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {PRIORITY_LABELS[t.priority]}
                      </span>
                      <span className="w-28 truncate text-xs">
                        {t.assignee?.name ?? 'Unassigned'}
                      </span>
                      <span className="w-32 text-right text-xs text-muted-foreground">
                        {relativeDue(t.dueDate)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section
              className="rounded-xl border bg-card p-4 shadow-xs"
              aria-label="Recent activity"
            >
              <h3 className="mb-3 text-sm font-semibold">Recent activity</h3>
              <ActivityList items={activity.data} isLoading={activity.isLoading} showEntity />
            </section>
          </div>
        </>
      )}

      {isAdmin ? <PlatformStatusCard /> : null}
    </div>
  );
}

function ProjectHealthSummary({
  health,
}: {
  health?: { healthy: number; watch: number; at_risk: number };
}) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-xs" aria-label="Project health">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Project health</h3>
        <Link to="/project-health" className="text-xs text-primary hover:underline">
          Details
        </Link>
      </div>
      {!health ? (
        <Skeleton className="h-24 w-full" />
      ) : health.healthy + health.watch + health.at_risk === 0 ? (
        <p className="text-sm text-muted-foreground">No active projects to score.</p>
      ) : (
        <ul className="space-y-2">
          {(['healthy', 'watch', 'at_risk'] as const).map((b) => (
            <li key={b} className="flex items-center justify-between">
              <HealthBadge band={b} />
              <span className="text-lg font-semibold tabular">{health[b]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
