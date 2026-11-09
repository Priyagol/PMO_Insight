import { format, parseISO } from 'date-fns';
import { PauseCircle, PlayCircle } from 'lucide-react';
import { useState } from 'react';
import type { ProjectDto } from '@arihant/shared';
import { FormField } from '@/components/common/FormField';
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
import { Textarea } from '@/components/ui/textarea';
import * as work from '@/services/api/work';
import { useWorkMutation } from '../hooks';

const day = (iso: string) => format(parseISO(iso), 'd MMM yyyy');

/** Shown at the top of a project while it is on hold: why, since when, by whom, and the expected restart. */
export function HoldBanner({ project }: { project: ProjectDto }) {
  if (project.status !== 'on_hold') return null;
  const h = project.hold;
  return (
    <div
      role="status"
      className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
    >
      <PauseCircle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
      <div className="space-y-0.5">
        <p className="font-medium">This project is on hold</p>
        {h ? (
          <>
            <p>{h.reason}</p>
            <p className="text-xs text-muted-foreground">
              Since {day(h.since)}
              {h.by ? ` · put on hold by ${h.by.name}` : ''}
              {h.until ? ` · expected to restart ${day(h.until)}` : ' · no restart date set'}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No reason was recorded.</p>
        )}
      </div>
    </div>
  );
}

/** "Put on hold" / "Restart" for people who can edit the project. */
export function HoldButton({ project }: { project: ProjectDto }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onHold = project.status === 'on_hold';
  const hold = useWorkMutation(
    () =>
      work.updateProject(project.id, {
        status: 'on_hold',
        holdReason: reason.trim(),
        holdUntil: until || null,
      }),
    { success: (p) => `${p.key} is on hold. Its members have been told.` },
  );
  const restart = useWorkMutation(() => work.updateProject(project.id, { status: 'in_progress' }), {
    success: (p) => `${p.key} restarted`,
  });
  if (!project.can.update || ['completed', 'cancelled'].includes(project.status)) return null;

  if (onHold)
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={restart.isPending}
        onClick={() => restart.mutate(undefined)}
      >
        <PlayCircle /> Restart
      </Button>
    );

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PauseCircle /> Put on hold
      </Button>
      <Dialog open={open} onOpenChange={(o) => !hold.isPending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Put {project.key} on hold</DialogTitle>
            <DialogDescription>
              The project shows as On hold with your reason. Its members and the department head are
              told, and due-date reminders and overdue escalations pause until it restarts.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim().length < 3) return setError('Say why the project is on hold');
              setError(null);
              hold.mutate(undefined, { onSuccess: () => setOpen(false) });
            }}
          >
            <FormField
              label="Why is the project on hold?"
              required
              hint="For example: Business priorities changed, budget moved to the CRM rollout."
              error={error ?? undefined}
            >
              <Textarea
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </FormField>
            <FormField label="Expected restart" hint="Optional">
              <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={hold.isPending}>
                Put on hold
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
