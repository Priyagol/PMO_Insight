import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { formatDistanceToNow } from 'date-fns';
import { UserPlus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { EmploymentStatus, UserDto } from '@arihant/shared';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchInput } from '@/components/common/SearchInput';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCan } from '@/hooks/use-permission';
import { toSortParam } from '@/lib/table';
import { EmploymentBadge, RolePills } from '../components/Badges';
import { useDepartments, useRoles, useUsers } from '../hooks';
import { EmployeeDrawer } from './EmployeeDrawer';
import { EmployeeFormDialog } from './EmployeeFormDialog';

const ALL = 'all';
const PAGE_SIZE = 20;

const columns: ColumnDef<UserDto, unknown>[] = [
  {
    id: 'name',
    accessorKey: 'name',
    header: 'Employee',
    cell: ({ row }) => (
      <div className="flex min-w-0 items-center gap-2.5">
        <UserAvatar name={row.original.name} />
        <div className="min-w-0">
          <p className="truncate font-medium">{row.original.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.original.email}</p>
        </div>
      </div>
    ),
  },
  {
    id: 'employeeId',
    accessorKey: 'employeeId',
    header: 'ID',
    cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() as string}</span>,
  },
  {
    id: 'department',
    header: 'Department',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.department?.name ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: 'designation',
    accessorKey: 'designation',
    header: 'Designation',
    cell: ({ getValue }) =>
      (getValue() as string | undefined) ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: 'roles',
    header: 'Roles',
    enableSorting: false,
    cell: ({ row }) => <RolePills roles={row.original.roles} />,
  },
  {
    id: 'status',
    header: 'Status',
    enableSorting: false,
    cell: ({ row }) => (
      <EmploymentBadge status={row.original.status} invitePending={!row.original.hasPassword} />
    ),
  },
  {
    id: 'lastLoginAt',
    accessorKey: 'lastLoginAt',
    header: 'Last sign-in',
    cell: ({ getValue }) => {
      const v = getValue() as string | undefined;
      return v ? (
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(v), { addSuffix: true })}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Never</span>
      );
    },
  },
];

export function EmployeesPage() {
  const canManage = useCan('user:manage', 'org');
  const canSeeRoles = useCan('role:manage', 'org') || canManage;
  const [q, setQ] = useState('');
  const [departmentId, setDepartmentId] = useState(ALL);
  const [roleId, setRoleId] = useState(ALL);
  const [status, setStatus] = useState<EmploymentStatus | typeof ALL>('active');
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [creating, setCreating] = useState(false);
  // ?person=<id> opens a profile directly (global search).
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get('person'));

  const departments = useDepartments();
  const roles = useRoles(canSeeRoles);
  const query = useMemo(
    () => ({
      q: q || undefined,
      departmentId: departmentId === ALL ? undefined : departmentId,
      roleId: roleId === ALL ? undefined : roleId,
      status: status === ALL ? undefined : status,
      sort: toSortParam(sorting),
      page,
      limit: PAGE_SIZE,
    }),
    [q, departmentId, roleId, status, sorting, page],
  );
  const users = useUsers(query);
  const filtered = Boolean(q) || departmentId !== ALL || roleId !== ALL || status !== 'active';

  const resetPageAnd =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Employees"
        description="Directory of people, their roles, skills and reporting lines."
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <UserPlus /> Add employee
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={q}
          onChange={resetPageAnd(setQ)}
          placeholder="Search name, e-mail, ID…"
        />
        <Select value={departmentId} onValueChange={resetPageAnd(setDepartmentId)}>
          <SelectTrigger size="sm" className="w-48" aria-label="Filter by department">
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
        {canSeeRoles ? (
          <Select value={roleId} onValueChange={resetPageAnd(setRoleId)}>
            <SelectTrigger size="sm" className="w-44" aria-label="Filter by role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All roles</SelectItem>
              {roles.data?.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Select
          value={status}
          onValueChange={resetPageAnd((v: string) => setStatus(v as EmploymentStatus | typeof ALL))}
        >
          <SelectTrigger size="sm" className="w-36" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="terminated">Terminated</SelectItem>
            <SelectItem value={ALL}>All (excl. terminated)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={users.data?.items}
        meta={users.data?.meta}
        onPageChange={setPage}
        sorting={sorting}
        onSortingChange={resetPageAnd(setSorting)}
        isLoading={users.isLoading}
        error={users.error}
        onRetry={() => void users.refetch()}
        getRowId={(u) => u.id}
        onRowClick={(u) => setSelected(u.id)}
        empty={
          <EmptyState
            compact
            icon={Users}
            title={filtered ? 'No employees match these filters' : 'No employees yet'}
            description={
              filtered
                ? 'Try clearing the search or filters.'
                : canManage
                  ? 'Add the first employee to get started.'
                  : undefined
            }
            action={
              !filtered && canManage ? (
                <Button size="sm" onClick={() => setCreating(true)}>
                  <UserPlus /> Add employee
                </Button>
              ) : undefined
            }
          />
        }
      />

      <EmployeeFormDialog open={creating} onOpenChange={setCreating} />
      <EmployeeDrawer userId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
