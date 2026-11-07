import { STATUS_LABELS, type ProjectStatus, type TaskStatus } from '@arihant/shared';
import { cn } from '@/lib/utils';

type Status = ProjectStatus | TaskStatus;

const TONE: Record<Status, string> = {
  planning: 'bg-violet/10 text-violet',
  not_started: 'bg-muted text-muted-foreground',
  in_progress: 'bg-primary/10 text-primary',
  on_hold: 'bg-warning/10 text-warning',
  at_risk: 'bg-destructive/10 text-destructive',
  completed: 'bg-success/10 text-success',
  cancelled: 'bg-muted text-muted-foreground line-through',
  backlog: 'bg-muted text-muted-foreground',
  todo: 'bg-secondary text-secondary-foreground',
  in_review: 'bg-violet/10 text-violet',
  testing: 'bg-info/10 text-info',
  blocked: 'bg-destructive/10 text-destructive',
  done: 'bg-success/10 text-success',
};

const DOT: Record<Status, string> = {
  planning: 'bg-violet',
  not_started: 'bg-muted-foreground',
  in_progress: 'bg-primary',
  on_hold: 'bg-warning',
  at_risk: 'bg-destructive',
  completed: 'bg-success',
  cancelled: 'bg-muted-foreground',
  backlog: 'bg-muted-foreground',
  todo: 'bg-secondary-foreground/60',
  in_review: 'bg-violet',
  testing: 'bg-info',
  blocked: 'bg-destructive',
  done: 'bg-success',
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: Status;
  /** Name from the project's workflow, when it renames the status. */
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE[status],
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', DOT[status])} aria-hidden />
      {label ?? STATUS_LABELS[status]}
    </span>
  );
}
