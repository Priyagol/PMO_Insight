import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { WorklogQuery } from '@arihant/shared';
import { errorMessage } from '@/lib/errors';
import * as t from '@/services/api/tracking';

export const trackKeys = {
  all: ['tracking'] as const,
  worklogs: (q: object) => ['tracking', 'worklogs', q] as const,
  timer: ['tracking', 'timer'] as const,
  week: (weekStart: string, userId?: string) =>
    ['tracking', 'week', weekStart, userId ?? 'me'] as const,
  timesheets: (q: object) => ['tracking', 'timesheets', q] as const,
  journals: (q: object) => ['tracking', 'journals', q] as const,
  availability: (q: object) => ['tracking', 'availability', q] as const,
  workload: (dept?: string) => ['tracking', 'workload', dept ?? 'all'] as const,
  passport: (id: string) => ['tracking', 'passport', id] as const,
  assignment: ['assignment'] as const,
  config: ['assignment', 'config'] as const,
  plans: ['assignment', 'plans'] as const,
  plan: (id: string) => ['assignment', 'plan', id] as const,
  suggestions: (taskId: string) => ['assignment', 'suggestions', taskId] as const,
};

export const useWorklogs = (q: Partial<WorklogQuery>) =>
  useQuery({
    queryKey: trackKeys.worklogs(q),
    queryFn: () => t.fetchWorklogs(q),
    placeholderData: keepPreviousData,
  });
export const useTimer = () =>
  useQuery({ queryKey: trackKeys.timer, queryFn: t.fetchTimer, refetchInterval: 60_000 });
export const useTimesheetWeek = (weekStart: string, userId?: string) =>
  useQuery({
    queryKey: trackKeys.week(weekStart, userId),
    queryFn: () => t.fetchTimesheetWeek(weekStart, userId),
  });
export const useTimesheets = (
  q: { scope: 'mine' | 'approvals'; status?: string },
  enabled = true,
) => useQuery({ queryKey: trackKeys.timesheets(q), queryFn: () => t.fetchTimesheets(q), enabled });
export const useJournals = (q: { userId?: string; from?: string; to?: string; limit?: number }) =>
  useQuery({ queryKey: trackKeys.journals(q), queryFn: () => t.fetchJournals(q) });
export const useAvailability = (
  q: { scope: 'mine' | 'approvals' | 'team'; status?: string },
  enabled = true,
) =>
  useQuery({ queryKey: trackKeys.availability(q), queryFn: () => t.fetchAvailability(q), enabled });
export const useTeamWorkload = (departmentId?: string) =>
  useQuery({
    queryKey: trackKeys.workload(departmentId),
    queryFn: () => t.fetchTeamWorkload(departmentId),
  });
export const usePassport = (userId: string | null, enabled = true) =>
  useQuery({
    queryKey: trackKeys.passport(userId ?? ''),
    queryFn: () => t.fetchPassport(userId!),
    enabled: Boolean(userId) && enabled,
    retry: false,
  });
export const useAssignmentConfig = () =>
  useQuery({ queryKey: trackKeys.config, queryFn: t.fetchAssignmentConfig });
export const usePlans = () => useQuery({ queryKey: trackKeys.plans, queryFn: t.fetchPlans });
/** Polls while a plan is executing in the background worker. */
export const usePlan = (id: string | null) =>
  useQuery({
    queryKey: trackKeys.plan(id ?? ''),
    queryFn: () => t.fetchPlan(id!),
    enabled: Boolean(id),
    refetchInterval: (q) =>
      q.state.data && ['approved', 'executing'].includes(q.state.data.status) ? 1000 : false,
  });
export const useSuggestions = (taskId: string | null) =>
  useQuery({
    queryKey: trackKeys.suggestions(taskId ?? ''),
    queryFn: () => t.fetchSuggestions(taskId!),
    enabled: Boolean(taskId),
    retry: false,
  });

/**
 * Mutation helper: time and assignment changes affect tasks (actual hours, assignees),
 * so task and project caches are refreshed along with tracking data.
 */
export function useTrackMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { success?: string | ((r: TResult) => string | null) } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => fn(vars),
    onSuccess: async (result) => {
      await Promise.all(
        [trackKeys.all, trackKeys.assignment, ['tasks'], ['projects']].map((queryKey) =>
          qc.invalidateQueries({ queryKey }),
        ),
      );
      const message = typeof opts.success === 'function' ? opts.success(result) : opts.success;
      if (message) toast.success(message);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

/** Minutes → "3h 20m". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
