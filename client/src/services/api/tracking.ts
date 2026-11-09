import type {
  AssignmentConfig,
  AssignmentPlanDto,
  AvailabilityDto,
  AvailabilityInput,
  CapacityPlanDto,
  CapacityPlanQuery,
  BatchPreviewInput,
  CreateWorklogInput,
  JournalDto,
  JournalInput,
  PageMeta,
  StartTimerInput,
  PerformancePeriod,
  SuggestionDto,
  TeamDto,
  TeamInput,
  TeamPerformanceDto,
  TimerDto,
  TimesheetDto,
  UpdateWorklogInput,
  WorklogDto,
  WorklogQuery,
  WorkloadRowDto,
  WorkPassportDto,
} from '@arihant/shared';
import { api, apiDelete, apiGet, apiGetPage, apiPatch, apiPost } from './client';
import { toParams } from './work';

/* ---------- Work logs & timer ---------- */

export async function fetchWorklogs(q: Partial<WorklogQuery>) {
  const res = await api.get<{ data: WorklogDto[]; meta: PageMeta & { totalMinutes: number } }>(
    '/worklogs',
    { params: toParams(q) },
  );
  return { items: res.data.data, meta: res.data.meta };
}
export const createWorklog = (input: CreateWorklogInput) => apiPost<WorklogDto>('/worklogs', input);
export const updateWorklog = (id: string, input: UpdateWorklogInput) =>
  apiPatch<WorklogDto>(`/worklogs/${id}`, input);
export const deleteWorklog = (id: string) => apiDelete(`/worklogs/${id}`);

export const fetchTimer = () => apiGet<TimerDto | null>('/timer');
export const startTimer = (input: StartTimerInput) => apiPost<TimerDto>('/timer/start', input);
export const pauseTimer = () => apiPost<TimerDto>('/timer/pause');
export const resumeTimer = () => apiPost<TimerDto>('/timer/resume');
export const stopTimer = (input: { description?: string; discard?: boolean }) =>
  apiPost<{ worklog: WorklogDto | null }>('/timer/stop', input);

/* ---------- Timesheets, journal, availability ---------- */

export const fetchTimesheetWeek = (weekStart: string, userId?: string) =>
  apiGet<TimesheetDto>('/timesheets/week', { params: toParams({ weekStart, userId }) });
export const fetchTimesheets = (q: {
  scope: 'mine' | 'approvals';
  status?: string;
  page?: number;
}) => apiGetPage<TimesheetDto>('/timesheets', { params: toParams(q) });
export const submitTimesheet = (weekStart: string) =>
  apiPost<TimesheetDto>('/timesheets/submit', { weekStart });
export const approveTimesheet = (id: string, comment?: string) =>
  apiPost<TimesheetDto>(`/timesheets/${id}/approve`, { comment });
export const rejectTimesheet = (id: string, comment: string) =>
  apiPost<TimesheetDto>(`/timesheets/${id}/reject`, { comment });

export const fetchJournals = (q: {
  userId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}) => apiGetPage<JournalDto>('/journals', { params: toParams(q) });
export async function saveJournal(input: JournalInput): Promise<JournalDto> {
  const res = await api.put<{ data: JournalDto }>('/journals', input);
  return res.data.data;
}

export const fetchAvailability = (q: {
  scope: 'mine' | 'approvals' | 'team';
  status?: string;
  page?: number;
}) => apiGetPage<AvailabilityDto>('/availability', { params: toParams(q) });
export const requestAvailability = (input: AvailabilityInput) =>
  apiPost<AvailabilityDto>('/availability', input);
export const decideAvailability = (id: string, decision: 'approve' | 'reject') =>
  apiPost<AvailabilityDto>(`/availability/${id}/${decision}`);
export const cancelAvailability = (id: string) =>
  apiPost<AvailabilityDto>(`/availability/${id}/cancel`);

/* ---------- Teams, passport ---------- */

export const fetchTeamWorkload = (departmentId?: string) =>
  apiGet<WorkloadRowDto[]>('/teams/workload', { params: toParams({ departmentId }) });
export const fetchTeamPerformance = (
  period: PerformancePeriod,
  filter: { departmentId?: string; teamId?: string } = {},
) => apiGet<TeamPerformanceDto>('/teams/performance', { params: toParams({ period, ...filter }) });
export const fetchCapacityPlan = (q: Partial<CapacityPlanQuery>) =>
  apiGet<CapacityPlanDto>('/teams/capacity', { params: toParams(q) });
export const fetchTeams = () => apiGet<TeamDto[]>('/teams');
export const createTeam = (input: TeamInput) => apiPost<TeamDto>('/teams', input);
export const updateTeam = (id: string, input: Partial<TeamInput>) =>
  apiPatch<TeamDto>(`/teams/${id}`, input);
export const archiveTeam = (id: string) => apiDelete(`/teams/${id}`);
export const fetchPassport = (userId: string) =>
  apiGet<WorkPassportDto>(`/users/${userId}/passport`);

/* ---------- Smart assignment ---------- */

export const fetchAssignmentConfig = () => apiGet<AssignmentConfig>('/assignment/config');
export async function saveAssignmentConfig(input: AssignmentConfig): Promise<AssignmentConfig> {
  const res = await api.put<{ data: AssignmentConfig }>('/assignment/config', input);
  return res.data.data;
}
export const fetchSuggestions = (taskId: string) =>
  apiGet<SuggestionDto>(`/assignment/tasks/${taskId}/suggestions`);
export const assignSuggested = (taskId: string, userId: string) =>
  apiPost<{ assigned: boolean; score: number }>(`/assignment/tasks/${taskId}/assign`, { userId });
export const previewBatch = (input: BatchPreviewInput) =>
  apiPost<AssignmentPlanDto>('/assignment/plans/batch', input);
export const previewRebalance = (input: { projectId: string; roleKeys?: string[] }) =>
  apiPost<AssignmentPlanDto>('/assignment/plans/rebalance', input);
export const previewReassign = (userId: string) =>
  apiPost<AssignmentPlanDto>('/assignment/plans/reassign', { userId });
export const fetchPlans = () => apiGet<AssignmentPlanDto[]>('/assignment/plans');
export const fetchPlan = (id: string) => apiGet<AssignmentPlanDto>(`/assignment/plans/${id}`);
export const modifyPlan = (id: string, proposals: { taskId: string; toUserId: string | null }[]) =>
  apiPatch<AssignmentPlanDto>(`/assignment/plans/${id}`, { proposals });
export const approvePlan = (id: string) =>
  apiPost<AssignmentPlanDto>(`/assignment/plans/${id}/approve`);
export const rejectPlan = (id: string) =>
  apiPost<AssignmentPlanDto>(`/assignment/plans/${id}/reject`);
