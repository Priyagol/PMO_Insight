import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  STATUS_LABELS,
  type BoardColumnDto,
  type ProjectListQuery,
  type TaskDto,
  type TaskListQuery,
  type UpdateTaskInput,
} from '@arihant/shared';
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

const isTask = (value: unknown): value is TaskDto =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as TaskDto).id === 'string' &&
  typeof (value as TaskDto).key === 'string' &&
  typeof (value as TaskDto).status === 'string' &&
  typeof (value as TaskDto).project === 'object';

type TaskPage = { items: TaskDto[]; meta: unknown };

/** Writes a task into its detail entry and every cached list and board that already shows it. */
export function putTaskInCaches(qc: QueryClient, task: TaskDto) {
  qc.setQueryData<TaskDto>(workKeys.task(task.id), task);
  qc.setQueriesData<TaskPage>({ queryKey: ['tasks', 'list'] }, (page) =>
    page?.items?.some((t) => t.id === task.id)
      ? { ...page, items: page.items.map((t) => (t.id === task.id ? task : t)) }
      : page,
  );
  qc.setQueriesData<BoardColumnDto[]>({ queryKey: ['tasks', 'board'] }, (columns) => {
    if (!Array.isArray(columns) || !columns.some((c) => c.tasks.some((t) => t.id === task.id)))
      return columns;
    return columns.map((c) => {
      const had = c.tasks.some((t) => t.id === task.id);
      if (c.status === task.status)
        return had
          ? { ...c, tasks: c.tasks.map((t) => (t.id === task.id ? task : t)) }
          : { ...c, total: c.total + 1, tasks: [task, ...c.tasks] };
      return had
        ? { ...c, total: Math.max(c.total - 1, 0), tasks: c.tasks.filter((t) => t.id !== task.id) }
        : c;
    });
  });
}

/** Simple fields that read the same in the update and the task, so the screen can show them before the save returns. */
const INSTANT_FIELDS = [
  'title',
  'description',
  'priority',
  'status',
  'startDate',
  'dueDate',
  'estimatedHours',
  'complexity',
  'tags',
  'type',
  'storyPoints',
  'components',
  'acceptanceCriteria',
  'remainingHours',
] as const;

/**
 * Task edits from the task panel: the change shows at once, is replaced by the saved task
 * when the server answers, and is undone if the save fails.
 */
export function useTaskUpdate(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTaskInput) => work.updateTask(taskId, input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: workKeys.task(taskId) });
      const before = qc.getQueryData<TaskDto>(workKeys.task(taskId));
      if (before) {
        const patch: Record<string, unknown> = {};
        for (const f of INSTANT_FIELDS)
          if (f in input) patch[f] = (input as Record<string, unknown>)[f] ?? undefined;
        if (input.status) patch.statusLabel = STATUS_LABELS[input.status];
        putTaskInCaches(qc, { ...before, ...patch } as TaskDto);
      }
      return { before };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.before) putTaskInCaches(qc, ctx.before);
      toast.error(errorMessage(err));
    },
    onSuccess: (task) => putTaskInCaches(qc, task),
    onSettled: () => {
      for (const queryKey of [workKeys.tasks, workKeys.projects, ['agile'], ['releases']])
        void qc.invalidateQueries({ queryKey });
    },
  });
}

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
    onSuccess: (result) => {
      // Show the saved task at once; the wider refresh then runs in the background.
      if (isTask(result)) putTaskInCaches(qc, result);
      const keys = opts.invalidate ?? [workKeys.tasks, workKeys.projects, ['agile'], ['releases']];
      void Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
      const message = typeof opts.success === 'function' ? opts.success(result) : opts.success;
      if (message) toast.success(message);
    },
    onError: (err) => {
      if (!opts.silentError) toast.error(errorMessage(err));
    },
  });
}
