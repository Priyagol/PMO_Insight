import type {
  ActivityDto,
  AttachmentDto,
  BoardColumnDto,
  BulkTaskInput,
  CommentDto,
  CreateProjectInput,
  CreateTaskInput,
  DuplicateProjectInput,
  MoveTaskInput,
  ProjectDto,
  ProjectListQuery,
  ProjectMemberRole,
  ProjectVersionDto,
  SavedViewDto,
  SavedViewInput,
  TaskDto,
  TaskListQuery,
  UpdateProjectInput,
  UpdateTaskInput,
  UserRef,
  Priority,
  TaskStatus,
} from '@arihant/shared';
import { api, apiDelete, apiGet, apiGetPage, apiPatch, apiPost } from './client';

/** Arrays become comma-separated values; empty values are dropped. */
export function toParams(query: object): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) out[k] = v.join(',');
    } else out[k] = v as string | number;
  }
  return out;
}

/* ---------- Projects ---------- */

export interface ProjectOverview {
  project: ProjectDto;
  upcoming: {
    id: string;
    key: string;
    title: string;
    status: TaskStatus;
    priority: Priority;
    dueDate: string;
    overdue: boolean;
    assignee: UserRef | null;
  }[];
  workload: { user: UserRef | null; openTasks: number; estimatedHours: number }[];
}

export const fetchProjects = (q: Partial<ProjectListQuery>) =>
  apiGetPage<ProjectDto>('/projects', { params: toParams(q) });
export const fetchProject = (id: string) => apiGet<ProjectDto>(`/projects/${id}`);
export const fetchProjectOverview = (id: string) =>
  apiGet<ProjectOverview>(`/projects/${id}/overview`);
export const createProject = (input: CreateProjectInput) => apiPost<ProjectDto>('/projects', input);
export const updateProject = (id: string, input: UpdateProjectInput) =>
  apiPatch<ProjectDto>(`/projects/${id}`, input);
export async function setProjectMembers(
  id: string,
  members: { userId: string; role: ProjectMemberRole }[],
) {
  const res = await api.put<{ data: ProjectDto }>(`/projects/${id}/members`, { members });
  return res.data.data;
}
export const archiveProject = (id: string) => apiPost<ProjectDto>(`/projects/${id}/archive`);
export const restoreProject = (id: string) => apiPost<ProjectDto>(`/projects/${id}/restore`);
export const duplicateProject = (id: string, input: DuplicateProjectInput) =>
  apiPost<ProjectDto>(`/projects/${id}/duplicate`, input);
export const fetchProjectVersions = (id: string) =>
  apiGet<ProjectVersionDto[]>(`/projects/${id}/versions`);
export const fetchProjectActivity = (id: string, page = 1) =>
  apiGetPage<ActivityDto>(`/projects/${id}/activity`, { params: { page, limit: 30 } });

/* ---------- Tasks ---------- */

export const fetchTasks = (q: Partial<TaskListQuery>) =>
  apiGetPage<TaskDto>('/tasks', { params: toParams(q) });
export const fetchBoard = (q: Partial<TaskListQuery>) =>
  apiGet<BoardColumnDto[]>('/tasks/board', { params: toParams(q) });
export const fetchTask = (id: string) => apiGet<TaskDto>(`/tasks/${id}`);
export const createTask = (input: CreateTaskInput) => apiPost<TaskDto>('/tasks', input);
export const updateTask = (id: string, input: UpdateTaskInput) =>
  apiPatch<TaskDto>(`/tasks/${id}`, input);
export const moveTask = (id: string, input: MoveTaskInput) =>
  apiPost<TaskDto>(`/tasks/${id}/move`, input);
export const deleteTask = (id: string) => apiDelete(`/tasks/${id}`);
export const bulkUpdateTasks = (input: BulkTaskInput) =>
  apiPatch<{ updated: number; failed: { id: string; key?: string; reason: string }[] }>(
    '/tasks/bulk',
    input,
  );
export const bulkDeleteTasks = (ids: string[]) =>
  apiPost<{ deleted: number; failed: { id: string; reason: string }[] }>('/tasks/bulk-delete', {
    ids,
  });
export const watchTask = (id: string, watching: boolean) =>
  watching
    ? apiPost<TaskDto>(`/tasks/${id}/watch`)
    : api.delete<{ data: TaskDto }>(`/tasks/${id}/watch`).then((r) => r.data.data);
export const fetchTaskActivity = (id: string) =>
  apiGetPage<ActivityDto>(`/tasks/${id}/activity`, { params: { page: 1, limit: 50 } });

/* ---------- Comments ---------- */

export const fetchComments = (taskId: string) => apiGet<CommentDto[]>(`/tasks/${taskId}/comments`);
export const addComment = (taskId: string, body: string, parentId?: string | null) =>
  apiPost<CommentDto>(`/tasks/${taskId}/comments`, { body, parentId: parentId ?? null });
export const editComment = (id: string, body: string) =>
  apiPatch<CommentDto>(`/comments/${id}`, { body });
export const deleteComment = (id: string) => apiDelete(`/comments/${id}`);

/* ---------- Attachments ---------- */

export type AttachmentOwner = { type: 'task' | 'project'; id: string };
const ownerPath = (o: AttachmentOwner) =>
  `/${o.type === 'task' ? 'tasks' : 'projects'}/${o.id}/attachments`;

export const fetchAttachments = (owner: AttachmentOwner) =>
  apiGet<AttachmentDto[]>(ownerPath(owner));
export async function uploadAttachment(
  owner: AttachmentOwner,
  file: File,
  onProgress?: (pct: number) => void,
) {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post<{ data: AttachmentDto }>(ownerPath(owner), form, {
    onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
  });
  return res.data.data;
}
export const attachmentDownloadUrl = (id: string) =>
  apiGet<{ url: string; fileName: string }>(`/attachments/${id}/download`);
export const deleteAttachment = (id: string) => apiDelete(`/attachments/${id}`);

/* ---------- Saved views ---------- */

export const fetchSavedViews = () =>
  apiGet<SavedViewDto[]>('/saved-views', { params: { module: 'tasks' } });
export const createSavedView = (input: SavedViewInput) =>
  apiPost<SavedViewDto>('/saved-views', input);
export const deleteSavedView = (id: string) => apiDelete(`/saved-views/${id}`);
