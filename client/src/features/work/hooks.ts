import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProjectListQuery, TaskListQuery } from '@arihant/shared';
import { errorMessage } from '@/lib/errors';
import * as work from '@/services/api/work';

/** Query keys. Everything task-shaped lives under ['tasks'] so one invalidation refreshes every view. */
export const workKeys = {
  projects: ['projects'] as const,
  projectList: (q: object) => ['projects', 'list', q] as const,
  project: (id: string) => ['projects', 'detail', id] as const,
  overview: (id: string) => ['projects', 'overview', id] as const,
  versions: (id: string) => ['projects', 'versions', id] as const,
  projectActivity: (id: string) => ['projects', 'activity', id] as const,
  tasks: ['tasks'] as const,
  taskList: (q: object) => ['tasks', 'list', q] as const,
  board: (q: object) => ['tasks', 'board', q] as const,
  task: (id: string) => ['tasks', 'detail', id] as const,
  taskActivity: (id: string) => ['tasks', 'activity', id] as const,
  comments: (taskId: string) => ['tasks', 'comments', taskId] as const,
  attachments: (o: work.AttachmentOwner) => ['attachments', o.type, o.id] as const,
  savedViews: ['saved-views'] as const,
};

export const useProjects = (q: Partial<ProjectListQuery>, enabled = true) =>
  useQuery({
    queryKey: workKeys.projectList(q),
    queryFn: () => work.fetchProjects(q),
    placeholderData: keepPreviousData,
    enabled,
  });
export const useProject = (id: string | undefined) =>
  useQuery({
    queryKey: workKeys.project(id ?? ''),
    queryFn: () => work.fetchProject(id!),
    enabled: Boolean(id),
  });
export const useProjectOverview = (id: string) =>
  useQuery({ queryKey: workKeys.overview(id), queryFn: () => work.fetchProjectOverview(id) });
export const useProjectVersions = (id: string) =>
  useQuery({ queryKey: workKeys.versions(id), queryFn: () => work.fetchProjectVersions(id) });
export const useProjectActivity = (id: string) =>
  useQuery({
    queryKey: workKeys.projectActivity(id),
    queryFn: () => work.fetchProjectActivity(id),
  });

export const useTasks = (q: Partial<TaskListQuery>, enabled = true) =>
  useQuery({
    queryKey: workKeys.taskList(q),
    queryFn: () => work.fetchTasks(q),
    placeholderData: keepPreviousData,
    enabled,
  });
export const useBoard = (q: Partial<TaskListQuery>) =>
  useQuery({
    queryKey: workKeys.board(q),
    queryFn: () => work.fetchBoard(q),
    placeholderData: keepPreviousData,
  });
export const useTask = (id: string | null) =>
  useQuery({
    queryKey: workKeys.task(id ?? ''),
    queryFn: () => work.fetchTask(id!),
    enabled: Boolean(id),
  });
export const useTaskActivity = (id: string) =>
  useQuery({ queryKey: workKeys.taskActivity(id), queryFn: () => work.fetchTaskActivity(id) });
export const useComments = (taskId: string) =>
  useQuery({ queryKey: workKeys.comments(taskId), queryFn: () => work.fetchComments(taskId) });
export const useAttachments = (owner: work.AttachmentOwner) =>
  useQuery({ queryKey: workKeys.attachments(owner), queryFn: () => work.fetchAttachments(owner) });
export const useSavedViews = () =>
  useQuery({ queryKey: workKeys.savedViews, queryFn: work.fetchSavedViews });

/**
 * Mutation with toasts and broad invalidation: a task change can affect boards, lists,
 * calendars, project progress and activity, so all task and project queries are refreshed.
 */
export function useWorkMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: {
    success?: string | ((r: TResult) => string | null);
    invalidate?: readonly (readonly unknown[])[];
    silentError?: boolean;
  } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => {
      const keys = opts.invalidate ?? [workKeys.tasks, workKeys.projects, ['agile'], ['releases']];
      await Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
      const message = typeof opts.success === 'function' ? opts.success(result) : opts.success;
      if (message) toast.success(message);
    },
    onError: (err) => {
      if (!opts.silentError) toast.error(errorMessage(err));
    },
  });
}
