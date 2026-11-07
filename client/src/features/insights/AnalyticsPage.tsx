import { Download, FileSpreadsheet, FileText, Loader2, ScrollText, Printer } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PRIORITY_LABELS, type AnalyticsQuery, type ManagementSnapshotDto } from '@arihant/shared';
import { HealthBadge } from '@/components/charts/HealthBadge';
import { ErrorState } from '@/components/common/ErrorState';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDay } from '@/features/work/format';
import { errorMessage } from '@/lib/errors';
import { downloadFile } from '@/services/api/insights';
import { AnalyticsFilters, useAnalyticsFilters } from './AnalyticsFilters';
import {
  CompletionTrendChart,
  HoursChart,
  PlannedVsActualChart,
  TaskStatusChart,
  WorkloadChart,
} from './charts';
import { useHours, useOverview, useSnapshot } from './hooks';

const GROUPS = [
  { value: 'project', label: 'By project' },
  { value: 'user', label: 'By person' },
  { value: 'category', label: 'By category' },
  { value: 'week', label: 'By week' },
] as const;

const params = (q: Partial<AnalyticsQuery>) =>
  Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;

export function AnalyticsPage() {
  const { state, setState, query } = useAnalyticsFilters();
  const [tab, setTab] = useState('overview');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Analytics & Reports"
        description="Figures are computed from live records inside your access scope."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AnalyticsFilters state={state} onChange={setState} />
            <Button variant="outline" size="sm" data-print="hide" onClick={() => window.print()}>
              <Printer /> Print
            </Button>
          </div>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Delivery</TabsTrigger>
          <TabsTrigger value="hours">Hours</TabsTrigger>
          <TabsTrigger value="snapshot">Management snapshot</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <DeliveryTab query={query} />
        </TabsContent>
        <TabsContent value="hours" className="mt-4">
          <HoursTab query={query} />
        </TabsContent>
        <TabsContent value="snapshot" className="mt-4">
          <SnapshotTab query={query} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DeliveryTab({ query }: { query: Partial<AnalyticsQuery> }) {
  const overview = useOverview(query);
  const d = overview.data;
  if (overview.error)
    return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  const loading = overview.isLoading;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Tasks completed"
          value={d?.tasks.completedInPeriod}
          isLoading={loading}
          hint="in period"
        />
        <StatCard
          label="Tasks created"
          value={d?.tasks.createdInPeriod}
          isLoading={loading}
          hint="in period"
        />
        <StatCard label="Overdue now" value={d?.tasks.overdue} isLoading={loading} />
        <StatCard
          label="Hours logged"
          value={
            d
              ? d.hours.loggedInPeriod.toLocaleString('en-IN', { maximumFractionDigits: 1 })
              : undefined
          }
          isLoading={loading}
          hint="in period"
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CompletionTrendChart data={d?.completionTrend} isLoading={loading} />
        <TaskStatusChart data={d?.taskStatus} isLoading={loading} />
        <PlannedVsActualChart data={d?.plannedVsActual} isLoading={loading} />
        {d?.people !== null ? <WorkloadChart data={d?.workload} isLoading={loading} /> : null}
      </div>
    </div>
  );
}

function HoursTab({ query }: { query: Partial<AnalyticsQuery> }) {
  const [groupBy, setGroupBy] = useState<(typeof GROUPS)[number]['value']>('project');
  const hours = useHours({ ...query, groupBy });
  if (hours.error) return <ErrorState error={hours.error} onRetry={() => void hours.refetch()} />;
  const rows = hours.data ?? [];
  const total = rows.reduce((s, r) => s + r.hours, 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Group hours">
        {GROUPS.map((g) => (
          <Button
            key={g.value}
            size="sm"
            variant={groupBy === g.value ? 'secondary' : 'ghost'}
            aria-pressed={groupBy === g.value}
            onClick={() => setGroupBy(g.value)}
          >
            {g.label}
          </Button>
        ))}
        <span className="ml-auto text-sm text-muted-foreground">
          Total{' '}
          <strong className="text-foreground tabular">
            {total.toLocaleString('en-IN', { maximumFractionDigits: 1 })} h
          </strong>
        </span>
      </div>
      <HoursChart
        title={`Hours logged ${GROUPS.find((g) => g.value === groupBy)!.label.toLowerCase()}`}
        rows={rows}
        isLoading={hours.isLoading}
        vertical={groupBy === 'week'}
      />
    </div>
  );
}

function SnapshotTab({ query }: { query: Partial<AnalyticsQuery> }) {
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const snapshot = useSnapshot(query, requested);

  const download = async (kind: 'pdf' | 'xlsx' | 'csv') => {
    setBusy(kind);
    try {
      if (kind === 'csv')
        await downloadFile(
          '/reports/tasks.csv',
          query.projectId ? { projectId: query.projectId } : {},
          'tasks.csv',
        );
      else
        await downloadFile(
          '/reports/snapshot',
          { ...params(query), format: kind },
          `management-snapshot.${kind}`,
        );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="text-sm">
          <p className="font-medium">Management snapshot</p>
          <p className="text-muted-foreground">
            Completed and overdue work, delayed projects, health, contributions, blockers and
            upcoming deadlines for the selected period. Every export is recorded in the audit log.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => (requested ? void snapshot.refetch() : setRequested(true))}
          >
            <ScrollText /> {requested ? 'Refresh preview' : 'Preview'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => void download('pdf')}
          >
            {busy === 'pdf' ? <Loader2 className="animate-spin" /> : <FileText />} PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => void download('xlsx')}
          >
            {busy === 'xlsx' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => void download('csv')}
          >
            {busy === 'csv' ? <Loader2 className="animate-spin" /> : <Download />} Tasks CSV
          </Button>
        </div>
      </section>
      {!requested ? null : snapshot.error ? (
        <ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} />
      ) : !snapshot.data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <SnapshotPreview s={snapshot.data} />
      )}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold">
        {title}
        {count !== undefined ? (
          <span className="ml-1.5 text-muted-foreground tabular">({count})</span>
        ) : null}
      </h3>
      {children}
    </section>
  );
}

function SimpleTable({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: React.ReactNode[][];
  empty: string;
}) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th key={c} className="border-b px-2 py-1.5 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-1.5">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SnapshotPreview({ s }: { s: ManagementSnapshotDto }) {
  return (
    <div className="space-y-4" aria-label="Snapshot preview">
      <p className="text-xs text-muted-foreground">
        {formatDay(s.period.from)} – {formatDay(s.period.to)} · generated for {s.generatedBy} at{' '}
        {new Date(s.generatedAt).toLocaleString('en-IN')}
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <StatCard label="Active projects" value={s.summary.projectsActive} />
        <StatCard label="Delayed projects" value={s.summary.projectsDelayed} />
        <StatCard label="Tasks completed" value={s.summary.tasksCompleted} />
        <StatCard label="Tasks pending" value={s.summary.tasksPending} />
        <StatCard label="Tasks overdue" value={s.summary.tasksOverdue} />
        <StatCard
          label="Hours logged"
          value={s.summary.hoursLogged.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Completed work" count={s.completed.length}>
          <SimpleTable
            columns={['Task', 'Project', 'Assignee', 'Completed']}
            rows={s.completed.map((t) => [
              `${t.key} ${t.title}`,
              t.project,
              t.assignee,
              formatDay(t.completedAt),
            ])}
            empty="Nothing completed in this period."
          />
        </Section>
        <Section title="Overdue work" count={s.overdue.length}>
          <SimpleTable
            columns={['Task', 'Project', 'Assignee', 'Due', 'Priority']}
            rows={s.overdue.map((t) => [
              `${t.key} ${t.title}`,
              t.project,
              t.assignee,
              formatDay(t.dueDate),
              PRIORITY_LABELS[t.priority],
            ])}
            empty="No overdue work."
          />
        </Section>
        <Section title="Delayed projects" count={s.delayedProjects.length}>
          <SimpleTable
            columns={['Project', 'End date', 'Progress', 'Manager']}
            rows={s.delayedProjects.map((p) => [
              `${p.key} ${p.name}`,
              formatDay(p.endDate),
              `${p.progress}%`,
              p.manager,
            ])}
            empty="No delayed projects."
          />
        </Section>
        <Section title="Project health" count={s.health.length}>
          <SimpleTable
            columns={['Project', 'Health', 'Main issue']}
            rows={s.health.map((h) => [
              `${h.key} ${h.name}`,
              <HealthBadge key="b" band={h.band} score={h.score} />,
              h.topIssue,
            ])}
            empty="No active projects."
          />
        </Section>
        <Section title="Team contributions" count={s.contributions.length}>
          <SimpleTable
            columns={['Person', 'Hours', 'Tasks completed']}
            rows={s.contributions.map((c) => [
              c.name,
              c.hours.toLocaleString('en-IN', { maximumFractionDigits: 1 }),
              c.tasksCompleted,
            ])}
            empty="No hours or completions recorded."
          />
        </Section>
        <Section title="Blockers & risks" count={s.blockers.length}>
          <SimpleTable
            columns={['Source', 'Project', 'Item', 'Detail']}
            rows={s.blockers.map((b) => [b.source, b.project, b.title, b.detail])}
            empty="No open blockers."
          />
        </Section>
        <Section title="Upcoming deadlines" count={s.upcoming.length}>
          <SimpleTable
            columns={['Type', 'Item', 'Date']}
            rows={s.upcoming.map((u) => [
              u.kind === 'project' ? 'Project' : 'Task',
              `${u.key} ${u.title}`,
              formatDay(u.date),
            ])}
            empty="Nothing due soon."
          />
        </Section>
        <Section title="Important changes" count={s.changes.length}>
          <SimpleTable
            columns={['Project', 'When', 'By', 'Change']}
            rows={s.changes.map((c) => [
              c.project,
              new Date(c.at).toLocaleDateString('en-IN'),
              c.by,
              c.change,
            ])}
            empty="No notable changes."
          />
        </Section>
      </div>
    </div>
  );
}
