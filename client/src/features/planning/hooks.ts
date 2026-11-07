import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/errors';
import * as api from '@/services/api/planning';

export const planningKeys = {
  milestones: (projectId: string) => ['projects', 'milestones', projectId] as const,
  dependencies: (projectId: string) => ['projects', 'dependencies', projectId] as const,
  templates: (q: string) => ['templates', 'list', q] as const,
  template: (id: string) => ['templates', 'detail', id] as const,
};

export const useMilestones = (projectId: string | undefined) =>
  useQuery({
    queryKey: planningKeys.milestones(projectId ?? ''),
    queryFn: () => api.fetchMilestones(projectId!),
    enabled: Boolean(projectId),
  });
export const useDependencies = (projectId: string) =>
  useQuery({
    queryKey: planningKeys.dependencies(projectId),
    queryFn: () => api.fetchDependencies(projectId),
  });
export const useTemplates = (q = '', enabled = true) =>
  useQuery({
    queryKey: planningKeys.templates(q),
    queryFn: () => api.fetchTemplates(q || undefined),
    enabled,
  });
export const useTemplate = (id: string | null) =>
  useQuery({
    queryKey: planningKeys.template(id ?? ''),
    queryFn: () => api.fetchTemplate(id!),
    enabled: Boolean(id),
  });

/** Mutations refresh projects, tasks (milestone names, custom values) and templates. */
export function usePlanningMutation<TVars, TResult>(
  fn: (v: TVars) => Promise<TResult>,
  opts: { success?: string | ((r: TResult) => string) } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      await Promise.all(
        [['projects'], ['tasks'], ['templates'], ['insights']].map((queryKey) =>
          qc.invalidateQueries({ queryKey }),
        ),
      );
      if (opts.success)
        toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
