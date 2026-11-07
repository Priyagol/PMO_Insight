import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Bug, CheckSquare, Zap, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  BUG_SEVERITY_LABELS,
  ISSUE_TYPES,
  ISSUE_TYPE_LABELS,
  type BugSeverity,
  type IssueType,
} from '@arihant/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import * as agileApi from '@/services/api/agile';
import * as delivery from '@/services/api/delivery';
import * as work from '@/services/api/work';

export const NONE = '__none__';

export const agileKeys = {
  all: ['agile'] as const,
  backlog: (projectId: string) => ['agile', 'backlog', projectId] as const,
  sprints: (projectId: string) => ['agile', 'sprints', projectId] as const,
  epics: (projectId: string) => ['agile', 'epics', projectId] as const,
  settings: (projectId: string) => ['agile', 'settings', projectId] as const,
  deleted: (projectId: string) => ['agile', 'deleted', projectId] as const,
  report: (kind: string, ...args: unknown[]) => ['agile', 'report', kind, ...args] as const,
};

/** Mutations here touch tasks, projects, sprints and releases: refresh all of them. */
export function useAgileMutation<TVars, TResult>(
  fn: (v: TVars) => Promise<TResult>,
  opts: { success?: string | ((r: TResult) => string) } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      await Promise.all(
        [['agile'], ['tasks'], ['projects'], ['releases']].map((queryKey) =>
          qc.invalidateQueries({ queryKey }),
        ),
      );
      if (opts.success)
        toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

const TYPE_STYLE: Record<IssueType, { icon: LucideIcon; color: string }> = {
  task: { icon: CheckSquare, color: 'var(--chart-1)' },
  story: { icon: BookOpen, color: 'var(--status-good)' },
  bug: { icon: Bug, color: 'var(--status-critical)' },
  epic: { icon: Zap, color: 'var(--violet)' },
};

export function IssueTypeIcon({ type, className }: { type: IssueType; className?: string }) {
  const s = TYPE_STYLE[type];
  return (
    <s.icon
      className={cn('size-3.5 shrink-0', className)}
      style={{ color: s.color }}
      aria-label={ISSUE_TYPE_LABELS[type]}
      role="img"
    />
  );
}

export function IssueTypeSelect({
  value,
  onChange,
  disabled,
  allowEpic = true,
  className,
}: {
  value: IssueType;
  onChange: (t: IssueType) => void;
  disabled?: boolean;
  allowEpic?: boolean;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as IssueType)} disabled={disabled}>
      <SelectTrigger size="sm" className={cn('w-36', className)} aria-label="Type">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ISSUE_TYPES.filter((t) => allowEpic || t !== 'epic' || t === value).map((t) => (
          <SelectItem key={t} value={t}>
            <span className="inline-flex items-center gap-1.5">
              <IssueTypeIcon type={t} /> {ISSUE_TYPE_LABELS[t]}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const SEVERITY_COLOR: Record<BugSeverity, string> = {
  blocker: 'var(--status-critical)',
  critical: 'var(--status-critical)',
  major: 'var(--status-serious)',
  minor: 'var(--status-warning)',
  trivial: 'var(--muted-foreground)',
};
export function SeverityBadge({ severity }: { severity: BugSeverity }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium">
      <span
        className="size-2 rounded-full"
        style={{ background: SEVERITY_COLOR[severity] }}
        aria-hidden
      />
      {BUG_SEVERITY_LABELS[severity]}
    </span>
  );
}

export function PointsBadge({ points }: { points?: number }) {
  if (points == null) return null;
  return (
    <span
      className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular"
      title="Story points"
    >
      {points}
    </span>
  );
}

/** Generic "pick one or none" select fed by a query. */
function RefSelect({
  value,
  onChange,
  options,
  label,
  noneLabel,
  disabled,
  className,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  options: { id: string; label: string }[];
  label: string;
  noneLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={value ?? NONE}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className={cn('w-56', className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type SelectProps = {
  projectId?: string;
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  className?: string;
};

export function EpicSelect({ projectId, ...rest }: SelectProps & { excludeId?: string }) {
  const epics = useQuery({
    queryKey: agileKeys.epics(projectId ?? ''),
    queryFn: () => agileApi.fetchEpics(projectId!),
    enabled: Boolean(projectId),
  });
  return (
    <RefSelect
      {...rest}
      label="Epic"
      noneLabel="No epic"
      disabled={rest.disabled || !projectId}
      options={(epics.data ?? [])
        .filter((e) => e.id !== rest.excludeId)
        .map((e) => ({ id: e.id, label: `${e.key} · ${e.title}` }))}
    />
  );
}

export function SprintSelect(props: SelectProps) {
  const sprints = useQuery({
    queryKey: agileKeys.sprints(props.projectId ?? ''),
    queryFn: () => agileApi.fetchSprints(props.projectId!),
    enabled: Boolean(props.projectId),
  });
  const options = (sprints.data ?? [])
    .filter((s) => s.status !== 'completed' || s.id === props.value)
    .map((s) => ({
      id: s.id,
      label: `${s.name}${s.status === 'active' ? ' (running)' : s.status === 'completed' ? ' (completed)' : ''}`,
    }));
  return (
    <RefSelect
      {...props}
      label="Sprint"
      noneLabel="Backlog"
      disabled={props.disabled || !props.projectId}
      options={options}
    />
  );
}

export function ReleaseSelect({
  label = 'Fix version',
  ...props
}: SelectProps & { label?: string }) {
  const releases = useQuery({
    queryKey: ['releases', 'for', props.projectId],
    queryFn: () => delivery.fetchReleases({ projectId: props.projectId, limit: 50 }),
    enabled: Boolean(props.projectId),
  });
  return (
    <RefSelect
      {...props}
      label={label}
      noneLabel="None"
      disabled={props.disabled || !props.projectId}
      options={(releases.data?.items ?? []).map((r) => ({
        id: r.id,
        label: `${r.version}${r.name ? ` · ${r.name}` : ''}`,
      }))}
    />
  );
}

/** Toggle chips for the project's components. */
export function ComponentsPicker({
  available,
  value,
  onChange,
  disabled,
}: {
  available: string[];
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  if (!available.length)
    return <span className="text-xs text-muted-foreground">No components defined</span>;
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Components">
      {available.map((c) => {
        const on = value.includes(c);
        return (
          <button
            key={c}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])}
            className={cn(
              'rounded-full border px-2 py-0.5 text-xs',
              on
                ? 'border-primary bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}

/** Tasks of a project for pickers (links). */
export const searchTasks = (projectIds: string[] | undefined, q: string) =>
  work.fetchTasks({ projectId: projectIds, q, limit: 8 });
