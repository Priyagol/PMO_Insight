import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, Clock, GitBranch, Hourglass, Lock } from 'lucide-react';
import { useState } from 'react';
import {
  STATUS_LABELS,
  type AvailableTransitionDto,
  type TaskDto,
  type TaskStatus,
  type UpdateTaskInput,
} from '@arihant/shared';
import { StatusBadge } from '@/components/common/StatusBadge';
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
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import * as wfApi from '@/services/api/workflows';

export const workflowKeys = {
  transitions: (taskId: string) => ['tasks', 'transitions', taskId] as const,
  history: (taskId: string) => ['tasks', 'transition-history', taskId] as const,
  list: ['workflows'] as const,
};

/** Formats a duration in milliseconds as "3 d 4 h" / "25 min". */
export function formatDuration(ms: number | null): string {
  if (ms == null) return '';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/**
 * Status control for a task: lists the workflow transitions the user may take from the current
 * status, explains the ones that are blocked, asks for a comment when required and shows a move
 * waiting for approval.
 */
export function TaskWorkflowControl({
  task,
  editable,
  onMove,
}: {
  task: TaskDto;
  editable: boolean;
  onMove: (input: UpdateTaskInput) => void;
}) {
  const q = useQuery({
    queryKey: workflowKeys.transitions(task.id),
    queryFn: () => wfApi.fetchTaskTransitions(task.id),
    enabled: editable,
  });
  const [asking, setAsking] = useState<AvailableTransitionDto | null>(null);
  const [comment, setComment] = useState('');
  const data = q.data;
  const label = (s: TaskStatus) => data?.workflow.labels[s] ?? STATUS_LABELS[s];

  const take = (t: AvailableTransitionDto) => {
    if (t.requireComment) {
      setComment('');
      setAsking(t);
    } else onMove({ status: t.to });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {editable && data && data.transitions.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Status: ${task.statusLabel}. Change status`}
              >
                <StatusBadge status={task.status} label={task.statusLabel} />
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel className="flex items-center gap-1 text-xs text-muted-foreground">
                <GitBranch className="size-3" /> {data.workflow.name}
              </DropdownMenuLabel>
              {data.transitions.map((t) => (
                <DropdownMenuItem
                  key={t.id}
                  disabled={t.blockers.length > 0 || Boolean(data.pending)}
                  onSelect={() => take(t)}
                  className="flex-col items-start gap-0.5"
                >
                  <span className="flex w-full items-center gap-1.5">
                    <span className="font-medium">{t.name}</span>
                    <ArrowRight className="size-3 text-muted-foreground" />
                    <span>{t.toLabel}</span>
                    {t.approval ? (
                      <span className="ml-auto rounded bg-amber-500/15 px-1 text-[10px] text-amber-700 dark:text-amber-300">
                        needs approval
                      </span>
                    ) : null}
                  </span>
                  {t.blockers.length ? (
                    <span className="flex items-start gap-1 text-xs text-muted-foreground">
                      <Lock className="mt-0.5 size-3 shrink-0" /> {t.blockers.join('. ')}
                    </span>
                  ) : t.requireComment ? (
                    <span className="text-xs text-muted-foreground">Asks for a comment</span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <StatusBadge status={task.status} label={task.statusLabel} />
        )}
      </div>
      {data?.pending ? (
        <p
          role="status"
          className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300"
        >
          <Hourglass className="size-3.5" /> Waiting for approval to move to{' '}
          {label(data.pending.to)}
          {data.pending.approvalKey ? ` (${data.pending.approvalKey})` : ''}
        </p>
      ) : null}

      <Dialog open={asking !== null} onOpenChange={(o) => !o && setAsking(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{asking?.name}</DialogTitle>
            <DialogDescription>
              {task.key} moves to {asking?.toLabel}. This step asks for a comment; it is added to
              the task.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            aria-label="Comment"
            rows={4}
            maxLength={5000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(null)}>
              Cancel
            </Button>
            <Button
              disabled={!comment.trim()}
              onClick={() => {
                if (asking) onMove({ status: asking.to, transitionComment: comment.trim() });
                setAsking(null);
              }}
            >
              {asking?.approval ? 'Ask for approval' : asking?.name}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const VIA_LABELS: Record<string, string> = {
  user: '',
  board: 'on the board',
  bulk: 'in a bulk edit',
  git: 'by GitHub',
  approval: 'after approval',
  automation: 'by an automation',
  workflow_change: 'when the workflow changed',
  create: '',
};

/** Status history of a task with the time spent in each status. */
export function TransitionHistory({
  taskId,
  labels,
}: {
  taskId: string;
  labels: Partial<Record<TaskStatus, string>>;
}) {
  const q = useQuery({
    queryKey: workflowKeys.history(taskId),
    queryFn: () => wfApi.fetchTransitionHistory(taskId),
  });
  if (!q.data?.length) return null;
  const name = (s: TaskStatus) => labels[s] ?? s.replace('_', ' ');
  return (
    <section aria-label="Status history" className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Status history
      </h3>
      <ol className="space-y-1.5 border-l pl-3 text-xs">
        {q.data.map((h) => (
          <li key={h.id} className="space-y-0.5">
            <p>
              {h.from ? (
                <>
                  <span className="text-muted-foreground">{name(h.from)}</span> →{' '}
                </>
              ) : (
                'Created in '
              )}
              <span className="font-medium">{name(h.to)}</span>
              {h.transition ? (
                <span className="text-muted-foreground"> · {h.transition}</span>
              ) : null}
            </p>
            <p className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
              {h.by?.name ?? (h.via === 'git' ? 'GitHub' : 'System')}
              {VIA_LABELS[h.via] ? ` ${VIA_LABELS[h.via]}` : ''} ·{' '}
              {new Date(h.at).toLocaleString('en-IN')}
              {h.durationMs != null ? (
                <span className="inline-flex items-center gap-0.5">
                  <Clock className="size-3" /> {formatDuration(h.durationMs)} in{' '}
                  {h.from ? name(h.from) : ''}
                </span>
              ) : null}
            </p>
            {h.comment ? <p className="rounded bg-muted px-2 py-1">{h.comment}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
