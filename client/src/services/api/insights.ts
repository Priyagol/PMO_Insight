import type {
  ActivityDto,
  BottlenecksDto,
  DependencyMapDto,
  PerformanceTrendsDto,
  ProjectStatusDto,
  RoleDashboardDto,
  WorkSummaryDto,
  AnalyticsQuery,
  CreateRiskInput,
  HoursRowDto,
  ManagementSnapshotDto,
  OverviewDto,
  ProjectDelayDto,
  ProjectAnalyticsDto,
  ProjectHealthDto,
  RiskDto,
  RiskHeatmapDto,
  RiskQuery,
  TimelineProjectDto,
  UpdateRiskInput,
} from '@arihant/shared';
import { api, apiDelete, apiGet, apiGetPage, apiPatch, apiPost } from './client';
import { toParams } from './work';

type SummaryQuery = { from?: string; to?: string; departmentId?: string };
export const fetchWorkSummary = (q: SummaryQuery) =>
  apiGet<WorkSummaryDto>('/analytics/work-summary', { params: toParams(q) });
export const fetchProjectStatus = (q: SummaryQuery) =>
  apiGet<ProjectStatusDto>('/analytics/project-status', { params: toParams(q) });
export const fetchTrends = (q: { departmentId?: string }) =>
  apiGet<PerformanceTrendsDto>('/analytics/trends', { params: toParams(q) });
export const fetchBottlenecks = (q: SummaryQuery) =>
  apiGet<BottlenecksDto>('/analytics/bottlenecks', { params: toParams(q) });
export const fetchRoleDashboard = (q: { from?: string; to?: string }) =>
  apiGet<RoleDashboardDto>('/analytics/my-dashboard', { params: toParams(q) });
export const fetchDependencies = (q: { departmentId?: string; projectId?: string }) =>
  apiGet<DependencyMapDto>('/analytics/dependencies', { params: toParams(q) });
export const fetchOverview = (q: Partial<AnalyticsQuery>) =>
  apiGet<OverviewDto>('/analytics/overview', { params: toParams(q) });
export const fetchDashboardActivity = () => apiGet<ActivityDto[]>('/analytics/activity');
export const fetchHealth = (q: Partial<AnalyticsQuery>) =>
  apiGet<ProjectHealthDto[]>('/analytics/health', { params: toParams(q) });
export const fetchProjectAnalytics = (id: string) =>
  apiGet<ProjectAnalyticsDto>(`/analytics/projects/${id}`);
export const fetchTimeline = (q: { departmentId?: string } = {}) =>
  apiGet<TimelineProjectDto[]>('/analytics/timeline', { params: toParams(q) });
export const fetchProjectDelays = (id: string) =>
  apiGet<ProjectDelayDto>(`/analytics/projects/${id}/delays`);
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
