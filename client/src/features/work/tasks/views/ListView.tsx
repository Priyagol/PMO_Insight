import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { ListTodo, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_STATUSES,
  type TaskDto,
  type TaskListQuery,
} from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { PriorityIndicator } from '@/components/common/PriorityIndicator';
import { StatusBadge } from '@/components/common/StatusBadge';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toSortParam } from '@/lib/table';
import { cn } from '@/lib/utils';
import * as work from '@/services/api/work';
import { formatDay } from '../../format';
import { useTasks, useWorkMutation } from '../../hooks';
import { useTaskDrawer } from '../use-task-drawer';

const PAGE_SIZE = 25;

export function ListView({
  query,
  showProject,
}: {
  query: Partial<TaskListQuery>;
  showProject: boolean;
}) {
  const drawer = useTaskDrawer();
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fullQuery = useMemo(
    () => ({ ...query, sort: toSortParam(sorting), page, limit: PAGE_SIZE }),
    [query, sorting, page],
  );
  const tasks = useTasks(fullQuery);
  const rows = tasks.data?.items ?? [];

  const bulk = useWorkMutation(work.bulkUpdateTasks, {
    success: (r) =>
      r.failed.length
        ? `${r.updated} updated, ${r.failed.length} skipped: ${r.failed[0]!.key ?? ''} ${r.failed[0]!.reason}`
        : `${r.updated} task(s) updated`,
  });
  const bulkDelete = useWorkMutation(work.bulkDeleteTasks, {
    success: (r) =>
      r.failed.length
        ? `${r.deleted} deleted, ${r.failed.length} not permitted`
        : `${r.deleted} task(s) deleted`,
  });
  const ids = [...selected];
  const apply = (set: Parameters<typeof work.bulkUpdateTasks>[0]['set']) =>
    bulk.mutate({ ids, set }, { onSuccess: () => setSelected(new Set()) });

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const columns: ColumnDef<TaskDto, unknown>[] = [
    {
      id: 'select',
      enableSorting: false,
      header: () => (
        <Checkbox
          aria-label="Select all on this page"
          checked={allOnPage}
          onCheckedChange={(c) =>
            setSelected(
              c
                ? new Set([...selected, ...rows.map((r) => r.id)])
                : new Set([...selected].filter((id) => !rows.some((r) => r.id === id))),
            )
          }
        />
      ),
      cell: ({ row }) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Checkbox
            aria-label={`Select ${row.original.key}`}
            checked={selected.has(row.original.id)}
            onCheckedChange={() => toggle(row.original.id)}
          />
        </span>
      ),
    },
    {
      id: 'key',
      header: 'ID',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.key}</span>,
    },
    {
      id: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <div className="min-w-0 max-w-md">
          <p className="truncate font-medium">{row.original.title}</p>
          {showProject || row.original.parent ? (
            <p className="truncate text-xs text-muted-foreground">
              {showProject ? row.original.project.name : null}
              {row.original.parent ? ` · subtask of ${row.original.parent.key}` : null}
            </p>
          ) : null}
        </div>
      ),
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
      enableSorting: false,
      cell: ({ row }) =>
        row.original.assignee ? (
          <span className="flex items-center gap-1.5 text-sm">
            <UserAvatar name={row.original.assignee.name} size="sm" />
            {row.original.assignee.name}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Unassigned</span>
        ),
    },
    {
      id: 'dueDate',
      header: 'Due',
      cell: ({ row }) => (
        <span
          className={cn('text-xs tabular', row.original.overdue && 'font-medium text-destructive')}
        >
          {formatDay(row.original.dueDate, 'd MMM yyyy')}
        </span>
      ),
    },
    {
      id: 'estimate',
      header: 'Est.',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-xs tabular">
          {row.original.estimatedHours != null ? `${row.original.estimatedHours} h` : '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {selected.size > 0 ? (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-2 rounded-lg border bg-accent/60 px-3 py-2 text-sm"
        >
          <span className="font-medium">{selected.size} selected</span>
          <Select
            onValueChange={(v) => apply({ status: v as TaskDto['status'] })}
            disabled={bulk.isPending}
          >
            <SelectTrigger size="sm" className="w-36" aria-label="Set status">
              <SelectValue placeholder="Set status" />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            onValueChange={(v) => apply({ priority: v as TaskDto['priority'] })}
            disabled={bulk.isPending}
          >
            <SelectTrigger size="sm" className="w-36" aria-label="Set priority">
              <SelectValue placeholder="Set priority" />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-xs">
            Due
            <Input
              type="date"
              className="h-8 w-36"
              aria-label="Set due date"
              disabled={bulk.isPending}
              onChange={(e) => e.target.value && apply({ dueDate: e.target.value })}
            />
          </label>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 /> Delete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setSelected(new Set())}
          >
            <X /> Clear
          </Button>
        </div>
      ) : null}
      <DataTable
        columns={columns}
        data={tasks.data?.items}
        meta={tasks.data?.meta}
        onPageChange={setPage}
        sorting={sorting}
        onSortingChange={(s) => {
          setSorting(s);
          setPage(1);
        }}
        isLoading={tasks.isLoading}
        error={tasks.error}
        onRetry={() => void tasks.refetch()}
        getRowId={(t) => t.id}
        onRowClick={(t) => drawer.open(t.id)}
        empty={
          <EmptyState
            compact
            icon={ListTodo}
            title="No tasks match"
            description="Try changing the filters or create a task."
          />
        }
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${selected.size} task(s)?`}
        description="Subtasks are deleted too. Tasks you are not allowed to delete are skipped."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await bulkDelete.mutateAsync(ids);
          setSelected(new Set());
        }}
      />
    </div>
  );
}
