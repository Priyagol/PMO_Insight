import type {
  CreatedOutboundHookDto,
  HookDeliveryDto,
  OutboundHookDto,
  OutboundHookInput,
  WebLinkDto,
  WebLinkInput,
} from '@arihant/shared';
import { apiDelete, apiGet, apiPatch, apiPost } from './client';

export const fetchHooks = () => apiGet<OutboundHookDto[]>('/integrations/outgoing');
export const createHook = (input: OutboundHookInput) =>
  apiPost<CreatedOutboundHookDto>('/integrations/outgoing', input);
export const updateHook = (id: string, input: Partial<OutboundHookInput>) =>
  apiPatch<OutboundHookDto>(`/integrations/outgoing/${id}`, input);
export const deleteHook = (id: string) => apiDelete(`/integrations/outgoing/${id}`);
export const testHook = (id: string) =>
  apiPost<HookDeliveryDto>(`/integrations/outgoing/${id}/test`);
export const rotateHookSecret = (id: string) =>
  apiPost<{ secret: string }>(`/integrations/outgoing/${id}/rotate-secret`);
export const fetchDeliveries = (id: string) =>
  apiGet<HookDeliveryDto[]>(`/integrations/outgoing/${id}/deliveries`);

export const fetchWebLinks = (taskId: string) => apiGet<WebLinkDto[]>(`/tasks/${taskId}/web-links`);
export const addWebLink = (taskId: string, input: WebLinkInput) =>
  apiPost<WebLinkDto>(`/tasks/${taskId}/web-links`, input);
export const removeWebLink = (taskId: string, id: string) =>
  apiDelete(`/tasks/${taskId}/web-links/${id}`);
