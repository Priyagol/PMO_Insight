import { useQuery } from '@tanstack/react-query';
import {
  AlertOctagon,
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  CircleHelp,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import type {
  AiRiskScanOutput,
  AiResult,
  ForecastLabel,
  ProjectForecastDto,
} from '@arihant/shared';
import { Button } from '@/components/ui/button';
import { formatDay } from '@/features/work/format';
import {
  AiButton,
  AiResultDialog,
  useAiAvailable,
  useAiCall,
} from '@/features/intelligence/ai-kit';
import { useCan } from '@/hooks/use-permission';
import * as api from '@/services/api/intelligence';
import * as risksApi from '@/services/api/insights';
import { useRiskMutation } from './hooks';

export const useForecasts = (q: { projectId?: string; departmentId?: string }) =>
  useQuery({ queryKey: ['insights', 'forecast', q], queryFn: () => api.fetchForecasts(q) });

const LABEL: Record<ForecastLabel, { label: string; icon: LucideIcon; color: string }> = {
  on_track: { label: 'On track', icon: CheckCircle2, color: 'var(--status-good)' },
  at_risk: { label: 'Forecast at risk', icon: AlertTriangle, color: 'var(--status-warning)' },
  likely_late: { label: 'Likely late', icon: AlertOctagon, color: 'var(--status-critical)' },
  no_end_date: { label: 'No end date', icon: CalendarCheck, color: 'var(--muted-foreground)' },
  insufficient_data: {
    label: 'Not enough history',
    icon: CircleHelp,
    color: 'var(--muted-foreground)',
  },
  done: { label: 'No open work', icon: CheckCircle2, color: 'var(--muted-foreground)' },
};

export function ForecastBadge({ f }: { f: ProjectForecastDto }) {
  const l = LABEL[f.label];
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" title={f.explanation}>
      <l.icon className="size-3.5" style={{ color: l.color }} aria-hidden />
      {l.label}
      {f.forecastDate ? (
        <span className="font-normal text-muted-foreground">
          · {formatDay(f.forecastDate, 'd MMM')}
        </span>
      ) : null}
    </span>
  );
}

/** Explains the forecast, with the weekly history it is based on and tasks at risk. */
export function ForecastDetail({ f }: { f: ProjectForecastDto }) {
  return (
    <section className="space-y-2 text-sm" aria-label="Delivery forecast">
      <div className="flex items-center gap-2">
        <h4 className="font-semibold">Delivery forecast</h4>
        <ForecastBadge f={f} />
      </div>
      <p className="text-muted-foreground">{f.explanation}</p>
      {f.range.optimistic ? (
        <p className="text-xs text-muted-foreground">
          Range: {formatDay(f.range.optimistic)} (best recent week) to{' '}
          {f.range.pessimistic ? formatDay(f.range.pessimistic) : 'unknown'} (slowest recent week).
        </p>
      ) : null}
      <table className="text-xs">
        <caption className="sr-only">Completed effort per week</caption>
        <thead className="text-muted-foreground">
          <tr>
            <th className="pr-3 text-left font-medium">Week from</th>
            {f.weeklyHistory.map((w) => (
              <th key={w.week} className="px-2 text-right font-medium">
                {formatDay(w.week, 'd MMM')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="pr-3">Done (h)</td>
            {f.weeklyHistory.map((w) => (
              <td key={w.week} className="px-2 text-right tabular">
                {w.hours}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {f.tasksAtRisk.length ? (
        <div>
          <p className="text-xs font-medium">Due within a week and at risk</p>
          <ul className="text-xs">
            {f.tasksAtRisk.map((t) => (
              <li key={t.id}>
                <span className="font-mono">{t.key}</span> {t.title} · due{' '}
                {formatDay(t.dueDate, 'd MMM')} · {t.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** AI risk scan: proposals the user can raise one by one in the register. */
export function RiskScanButton({ projectId }: { projectId: string }) {
  const available = useAiAvailable();
  const canWrite = useCan('risk:write');
  const [result, setResult] = useState<AiResult<AiRiskScanOutput> | null>(null);
  const [raised, setRaised] = useState<Set<number>>(new Set());
  const call = useAiCall(() => api.aiRiskScan(projectId));
  const raise = useRiskMutation(
    (r: AiRiskScanOutput['risks'][number]) =>
      risksApi.createRisk({
        projectId,
        type: r.type,
        title: r.title.slice(0, 200),
        description: r.rationale,
        mitigation: r.mitigation,
        probability: r.probability,
        impact: r.impact,
      }),
    'Added to the risk register',
  );
  if (!available || !canWrite) return null;
  return (
    <>
      <AiButton
        size="sm"
        busy={call.isPending}
        onClick={() =>
          call.mutate(undefined, { onSuccess: (r) => (setRaised(new Set()), setResult(r)) })
        }
      >
        Scan for risks
      </AiButton>
      {result ? (
        <AiResultDialog
          title="Possible new risks"
          model={result.model}
          disclaimer={result.disclaimer}
          onClose={() => setResult(null)}
        >
          {result.proposal.risks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing new beyond the existing register.
            </p>
          ) : (
            <ul className="space-y-3">
              {result.proposal.risks.map((r, i) => (
                <li key={i} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{r.title}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={raised.has(i) || raise.isPending}
                      onClick={() =>
                        raise.mutate(r, { onSuccess: () => setRaised((s) => new Set(s).add(i)) })
                      }
                    >
                      <Plus /> {raised.has(i) ? 'Raised' : 'Raise'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {r.type} · probability {r.probability}/5 · impact {r.impact}/5
                  </p>
                  <p className="mt-1">{r.rationale}</p>
                  <p className="text-xs">
                    <span className="font-medium">Mitigation:</span> {r.mitigation}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </AiResultDialog>
      ) : null}
    </>
  );
}
