import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fiscalPeriodStart, type AnalyticsQuery, type RiskQuery } from '@arihant/shared';
import { errorMessage } from '@/lib/errors';
import * as api from '@/services/api/insights';

export const insightKeys = {
  all: ['insights'] as const,
  overview: (q: object) => ['insights', 'overview', q] as const,
  activity: ['insights', 'activity'] as const,
  health: (q: object) => ['insights', 'health', q] as const,
  project: (id: string) => ['insights', 'project', id] as const,
  hours: (q: object) => ['insights', 'hours', q] as const,
  timeline: (q: object) => ['insights', 'timeline', q] as const,
  delays: (id: string) => ['insights', 'delays', id] as const,
  snapshot: (q: object) => ['insights', 'snapshot', q] as const,
  summary: (kind: string, q: object) => ['insights', 'summary', kind, q] as const,
  risks: (q: object) => ['risks', 'list', q] as const,
  heatmap: (q: object) => ['risks', 'heatmap', q] as const,
};

type SummaryQuery = { from?: string; to?: string; departmentId?: string };
const summaryQuery = (q: Partial<AnalyticsQuery>): SummaryQuery => ({
  from: q.from,
  to: q.to,
  departmentId: q.departmentId,
});
export const useWorkSummary = (q: Partial<AnalyticsQuery>) =>
  useQuery({
    queryKey: insightKeys.summary('work', summaryQuery(q)),
    queryFn: () => api.fetchWorkSummary(summaryQuery(q)),
    placeholderData: keepPreviousData,
  });
export const useProjectStatus = (q: Partial<AnalyticsQuery>) =>
  useQuery({
    queryKey: insightKeys.summary('status', summaryQuery(q)),
    queryFn: () => api.fetchProjectStatus(summaryQuery(q)),
    placeholderData: keepPreviousData,
  });
export const useTrends = (departmentId?: string) =>
  useQuery({
    queryKey: insightKeys.summary('trends', { departmentId }),
    queryFn: () => api.fetchTrends({ departmentId }),
    placeholderData: keepPreviousData,
  });
export const useBottlenecks = (q: Partial<AnalyticsQuery>) =>
  useQuery({
    queryKey: insightKeys.summary('bottlenecks', summaryQuery(q)),
    queryFn: () => api.fetchBottlenecks(summaryQuery(q)),
    placeholderData: keepPreviousData,
  });
export const useOverview = (q: Partial<AnalyticsQuery>) =>
  useQuery({
    queryKey: insightKeys.overview(q),
    queryFn: () => api.fetchOverview(q),
    placeholderData: keepPreviousData,
  });
export const useDashboardActivity = () =>
  useQuery({ queryKey: insightKeys.activity, queryFn: api.fetchDashboardActivity });
export const useHealth = (q: Partial<AnalyticsQuery>) =>
  useQuery({
    queryKey: insightKeys.health(q),
    queryFn: () => api.fetchHealth(q),
    placeholderData: keepPreviousData,
  });
export const useProjectAnalytics = (id: string) =>
  useQuery({ queryKey: insightKeys.project(id), queryFn: () => api.fetchProjectAnalytics(id) });
export const useTimeline = (q: { departmentId?: string }) =>
  useQuery({
    queryKey: insightKeys.timeline(q),
    queryFn: () => api.fetchTimeline(q),
    placeholderData: keepPreviousData,
  });
export const useProjectDelays = (id: string) =>
  useQuery({ queryKey: insightKeys.delays(id), queryFn: () => api.fetchProjectDelays(id) });
export const useHours = (q: Partial<AnalyticsQuery> & { groupBy: string }) =>
  useQuery({
    queryKey: insightKeys.hours(q),
    queryFn: () => api.fetchHours(q),
    placeholderData: keepPreviousData,
  });
export const useSnapshot = (q: Partial<AnalyticsQuery>, enabled: boolean) =>
  useQuery({ queryKey: insightKeys.snapshot(q), queryFn: () => api.fetchSnapshot(q), enabled });
export const useRisks = (q: Partial<RiskQuery>) =>
  useQuery({
    queryKey: insightKeys.risks(q),
    queryFn: () => api.fetchRisks(q),
    placeholderData: keepPreviousData,
  });
export const useRiskHeatmap = (q: Partial<RiskQuery>) =>
  useQuery({ queryKey: insightKeys.heatmap(q), queryFn: () => api.fetchRiskHeatmap(q) });

export function useRiskMutation<TVars, TResult>(
  fn: (v: TVars) => Promise<TResult>,
  success?: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: TVars) => fn(v),
    onSuccess: async () => {
      await Promise.all(
        [['risks'], insightKeys.all, ['projects']].map((queryKey) =>
          qc.invalidateQueries({ queryKey }),
        ),
      );
      if (success) toast.success(success);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

/** Period presets used by every analytics filter row. */
export const PERIODS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
  { value: 'quarter', label: 'This quarter' },
  { value: 'last-quarter', label: 'Last quarter' },
  { value: 'year', label: 'This financial year' },
] as const;

/**
 * Date range for a preset. Quarters and years are financial (April to March, the organisation
 * default) and end today; "last-quarter" is the whole previous quarter.
 */
export function periodRange(period: string, now = new Date()): { from: string; to: string } {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = iso(now);
  if (period === 'quarter' || period === 'year')
    return { from: fiscalPeriodStart(today, period), to: today };
  if (period === 'last-quarter') {
    const start = fiscalPeriodStart(today, 'quarter');
    const [y, m, d] = start.split('-').map(Number) as [number, number, number];
    const lastDay = iso(new Date(y, m - 1, d - 1));
    return { from: fiscalPeriodStart(lastDay, 'quarter'), to: lastDay };
  }
  const from = new Date(now.getTime() - (Number(period) - 1) * 86_400_000);
  return { from: iso(from), to: today };
}
