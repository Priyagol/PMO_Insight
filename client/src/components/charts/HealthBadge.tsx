import { AlertOctagon, AlertTriangle, CheckCircle2, type LucideIcon } from 'lucide-react';
import type { HealthBand, RiskSeverity } from '@arihant/shared';
import { cn } from '@/lib/utils';

/** Status colours always come with an icon and a label, never colour alone. */
const BAND: Record<HealthBand, { label: string; icon: LucideIcon; color: string }> = {
  healthy: { label: 'Healthy', icon: CheckCircle2, color: 'var(--status-good)' },
  watch: { label: 'Watch', icon: AlertTriangle, color: 'var(--status-warning)' },
  at_risk: { label: 'At risk', icon: AlertOctagon, color: 'var(--status-critical)' },
};

export function HealthBadge({
  band,
  score,
  className,
}: {
  band: HealthBand;
  score?: number;
  className?: string;
}) {
  const b = BAND[band];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        className,
      )}
    >
      <b.icon className="size-3.5" style={{ color: b.color }} aria-hidden />
      {b.label}
      {score !== undefined ? <span className="text-muted-foreground tabular">{score}</span> : null}
    </span>
  );
}

const SEVERITY: Record<RiskSeverity, { label: string; color: string }> = {
  low: { label: 'Low', color: 'var(--status-good)' },
  medium: { label: 'Medium', color: 'var(--status-warning)' },
  high: { label: 'High', color: 'var(--status-serious)' },
  critical: { label: 'Critical', color: 'var(--status-critical)' },
};

export function SeverityBadge({ severity, score }: { severity: RiskSeverity; score?: number }) {
  const s = SEVERITY[severity];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
      {s.label}
      {score !== undefined ? (
        <span className="text-muted-foreground tabular">({score})</span>
      ) : null}
    </span>
  );
}

export const severityColor = (severity: RiskSeverity) => SEVERITY[severity].color;
