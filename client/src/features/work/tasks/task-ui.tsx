import { CalendarClock, CheckSquare, MessageSquare, Paperclip } from 'lucide-react';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_STATUSES,
  type ProjectMemberDto,
  type TaskDto,
  type TaskStatus,
} from '@arihant/shared';
import { PriorityIndicator } from '@/components/common/PriorityIndicator';
import { IssueTypeIcon, PointsBadge } from '@/features/agile/agile-ui';
import { UserAvatar } from '@/components/common/UserAvatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatDay } from '../format';

export const UNASSIGNED = '__unassigned__';

export function StatusSelect({
  value,
  onChange,
  disabled,
  allowed,
  className,
}: {
  value: TaskStatus;
  onChange: (s: TaskStatus) => void;
  disabled?: boolean;
  /** Restrict choices (e.g. allowed transitions). */
  allowed?: readonly TaskStatus[];
  className?: string;
}) {
  const options = TASK_STATUSES.filter((s) => s === value || !allowed || allowed.includes(s));
  return (
    <Select value={value} onValueChange={(v) => onChange(v as TaskStatus)} disabled={disabled}>
      <SelectTrigger size="sm" className={cn('w-36', className)} aria-label="Status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((s) => (
          <SelectItem key={s} value={s}>
            {STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PrioritySelect({
  value,
  onChange,
  disabled,
}: {
  value: TaskDto['priority'];
  onChange: (p: TaskDto['priority']) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as TaskDto['priority'])}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className="w-32" aria-label="Priority">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRIORITIES.map((p) => (
          <SelectItem key={p} value={p}>
            <PriorityIndicator priority={p} showLabel={false} /> {PRIORITY_LABELS[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Assignee chooser limited to the project team (the API enforces the same rule). */
export function AssigneeSelect({
  members,
  value,
  onChange,
  disabled,
  className,
}: {
  members: ProjectMemberDto[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={value ?? UNASSIGNED}
      onValueChange={(v) => onChange(v === UNASSIGNED ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className={cn('w-48', className)} aria-label="Assignee">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
        {members
          .filter((m) => m.role !== 'viewer')
          .map((m) => (
            <SelectItem key={m.user.id} value={m.user.id}>
              {m.user.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

/** Compact task card used by the board and lists. */
export function TaskCardBody({ task }: { task: TaskDto }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm leading-snug font-medium">{task.title}</p>
        {task.assignee ? <UserAvatar name={task.assignee.name} size="sm" /> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-mono">
          <IssueTypeIcon type={task.type} />
          {task.key}
        </span>
        <PriorityIndicator priority={task.priority} showLabel={false} />
        <PointsBadge points={task.storyPoints} />
        {task.dueDate ? (
          <span
            className={cn(
              'inline-flex items-center gap-1',
              task.overdue && 'font-medium text-destructive',
            )}
          >
            <CalendarClock className="size-3" />
            {formatDay(task.dueDate, 'd MMM')}
          </span>
        ) : null}
        {task.subtaskCount ? (
          <span className="inline-flex items-center gap-1">
            <CheckSquare className="size-3" />
            {task.subtasksDone}/{task.subtaskCount}
          </span>
        ) : null}
        {task.commentCount ? (
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="size-3" />
            {task.commentCount}
          </span>
        ) : null}
        {task.attachmentCount ? (
          <span className="inline-flex items-center gap-1">
            <Paperclip className="size-3" />
            {task.attachmentCount}
          </span>
        ) : null}
      </div>
      {task.tags.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.tags.slice(0, 3).map((t) => (
            <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}
