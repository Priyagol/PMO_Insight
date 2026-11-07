import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BUG_SEVERITIES, BUG_SEVERITY_LABELS, ISSUE_TYPE_LABELS } from '@arihant/shared';
import {
  AXIS_TICK,
  BAR_RADIUS,
  ChartCard,
  ChartTooltip,
  GRID,
  SERIES,
} from '@/components/charts/chart-kit';
import { StatCard } from '@/components/common/StatCard';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDay } from '@/features/work/format';
import * as agileApi from '@/services/api/agile';
import { SeverityBadge, agileKeys } from './agile-ui';

const pts = (v: number | string) =>
  `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} pts`;
const days = (v: number | null) =>
  v == null ? '—' : `${v.toLocaleString('en-IN', { maximumFractionDigits: 1 })} d`;
const cursor = { fill: 'var(--muted)', opacity: 0.6 };

function VelocityChart({ projectId }: { projectId: string }) {
  const q = useQuery({
    queryKey: agileKeys.report('velocity', projectId),
    queryFn: () => agileApi.fetchVelocity(projectId),
  });
  const rows = q.data?.sprints ?? [];
  return (
    <ChartCard
      title="Velocity"
      subtitle={
        q.data?.average != null
          ? `Average ${pts(q.data.average)} completed per sprint`
          : 'Story points per completed sprint'
      }
      isLoading={q.isLoading}
      empty={!q.isLoading && rows.length === 0}
      emptyText="No completed sprints yet"
      legend={[
        { label: 'Committed', color: SERIES[1] },
        { label: 'Completed', color: SERIES[0] },
      ]}
      table={{
        columns: ['Sprint', 'Committed', 'Completed'],
        rows: rows.map((r) => [r.name, r.committed, r.completed]),
      }}
    >
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ left: -12, right: 12, top: 4 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip cursor={cursor} content={<ChartTooltip format={pts} />} />
          <Bar
            dataKey="committed"
            name="Committed"
            fill={SERIES[1]}
            radius={BAR_RADIUS}
            maxBarSize={28}
          />
          <Bar
            dataKey="completed"
            name="Completed"
            fill={SERIES[0]}
            radius={BAR_RADIUS}
            maxBarSize={28}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function SprintCharts({ projectId }: { projectId: string }) {
  const sprints = useQuery({
    queryKey: agileKeys.sprints(projectId),
    queryFn: () => agileApi.fetchSprints(projectId),
  });
  const started = (sprints.data ?? []).filter((s) => s.status !== 'planned');
  const [chosen, setChosen] = useState<string | null>(null);
  const sprintId = chosen ?? started[0]?.id ?? null;
  const chart = useQuery({
    queryKey: agileKeys.report('sprint', sprintId),
    queryFn: () => agileApi.fetchSprintChart(sprintId!),
    enabled: Boolean(sprintId),
  });
  const rows = (chart.data?.days ?? []).map((d) => ({ ...d, label: formatDay(d.date, 'd MMM') }));
  const loading = sprints.isLoading || (Boolean(sprintId) && chart.isLoading);
  const empty = !loading && rows.length === 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Sprint</span>
        <Select value={sprintId ?? ''} onValueChange={setChosen} disabled={!started.length}>
          <SelectTrigger size="sm" className="w-56" aria-label="Sprint for charts">
            <SelectValue placeholder="No started sprints" />
          </SelectTrigger>
          <SelectContent>
            {started.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} {s.status === 'active' ? '(running)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Sprint burndown"
          subtitle="Story points remaining"
          isLoading={loading}
          empty={empty}
          emptyText="Start a sprint to see its burndown"
          legend={[
            { label: 'Remaining', color: SERIES[0] },
            { label: 'Ideal', color: SERIES[1] },
          ]}
          table={{
            columns: ['Day', 'Remaining', 'Ideal'],
            rows: rows.map((r) => [r.label, r.remaining, r.ideal]),
          }}
        >
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ left: -12, right: 12, top: 4 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="label"
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip format={pts} />} />
              <Line
                type="stepAfter"
                dataKey="remaining"
                name="Remaining"
                stroke={SERIES[0]}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="linear"
                dataKey="ideal"
                name="Ideal"
                stroke={SERIES[1]}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard
          title="Sprint burnup"
          subtitle="Completed points against scope"
          isLoading={loading}
          empty={empty}
          emptyText="Start a sprint to see its burnup"
          legend={[
            { label: 'Completed', color: SERIES[0] },
            { label: 'Scope', color: SERIES[2] },
          ]}
          table={{
            columns: ['Day', 'Completed', 'Scope'],
            rows: rows.map((r) => [r.label, r.completed, r.scope]),
          }}
        >
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ left: -12, right: 12, top: 4 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="label"
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip format={pts} />} />
              <Line
                type="stepAfter"
                dataKey="completed"
                name="Completed"
                stroke={SERIES[0]}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="stepAfter"
                dataKey="scope"
                name="Scope"
                stroke={SERIES[2]}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      {chart.data?.notes.length ? (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {chart.data.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FlowAndDefects({ projectId }: { projectId: string }) {
  const [period, setPeriod] = useState(90);
  const ct = useQuery({
    queryKey: agileKeys.report('cycle', projectId, period),
    queryFn: () => agileApi.fetchCycleTime(projectId, period),
  });
  const df = useQuery({
    queryKey: agileKeys.report('defects', projectId, period),
    queryFn: () => agileApi.fetchDefects(projectId, period),
  });
  const weeks = (df.data?.weeks ?? []).map((w) => ({
    ...w,
    label: formatDay(w.weekStart, 'd MMM'),
  }));
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Period</span>
        <Select value={String(period)} onValueChange={(v) => setPeriod(Number(v))}>
          <SelectTrigger size="sm" className="w-36" aria-label="Report period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[30, 90, 180].map((d) => (
              <SelectItem key={d} value={String(d)}>
                Last {d} days
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Median cycle time"
          value={ct.data ? days(ct.data.cycle.median) : undefined}
          isLoading={ct.isLoading}
          hint={ct.data ? `${ct.data.cycle.count} task(s) with a recorded start` : undefined}
        />
        <StatCard
          label="Median lead time"
          value={ct.data ? days(ct.data.lead.median) : undefined}
          isLoading={ct.isLoading}
          hint={ct.data ? `${ct.data.lead.count} task(s) finished` : undefined}
        />
        <StatCard
          label="Open bugs"
          value={df.data ? String(df.data.open) : undefined}
          isLoading={df.isLoading}
          hint={df.data ? `${df.data.regressionsOpen} regression(s)` : undefined}
        />
        <StatCard
          label="Avg bug resolution"
          value={df.data ? days(df.data.averageResolutionDays) : undefined}
          isLoading={df.isLoading}
          hint="Created → done"
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Bugs created vs resolved"
          subtitle="Per week"
          isLoading={df.isLoading}
          empty={!df.isLoading && weeks.every((w) => !w.created && !w.resolved)}
          emptyText="No bugs in this period"
          legend={[
            { label: 'Created', color: SERIES[3] },
            { label: 'Resolved', color: SERIES[0] },
          ]}
          table={{
            columns: ['Week of', 'Created', 'Resolved'],
            rows: weeks.map((w) => [w.label, w.created, w.resolved]),
          }}
        >
          <ResponsiveContainer>
            <BarChart data={weeks} margin={{ left: -12, right: 12, top: 4 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="label"
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                minTickGap={16}
              />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip cursor={cursor} content={<ChartTooltip />} />
              <Bar
                dataKey="created"
                name="Created"
                fill={SERIES[3]}
                radius={BAR_RADIUS}
                maxBarSize={18}
              />
              <Bar
                dataKey="resolved"
                name="Resolved"
                fill={SERIES[0]}
                radius={BAR_RADIUS}
                maxBarSize={18}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <section
          className="space-y-3 rounded-xl border bg-card p-4"
          aria-label="Open bugs by severity"
        >
          <h3 className="text-sm font-semibold">Open bugs by severity</h3>
          <ul className="grid grid-cols-5 gap-2 text-center">
            {BUG_SEVERITIES.map((s) => (
              <li key={s} className="rounded-lg bg-muted/50 p-2">
                <p className="text-lg font-semibold tabular">
                  {df.data ? df.data.openBySeverity[s] : '—'}
                </p>
                <p className="text-[11px] text-muted-foreground">{BUG_SEVERITY_LABELS[s]}</p>
              </li>
            ))}
          </ul>
          <h4 className="pt-1 text-xs font-medium text-muted-foreground">Oldest open bugs</h4>
          {df.data?.oldestOpen.length ? (
            <ul className="space-y-1 text-sm">
              {df.data.oldestOpen.map((b) => (
                <li key={b.id} className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{b.key}</span>
                  <span className="min-w-0 flex-1 truncate">{b.title}</span>
                  <SeverityBadge severity={b.severity} />
                  <span className="text-xs text-muted-foreground tabular">{b.ageDays} d</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No open bugs.</p>
          )}
          <h4 className="pt-1 text-xs font-medium text-muted-foreground">
            Cycle time by type (median)
          </h4>
          <ul className="flex flex-wrap gap-3 text-xs">
            {(ct.data?.byType ?? []).map((t) => (
              <li key={t.type}>
                {ISSUE_TYPE_LABELS[t.type]}: <span className="font-medium">{days(t.median)}</span>{' '}
                <span className="text-muted-foreground">({t.count})</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="text-xs text-muted-foreground">
        Cycle time runs from the first time work started (In progress, In review or Testing) to
        Done. Tasks finished before this was recorded, or moved straight to Done, count only towards
        lead time.
      </p>
    </div>
  );
}

export function AgileReportsPanel({ projectId }: { projectId: string }) {
  return (
    <div className="space-y-6">
      <VelocityChart projectId={projectId} />
      <SprintCharts projectId={projectId} />
      <FlowAndDefects projectId={projectId} />
    </div>
  );
}
