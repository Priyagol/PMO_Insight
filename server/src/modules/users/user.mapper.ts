import type { Types } from 'mongoose';
import type { DepartmentRef, RoleRef, UserDto, UserRef } from '@arihant/shared';
import type { IUser } from './user.model';

/** Shape of a user document after `populateUser()`. */
export type PopulatedUser = Omit<IUser, 'departmentId' | 'managerId' | 'roleIds'> & {
  departmentId: { _id: Types.ObjectId; name: string; code: string } | null;
  managerId: {
    _id: Types.ObjectId;
    name: string;
    email: string;
    employeeId: string;
    designation?: string;
  } | null;
  roleIds: { _id: Types.ObjectId; key: string; name: string }[];
};

export const USER_POPULATE = [
  { path: 'departmentId', select: 'name code' },
  { path: 'managerId', select: 'name email employeeId designation' },
  { path: 'roleIds', select: 'key name' },
] as const;

export function toUserRef(u: {
  _id: Types.ObjectId;
  name: string;
  email: string;
  employeeId: string;
  designation?: string;
}): UserRef {
  return {
    id: u._id.toString(),
    name: u.name,
    email: u.email,
    employeeId: u.employeeId,
    designation: u.designation,
  };
}

export function toUserDto(u: PopulatedUser): UserDto {
  const department: DepartmentRef | null = u.departmentId
    ? { id: u.departmentId._id.toString(), name: u.departmentId.name, code: u.departmentId.code }
    : null;
  const roles: RoleRef[] = (u.roleIds ?? [])
    .filter(Boolean)
    .map((r) => ({ id: r._id.toString(), key: r.key, name: r.name }));
  return {
    id: u._id.toString(),
    employeeId: u.employeeId,
    name: u.name,
    email: u.email,
    phone: u.phone,
    designation: u.designation,
    department,
    manager: u.managerId ? toUserRef(u.managerId) : null,
    roles,
    skills: (u.skills ?? []).map((s) => ({ name: s.name, level: s.level })),
    weeklyCapacityHours: u.weeklyCapacityHours,
    status: u.status,
    hasPassword: Boolean(u.passwordHash),
    joinedAt: u.joinedAt ? u.joinedAt.toISOString().slice(0, 10) : undefined,
    lastLoginAt: u.lastLoginAt?.toISOString(),
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}
