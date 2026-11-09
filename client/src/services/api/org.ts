import type {
  AuditLogDto,
  AuditQuery,
  CreateUserInput,
  DepartmentDto,
  DepartmentInput,
  EmploymentStatus,
  LoginHistoryDto,
  OrgSettings,
  OrgSettingsDto,
  PERMISSION_GROUPS,
  Permission,
  RoleDto,
  RoleInput,
  UpdateUserInput,
  UserDto,
  UserListQuery,
} from '@arihant/shared';
import { apiDelete, apiGet, apiGetPage, apiPatch, apiPost, api } from './client';

/** Drops empty values so they are not sent as `?key=`. */
function params<T extends object>(query: Partial<T>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v as string | number;
  }
  return out;
}

/* ---------- Employees ---------- */

export const fetchUsers = (query: Partial<UserListQuery>) =>
  apiGetPage<UserDto>('/users', { params: params(query) });
export const fetchUser = (id: string) => apiGet<UserDto>(`/users/${id}`);
export const createUser = (input: CreateUserInput) =>
  apiPost<{ user: UserDto; inviteSent: boolean }>('/users', input);
export const updateUser = (id: string, input: UpdateUserInput) =>
  apiPatch<UserDto>(`/users/${id}`, input);
export const setUserStatus = (id: string, status: EmploymentStatus) =>
  apiPatch<UserDto>(`/users/${id}/status`, { status });
export async function setUserRoles(id: string, roleIds: string[]): Promise<UserDto> {
  const res = await api.put<{ data: UserDto }>(`/users/${id}/roles`, { roleIds });
  return res.data.data;
}
export const resendInvite = (id: string) =>
  apiPost<{ sent: boolean }>(`/users/${id}/resend-invite`);
export const sendPasswordReset = (id: string) =>
  apiPost<{ sent: boolean }>(`/users/${id}/send-password-reset`);
export const fetchSkills = (q?: string) => apiGet<string[]>('/skills', { params: params({ q }) });

/* ---------- Departments ---------- */

export const fetchDepartments = () => apiGet<DepartmentDto[]>('/departments');
export const createDepartment = (input: DepartmentInput) =>
  apiPost<DepartmentDto>('/departments', input);
export const updateDepartment = (id: string, input: Partial<DepartmentInput>) =>
  apiPatch<DepartmentDto>(`/departments/${id}`, input);
export const archiveDepartment = (id: string) => apiDelete(`/departments/${id}`);
export const fetchArchivedDepartments = () =>
  apiGet<DepartmentDto[]>('/departments', { params: { archived: 'true' } });
export const restoreDepartment = (id: string) =>
  apiPost<DepartmentDto>(`/departments/${id}/restore`, {});

/* ---------- Roles ---------- */

export const fetchRoles = () => apiGet<RoleDto[]>('/roles');
export const createRole = (input: RoleInput) => apiPost<RoleDto>('/roles', input);
export const updateRole = (id: string, input: Partial<RoleInput>) =>
  apiPatch<RoleDto>(`/roles/${id}`, input);
export const deleteRole = (id: string) => apiDelete(`/roles/${id}`);
export const fetchPermissionCatalogue = () =>
  apiGet<{ groups: typeof PERMISSION_GROUPS; orgOnly: Permission[] }>('/permissions');

/* ---------- Audit & settings ---------- */

export const fetchAuditLogs = (query: Partial<AuditQuery>) =>
  apiGetPage<AuditLogDto>('/audit-logs', { params: params(query) });
export const fetchLoginHistory = (query: {
  page?: number;
  limit?: number;
  q?: string;
  success?: string;
}) => apiGetPage<LoginHistoryDto>('/audit-logs/logins', { params: params(query) });
export const fetchSettings = () => apiGet<OrgSettingsDto>('/settings');
export async function saveSettings(input: OrgSettings): Promise<OrgSettingsDto> {
  const res = await api.put<{ data: OrgSettingsDto }>('/settings', input);
  return res.data.data;
}
