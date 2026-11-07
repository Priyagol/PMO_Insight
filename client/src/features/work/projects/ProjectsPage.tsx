import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { FolderKanban, FolderPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  PROJECT_STATUSES,
  STATUS_LABELS,
  type ProjectDto,
  type ProjectStatus,
} from '@arihant/shared';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { PriorityIndicator } from '@/components/common/PriorityIndicator';
import { SearchInput } from '@/components/common/SearchInput';
import { StatusBadge } from '@/components/common/StatusBadge';
import { AvatarGroup } from '@/components/common/UserAvatar';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDepartments } from '@/features/org/hooks';
import { useCan } from '@/hooks/use-permission';
import { toSortParam } from '@/lib/table';
import { formatDay } from '../format';
import { useProjects } from '../hooks';
import { ProgressBar } from './ProgressBar';
import { ProjectFormDialog } from './ProjectFormDialog';

const ALL = 'all';

const columns: ColumnDef<ProjectDto, unknown>[] = [
  {
    id: 'name',
    header: 'Project',
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.original.name}</p>
        <p className="font-mono text-xs text-muted-foreground">{row.original.key}</p>
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
    enableSorting: false,
    cell: ({ row }) => <PriorityIndicator priority={row.original.priority} />,
  },
  {
    id: 'progress',
    header: 'Progress',
    enableSorting: false,
    cell: ({ row }) => (
      <div className="w-36">
        <ProgressBar value={row.original.progress.percent} />
        <p className="mt-1 text-[11px] text-muted-foreground tabular">
          {row.original.progress.doneTasks}/{row.original.progress.totalTasks} tasks
          {row.original.progress.overdueTasks ? (
            <span className="text-destructive">
              {' '}
              · {row.original.progress.overdueTasks} overdue
            </span>
          ) : null}
        </p>
      </div>
    ),
  },
  {
    id: 'manager',
    header: 'Manager',
    enableSorting: false,
    cell: ({ row }) => row.original.manager?.name ?? '—',
  },
  {
    id: 'team',
    header: 'Team',
    enableSorting: false,
    cell: ({ row }) => <AvatarGroup names={row.original.members.map((m) => m.user.name)} />,
  },
  {
    id: 'endDate',
    header: 'End date',
    cell: ({ row }) => <span className="text-xs tabular">{formatDay(row.original.endDate)}</span>,
  },
];

export function ProjectsPage() {
  const navigate = useNavigate();
  const canCreate = useCan('project:create');
  const departments = useDepartments();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ProjectStatus | typeof ALL>(ALL);
  const [departmentId, setDepartmentId] = useState(ALL);
  const [archived, setArchived] = useState(false);
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [creating, setCreating] = useState(false);

  const query = useMemo(
    () => ({
      q: q || undefined,
      status: status === ALL ? undefined : [status],
      departmentId: departmentId === ALL ? undefined : departmentId,
      archived: archived ? ('true' as const) : undefined,
      mine: mine ? ('true' as const) : undefined,
      sort: toSortParam(sorting),
      page,
      limit: 20,
    }),
    [q, status, departmentId, archived, mine, sorting, page],
  );
  const projects = useProjects(query);
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };
  const filtered = Boolean(q) || status !== ALL || departmentId !== ALL || mine;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects"
        description="Every running initiative, its owner, team and delivery progress."
        actions={
          canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <FolderPlus /> New project
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={reset(setQ)} placeholder="Search name, key, category…" />
        <Select value={status} onValueChange={reset((v: string) => setStatus(v as ProjectStatus))}>
          <SelectTrigger size="sm" className="w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {PROJECT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={departmentId} onValueChange={reset(setDepartmentId)}>
          <SelectTrigger size="sm" className="w-44" aria-label="Filter by department">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {departments.data?.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant={mine ? 'secondary' : 'ghost'}
          aria-pressed={mine}
          onClick={() => reset(setMine)(!mine)}
        >
          My projects
        </Button>
        <Button
          size="sm"
          variant={archived ? 'secondary' : 'ghost'}
          aria-pressed={archived}
          onClick={() => reset(setArchived)(!archived)}
        >
          Archived
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={projects.data?.items}
        meta={projects.data?.meta}
        onPageChange={setPage}
        sorting={sorting}
        onSortingChange={reset(setSorting)}
        isLoading={projects.isLoading}
        error={projects.error}
        onRetry={() => void projects.refetch()}
        getRowId={(p) => p.id}
        onRowClick={(p) => navigate(`/projects/${p.id}`)}
        empty={
          <EmptyState
            compact
            icon={FolderKanban}
            title={
              archived
                ? 'No archived projects'
                : filtered
                  ? 'No projects match these filters'
                  : 'No projects yet'
            }
            description={
              !filtered && !archived && canCreate
                ? 'Create the first project to start planning work.'
                : undefined
            }
            action={
              !filtered && !archived && canCreate ? (
                <Button size="sm" onClick={() => setCreating(true)}>
                  <FolderPlus /> New project
                </Button>
              ) : undefined
            }
          />
        }
      />
      <ProjectFormDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
