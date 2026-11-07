import { Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  ORG_ONLY_PERMISSIONS,
  PERMISSION_GROUPS,
  SCOPES,
  type RoleDto,
  type Scope,
} from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { FormField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import * as org from '@/services/api/org';
import { Pill } from '../components/Badges';
import { sameGrants, SCOPE_LABELS, toGrants, toMap, type GrantMap } from './grants';
import { useOrgMutation, useRoles } from '../hooks';

const NONE = 'none';

/** Permission × scope matrix. Read-only for the locked Super Admin role. */
export function PermissionMatrix({
  value,
  onChange,
  readOnly,
}: {
  value: GrantMap;
  onChange: (v: GrantMap) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="divide-y rounded-xl border">
      {PERMISSION_GROUPS.map((group) => (
        <section key={group.resource} className="p-4">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {group.label}
          </h3>
          <ul className="space-y-1.5">
            {group.permissions.map((p) => {
              const orgOnly = ORG_ONLY_PERMISSIONS.includes(p.key);
              const scopes = orgOnly ? (['org'] as Scope[]) : [...SCOPES];
              return (
                <li key={p.key} className="flex items-center justify-between gap-3">
                  <span className="text-sm">
                    {p.label}
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                      {p.key}
                    </span>
                  </span>
                  <Select
                    disabled={readOnly}
                    value={value[p.key] ?? NONE}
                    onValueChange={(v) => {
                      const next = { ...value };
                      if (v === NONE) delete next[p.key];
                      else next[p.key] = v as Scope;
                      onChange(next);
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className={cn('w-40', !value[p.key] && 'text-muted-foreground')}
                      aria-label={`Scope for ${p.label}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No access</SelectItem>
                      {scopes.map((s) => (
                        <SelectItem key={s} value={s}>
                          {SCOPE_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function NewRoleDialog({
  open,
  onOpenChange,
  roles,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  roles: RoleDto[];
  onCreated: (r: RoleDto) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [copyFrom, setCopyFrom] = useState(NONE);
  const [error, setError] = useState<string | null>(null);
  const create = useOrgMutation(org.createRole, {
    success: (r) => `Role "${r.name}" created`,
    invalidate: [['roles']],
  });

  const submit = async () => {
    if (name.trim().length < 2) return setError('Enter a role name (at least 2 characters)');
    const source = roles.find((r) => r.id === copyFrom);
    const role = await create.mutateAsync({
      name: name.trim(),
      description: description.trim() || undefined,
      grants: source?.grants ?? [],
    });
    onCreated(role);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>
            Start empty or copy the permissions of an existing role, then adjust them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Role name" required error={error ?? undefined}>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. HR Administrator"
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>
          <FormField label="Copy permissions from">
            <Select value={copyFrom} onValueChange={setCopyFrom}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Start with no permissions</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit().catch(() => undefined)} disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleEditor({ role, onDeleted }: { role: RoleDto; onDeleted: () => void }) {
  const [grants, setGrants] = useState<GrantMap>(() => toMap(role.grants));
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty =
    !sameGrants(toMap(role.grants), grants) ||
    name !== role.name ||
    description !== (role.description ?? '');

  const save = useOrgMutation(
    () =>
      org.updateRole(role.id, {
        ...(role.isSystem ? {} : { name: name.trim() }),
        description: description.trim() || undefined,
        grants: toGrants(grants),
      }),
    {
      success: (r) => `Role "${r.name}" saved. Changes apply on users' next request.`,
      invalidate: [['roles']],
    },
  );
  const remove = useOrgMutation(() => org.deleteRole(role.id), {
    success: 'Role deleted',
    invalidate: [['roles']],
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <FormField label="Role name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={role.isSystem}
            />
          </FormField>
          <FormField label="Description">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={role.locked}
            />
          </FormField>
        </div>
        <div className="flex items-center gap-2 self-end">
          {!role.isSystem ? (
            <Button
              variant="outline"
              className="text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 /> Delete
            </Button>
          ) : null}
          {!role.locked ? (
            <>
              <Button
                variant="ghost"
                disabled={!dirty || save.isPending}
                onClick={() => {
                  setGrants(toMap(role.grants));
                  setName(role.name);
                  setDescription(role.description ?? '');
                }}
              >
                Discard
              </Button>
              <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(undefined)}>
                {save.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {role.locked ? (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <Lock className="size-4" /> Super Admin always has every permission organisation-wide and
          cannot be edited.
        </p>
      ) : null}
      <PermissionMatrix value={grants} onChange={setGrants} readOnly={role.locked} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete role "${role.name}"?`}
        description="Only roles that are not assigned to anyone can be deleted."
        confirmLabel="Delete role"
        destructive
        onConfirm={async () => {
          await remove.mutateAsync(undefined);
          onDeleted();
        }}
      />
    </div>
  );
}

export function RolesPage() {
  const { data: roles, isLoading, error, refetch } = useRoles();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = roles?.find((r) => r.id === selectedId) ?? roles?.[0];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Roles & Permissions"
        description="What each role may do, and how widely: own work, team, project, department or the whole organisation."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New role
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          <nav aria-label="Roles" className="space-y-1">
            {isLoading
              ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)
              : roles?.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    aria-current={selected?.id === r.id ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                      selected?.id === r.id
                        ? 'border-primary bg-primary/5'
                        : 'bg-card hover:bg-muted/60',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.userCount} {r.userCount === 1 ? 'person' : 'people'} · {r.grants.length}{' '}
                        permissions
                      </span>
                    </span>
                    {r.locked ? (
                      <Lock className="size-3.5 text-muted-foreground" />
                    ) : !r.isSystem ? (
                      <Pill className="bg-violet/10 text-violet">Custom</Pill>
                    ) : null}
                  </button>
                ))}
          </nav>
          <div>
            {selected ? (
              <RoleEditor
                key={`${selected.id}:${selected.updatedAt}`}
                role={selected}
                onDeleted={() => setSelectedId(null)}
              />
            ) : isLoading ? (
              <Skeleton className="h-96 w-full" />
            ) : (
              <EmptyState icon={ShieldCheck} title="No roles" />
            )}
          </div>
        </div>
      )}
      {/* Mounted only while open so each opening starts with a fresh form. */}
      {creating ? (
        <NewRoleDialog
          open={creating}
          onOpenChange={setCreating}
          roles={roles ?? []}
          onCreated={(r) => setSelectedId(r.id)}
        />
      ) : null}
    </div>
  );
}
