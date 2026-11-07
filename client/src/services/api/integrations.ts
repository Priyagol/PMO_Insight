import type { GitLinkDto, GitSettingsDto, GitSettingsInput } from '@arihant/shared';
import { api, apiGet } from './client';

export const fetchGitSettings = () => apiGet<GitSettingsDto>('/integrations/github');
export async function saveGitSettings(input: GitSettingsInput): Promise<GitSettingsDto> {
  const res = await api.put<{ data: GitSettingsDto }>('/integrations/github', input);
  return res.data.data;
}
export const fetchTaskGitLinks = (taskId: string) => apiGet<GitLinkDto[]>(`/tasks/${taskId}/git`);
