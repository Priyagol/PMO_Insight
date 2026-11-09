import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AuditQuery, UserListQuery } from '@arihant/shared';
import { errorMessage } from '@/lib/errors';
import * as org from '@/services/api/org';
import { queryKeys } from '@/services/query-keys';

/* ---------- Queries ---------- */

export const useUsers = (query: Partial<UserListQuery>, enabled = true) =>
  useQuery({
    queryKey: queryKeys.users.list(query),
    queryFn: () => org.fetchUsers(query),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useUser = (id: string | null) =>
  useQuery({
    queryKey: queryKeys.users.detail(id ?? ''),
    queryFn: () => org.fetchUser(id!),
    enabled: Boolean(id),
  });

export const useSkills = (q: string) =>
  useQuery({ queryKey: queryKeys.skills(q), queryFn: () => org.fetchSkills(q), staleTime: 60_000 });

export const useDepartments = () =>
  useQuery({ queryKey: queryKeys.departments, queryFn: org.fetchDepartments, staleTime: 60_000 });

export const useArchivedDepartments = (enabled: boolean) =>
  useQuery({
    queryKey: [...queryKeys.departments, 'archived'],
    queryFn: org.fetchArchivedDepartments,
    enabled,
  });

export const useRoles = (enabled = true) =>
  useQuery({ queryKey: queryKeys.roles, queryFn: org.fetchRoles, staleTime: 60_000, enabled });

export const useAuditLogs = (query: Partial<AuditQuery>) =>
  useQuery({
    queryKey: queryKeys.audit.list(query),
    queryFn: () => org.fetchAuditLogs(query),
    placeholderData: keepPreviousData,
  });

export const useLoginHistory = (query: { page?: number; q?: string; success?: string }) =>
  useQuery({
    queryKey: queryKeys.audit.logins(query),
    queryFn: () => org.fetchLoginHistory(query),
    placeholderData: keepPreviousData,
  });

export const useSettings = () =>
  useQuery({ queryKey: queryKeys.settings, queryFn: org.fetchSettings });

/* ---------- Mutations ---------- */

/**
 * Wraps a mutation with a success toast, an error toast and invalidation of the
 * affected caches (users, departments, roles and audit all depend on each other).
 */
export function useOrgMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: {
    success?: string | ((r: TResult) => string);
    invalidate?: readonly (readonly unknown[])[];
  } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => {
      const keys = opts.invalidate ?? [queryKeys.users.all, queryKeys.departments, queryKeys.roles];
      await Promise.all(
        [...keys, queryKeys.audit.all].map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
      const message = typeof opts.success === 'function' ? opts.success(result) : opts.success;
      if (message) toast.success(message);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
