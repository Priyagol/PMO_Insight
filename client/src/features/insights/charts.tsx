import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  STATUS_LABELS,
  TASK_STATUSES,
  type OverviewDto,
  type ProjectAnalyticsDto,
} from '@arihant/shared';
import {
  AXIS_TICK,
  BAR_RADIUS,
  BAR_RADIUS_H,
  ChartCard,
  ChartTooltip,
  GRID,
  SERIES,
  seriesColor,
} from '@/components/charts/chart-kit';
import { formatDay } from '@/features/work/format';

const hours = (v: number | string) =>
  `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} h`;
const pct = (v: number | string) => `${Math.round(Number(v))}%`;
const weekLabel = (iso: string) => formatDay(iso, 'd MMM');
const cursor = { fill: 'var(--muted)', opacity: 0.6 };

/** Open/closed task counts per workflow status (single series, horizontal bars). */
export function TaskStatusChart({
  data,
  isLoading,
}: {
  data?: OverviewDto['taskStatus'];
  isLoading?: boolean;
}) {
  const rows = TASK_STATUSES.map((s) => ({
    label: STATUS_LABELS[s],
    count: data?.find((d) => d.status === s)?.count ?? 0,
  }));
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <ChartCard
      title="Tasks by status"
      subtitle={`${total} tasks in scope`}
      isLoading={isLoading}
      empty={!isLoading && total === 0}
      emptyText="No tasks yet"
      table={{ columns: ['Status', 'Tasks'], rows: rows.map((r) => [r.label, r.count]) }}
    >
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={86}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip cursor={cursor} content={<ChartTooltip />} />
          <Bar
            dataKey="count"
            name="Tasks"
            fill={SERIES[0]}
            radius={BAR_RADIUS_H}
            maxBarSize={20}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Weekly created vs completed tasks (two lines, one axis). */
export function CompletionTrendChart({
  data,
  isLoading,
}: {
  data?: OverviewDto['completionTrend'];
  isLoading?: boolean;
}) {
  const rows = (data ?? []).map((d) => ({ ...d, label: weekLabel(d.week) }));
  return (
    <ChartCard
      title="Completed vs created"
      subtitle="Tasks per week"
      isLoading={isLoading}
      empty={!isLoading && rows.every((r) => r.completed === 0 && r.created === 0)}
      legend={[
        { label: 'Completed', color: SERIES[0] },
        { label: 'Created', color: SERIES[1] },
      ]}
      table={{
        columns: ['Week of', 'Completed', 'Created'],
        rows: rows.map((r) => [r.label, r.completed, r.created]),
      }}
    >
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ left: -16, right: 12, top: 4 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            minTickGap={16}
          />
          <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTooltip />} />
          <Line
            type="monotone"
            dataKey="completed"
            name="Completed"
            stroke={SERIES[0]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="created"
            name="Created"
            stroke={SERIES[1]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Estimated vs logged hours for the biggest projects (grouped bars). */
export function PlannedVsActualChart({
  data,
  isLoading,
}: {
  data?: OverviewDto['plannedVsActual'];
  isLoading?: boolean;
}) {
  const rows = (data ?? []).map((d) => ({
    label: d.project.key,
    name: d.project.name,
    estimated: d.estimated,
    actual: d.actual,
  }));
  return (
    <ChartCard
      title="Planned vs actual effort"
      subtitle="Estimated hours against hours logged, by project"
      isLoading={isLoading}
      empty={!isLoading && rows.length === 0}
      emptyText="No estimated or logged effort yet"
      legend={[
        { label: 'Estimated', color: SERIES[0] },
        { label: 'Logged', color: SERIES[1] },
      ]}
      table={{
        columns: ['Project', 'Estimated (h)', 'Logged (h)'],
        rows: rows.map((r) => [`${r.label} · ${r.name}`, r.estimated, r.actual]),
      }}
    >
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ left: -12, right: 8, top: 4 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <Tooltip cursor={cursor} content={<ChartTooltip format={hours} />} />
          <Bar
            dataKey="estimated"
            name="Estimated"
            fill={SERIES[0]}
            radius={BAR_RADIUS}
            maxBarSize={24}
          />
          <Bar
            dataKey="actual"
            name="Logged"
            fill={SERIES[1]}
            radius={BAR_RADIUS}
            maxBarSize={24}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Per-person load as % of capacity with a 100% reference line. */
export function WorkloadChart({
  data,
  isLoading,
}: {
  data?: OverviewDto['workload'];
  isLoading?: boolean;
}) {
  const rows = (data ?? []).map((d) => ({
    label: d.user.name,
    utilization: Math.round(d.utilization * 100),
    load: d.loadHours,
    capacity: d.capacityHours,
  }));
  return (
    <ChartCard
      title="Team workload"
      subtitle="Open effort as % of the next two weeks' capacity"
      isLoading={isLoading}
      empty={!isLoading && rows.length === 0}
      emptyText="No people in this scope"
      height={Math.max(160, rows.length * 28)}
      table={{
        columns: ['Person', 'Load (h)', 'Capacity (h)', 'Utilisation'],
        rows: rows.map((r) => [r.label, r.load, r.capacity, `${r.utilization}%`]),
      }}
    >
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis
            type="number"
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${v}%`}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={110}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
          <ReferenceLine
            x={100}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={{
              value: 'Capacity',
              fill: 'var(--muted-foreground)',
              fontSize: 10,
              position: 'top',
            }}
          />
          <Tooltip cursor={cursor} content={<ChartTooltip format={pct} />} />
          <Bar
            dataKey="utilization"
            name="Utilisation"
            fill={SERIES[0]}
            radius={BAR_RADIUS_H}
            maxBarSize={16}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Generic single-series bar list (hours by project/person/category/week). */
export function HoursChart({
  title,
  subtitle,
  rows,
  isLoading,
  vertical,
}: {
  title: string;
  subtitle?: string;
  rows: { label: string; hours: number; entries: number }[];
  isLoading?: boolean;
  vertical?: boolean;
}) {
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      isLoading={isLoading}
      empty={!isLoading && rows.length === 0}
      emptyText="No hours logged in this period"
      height={vertical ? 240 : Math.max(160, rows.length * 28)}
      table={{
        columns: ['Group', 'Hours', 'Entries'],
        rows: rows.map((r) => [r.label, r.hours, r.entries]),
      }}
    >
      <ResponsiveContainer>
        {vertical ? (
          <BarChart data={rows} margin={{ left: -12, right: 8, top: 4 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="label"
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              minTickGap={8}
            />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <Tooltip cursor={cursor} content={<ChartTooltip format={hours} />} />
            <Bar
              dataKey="hours"
              name="Hours"
              fill={SERIES[0]}
              radius={BAR_RADIUS}
              maxBarSize={24}
            />
          </BarChart>
        ) : (
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <YAxis
              type="category"
              dataKey="label"
              width={140}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip cursor={cursor} content={<ChartTooltip format={hours} />} />
            <Bar
              dataKey="hours"
              name="Hours"
              fill={SERIES[0]}
              radius={BAR_RADIUS_H}
              maxBarSize={18}
            />
          </BarChart>
        )}
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Remaining effort per day vs a straight ideal line to the project end date. */
export function BurndownChart({
  data,
  isLoading,
}: {
  data?: ProjectAnalyticsDto['burndown'];
  isLoading?: boolean;
}) {
  const rows = (data ?? []).map((d) => ({ ...d, label: formatDay(d.date, 'd MMM') }));
  return (
    <ChartCard
      title="Burndown"
      subtitle="Remaining estimated hours"
      isLoading={isLoading}
      empty={!isLoading && rows.length === 0}
      emptyText="No estimated tasks yet"
      legend={[
        { label: 'Remaining', color: SERIES[0] },
        { label: 'Ideal', color: SERIES[1] },
      ]}
      table={{
        columns: ['Date', 'Remaining (h)', 'Ideal (h)'],
        rows: rows.map((r) => [r.label, r.remaining, r.ideal ?? '—']),
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
          <Tooltip content={<ChartTooltip format={hours} />} />
          <Line
            type="monotone"
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
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function ThroughputChart({
  data,
  isLoading,
}: {
  data?: ProjectAnalyticsDto['throughput'];
  isLoading?: boolean;
}) {
  const rows = (data ?? []).map((d) => ({ ...d, label: weekLabel(d.week) }));
  return (
    <ChartCard
      title="Throughput"
      subtitle="Tasks completed per week"
      isLoading={isLoading}
      empty={!isLoading && rows.every((r) => r.completed === 0)}
      emptyText="No tasks completed in the last 12 weeks"
      table={{
        columns: ['Week of', 'Tasks completed', 'Effort (h)'],
        rows: rows.map((r) => [r.label, r.completed, r.effort]),
      }}
    >
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ left: -16, right: 8, top: 4 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            minTickGap={12}
          />
          <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <Tooltip cursor={cursor} content={<ChartTooltip />} />
          <Bar
            dataKey="completed"
            name="Completed"
            fill={SERIES[0]}
            radius={BAR_RADIUS}
            maxBarSize={24}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Cumulative flow from daily snapshots (stacked areas, fixed status order). */
export function CumulativeFlowChart({
  data,
  isLoading,
}: {
  data?: ProjectAnalyticsDto['flow'];
  isLoading?: boolean;
}) {
  const statuses = TASK_STATUSES.filter((s) => s !== 'cancelled');
  const rows = (data ?? []).map((d) => ({
    label: formatDay(d.date, 'd MMM'),
    ...Object.fromEntries(statuses.map((s) => [s, d.counts[s] ?? 0])),
  }));
  return (
    <ChartCard
      title="Cumulative flow"
      subtitle="Tasks per status, from nightly snapshots"
      isLoading={isLoading}
      empty={!isLoading && rows.length < 2}
      emptyText="Builds up from nightly snapshots (needs at least two days)"
      legend={statuses.map((s, i) => ({ label: STATUS_LABELS[s], color: seriesColor(i) }))}
      table={{
        columns: ['Date', ...statuses.map((s) => STATUS_LABELS[s])],
        rows: rows.map((r) => [
          r.label,
          ...statuses.map((s) => (r as Record<string, number | string>)[s] as number),
        ]),
      }}
    >
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ left: -16, right: 12, top: 4 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTooltip />} />
          {[...statuses].reverse().map((s) => {
            const i = statuses.indexOf(s);
            return (
              <Area
                key={s}
                type="monotone"
                dataKey={s}
                name={STATUS_LABELS[s]}
                stackId="flow"
                stroke="var(--card)"
                strokeWidth={1}
                fill={seriesColor(i)}
                fillOpacity={0.85}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
