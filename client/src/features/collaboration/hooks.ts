import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ApprovalQuery, MeetingQuery } from '@arihant/shared';
import { errorMessage } from '@/lib/errors';
import * as api from '@/services/api/collaboration';

export const collabKeys = {
  notifications: ['notifications'] as const,
  unread: ['notifications', 'unread'] as const,
  prefs: ['notifications', 'prefs'] as const,
  approvals: (q: object) => ['approvals', 'list', q] as const,
  approval: (id: string) => ['approvals', 'detail', id] as const,
  workflows: ['approvals', 'workflows'] as const,
  meetings: (q: object) => ['meetings', 'list', q] as const,
  meeting: (id: string) => ['meetings', 'detail', id] as const,
};

/** Polls as a fallback; the socket pushes new notifications immediately when connected. */
export const useUnreadCount = () =>
  useQuery({ queryKey: collabKeys.unread, queryFn: api.fetchUnreadCount, refetchInterval: 60_000 });
export const useNotifications = (enabled: boolean) =>
  useQuery({
    queryKey: [...collabKeys.notifications, 'list'],
    queryFn: () => api.fetchNotifications({ limit: 20 }),
    enabled,
  });
export const useNotificationPrefs = (enabled: boolean) =>
  useQuery({ queryKey: collabKeys.prefs, queryFn: api.fetchNotificationPrefs, enabled });

export const useApprovals = (q: Partial<ApprovalQuery>) =>
  useQuery({
    queryKey: collabKeys.approvals(q),
    queryFn: () => api.fetchApprovals(q),
    placeholderData: keepPreviousData,
  });
export const useApproval = (id: string | null) =>
  useQuery({
    queryKey: collabKeys.approval(id ?? ''),
    queryFn: () => api.fetchApproval(id!),
    enabled: Boolean(id),
  });
export const useWorkflows = (enabled = true) =>
  useQuery({ queryKey: collabKeys.workflows, queryFn: api.fetchWorkflows, enabled });

export const useMeetings = (q: Partial<MeetingQuery>) =>
  useQuery({
    queryKey: collabKeys.meetings(q),
    queryFn: () => api.fetchMeetings(q),
    placeholderData: keepPreviousData,
  });
export const useMeeting = (id: string | null) =>
  useQuery({
    queryKey: collabKeys.meeting(id ?? ''),
    queryFn: () => api.fetchMeeting(id!),
    enabled: Boolean(id),
  });

export function useCollabMutation<TVars, TResult>(
  fn: (v: TVars) => Promise<TResult>,
  opts: { success?: string | ((r: TResult) => string) } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      await Promise.all(
        [['approvals'], ['meetings'], ['notifications'], ['projects'], ['tasks']].map((queryKey) =>
          qc.invalidateQueries({ queryKey }),
        ),
      );
      if (opts.success)
        toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
