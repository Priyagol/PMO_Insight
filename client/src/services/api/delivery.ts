import type {
  ChangeRequestDto,
  ChangeRequestQuery,
  CreateChangeRequestInput,
  CreateDocumentInput,
  CreateFeedbackInput,
  CreateReleaseInput,
  CreateStakeholderInput,
  DeployInput,
  DocumentDto,
  DocumentQuery,
  Environment,
  FeedbackDto,
  FeedbackQuery,
  ReleaseDto,
  ReleaseQuery,
  StakeholderDto,
  StakeholderQuery,
  UpdateChangeRequestInput,
  UpdateDocumentInput,
  UpdateReleaseInput,
  UpdateStakeholderInput,
} from '@arihant/shared';
import { api, apiDelete, apiGet, apiGetPage, apiPatch, apiPost } from './client';
import { toParams } from './work';

/* Documents */
export const fetchDocuments = (q: Partial<DocumentQuery>) =>
  apiGetPage<DocumentDto>('/documents', { params: toParams(q) });
export const fetchDocument = (id: string) => apiGet<DocumentDto>(`/documents/${id}`);
export async function createDocument(meta: CreateDocumentInput, file: File): Promise<DocumentDto> {
  const form = new FormData();
  form.append('meta', JSON.stringify(meta));
  form.append('file', file);
  const res = await api.post<{ data: DocumentDto }>('/documents', form);
  return res.data.data;
}
export async function uploadDocumentVersion(
  id: string,
  file: File,
  note?: string,
): Promise<DocumentDto> {
  const form = new FormData();
  if (note) form.append('note', note);
  form.append('file', file);
  const res = await api.post<{ data: DocumentDto }>(`/documents/${id}/versions`, form);
  return res.data.data;
}
export const updateDocument = (id: string, input: UpdateDocumentInput) =>
  apiPatch<DocumentDto>(`/documents/${id}`, input);
export const deleteDocument = (id: string) => apiDelete(`/documents/${id}`);
export const publishDocument = (id: string) => apiPost<DocumentDto>(`/documents/${id}/publish`);
export const documentDownloadUrl = (id: string, version: number) =>
  apiGet<{ url: string; fileName: string }>(`/documents/${id}/versions/${version}/download`);

/* Releases */
export const fetchReleases = (q: Partial<ReleaseQuery>) =>
  apiGetPage<ReleaseDto>('/releases', { params: toParams(q) });
export const fetchRelease = (id: string) => apiGet<ReleaseDto>(`/releases/${id}`);
export const createRelease = (input: CreateReleaseInput) => apiPost<ReleaseDto>('/releases', input);
export const updateRelease = (id: string, input: UpdateReleaseInput) =>
  apiPatch<ReleaseDto>(`/releases/${id}`, input);
export const deployRelease = (id: string, input: DeployInput) =>
  apiPost<ReleaseDto>(`/releases/${id}/deploy`, input);
export const rollbackRelease = (id: string, environment: Environment, reason: string) =>
  apiPost<ReleaseDto>(`/releases/${id}/rollback`, { environment, reason });
export const requestGoLive = (id: string) => apiPost<ReleaseDto>(`/releases/${id}/request-go-live`);

/* Stakeholders */
export const fetchStakeholders = (q: Partial<StakeholderQuery>) =>
  apiGetPage<StakeholderDto>('/stakeholders', { params: toParams(q) });
export const createStakeholder = (input: CreateStakeholderInput) =>
  apiPost<StakeholderDto>('/stakeholders', input);
export const updateStakeholder = (id: string, input: UpdateStakeholderInput) =>
  apiPatch<StakeholderDto>(`/stakeholders/${id}`, input);
export const deleteStakeholder = (id: string) => apiDelete(`/stakeholders/${id}`);

/* Change requests */
export const fetchChangeRequests = (q: Partial<ChangeRequestQuery>) =>
  apiGetPage<ChangeRequestDto>('/change-requests', { params: toParams(q) });
export const fetchChangeRequest = (id: string) =>
  apiGet<ChangeRequestDto>(`/change-requests/${id}`);
export const createChangeRequest = (input: CreateChangeRequestInput) =>
  apiPost<ChangeRequestDto>('/change-requests', input);
export const updateChangeRequest = (id: string, input: UpdateChangeRequestInput) =>
  apiPatch<ChangeRequestDto>(`/change-requests/${id}`, input);
export const submitChangeRequest = (id: string) =>
  apiPost<ChangeRequestDto>(`/change-requests/${id}/submit`);
export const withdrawChangeRequest = (id: string) =>
  apiPost<ChangeRequestDto>(`/change-requests/${id}/withdraw`);
export const changeRequestTask = (id: string) =>
  apiPost<ChangeRequestDto>(`/change-requests/${id}/create-task`);
export const changeRequestImplemented = (id: string) =>
  apiPost<ChangeRequestDto>(`/change-requests/${id}/implemented`);

/* Feedback */
export const fetchFeedback = (q: Partial<FeedbackQuery>) =>
  apiGetPage<FeedbackDto>('/feedback', { params: toParams(q) });
export const recordFeedback = (input: CreateFeedbackInput) =>
  apiPost<FeedbackDto>('/feedback', input);
