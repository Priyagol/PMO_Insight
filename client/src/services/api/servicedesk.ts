import type {
  QueueView,
  RequestCommentDto,
  RequestTypeDto,
  RequestTypeInput,
  ServiceDeskReportDto,
  ServiceDeskSettingsDto,
  ServiceDeskSettingsInput,
  ServiceRequestDto,
  SubmitRequestInput,
} from '@arihant/shared';
import { api, apiGet, apiPost } from './client';

const put = async <T>(url: string, body: unknown): Promise<T> =>
  (await api.put<{ data: T }>(url, body)).data.data;

export const fetchPortal = () => apiGet<RequestTypeDto[]>('/service-desk/portal');
export const submitRequest = (input: SubmitRequestInput) =>
  apiPost<ServiceRequestDto>('/service-desk/requests', input);
export const fetchMyRequests = () => apiGet<ServiceRequestDto[]>('/service-desk/requests/mine');
export const fetchRequest = (id: string) =>
  apiGet<ServiceRequestDto>(`/service-desk/requests/${id}`);
export const fetchRequestComments = (id: string) =>
  apiGet<RequestCommentDto[]>(`/service-desk/requests/${id}/comments`);
export const addRequestComment = (id: string, body: string) =>
  apiPost<RequestCommentDto[]>(`/service-desk/requests/${id}/comments`, { body });
export const rateRequest = (id: string, rating: number, comment?: string) =>
  apiPost<ServiceRequestDto>(`/service-desk/requests/${id}/feedback`, { rating, comment });

export const fetchDeskSettings = (projectId: string) =>
  apiGet<ServiceDeskSettingsDto>(`/service-desk/projects/${projectId}/settings`);
export const saveDeskSettings = (projectId: string, input: ServiceDeskSettingsInput) =>
  put<ServiceDeskSettingsDto>(`/service-desk/projects/${projectId}/settings`, input);
export const fetchRequestTypes = (projectId: string) =>
  apiGet<RequestTypeDto[]>(`/service-desk/projects/${projectId}/request-types`);
export const createRequestType = (projectId: string, input: RequestTypeInput) =>
  apiPost<RequestTypeDto>(`/service-desk/projects/${projectId}/request-types`, input);
export const updateRequestType = (id: string, input: RequestTypeInput) =>
  put<RequestTypeDto>(`/service-desk/request-types/${id}`, input);
export const fetchQueue = (projectId: string, view: QueueView) =>
  apiGet<ServiceRequestDto[]>(`/service-desk/projects/${projectId}/queue`, { params: { view } });
export const fetchDeskReport = (projectId: string) =>
  apiGet<ServiceDeskReportDto>(`/service-desk/projects/${projectId}/report`);
