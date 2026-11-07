import type {
  ApiTokenDto,
  CreateApiTokenInput,
  CreatedApiTokenDto,
  MfaEnabledDto,
  MfaSetupDto,
  MfaStatusDto,
  PublicAuthConfigDto,
  SecuritySettingsDto,
  SecuritySettingsInput,
  TaskRestrictionInput,
} from '@arihant/shared';
import { api, apiDelete, apiGet, apiPost } from './client';

export const fetchAuthConfig = () => apiGet<PublicAuthConfigDto>('/auth/config');
/** Full-page navigation: the provider's sign-in page cannot be fetched by script. */
export const ssoStartUrl = '/api/v1/auth/sso/start';

export const fetchMfaStatus = () => apiGet<MfaStatusDto>('/auth/mfa');
export const startMfaSetup = (mfaToken?: string) =>
  apiPost<MfaSetupDto>('/auth/mfa/setup', mfaToken ? { mfaToken } : {});
export const enableMfa = (code: string) => apiPost<MfaEnabledDto>('/auth/mfa/enable', { code });
export async function disableMfa(password: string, code: string): Promise<void> {
  await api.post('/auth/mfa/disable', { password, code });
}
export const regenerateRecoveryCodes = (code: string) =>
  apiPost<MfaEnabledDto>('/auth/mfa/recovery-codes', { code });

export const fetchSecuritySettings = () => apiGet<SecuritySettingsDto>('/security/settings');
export async function saveSecuritySettings(
  input: SecuritySettingsInput,
): Promise<SecuritySettingsDto> {
  const res = await api.put<{ data: SecuritySettingsDto }>('/security/settings', input);
  return res.data.data;
}
export const fetchMyApiTokens = () => apiGet<ApiTokenDto[]>('/security/api-tokens');
export const fetchAllApiTokens = () => apiGet<ApiTokenDto[]>('/security/api-tokens/all');
export const createApiToken = (input: CreateApiTokenInput) =>
  apiPost<CreatedApiTokenDto>('/security/api-tokens', input);
export const revokeApiToken = (id: string) => apiDelete(`/security/api-tokens/${id}`);
export async function resetUserMfa(userId: string): Promise<void> {
  await api.post(`/security/users/${userId}/mfa-reset`);
}

export async function setTaskRestriction(
  taskId: string,
  input: TaskRestrictionInput,
): Promise<{ restricted: boolean; allowedUserIds: string[] }> {
  const res = await api.put<{ data: { restricted: boolean; allowedUserIds: string[] } }>(
    `/tasks/${taskId}/restriction`,
    input,
  );
  return res.data.data;
}
export async function setProjectConfidential(projectId: string, confidential: boolean) {
  const res = await api.put<{ data: { confidential: boolean } }>(
    `/projects/${projectId}/confidential`,
    { confidential },
  );
  return res.data.data;
}
