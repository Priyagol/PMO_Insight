import type {
  ActivityDto,
  AnalyticsQuery,
  CreateRiskInput,
  HoursRowDto,
  ManagementSnapshotDto,
  OverviewDto,
  ProjectAnalyticsDto,
  ProjectHealthDto,
  RiskDto,
  RiskHeatmapDto,
  RiskQuery,
  UpdateRiskInput,
} from '@arihant/shared';
import { api, apiDelete, apiGet, apiGetPage, apiPatch, apiPost } from './client';
import { toParams } from './work';

export const fetchOverview = (q: Partial<AnalyticsQuery>) =>
  apiGet<OverviewDto>('/analytics/overview', { params: toParams(q) });
export const fetchDashboardActivity = () => apiGet<ActivityDto[]>('/analytics/activity');
export const fetchHealth = (q: Partial<AnalyticsQuery>) =>
  apiGet<ProjectHealthDto[]>('/analytics/health', { params: toParams(q) });
export const fetchProjectAnalytics = (id: string) =>
  apiGet<ProjectAnalyticsDto>(`/analytics/projects/${id}`);
export const fetchHours = (q: Partial<AnalyticsQuery> & { groupBy: string }) =>
  apiGet<HoursRowDto[]>('/analytics/hours', { params: toParams(q) });
export const fetchSnapshot = (q: Partial<AnalyticsQuery>) =>
  apiGet<ManagementSnapshotDto>('/reports/snapshot', { params: toParams(q) });

/** Downloads a file produced by the API (keeps the auth header; no token in URLs). */
export async function downloadFile(
  path: string,
  params: Record<string, string | number>,
  fallbackName: string,
): Promise<void> {
  const res = await api.get<Blob>(path, { params, responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fetchRisks = (q: Partial<RiskQuery>) =>
  apiGetPage<RiskDto>('/risks', { params: toParams(q) });
export const fetchRiskHeatmap = (q: Partial<RiskQuery>) =>
  apiGet<RiskHeatmapDto>('/risks/heatmap', { params: toParams(q) });
export const createRisk = (input: CreateRiskInput) => apiPost<RiskDto>('/risks', input);
export const updateRisk = (id: string, input: UpdateRiskInput) =>
  apiPatch<RiskDto>(`/risks/${id}`, input);
export const escalateRisk = (id: string, note: string) =>
  apiPost<RiskDto>(`/risks/${id}/escalate`, { note });
export const deleteRisk = (id: string) => apiDelete(`/risks/${id}`);
