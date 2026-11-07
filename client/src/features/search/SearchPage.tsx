import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Download,
  History,
  KanbanSquare,
  Printer,
  Save,
  Search,
  Share2,
  Star,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  EXPORT_COLUMNS,
  checkAql,
  type ExportColumn,
  type SavedFilterDto,
  type TaskDto,
} from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { PriorityIndicator } from '@/components/common/PriorityIndicator';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { IssueTypeIcon } from '@/features/agile/agile-ui';
import { formatDay } from '@/features/work/format';
import { useTaskDrawer } from '@/features/work/tasks/use-task-drawer';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import * as searchApi from '@/services/api/search';
import { AqlEditor } from './AqlEditor';
import { EXAMPLES } from './examples';
import { FilterDashboard, StatsChart } from './FilterDashboard';
import { SaveFilterDialog } from './SaveFilterDialog';
import { CreatedResolvedChart } from '@/features/reporting/CreatedResolvedChart';
import { ReportSchedules } from '@/features/reporting/ReportSchedules';

const searchKeys = {
  results: (aql: string, page: number) => ['search', 'tasks', aql, page] as const,
  stats: (aql: string, by: string) => ['search', 'stats', aql, by] as const,
  history: ['search', 'history'] as const,
  filters: ['filters'] as const,
  gadgets: ['filters', 'gadgets'] as const,
};

const COLUMN_LABELS: Record<ExportColumn, string> = {
  key: 'Key',
  title: 'Title',
  project: 'Project',
  type: 'Type',
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  reporter: 'Reporter',
  sprint: 'Sprint',
  storyPoints: 'Story points',
  due: 'Due',
  estimate: 'Estimate',
  logged: 'Logged',
  labels: 'Labels',
  created: 'Created',
  updated: 'Updated',
  resolved: 'Resolved',
};

const columns: ColumnDef<TaskDto, unknown>[] = [
  {
    id: 'key',
    header: 'Key',
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5 font-mono text-xs">
        <IssueTypeIcon type={row.original.type} /> {row.original.key}
      </span>
    ),
  },
  {
    id: 'title',
    header: 'Title',
    cell: ({ row }) => <span className="line-clamp-1">{row.original.title}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    id: 'priority',
    header: 'Priority',
    cell: ({ row }) => <PriorityIndicator priority={row.original.priority} />,
  },
  {
    id: 'assignee',
    header: 'Assignee',
    cell: ({ row }) =>
      row.original.assignee?.name ?? <span className="text-muted-foreground">Unassigned</span>,
  },
  {
    id: 'due',
    header: 'Due',
    cell: ({ row }) => (row.original.dueDate ? formatDay(row.original.dueDate) : '—'),
  },
  {
    id: 'updated',
    header: 'Updated',
    cell: ({ row }) => formatDay(row.original.updatedAt.slice(0, 10)),
  },
];

function FiltersPanel({
  onRun,
  activeId,
}: {
  onRun: (f: SavedFilterDto) => void;
  activeId: string | null;
}) {
  const qc = useQueryClient();
  const filters = useQuery({ queryKey: searchKeys.filters, queryFn: searchApi.fetchFilters });
  const [deleting, setDeleting] = useState<SavedFilterDto | null>(null);
  const star = useMutation({
    mutationFn: (f: SavedFilterDto) => searchApi.setFilterFavourite(f.id, !f.favourite),
    onSuccess: () => qc.invalidateQueries({ queryKey: searchKeys.filters }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => searchApi.deleteFilter(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: searchKeys.filters });
      toast.success('Filter deleted');
      setDeleting(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rows = [...(filters.data ?? [])].sort(
    (a, b) => Number(b.favourite) - Number(a.favourite) || a.name.localeCompare(b.name),
  );
  return (
    <section aria-label="Saved filters" className="space-y-2">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Filters
      </h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {filters.isLoading ? 'Loading…' : 'Save a search to reuse and share it.'}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((f) => (
            <li
              key={f.id}
              className={cn(
                'group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm hover:bg-muted',
                activeId === f.id && 'bg-muted',
              )}
            >
              <button
                type="button"
                aria-label={f.favourite ? `Unstar ${f.name}` : `Star ${f.name}`}
                aria-pressed={f.favourite}
                onClick={() => star.mutate(f)}
              >
                <Star
                  className={cn(
                    'size-3.5',
                    f.favourite ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground',
                  )}
                />
              </button>
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => onRun(f)}
                title={f.aql}
              >
                {f.name}
              </button>
              {f.sharing !== 'private' ? (
                <Share2
                  className="size-3 text-muted-foreground"
                  aria-label={
                    f.sharing === 'org'
                      ? 'Shared with everyone'
                      : `Shared with ${f.project?.key ?? 'a project'}`
                  }
                />
              ) : null}
              {f.canEdit ? (
                <button
                  type="button"
                  aria-label={`Delete filter ${f.name}`}
                  className="opacity-0 group-hover:opacity-70 focus:opacity-100"
                  onClick={() => setDeleting(f)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete filter “${deleting?.name ?? ''}”?`}
        description="People it is shared with lose it too, along with any dashboard gadgets built on it."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleting) await del.mutateAsync(deleting.id);
        }}
      />
    </section>
  );
}

function HistoryPanel({ onRun }: { onRun: (aql: string) => void }) {
  const qc = useQueryClient();
  const history = useQuery({ queryKey: searchKeys.history, queryFn: searchApi.fetchSearchHistory });
  const clear = useMutation({
    mutationFn: searchApi.clearSearchHistory,
    onSuccess: () => qc.invalidateQueries({ queryKey: searchKeys.history }),
  });
  return (
    <section aria-label="Search history" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Recent searches
        </h2>
        {history.data?.length ? (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:underline"
            onClick={() => clear.mutate()}
          >
            Clear
          </button>
        ) : null}
      </div>
      {history.data?.length ? (
        <ul className="space-y-0.5">
          {history.data.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => onRun(h.aql)}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-muted"
                title={h.aql}
              >
                <History className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{h.aql}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{h.resultCount}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Your searches appear here for 90 days.</p>
      )}
    </section>
  );
}

/** Search & filters: query language, saved and shared filters, history, export, charts. */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const drawer = useTaskDrawer();
  const ran = params.get('aql') ?? '';
  const [draft, setDraft] = useState(ran);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<SavedFilterDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [exportCols, setExportCols] = useState<ExportColumn[]>([
    'key',
    'title',
    'type',
    'status',
    'priority',
    'assignee',
    'due',
    'updated',
  ]);
  const [exporting, setExporting] = useState(false);

  const run = (aql: string, filter: SavedFilterDto | null = null) => {
    if (!checkAql(aql).ok) return;
    setDraft(aql);
    setActive(filter);
    setPage(1);
    setParams((p) => {
      p.set('aql', aql);
      return p;
    });
    // Record explicit searches in the history.
    void searchApi.searchTasks(aql, 1, true, 1).then(
      () => qc.invalidateQueries({ queryKey: searchKeys.history }),
      () => undefined,
    );
  };

  const results = useQuery({
    queryKey: searchKeys.results(ran, page),
    queryFn: () => searchApi.searchTasks(ran, page),
    enabled: params.has('aql'),
    retry: false,
  });

  const doExport = async (format: 'csv' | 'xlsx') => {
    setExporting(true);
    try {
      await searchApi.exportSearch(ran, format, exportCols);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const total = results.data?.meta.total ?? 0;
  const dirty = draft !== ran;
  const empty = useMemo(
    () => (
      <EmptyState
        icon={Search}
        title="No tasks match"
        description="Change the query and search again."
      />
    ),
    [],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Search & filters"
        description="Find tasks with the query language, save and share filters, export results and build dashboards."
        actions={
          <Button variant="outline" size="sm" data-print="hide" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
        }
      />
      <Tabs defaultValue="search">
        <TabsList>
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="dashboard">Filter dashboard</TabsTrigger>
          <TabsTrigger value="schedules">Scheduled reports</TabsTrigger>
        </TabsList>
        <TabsContent value="search" className="mt-4">
          <div className="grid gap-5 lg:grid-cols-[1fr_16rem]">
            <div className="min-w-0 space-y-4">
              <AqlEditor
                value={draft}
                onChange={setDraft}
                onRun={() => run(draft, active)}
                running={results.isFetching}
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Try:</span>
                {EXAMPLES.map((e) => (
                  <button
                    key={e.label}
                    type="button"
                    onClick={() => run(e.aql)}
                    className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted"
                  >
                    {e.label}
                  </button>
                ))}
              </div>

              {params.has('aql') ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm" aria-live="polite">
                      {results.isLoading
                        ? 'Searching…'
                        : results.error
                          ? null
                          : `${total.toLocaleString('en-IN')} task${total === 1 ? '' : 's'}`}
                      {active ? (
                        <span className="text-muted-foreground"> · filter “{active.name}”</span>
                      ) : null}
                      {dirty ? (
                        <span className="text-muted-foreground"> · query edited, not run</span>
                      ) : null}
                    </p>
                    <div className="ml-auto flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSaving(true)}
                        disabled={!ran}
                      >
                        <Save /> {active?.canEdit ? 'Save filter' : 'Save as filter'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/tasks/board?aql=${encodeURIComponent(ran)}`)}
                      >
                        <KanbanSquare /> Open on board
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" disabled={exporting || total === 0}>
                            <Download /> Export
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem onSelect={() => void doExport('csv')}>
                            CSV (all results)
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void doExport('xlsx')}>
                            Excel (all results)
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs text-muted-foreground">
                            Columns
                          </DropdownMenuLabel>
                          {EXPORT_COLUMNS.map((c) => (
                            <DropdownMenuItem
                              key={c}
                              onSelect={(e) => {
                                e.preventDefault();
                                setExportCols((xs) =>
                                  xs.includes(c)
                                    ? xs.filter((x) => x !== c)
                                    : EXPORT_COLUMNS.filter((x) => x === c || xs.includes(x)),
                                );
                              }}
                            >
                              <span
                                className={cn(
                                  'size-3.5 rounded-sm border',
                                  exportCols.includes(c) && 'bg-primary',
                                )}
                                aria-hidden
                              />
                              <span
                                aria-label={`${COLUMN_LABELS[c]}${exportCols.includes(c) ? ' (included)' : ''}`}
                              >
                                {COLUMN_LABELS[c]}
                              </span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {results.error ? (
                    <p
                      role="alert"
                      className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
                    >
                      {errorMessage(results.error)}
                    </p>
                  ) : (
                    <DataTable
                      columns={columns}
                      data={results.data?.items}
                      meta={results.data?.meta}
                      onPageChange={setPage}
                      isLoading={results.isLoading}
                      getRowId={(t) => t.id}
                      onRowClick={(t) => drawer.open(t.id)}
                      empty={empty}
                    />
                  )}
                  {!results.error && total > 0 ? <StatsChart aql={ran} /> : null}
                  {!results.error ? <CreatedResolvedChart aql={ran} /> : null}
                </>
              ) : (
                <EmptyState
                  icon={Search}
                  title="Search all the tasks you can see"
                  description="Write a query, pick an example, or open a saved filter."
                />
              )}
            </div>
            <aside className="space-y-6">
              <FiltersPanel activeId={active?.id ?? null} onRun={(f) => run(f.aql, f)} />
              <HistoryPanel onRun={(aql) => run(aql)} />
            </aside>
          </div>
        </TabsContent>
        <TabsContent value="dashboard" className="mt-4">
          <FilterDashboard />
        </TabsContent>
        <TabsContent value="schedules" className="mt-4">
          <ReportSchedules />
        </TabsContent>
      </Tabs>
      {saving ? (
        <SaveFilterDialog
          aql={ran}
          existing={active?.canEdit ? active : null}
          onClose={() => setSaving(false)}
          onSaved={(f) => {
            setActive(f);
            setSaving(false);
          }}
        />
      ) : null}
    </div>
  );
}
