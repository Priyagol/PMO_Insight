import type {
  AddLinkInput,
  CloneTaskInput,
  CompleteSprintInput,
  CreateSprintInput,
  CycleTimeDto,
  DefectReportDto,
  EpicSummaryDto,
  LinkType,
  ProjectAgileSettingsDto,
  ProjectAgileSettingsInput,
  SprintChartDto,
  SprintDto,
  StartSprintInput,
  TaskDto,
  UpdateSprintInput,
  VelocityDto,
} from '@arihant/shared';
import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import { api } from './client';

/* Sprints */
export const fetchSprints = (projectId: string) =>
  apiGet<SprintDto[]>('/sprints', { params: { projectId } });
export const createSprint = (input: CreateSprintInput) => apiPost<SprintDto>('/sprints', input);
export const updateSprint = (id: string, input: UpdateSprintInput) =>
  apiPatch<SprintDto>(`/sprints/${id}`, input);
export const deleteSprint = (id: string) => apiDelete(`/sprints/${id}`);
export const startSprint = (id: string, input: StartSprintInput) =>
  apiPost<SprintDto>(`/sprints/${id}/start`, input);
export const completeSprint = (id: string, input: CompleteSprintInput) =>
  apiPost<SprintDto & { carriedOver: number }>(`/sprints/${id}/complete`, input);
export const setSprintScope = (taskIds: string[], sprintId: string | null) =>
  apiPost<{ moved: number }>('/sprints/scope', { taskIds, sprintId });
export const fetchSprintChart = (id: string) => apiGet<SprintChartDto>(`/sprints/${id}/chart`);

/* Project planning */
export interface BacklogDto {
  sprints: (SprintDto & { tasks: TaskDto[] })[];
  backlog: TaskDto[];
  canPlan: boolean;
}
export const fetchBacklog = (projectId: string) =>
  apiGet<BacklogDto>(`/projects/${projectId}/backlog`);
export const fetchEpics = (projectId: string) =>
  apiGet<EpicSummaryDto[]>(`/projects/${projectId}/epics`);
export const fetchAgileSettings = (projectId: string) =>
  apiGet<ProjectAgileSettingsDto>(`/projects/${projectId}/agile-settings`);
export async function saveAgileSettings(projectId: string, input: ProjectAgileSettingsInput) {
  const res = await api.put<{ data: ProjectAgileSettingsDto }>(
    `/projects/${projectId}/agile-settings`,
    input,
  );
  return res.data.data;
}
export const fetchDeletedTasks = (projectId: string) =>
  apiGet<TaskDto[]>(`/projects/${projectId}/deleted-tasks`);

/* Task actions */
export const addLink = (taskId: string, input: AddLinkInput) =>
  apiPost<TaskDto>(`/tasks/${taskId}/links`, input);
export async function removeLink(taskId: string, type: LinkType, otherId: string) {
  const res = await api.delete<{ data: TaskDto }>(`/tasks/${taskId}/links/${type}/${otherId}`);
  return res.data.data;
}
export const cloneTask = (taskId: string, input: CloneTaskInput) =>
  apiPost<TaskDto>(`/tasks/${taskId}/clone`, input);
export const moveTaskToProject = (taskId: string, projectId: string) =>
  apiPost<TaskDto>(`/tasks/${taskId}/move-project`, { projectId });
export const restoreTask = (taskId: string) => apiPost<TaskDto>(`/tasks/${taskId}/restore`);
export const rankInBacklog = (taskId: string, beforeId: string | null, afterId: string | null) =>
  apiPost<TaskDto>(`/tasks/${taskId}/backlog-rank`, { beforeId, afterId });

/* Reports */
export const fetchVelocity = (projectId: string) =>
  apiGet<VelocityDto>('/agile/velocity', { params: { projectId } });
export const fetchCycleTime = (projectId: string, days: number) =>
  apiGet<CycleTimeDto>('/agile/cycle-time', { params: { projectId, days } });
export const fetchDefects = (projectId: string, days: number) =>
  apiGet<DefectReportDto>('/agile/defects', { params: { projectId, days } });
