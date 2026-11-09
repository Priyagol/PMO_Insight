import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Trash2, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import type { TeamDto, UserRef } from '@arihant/shared';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { FormField } from '@/components/common/FormField';
import { UserAvatar } from '@/components/common/UserAvatar';
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
import { MultiUserPicker } from '@/features/org/components/MultiUserPicker';
import { UserPicker } from '@/features/org/components/UserPicker';
import { useDepartments } from '@/features/org/hooks';
import { useCan } from '@/hooks/use-permission';
import * as t from '@/services/api/tracking';
import { useTeams, useTrackMutation } from './hooks';

const NONE = '__none__';
const formSchema = z.object({
  name: z.string().trim().min(2, 'Name the team').max(80),
  description: z.string().trim().max(500),
  departmentId: z.string(),
  lead: z.custom<UserRef | null>(),
  members: z.custom<UserRef[]>(),
});
type FormValues = z.infer<typeof formSchema>;

function TeamDialog({
  open,
  onOpenChange,
  team,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  team?: TeamDto;
}) {
  const departments = useDepartments();
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema) });
  const errors = form.formState.errors;
  useEffect(() => {
    if (open)
      form.reset({
        name: team?.name ?? '',
        description: team?.description ?? '',
        departmentId: team?.department?.id ?? NONE,
        lead: team?.lead ?? null,
        members: team?.members ?? [],
      });
  }, [open, team, form]);

  const save = useTrackMutation(
    (v: FormValues) => {
      const input = {
        name: v.name,
        description: v.description || undefined,
        departmentId: v.departmentId === NONE ? null : v.departmentId,
        leadId: v.lead?.id ?? null,
        memberIds: v.members.map((m) => m.id),
      };
      return team ? t.updateTeam(team.id, input) : t.createTeam(input);
    },
    { success: (r) => `${r.name} ${team ? 'updated' : 'created'}` },
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{team ? `Edit ${team.name}` : 'New team'}</DialogTitle>
          <DialogDescription>
            A named group of people, such as a squad or a QA pod. Its figures appear on the
            Performance tab.
          </DialogDescription>
        </DialogHeader>
        <form
          id="team-form"
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            await save.mutateAsync(v);
            onOpenChange(false);
          })}
        >
          <FormField label="Name" required error={errors.name?.message}>
            <Input autoFocus {...form.register('name')} />
          </FormField>
          <FormField label="Department">
            <Controller
              control={form.control}
              name="departmentId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No department</SelectItem>
                    {departments.data?.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          <FormField label="Team lead">
            <Controller
              control={form.control}
              name="lead"
              render={({ field }) => (
                <UserPicker value={field.value ?? null} onChange={field.onChange} />
              )}
            />
          </FormField>
          <FormField label="Members" hint="The lead is always counted as a member.">
            <Controller
              control={form.control}
              name="members"
              render={({ field }) => (
                <MultiUserPicker
                  value={field.value ?? []}
                  onChange={field.onChange}
                  addLabel="Add members"
                />
              )}
            />
          </FormField>
          <FormField label="Description" error={errors.description?.message}>
            <Textarea rows={2} {...form.register('description')} />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="team-form" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : team ? 'Save changes' : 'Create team'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Named teams: who leads them and who is in them. */
export function TeamsPanel() {
  const teams = useTeams();
  const canManageAll = useCan('department:manage');
  const isDepartmentHead = useCan('team:read', 'department');
  const canCreate = canManageAll || isDepartmentHead;
  const [editing, setEditing] = useState<TeamDto | 'new' | null>(null);
  const [removing, setRemoving] = useState<TeamDto | null>(null);
  const archive = useTrackMutation((id: string) => t.archiveTeam(id), {
    success: 'Team archived',
  });

  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> New team
          </Button>
        </div>
      ) : null}
      {teams.error ? (
        <ErrorState error={teams.error} onRetry={() => void teams.refetch()} />
      ) : teams.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !teams.data?.length ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={UsersRound}
            title="No teams yet"
            description="Group people into named teams to see team-wise workload and delivery."
          />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {teams.data.map((team) => (
            <section key={team.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold">{team.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {team.department?.name ?? 'No department'} · {team.members.length} member
                    {team.members.length === 1 ? '' : 's'}
                    {team.lead ? ` · Lead: ${team.lead.name}` : ''}
                  </p>
                </div>
                {team.canEdit ? (
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit ${team.name}`}
                      onClick={() => setEditing(team)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Archive ${team.name}`}
                      onClick={() => setRemoving(team)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ) : null}
              </div>
              {team.description ? (
                <p className="mt-2 text-sm text-muted-foreground">{team.description}</p>
              ) : null}
              <ul className="mt-3 flex flex-wrap gap-2">
                {team.members.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
                  >
                    <UserAvatar name={m.name} size="sm" className="size-4 text-[8px]" />
                    {m.name}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <TeamDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        team={editing === 'new' || editing === null ? undefined : editing}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Archive ${removing?.name ?? ''}?`}
        description="The team disappears from lists. People, tasks and history are not changed."
        confirmLabel="Archive"
        destructive
        onConfirm={async () => {
          await archive.mutateAsync(removing!.id);
        }}
      />
    </div>
  );
}
