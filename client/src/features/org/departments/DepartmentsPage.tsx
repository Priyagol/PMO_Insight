import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Building2, MoreHorizontal, Pencil, Plus, Archive, ArchiveRestore } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import type { DepartmentDto, UserRef } from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { FormField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchInput } from '@/components/common/SearchInput';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/hooks/use-permission';
import * as org from '@/services/api/org';
import { useArchivedDepartments, useDepartments, useOrgMutation } from '../hooks';
import { UserPicker } from '../components/UserPicker';

const NONE = '__none__';
const formSchema = z.object({
  name: z.string().trim().min(2, 'Enter a department name').max(80),
  code: z
    .string()
    .trim()
    .min(2, 'Use 2–10 characters')
    .max(10, 'Use 2–10 characters')
    .regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes only'),
  description: z.string().trim().max(500),
  head: z.custom<UserRef | null>(),
  parentId: z.string(),
});
type FormValues = z.infer<typeof formSchema>;

function DepartmentDialog({
  open,
  onOpenChange,
  department,
  all,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  department?: DepartmentDto;
  all: DepartmentDto[];
}) {
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema) });
  const errors = form.formState.errors;
  useEffect(() => {
    if (open) {
      form.reset({
        name: department?.name ?? '',
        code: department?.code ?? '',
        description: department?.description ?? '',
        head: department?.head ?? null,
        parentId: department?.parent?.id ?? NONE,
      });
    }
  }, [open, department, form]);

  const save = useOrgMutation(
    (v: FormValues) => {
      const input = {
        name: v.name,
        code: v.code.toUpperCase(),
        description: v.description || undefined,
        headId: v.head?.id ?? null,
        parentId: v.parentId === NONE ? null : v.parentId,
      };
      return department ? org.updateDepartment(department.id, input) : org.createDepartment(input);
    },
    { success: (d) => `${d.name} ${department ? 'updated' : 'created'}` },
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{department ? `Edit ${department.name}` : 'New department'}</DialogTitle>
          <DialogDescription>
            Departments scope what department heads and members can see.
          </DialogDescription>
        </DialogHeader>
        <form
          id="department-form"
          noValidate
          className="grid gap-4 sm:grid-cols-[1fr_140px]"
          onSubmit={form.handleSubmit(async (v) => {
            await save.mutateAsync(v);
            onOpenChange(false);
          })}
        >
          <FormField label="Name" required error={errors.name?.message}>
            <Input autoFocus {...form.register('name')} />
          </FormField>
          <FormField label="Code" required error={errors.code?.message}>
            <Input className="font-mono uppercase" {...form.register('code')} />
          </FormField>
          <FormField label="Department head" className="sm:col-span-2">
            <Controller
              control={form.control}
              name="head"
              render={({ field }) => (
                <UserPicker value={field.value ?? null} onChange={field.onChange} />
              )}
            />
          </FormField>
          <FormField label="Parent department" className="sm:col-span-2">
            <Controller
              control={form.control}
              name="parentId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None (top level)</SelectItem>
                    {all
                      .filter((d) => d.id !== department?.id)
                      .map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name} ({d.code})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          <FormField
            label="Description"
            className="sm:col-span-2"
            error={errors.description?.message}
          >
            <Textarea rows={3} {...form.register('description')} />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="department-form" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : department ? 'Save changes' : 'Create department'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DepartmentsPage() {
  const canManage = useCan('department:manage', 'org');
  const { data, isLoading, error, refetch } = useDepartments();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<DepartmentDto | 'new' | null>(null);
  const [archiving, setArchiving] = useState<DepartmentDto | null>(null);
  const archive = useOrgMutation((id: string) => org.archiveDepartment(id), {
    success: 'Department archived',
  });

  const [showArchived, setShowArchived] = useState(false);
  const archived = useArchivedDepartments(canManage && showArchived);
  const restore = useOrgMutation((id: string) => org.restoreDepartment(id), {
    success: (d) => `${d.name} restored`,
  });

  const rows = useMemo(() => {
    const needle = q.toLowerCase();
    return (data ?? []).filter(
      (d) => !needle || `${d.name} ${d.code}`.toLowerCase().includes(needle),
    );
  }, [data, q]);

  const columns = useMemo<ColumnDef<DepartmentDto, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Department',
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.name}</p>
            {row.original.description ? (
              <p className="line-clamp-1 text-xs text-muted-foreground">
                {row.original.description}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: 'code',
        header: 'Code',
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      {
        id: 'head',
        header: 'Head',
        cell: ({ row }) =>
          row.original.head?.name ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: 'parent',
        header: 'Parent',
        cell: ({ row }) =>
          row.original.parent?.name ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: 'members',
        header: 'Active members',
        cell: ({ row }) => <span className="tabular">{row.original.memberCount}</span>,
      },
      ...(canManage
        ? [
            {
              id: 'actions',
              header: '',
              cell: ({ row }) => (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Actions for ${row.original.name}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(row.original)}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setArchiving(row.original)}
                    >
                      <Archive /> Archive
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            } satisfies ColumnDef<DepartmentDto, unknown>,
          ]
        : []),
    ],
    [canManage],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Departments"
        description="Organisational units, their heads and reporting structure."
        actions={
          canManage ? (
            <Button onClick={() => setEditing('new')}>
              <Plus /> New department
            </Button>
          ) : null
        }
      />
      <SearchInput value={q} onChange={setQ} placeholder="Search departments…" />
      <DataTable
        columns={columns}
        data={rows}
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(d) => d.id}
        onRowClick={canManage ? (d) => setEditing(d) : undefined}
        empty={
          <EmptyState
            compact
            icon={Building2}
            title={q ? 'No departments match' : 'No departments yet'}
            action={
              !q && canManage ? (
                <Button size="sm" onClick={() => setEditing('new')}>
                  <Plus /> New department
                </Button>
              ) : undefined
            }
          />
        }
      />
      <DepartmentDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        department={editing && editing !== 'new' ? editing : undefined}
        all={data ?? []}
      />
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={`Archive ${archiving?.name ?? ''}?`}
        description="Archived departments disappear from lists but keep their history. A department must have no active members or sub-departments."
        confirmLabel="Archive"
        destructive
        onConfirm={async () => {
          await archive.mutateAsync(archiving!.id);
        }}
      />
      {canManage ? (
        <section className="space-y-2" aria-label="Archived departments">
          <Button variant="outline" size="sm" onClick={() => setShowArchived((v) => !v)}>
            <Archive /> {showArchived ? 'Hide archived departments' : 'Show archived departments'}
          </Button>
          {showArchived ? (
            archived.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : archived.data?.length ? (
              <ul className="divide-y rounded-lg border bg-card">
                {archived.data.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-medium">{d.name}</span>{' '}
                      <span className="font-mono text-xs text-muted-foreground">{d.code}</span>
                      {d.archivedAt ? (
                        <span className="text-xs text-muted-foreground">
                          {' '}
                          · archived {new Date(d.archivedAt).toLocaleDateString('en-IN')}
                        </span>
                      ) : null}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={restore.isPending}
                      onClick={() => restore.mutate(d.id)}
                    >
                      <ArchiveRestore /> Restore
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No archived departments.</p>
            )
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
