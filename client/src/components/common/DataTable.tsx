import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PageMeta } from '@arihant/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';

/**
 * Renders a header/cell definition by calling it as a plain function. TanStack's flexRender
 * mounts function definitions as components, so an inline column definition (new function
 * each render) would remount every cell on every render, losing focus and state.
 * Column renderers must therefore not use hooks.
 */
function renderSlot<C>(slot: unknown, ctx: C): ReactNode {
  return typeof slot === 'function' ? (slot as (c: C) => ReactNode)(ctx) : (slot as ReactNode);
}

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[] | undefined;
  /** Server pagination metadata; omit for client-side (unpaginated) tables. */
  meta?: PageMeta;
  onPageChange?: (page: number) => void;
  /** Server-side sorting: the parent turns this into the `sort` query param. */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: ReactNode;
  getRowId?: (row: T) => string;
  onRowClick?: (row: T) => void;
  skeletonRows?: number;
}

export function DataTable<T>({
  columns,
  data,
  meta,
  onPageChange,
  sorting = [],
  onSortingChange,
  isLoading,
  error,
  onRetry,
  empty,
  getRowId,
  onRowClick,
  skeletonRows = 8,
}: DataTableProps<T>) {
  // TanStack Table v8 is not React-Compiler aware; this project does not use the compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    enableSortingRemoval: true,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      onSortingChange?.(next);
    },
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
  });

  const columnCount = table.getAllLeafColumns().length;

  let body: ReactNode;
  if (error) {
    body = (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={columnCount}>
          <ErrorState error={error} onRetry={onRetry} />
        </TableCell>
      </TableRow>
    );
  } else if (isLoading) {
    body = Array.from({ length: skeletonRows }, (_, i) => (
      <TableRow key={`sk-${i}`} className="hover:bg-transparent" data-testid="skeleton-row">
        {Array.from({ length: columnCount }, (_, j) => (
          <TableCell key={j}>
            <Skeleton className="h-4 w-[70%]" />
          </TableCell>
        ))}
      </TableRow>
    ));
  } else if (table.getRowModel().rows.length === 0) {
    body = (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={columnCount}>
          {empty ?? <EmptyState title="No records found" compact />}
        </TableCell>
      </TableRow>
    );
  } else {
    body = table.getRowModel().rows.map((row) => (
      <TableRow
        key={row.id}
        onClick={onRowClick ? () => onRowClick(row.original) : undefined}
        className={cn(onRowClick && 'cursor-pointer')}
      >
        {row.getVisibleCells().map((cell) => (
          <TableCell key={cell.id}>
            {renderSlot(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        ))}
      </TableRow>
    ));
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="bg-muted/40 hover:bg-muted/40">
              {group.headers.map((header) => {
                const canSort = Boolean(onSortingChange) && header.column.getCanSort();
                const dir = header.column.getIsSorted();
                const label = header.isPlaceholder
                  ? null
                  : renderSlot(header.column.columnDef.header, header.getContext());
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={
                      dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined
                    }
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        {label}
                        {dir === 'asc' ? (
                          <ArrowUp className="size-3" />
                        ) : dir === 'desc' ? (
                          <ArrowDown className="size-3" />
                        ) : (
                          <ArrowUpDown className="size-3 opacity-50" />
                        )}
                      </button>
                    ) : (
                      label
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>{body}</TableBody>
      </Table>

      {meta && onPageChange && meta.total > 0 ? (
        <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <span className="tabular">
            {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of{' '}
            {meta.total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Previous page"
              disabled={meta.page <= 1 || isLoading}
              onClick={() => onPageChange(meta.page - 1)}
            >
              <ChevronLeft />
            </Button>
            <span className="tabular px-1">
              Page {meta.page} of {meta.totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Next page"
              disabled={meta.page >= meta.totalPages || isLoading}
              onClick={() => onPageChange(meta.page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
