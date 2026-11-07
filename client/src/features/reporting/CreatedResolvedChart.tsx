import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AXIS_TICK, ChartCard, ChartTooltip, GRID, SERIES } from '@/components/charts/chart-kit';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDay } from '@/features/work/format';
import { errorMessage } from '@/lib/errors';
import { fetchCreatedResolved } from '@/services/api/reporting';

const tasks = (v: number | string) => `${Number(v).toLocaleString('en-IN')} tasks`;

/** Tasks created vs resolved per day or week, for a query (empty = all work the user can see). */
export function CreatedResolvedChart({ aql = '' }: { aql?: string }) {
  const [interval, setBucket] = useState<'day' | 'week'>('day');
  const [days, setDays] = useState('30');
  const q = useQuery({
    queryKey: ['reporting', 'created-resolved', aql, interval, days],
    queryFn: () => fetchCreatedResolved({ aql, interval, days: Number(days) }),
    retry: false,
  });
  const rows = (q.data?.points ?? []).map((p) => ({ ...p, label: formatDay(p.bucket, 'd MMM') }));
  if (q.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(q.error)}
      </p>
    );
  return (
    <ChartCard
      title="Created vs resolved"
      subtitle={
        q.data
          ? `${q.data.totals.created} created, ${q.data.totals.resolved} resolved; the line shows the change in open work`
          : undefined
      }
      isLoading={q.isLoading}
      empty={!q.isLoading && !q.data?.totals.created && !q.data?.totals.resolved}
      emptyText="Nothing created or resolved in this period"
      legend={[
        { label: 'Created', color: SERIES[1] },
        { label: 'Resolved', color: SERIES[0] },
        { label: 'Open work change', color: SERIES[3] },
      ]}
      table={{
        columns: [interval === 'week' ? 'Week of' : 'Day', 'Created', 'Resolved', 'Open change'],
        rows: rows.map((r) => [r.bucket, r.created, r.resolved, r.openChange]),
      }}
      action={
        <div className="flex gap-1" data-print="hide">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger size="sm" className="w-28" aria-label="Period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="14">14 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
              <SelectItem value="365">1 year</SelectItem>
            </SelectContent>
          </Select>
          <Select value={interval} onValueChange={(v) => setBucket(v as 'day' | 'week')}>
            <SelectTrigger size="sm" className="w-24" aria-label="Interval">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Daily</SelectItem>
              <SelectItem value="week">Weekly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
    >
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ left: -12, right: 12, top: 4 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            minTickGap={16}
          />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<ChartTooltip format={tasks} />} />
          <Line dataKey="created" name="Created" stroke={SERIES[1]} strokeWidth={2} dot={false} />
          <Line dataKey="resolved" name="Resolved" stroke={SERIES[0]} strokeWidth={2} dot={false} />
          <Line
            dataKey="openChange"
            name="Open work change"
            stroke={SERIES[3]}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
