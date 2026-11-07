import type {
  AiRiskScanOutput,
  AskResultDto,
  ProjectForecastDto,
  SimilarTaskDto,
  AiMinutesResult,
  AiProjectSummaryOutput,
  AiRequirementsOutput,
  AiResult,
  AiSettings,
  AiStatusDto,
  AiWorklogOutput,
  AutomationRuleDto,
  AutomationRunDto,
  AutomationRunQuery,
  AutomationTestResultDto,
  CreateAutomationInput,
  UpdateAutomationInput,
} from '@arihant/shared';
import { api, apiDelete, apiGet, apiGetPage, apiPatch, apiPost } from './client';
import { toParams } from './work';

/* Automations */
export const fetchAutomations = (projectId?: string) =>
  apiGet<AutomationRuleDto[]>('/automations', { params: projectId ? { projectId } : {} });
export const createAutomation = (input: CreateAutomationInput) =>
  apiPost<AutomationRuleDto>('/automations', input);
export const updateAutomation = (id: string, input: UpdateAutomationInput) =>
  apiPatch<AutomationRuleDto>(`/automations/${id}`, input);
export const deleteAutomation = (id: string) => apiDelete(`/automations/${id}`);
export const fetchAutomationRuns = (q: Partial<AutomationRunQuery>) =>
  apiGetPage<AutomationRunDto>('/automations/runs', { params: toParams(q) });
export const testAutomation = (id: string, taskId: string) =>
  apiPost<AutomationTestResultDto>(`/automations/${id}/test`, { taskId });

/* AI assistant */
export const fetchAiStatus = () => apiGet<AiStatusDto>('/ai/status');
export async function saveAiSettings(input: AiSettings): Promise<AiStatusDto> {
  const res = await api.put<{ data: AiStatusDto }>('/ai/settings', input);
  return res.data.data;
}
export const aiRequirementsToTasks = (projectId: string, text: string) =>
  apiPost<AiResult<AiRequirementsOutput>>('/ai/requirements-to-tasks', { projectId, text });
export const aiProjectSummary = (projectId: string) =>
  apiPost<AiResult<AiProjectSummaryOutput>>('/ai/project-summary', { projectId });
export const aiWorklogDraft = (date: string) =>
  apiPost<AiResult<AiWorklogOutput>>('/ai/worklog-draft', { date });
export const aiMinutesToActions = (meetingId: string, text: string) =>
  apiPost<AiMinutesResult>('/ai/minutes-to-actions', { meetingId, text });
export const aiExplainHealth = (projectId: string) =>
  apiPost<AiResult<{ explanation: string; actions: string[] }>>('/ai/explain-health', {
    projectId,
  });

/* Phase 7B */
export const askData = (question: string) => apiPost<AskResultDto>('/ai/ask', { question });
export const aiRiskScan = (projectId: string) =>
  apiPost<AiResult<AiRiskScanOutput>>('/ai/risk-scan', { projectId });
export const fetchForecasts = (q: { projectId?: string; departmentId?: string } = {}) =>
  apiGet<ProjectForecastDto[]>('/analytics/forecast', { params: toParams(q) });
export const fetchSimilarTasks = (projectId: string, title: string, excludeId?: string) =>
  apiGet<SimilarTaskDto[]>(`/projects/${projectId}/similar-tasks`, {
    params: { title, ...(excludeId ? { excludeId } : {}) },
  });
