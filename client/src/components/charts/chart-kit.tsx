import { Table2, BarChart3 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Chart conventions (dataviz method): categorical colours in fixed slot order, never by rank;
 * one axis; thin marks; recessive grid; legend for 2+ series; text in text tokens; and a
 * table view on every chart (required because some light-mode slots are below 3:1).
 */
export const SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
] as const;
/** Slot colour by fixed index (entity order, never rank). */
export const seriesColor = (i: number): string => SERIES[i % SERIES.length]!;
export const GRID = 'var(--chart-grid)';
export const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 };
export const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
export const BAR_RADIUS_H: [number, number, number, number] = [0, 4, 4, 0];

export interface TableView {
  columns: string[];
  rows: (string | number)[][];
}

interface ChartCardProps {
  title: string;
  subtitle?: ReactNode;
  /** Legend items for 2+ series (identity never relies on colour alone). */
  legend?: { label: string; color: string }[];
  table: TableView;
  isLoading?: boolean;
  empty?: boolean;
  emptyText?: string;
  height?: number;
  className?: string;
  action?: ReactNode;
  children: ReactNode;
}

export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  isLoading,
  empty,
  emptyText = 'No data for this period',
  height = 240,
  className,
  action,
  children,
}: ChartCardProps) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section
      className={cn('flex flex-col rounded-xl border bg-card p-4 shadow-xs', className)}
      aria-label={title}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-1">
          {action}
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
            aria-label={showTable ? `Show ${title} as a chart` : `Show ${title} as a table`}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {showTable ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
          </button>
        </div>
      </header>
      {legend && legend.length > 1 && !showTable ? (
        <ul
          className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
          aria-label="Legend"
        >
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: l.color }} aria-hidden />
              {l.label}
            </li>
          ))}
        </ul>
      ) : null}
      {isLoading ? (
        <Skeleton className="w-full" style={{ height }} />
      ) : empty ? (
        <div
          className="flex items-center justify-center text-sm text-muted-foreground"
          style={{ height }}
        >
          {emptyText}
        </div>
      ) : showTable ? (
        <div className="overflow-auto" style={{ maxHeight: height + 40 }}>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                {table.columns.map((c) => (
                  <th key={c} className="border-b px-2 py-1.5 text-left font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  {r.map((c, j) => (
                    <td
                      key={j}
                      className={cn('px-2 py-1.5', typeof c === 'number' && 'text-right tabular')}
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </section>
  );
}

/** Tooltip body in the app's popover style; values in text tokens with a colour swatch. */
export function ChartTooltip({
  active,
  label,
  payload,
  format = (v) => String(v),
}: {
  active?: boolean;
  label?: string | number;
  payload?: {
    name?: string | number;
    value?: number | string;
    color?: string;
    dataKey?: string | number;
  }[];
  format?: (v: number | string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      {label !== undefined ? <p className="mb-1 font-medium">{label}</p> : null}
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
            <span className="size-2 rounded-sm" style={{ background: p.color }} aria-hidden />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="ml-auto pl-3 font-medium tabular">
              {p.value !== undefined ? format(p.value) : '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
