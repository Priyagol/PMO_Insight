import { Sparkles } from 'lucide-react';
import { ErrorState } from '@/components/common/ErrorState';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import * as t from '@/services/api/tracking';
import { useSuggestions, useTrackMutation } from './hooks';

const FACTORS: [string, string][] = [
  ['workload', 'Workload'],
  ['capacity', 'Capacity'],
  ['skill', 'Skills'],
  ['priority', 'Fit'],
  ['availability', 'Availability'],
];

/** Ranked candidates for one task with the score explained; mounted only while open. */
export function SuggestAssigneeDialog({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose: () => void;
}) {
  const s = useSuggestions(taskId);
  const assign = useTrackMutation((userId: string) => t.assignSuggested(taskId, userId), {
    success: 'Assigned',
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-violet" /> Suggested assignees
          </DialogTitle>
          <DialogDescription>
            {s.data
              ? `${s.data.task.key} · ${s.data.task.effortHours} h of work · ranked by workload, capacity, skills, fit and availability`
              : 'Scoring the project team…'}
          </DialogDescription>
        </DialogHeader>
        {s.error ? (
          <ErrorState error={s.error} />
        ) : !s.data ? (
          <Skeleton className="h-48 w-full" />
        ) : s.data.candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody else on the project team can take this task.
          </p>
        ) : (
          <ol className="space-y-2">
            {s.data.candidates.map((c, i) => (
              <li
                key={c.user.id}
                className={cn('rounded-lg border p-3', !c.eligible && 'opacity-70')}
              >
                <div className="flex items-center gap-3">
                  <span className="w-5 text-center text-xs text-muted-foreground">{i + 1}</span>
                  <UserAvatar name={c.user.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.user.name}</p>
                    <p className="text-xs text-muted-foreground tabular">
                      {c.loadHours} h load / {c.capacityHours} h capacity · {c.availableDays} days
                      available
                    </p>
                  </div>
                  {c.eligible ? (
                    <>
                      <span className="text-lg font-semibold tabular">{c.score}</span>
                      <Button
                        size="sm"
                        disabled={assign.isPending}
                        onClick={() => assign.mutate(c.user.id, { onSuccess: onClose })}
                      >
                        Assign
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs font-medium text-destructive">Not eligible</span>
                  )}
                </div>
                {c.eligible ? (
                  <div className="mt-2 grid grid-cols-5 gap-2 pl-8">
                    {FACTORS.map(([k, label]) => {
                      const v = c.breakdown[k as keyof typeof c.breakdown];
                      return (
                        <div key={k} className="text-[11px]">
                          <div className="mb-0.5 flex justify-between text-muted-foreground">
                            <span>{label}</span>
                            <span className="tabular">{Math.round(v * 100)}</span>
                          </div>
                          <div className="h-1 overflow-hidden rounded bg-muted">
                            <div className="h-full bg-primary" style={{ width: `${v * 100}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {c.reasons.length ? (
                  <ul className="mt-1.5 pl-8 text-xs text-muted-foreground">
                    {c.reasons.map((r) => (
                      <li key={r}>• {r}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
