import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  /** Pass `undefined` while loading; never pass placeholder numbers. */
  value: ReactNode | undefined;
  icon?: LucideIcon;
  hint?: ReactNode;
  isLoading?: boolean;
  className?: string;
}

export function StatCard({ label, value, icon: Icon, hint, isLoading, className }: StatCardProps) {
  return (
    <div className={cn('rounded-xl border bg-card p-4 shadow-xs', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon ? <Icon className="size-4 text-muted-foreground" aria-hidden /> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular">
        {isLoading || value === undefined ? <Skeleton className="h-7 w-16" /> : value}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
