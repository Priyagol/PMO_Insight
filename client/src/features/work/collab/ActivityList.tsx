import { formatDistanceToNow } from 'date-fns';
import { History } from 'lucide-react';
import { STATUS_LABELS, type ActivityDto } from '@arihant/shared';
import { EmptyState } from '@/components/common/EmptyState';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Skeleton } from '@/components/ui/skeleton';

const pretty = (field: string, v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'status' && typeof v === 'string')
    return STATUS_LABELS[v as keyof typeof STATUS_LABELS] ?? v;
  if (Array.isArray(v)) return v.length ? `${v.length} item(s)` : '—';
  if (typeof v === 'object') return '…';
  return String(v);
};

/** Chronological feed of who changed what. */
export function ActivityList({
  items,
  isLoading,
  showEntity,
}: {
  items?: ActivityDto[];
  isLoading?: boolean;
  showEntity?: boolean;
}) {
  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (!items?.length) return <EmptyState compact icon={History} title="No activity yet" />;
  return (
    <ol className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="flex gap-3 text-sm">
          <UserAvatar name={a.actor?.name ?? 'System'} size="sm" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <p>
              <span className="font-medium">{a.actor?.name ?? 'System'}</span> {a.summary}
              {showEntity && a.entityType === 'task' ? (
                <span className="text-muted-foreground"> · {a.entity.label}</span>
              ) : null}
            </p>
            {a.changes.length && a.verb !== 'status_changed' ? (
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {a.changes.slice(0, 4).map((c) => (
                  <li key={c.field}>
                    <span className="font-medium">{c.field}</span>: {pretty(c.field, c.from)} →{' '}
                    {pretty(c.field, c.to)}
                  </li>
                ))}
              </ul>
            ) : null}
            <p
              className="mt-0.5 text-xs text-muted-foreground"
              title={new Date(a.createdAt).toLocaleString()}
            >
              {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
