import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  LoginResponse,
  LoginStepResponse,
  MfaEnabledDto,
  ResetPasswordInput,
  SessionDto,
} from '@arihant/shared';
import { api, apiGet, apiPost, tokenStore } from './client';

/** Signs in; with two-step verification the first call returns the next step instead of a session. */
export async function login(input: LoginInput): Promise<LoginStepResponse> {
  const res = await apiPost<LoginStepResponse>('/auth/login', input);
  if (!res.mfaRequired) tokenStore.set(res.accessToken);
  return res;
}

export async function loginWithCode(mfaToken: string, code: string): Promise<LoginResponse> {
  const res = await apiPost<LoginResponse>('/auth/login/mfa', { mfaToken, code });
  tokenStore.set(res.accessToken);
  return res;
}

/** Enrolment during sign-in (required by policy): returns recovery codes and the session. */
export async function enrollDuringLogin(mfaToken: string, code: string): Promise<MfaEnabledDto> {
  const res = await apiPost<MfaEnabledDto>('/auth/mfa/enable', { mfaToken, code });
  if (res.session) tokenStore.set(res.session.accessToken);
  return res;
}

/** Restores a session from the HttpOnly refresh cookie (page load / new tab). */
export async function restoreSession(): Promise<LoginResponse> {
  const res = await apiPost<LoginResponse>('/auth/refresh');
  tokenStore.set(res.accessToken);
  return res;
}

export const fetchMe = () => apiGet<SessionDto>('/auth/me');

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } finally {
    tokenStore.set(null);
  }
}

export async function logoutAll(): Promise<void> {
  try {
    await api.post('/auth/logout-all');
  } finally {
    tokenStore.set(null);
  }
}

export async function changePassword(input: ChangePasswordInput): Promise<LoginResponse> {
  const res = await apiPost<LoginResponse>('/auth/change-password', input);
  tokenStore.set(res.accessToken);
  return res;
}

export const forgotPassword = (input: ForgotPasswordInput) =>
  apiPost<{ message: string }>('/auth/forgot-password', input);

export const resetPassword = (input: ResetPasswordInput) =>
  apiPost<{ message: string; email: string }>('/auth/reset-password', input);
