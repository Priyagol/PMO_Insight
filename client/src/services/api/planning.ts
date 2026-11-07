import type {
  CreateMilestoneInput,
  CreateTemplateInput,
  CustomFieldDef,
  MilestoneDto,
  ProjectCustomFieldsInput,
  ProjectDependenciesDto,
  ProjectDependenciesInput,
  SaveAsTemplateInput,
  TemplateDto,
  TemplateSummaryDto,
  UpdateMilestoneInput,
  UpdateTemplateInput,
} from '@arihant/shared';
import { api, apiDelete, apiGet, apiPatch, apiPost } from './client';

async function apiPut<T>(url: string, body: unknown): Promise<T> {
  const res = await api.put<{ data: T }>(url, body);
  return res.data.data;
}

export const fetchMilestones = (projectId: string) =>
  apiGet<MilestoneDto[]>(`/projects/${projectId}/milestones`);
export const createMilestone = (projectId: string, input: CreateMilestoneInput) =>
  apiPost<MilestoneDto>(`/projects/${projectId}/milestones`, input);
export const updateMilestone = (id: string, input: UpdateMilestoneInput) =>
  apiPatch<MilestoneDto>(`/milestones/${id}`, input);
export const deleteMilestone = (id: string) => apiDelete(`/milestones/${id}`);

export const fetchDependencies = (projectId: string) =>
  apiGet<ProjectDependenciesDto>(`/projects/${projectId}/dependencies`);
export const setDependencies = (projectId: string, input: ProjectDependenciesInput) =>
  apiPut<ProjectDependenciesDto>(`/projects/${projectId}/dependencies`, input);

export const setCustomFields = (projectId: string, input: ProjectCustomFieldsInput) =>
  apiPut<CustomFieldDef[]>(`/projects/${projectId}/custom-fields`, input);

export const fetchTemplates = (q?: string) =>
  apiGet<TemplateSummaryDto[]>('/project-templates', { params: q ? { q } : {} });
export const fetchTemplate = (id: string) => apiGet<TemplateDto>(`/project-templates/${id}`);
export const createTemplate = (input: CreateTemplateInput) =>
  apiPost<TemplateDto>('/project-templates', input);
export const updateTemplate = (id: string, input: UpdateTemplateInput) =>
  apiPatch<TemplateDto>(`/project-templates/${id}`, input);
export const deleteTemplate = (id: string) => apiDelete(`/project-templates/${id}`);
export const saveAsTemplate = (projectId: string, input: SaveAsTemplateInput) =>
  apiPost<TemplateDto>(`/projects/${projectId}/save-as-template`, input);
