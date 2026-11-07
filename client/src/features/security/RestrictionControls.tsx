import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Lock, LockOpen } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ProjectDto, ProjectMemberDto, TaskDto } from '@arihant/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { errorMessage } from '@/lib/errors';
import * as sec from '@/services/api/security';

/** Task panel: restrict who can see the task. */
export function TaskRestrictionControl({
  task,
  members,
  canEdit,
}: {
  task: TaskDto;
  members: ProjectMemberDto[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [restricted, setRestricted] = useState(task.restricted);
  const [allowed, setAllowed] = useState<string[]>(task.allowedUserIds);
  const save = useMutation({
    mutationFn: () => sec.setTaskRestriction(task.id, { restricted, allowedUserIds: allowed }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      toast.success(restricted ? 'Access restricted' : 'Restriction removed');
      setOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const names = members
    .filter((m) => task.allowedUserIds.includes(m.user.id))
    .map((m) => m.user.name);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {task.restricted ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-800 dark:text-amber-200">
          <Lock className="size-3" /> Restricted
          {names.length ? `: ${names.join(', ')}` : ''} + assignee, reporter, project managers
        </span>
      ) : null}
      {canEdit ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={() => {
            setRestricted(task.restricted || true);
            setAllowed(task.allowedUserIds);
            setOpen(true);
          }}
        >
          {task.restricted ? <LockOpen /> : <Lock />}{' '}
          {task.restricted ? 'Change access' : 'Restrict access'}
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Who can see {task.key}</DialogTitle>
            <DialogDescription>
              A restricted task is hidden from everyone else on the project, in lists, boards,
              search and the activity feed.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={restricted} onCheckedChange={(c) => setRestricted(c === true)} />
            Restrict this task
          </label>
          {restricted ? (
            <fieldset className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2 text-sm">
              <legend className="px-1 text-xs text-muted-foreground">Also allow</legend>
              {members.map((m) => (
                <label key={m.user.id} className="flex items-center gap-2">
                  <Checkbox
                    checked={allowed.includes(m.user.id)}
                    onCheckedChange={(c) =>
                      setAllowed((xs) =>
                        c === true ? [...xs, m.user.id] : xs.filter((x) => x !== m.user.id),
                      )
                    }
                  />
                  {m.user.name}
                </label>
              ))}
            </fieldset>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Project setup: confidential projects are visible only to their members. */
export function ProjectConfidentialToggle({ project }: { project: ProjectDto }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (on: boolean) => sec.setProjectConfidential(project.id, on),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success(
        r.confidential ? 'Project is now confidential' : 'Project is no longer confidential',
      );
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <section aria-label="Confidentiality" className="space-y-2 rounded-xl border bg-card p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <EyeOff className="size-4" /> Confidential project
      </h2>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={project.confidential}
          disabled={!project.can.update || toggle.isPending}
          onCheckedChange={(c) => toggle.mutate(c === true)}
        />
        Only members of this project (and super administrators) can see it and its tasks, even
        people who normally see every project
      </label>
    </section>
  );
}
