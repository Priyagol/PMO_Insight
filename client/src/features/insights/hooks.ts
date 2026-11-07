import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AnalyticsQuery, RiskQuery } from '@arihant/shared';
import { errorMessage } from '@/lib/errors';
import * as api from '@/services/api/insights';

export const insightKeys = {
  all: ['insights'] as const,
  overview: (q: object) => ['insights', 'overview', q] as const,
  activity: ['insights', 'activity'] as const,
  health: (q: object) => ['insights', 'health', q] as const,
  project: (id: string) => ['insights', 'project', id] as const,
  hours: (q: object) => ['insights', 'hours', q] as const,
  snapshot: (q: object) => ['insights', 'snapshot', q] as const,
  risks: (q: object) => ['risks', 'list', q] as const,
  heatmap: (q: object) => ['risks', 'heatmap', q] as const,
};

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
] as const;

export function periodRange(days: string): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - (Number(days) - 1) * 86_400_000);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(from), to: iso(to) };
}
