import type {
  ApprovalDto,
  ApprovalQuery,
  ApprovalWorkflowDto,
  ApprovalWorkflowInput,
  CreateApprovalInput,
  CreateMeetingInput,
  MeetingDto,
  MeetingMinutesInput,
  MeetingQuery,
  NotificationDto,
  NotificationPrefs,
  NotificationQuery,
  UpdateMeetingInput,
} from '@arihant/shared';
import { api, apiDelete, apiGet, apiGetPage, apiPatch, apiPost } from './client';
import { toParams } from './work';

async function apiPut<T>(url: string, body: unknown): Promise<T> {
  const res = await api.put<{ data: T }>(url, body);
  return res.data.data;
}

/* Notifications */
export const fetchNotifications = (q: Partial<NotificationQuery>) =>
  apiGetPage<NotificationDto>('/notifications', { params: toParams(q) });
export const fetchUnreadCount = () => apiGet<{ unread: number }>('/notifications/unread-count');
export const markNotificationRead = (id: string) => apiPost<void>(`/notifications/${id}/read`);
export const markAllNotificationsRead = () =>
  apiPost<{ updated: number }>('/notifications/read-all');
export const fetchNotificationPrefs = () => apiGet<NotificationPrefs>('/notifications/preferences');
export const saveNotificationPrefs = (p: NotificationPrefs) =>
  apiPut<NotificationPrefs>('/notifications/preferences', p);

/* Approvals */
export const fetchApprovals = (q: Partial<ApprovalQuery>) =>
  apiGetPage<ApprovalDto>('/approvals', { params: toParams(q) });
export const fetchApproval = (id: string) => apiGet<ApprovalDto>(`/approvals/${id}`);
export const createApproval = (input: CreateApprovalInput) =>
  apiPost<ApprovalDto>('/approvals', input);
export const approveApproval = (id: string, comment?: string) =>
  apiPost<ApprovalDto>(`/approvals/${id}/approve`, { comment });
export const rejectApproval = (id: string, comment: string) =>
  apiPost<ApprovalDto>(`/approvals/${id}/reject`, { comment });
export const delegateApproval = (id: string, toUserId: string, comment?: string) =>
  apiPost<ApprovalDto>(`/approvals/${id}/delegate`, { toUserId, comment });
export const cancelApproval = (id: string) => apiPost<ApprovalDto>(`/approvals/${id}/cancel`);
export const fetchWorkflows = () => apiGet<ApprovalWorkflowDto[]>('/approvals/workflows');
export const saveWorkflow = (type: string, input: ApprovalWorkflowInput) =>
  apiPut<ApprovalWorkflowDto>(`/approvals/workflows/${type}`, input);

/* Meetings */
export const fetchMeetings = (q: Partial<MeetingQuery>) =>
  apiGetPage<MeetingDto>('/meetings', { params: toParams(q) });
export const fetchMeeting = (id: string) => apiGet<MeetingDto>(`/meetings/${id}`);
export const createMeeting = (input: CreateMeetingInput) => apiPost<MeetingDto>('/meetings', input);
export const updateMeeting = (id: string, input: UpdateMeetingInput) =>
  apiPatch<MeetingDto>(`/meetings/${id}`, input);
export const deleteMeeting = (id: string) => apiDelete(`/meetings/${id}`);
export const saveMinutes = (id: string, input: MeetingMinutesInput) =>
  apiPut<MeetingDto>(`/meetings/${id}/minutes`, input);
export const convertActionItem = (id: string, itemId: string) =>
  apiPost<MeetingDto>(`/meetings/${id}/action-items/${itemId}/convert`);
