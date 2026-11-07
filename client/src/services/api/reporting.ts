import type {
  CreatedResolvedDto,
  ReportSubscriptionDto,
  ReportSubscriptionInput,
} from '@arihant/shared';
import { api, apiDelete, apiGet, apiPost } from './client';

export const fetchCreatedResolved = (q: {
  aql?: string;
  interval?: 'day' | 'week';
  days?: number;
}) => apiGet<CreatedResolvedDto>('/reporting/created-vs-resolved', { params: q });

export const fetchSubscriptions = () => apiGet<ReportSubscriptionDto[]>('/reporting/subscriptions');
export const createSubscription = (input: ReportSubscriptionInput) =>
  apiPost<ReportSubscriptionDto>('/reporting/subscriptions', input);
export async function updateSubscription(
  id: string,
  input: ReportSubscriptionInput,
): Promise<ReportSubscriptionDto> {
  const res = await api.put<{ data: ReportSubscriptionDto }>(
    `/reporting/subscriptions/${id}`,
    input,
  );
  return res.data.data;
}
export const deleteSubscription = (id: string) => apiDelete(`/reporting/subscriptions/${id}`);
export const sendSubscriptionNow = (id: string) =>
  apiPost<ReportSubscriptionDto>(`/reporting/subscriptions/${id}/send`);
