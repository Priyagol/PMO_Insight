import type { EmploymentStatus } from './enums';
import type { PermissionGrant, PermissionMap } from './permissions';

/** Response shapes returned by the API (dates are ISO strings). */

export interface RoleRef {
  id: string;
  key: string;
  name: string;
}

export interface UserRef {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  designation?: string;
}

export interface DepartmentRef {
  id: string;
  name: string;
  code: string;
}

export interface UserDto {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  phone?: string;
  designation?: string;
  department: DepartmentRef | null;
  manager: UserRef | null;
  roles: RoleRef[];
  skills: { name: string; level: number }[];
  weeklyCapacityHours: number;
  status: EmploymentStatus;
  /** False until the employee accepts the invite and sets a password. */
  hasPassword: boolean;
  joinedAt?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionDto {
  user: UserDto;
  permissions: PermissionMap;
}

export interface LoginResponse extends SessionDto {
  accessToken: string;
}

export interface DepartmentDto {
  id: string;
  name: string;
  code: string;
  description?: string;
  head: UserRef | null;
  parent: DepartmentRef | null;
  memberCount: number;
  /** Set when the department is archived (listed only with ?archived=true). */
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoleDto {
  id: string;
  key: string;
  name: string;
  description?: string;
  isSystem: boolean;
  /** Super Admin's grants can never be edited. */
  locked: boolean;
  grants: PermissionGrant[];
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogDto {
  id: string;
  action: string;
  actor: UserRef | null;
  entityType: string;
  entityId?: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  createdAt: string;
}

export interface LoginHistoryDto {
  id: string;
  email: string;
  success: boolean;
  reason?: string;
  ip?: string;
  userAgent?: string;
  createdAt: string;
}

export interface OrgSettingsDto {
  organizationName: string;
  timezone: string;
  workingDays: number[];
  workingHoursPerDay: number;
  defaultWeeklyCapacityHours: number;
  fiscalYearStartMonth: number;
  updatedAt?: string;
}
