import { ArrowDown, ArrowUp, ChevronsUp, Minus, type LucideIcon } from 'lucide-react';
import { PRIORITY_LABELS, type Priority } from '@arihant/shared';
import { cn } from '@/lib/utils';

const CONFIG: Record<Priority, { icon: LucideIcon; tone: string }> = {
  critical: { icon: ChevronsUp, tone: 'text-destructive' },
  high: { icon: ArrowUp, tone: 'text-warning' },
  medium: { icon: Minus, tone: 'text-primary' },
  low: { icon: ArrowDown, tone: 'text-muted-foreground' },
};

interface PriorityIndicatorProps {
  priority: Priority;
  showLabel?: boolean;
  className?: string;
}

export function PriorityIndicator({
  priority,
  showLabel = true,
  className,
}: PriorityIndicatorProps) {
  const { icon: Icon, tone } = CONFIG[priority];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', className)}>
      <Icon className={cn('size-3.5', tone)} aria-hidden />
      {showLabel ? (
        PRIORITY_LABELS[priority]
      ) : (
        <span className="sr-only">{PRIORITY_LABELS[priority]}</span>
      )}
    </span>
  );
}
