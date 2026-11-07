import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { GADGET_CHARTS, STAT_GROUPS, type GadgetDto, type StatGroup } from '@arihant/shared';
import {
  AXIS_TICK,
  BAR_RADIUS_H,
  ChartCard,
  ChartTooltip,
  GRID,
  SERIES,
} from '@/components/charts/chart-kit';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { errorMessage } from '@/lib/errors';
import * as searchApi from '@/services/api/search';

const GROUP_LABELS: Record<StatGroup, string> = {
  status: 'Status',
  priority: 'Priority',
  type: 'Type',
  assignee: 'Assignee',
  project: 'Project',
};
const CHART_LABELS: Record<(typeof GADGET_CHARTS)[number], string> = {
  count: 'Total count',
  bar: 'Bar chart',
  list: 'Table',
};
const count = (v: number | string) => `${Number(v).toLocaleString('en-IN')} tasks`;

/** Tasks matching a query, grouped by a field (search results and dashboard gadgets). */
export function StatsChart({
  aql,
  by: fixedBy,
  title,
  chart = 'bar',
  action,
}: {
  aql: string;
  by?: StatGroup;
  title?: string;
  chart?: (typeof GADGET_CHARTS)[number];
  action?: React.ReactNode;
}) {
  const [by, setBy] = useState<StatGroup>(fixedBy ?? 'status');
  const q = useQuery({
    queryKey: ['search', 'stats', aql, by],
    queryFn: () => searchApi.fetchSearchStats(aql, by),
    retry: false,
  });
  const rows = q.data ?? [];
  const total = rows.reduce((s, r) => s + r.count, 0);

  if (q.error)
    return (
      <div className="rounded-xl border bg-card p-4 text-sm">
        <p className="font-medium">{title}</p>
        <p role="alert" className="text-destructive">
          {errorMessage(q.error)}
        </p>
      </div>
    );
  if (chart === 'count')
    return (
      <div className="flex flex-col justify-between rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium">{title}</p>
          {action}
        </div>
        <p className="mt-4 text-3xl font-semibold tabular-nums">
          {q.isLoading ? '…' : total.toLocaleString('en-IN')}
        </p>
        <p className="text-xs text-muted-foreground">matching tasks</p>
      </div>
    );

  const picker = fixedBy ? null : (
    <Select value={by} onValueChange={(v) => setBy(v as StatGroup)}>
      <SelectTrigger size="sm" className="w-32" aria-label="Group results by">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STAT_GROUPS.map((g) => (
          <SelectItem key={g} value={g}>
            By {GROUP_LABELS[g].toLowerCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const table = { columns: [GROUP_LABELS[by], 'Tasks'], rows: rows.map((r) => [r.label, r.count]) };

  if (chart === 'list')
    return (
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="text-sm font-medium">{title}</p>
          {action}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="font-normal">{GROUP_LABELS[by]}</th>
              <th className="text-right font-normal">Tasks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t">
                <td className="py-1">{r.label}</td>
                <td className="py-1 text-right tabular-nums">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!q.isLoading && !rows.length ? (
          <p className="text-xs text-muted-foreground">No matching tasks</p>
        ) : null}
      </div>
    );

  return (
    <ChartCard
      title={title ?? `Results by ${GROUP_LABELS[by].toLowerCase()}`}
      subtitle={`${total.toLocaleString('en-IN')} tasks`}
      isLoading={q.isLoading}
      empty={!q.isLoading && rows.length === 0}
      emptyText="No matching tasks"
      table={table}
      height={Math.max(140, rows.length * 30 + 30)}
      action={
        <div className="flex items-center gap-1">
          {picker}
          {action}
        </div>
      }
    >
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16, top: 4 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis
            type="number"
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            width={120}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
            content={<ChartTooltip format={count} />}
          />
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

function AddGadget({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const filters = useQuery({ queryKey: ['filters'], queryFn: searchApi.fetchFilters });
  const [filterId, setFilterId] = useState('');
  const [chart, setChart] = useState<(typeof GADGET_CHARTS)[number]>('bar');
  const [by, setBy] = useState<StatGroup>('status');
  const add = useMutation({
    mutationFn: () => searchApi.addGadget({ filterId, chart, by }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['filters', 'gadgets'] });
      toast.success('Gadget added');
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (filters.data && !filters.data.length)
    return (
      <p className="text-sm text-muted-foreground">
        Save a filter first, then build gadgets from it.
      </p>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-3">
      <Select value={filterId} onValueChange={setFilterId}>
        <SelectTrigger size="sm" className="w-56" aria-label="Filter">
          <SelectValue placeholder="Choose a filter" />
        </SelectTrigger>
        <SelectContent>
          {filters.data?.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={chart} onValueChange={(v) => setChart(v as typeof chart)}>
        <SelectTrigger size="sm" className="w-36" aria-label="Gadget type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GADGET_CHARTS.map((c) => (
            <SelectItem key={c} value={c}>
              {CHART_LABELS[c]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {chart !== 'count' ? (
        <Select value={by} onValueChange={(v) => setBy(v as StatGroup)}>
          <SelectTrigger size="sm" className="w-36" aria-label="Group by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAT_GROUPS.map((g) => (
              <SelectItem key={g} value={g}>
                By {GROUP_LABELS[g].toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Button size="sm" disabled={!filterId || add.isPending} onClick={() => add.mutate()}>
        Add gadget
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </div>
  );
}

function Gadget({ g }: { g: GadgetDto }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => searchApi.removeGadget(g.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['filters', 'gadgets'] }),
  });
  const close = (
    <Button
      size="icon"
      variant="ghost"
      className="size-7"
      aria-label="Remove gadget"
      onClick={() => remove.mutate()}
    >
      <X />
    </Button>
  );
  if (!g.filter)
    return (
      <div className="flex items-start justify-between rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        This filter was deleted or is no longer shared with you.
        {close}
      </div>
    );
  const f = g.filter;
  return (
    <div className="relative">
      <StatsChart
        aql={f.aql}
        by={g.by}
        chart={g.chart}
        title={f.name}
        action={
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => navigate(`/search?aql=${encodeURIComponent(f.aql)}`)}
            >
              Open
            </Button>
            {close}
          </>
        }
      />
    </div>
  );
}

/** Personal dashboard of gadgets built from saved filters. */
export function FilterDashboard() {
  const gadgets = useQuery({ queryKey: ['filters', 'gadgets'], queryFn: searchApi.fetchGadgets });
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Gadgets recount live from their filter, using your own access.
        </p>
        {!adding ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus /> Add gadget
          </Button>
        ) : null}
      </div>
      {adding ? <AddGadget onDone={() => setAdding(false)} /> : null}
      {gadgets.data?.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {gadgets.data.map((g) => (
            <Gadget key={g.id} g={g} />
          ))}
        </div>
      ) : !gadgets.isLoading && !adding ? (
        <EmptyState
          icon={LayoutGrid}
          title="No gadgets yet"
          description="Add a count, chart or table built from one of your saved filters."
        />
      ) : null}
    </div>
  );
}
