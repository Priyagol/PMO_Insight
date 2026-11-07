import type {
  AssignWorkflowInput,
  CreateWorkflowInput,
  TaskTransitionsDto,
  TransitionHistoryDto,
  WorkflowDto,
} from '@arihant/shared';
import { api, apiDelete, apiGet, apiPatch, apiPost } from './client';

export const fetchWorkflows = () => apiGet<WorkflowDto[]>('/workflows');
export const createWorkflow = (input: CreateWorkflowInput) =>
  apiPost<WorkflowDto>('/workflows', input);
export const updateWorkflow = (id: string, input: Partial<CreateWorkflowInput>) =>
  apiPatch<WorkflowDto>(`/workflows/${id}`, input);
export const deleteWorkflow = (id: string) => apiDelete(`/workflows/${id}`);
export async function assignWorkflow(
  projectId: string,
  input: AssignWorkflowInput,
): Promise<{ workflowId: string | null; moved: number }> {
  const res = await api.put<{ data: { workflowId: string | null; moved: number } }>(
    `/projects/${projectId}/workflow`,
    input,
  );
  return res.data.data;
}
export const fetchTaskTransitions = (taskId: string) =>
  apiGet<TaskTransitionsDto>(`/tasks/${taskId}/transitions`);
export const fetchTransitionHistory = (taskId: string) =>
  apiGet<TransitionHistoryDto[]>(`/tasks/${taskId}/transitions/history`);
