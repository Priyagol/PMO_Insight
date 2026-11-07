import { z } from 'zod';
import { EMPLOYMENT_STATUSES, SYSTEM_ROLES } from './enums';
import { PERMISSIONS, SCOPES } from './permissions';
import { objectIdSchema, paginationQuerySchema } from './api';

/* ----------------------------------------------------------------------------
 * Validation schemas shared by API (request validation) and client (forms).
 * ------------------------------------------------------------------------- */

export const PASSWORD_MIN_LENGTH = 10;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(128, 'Use at most 128 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

const email = z.email('Enter a valid email address').trim().toLowerCase().max(254);

/* ---------- Auth ---------- */

export const loginSchema = z.strictObject({
  email,
  password: z.string().min(1, 'Enter your password').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.strictObject({ email });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.strictObject({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1, 'Enter your current password').max(128),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must differ from the current one',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/* ---------- Users ---------- */

export const skillInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  level: z.number().int().min(1).max(5),
});
export type SkillInput = z.infer<typeof skillInputSchema>;

const userFields = {
  name: z.string().trim().min(2, 'Enter the full name').max(120),
  email,
  employeeId: z
    .string()
    .trim()
    .min(1, 'Enter the employee ID')
    .max(30)
    .regex(/^[A-Za-z0-9._-]+$/, 'Letters, numbers, dot, dash and underscore only'),
  departmentId: objectIdSchema.nullable().optional(),
  designation: z.string().trim().max(100).optional(),
  managerId: objectIdSchema.nullable().optional(),
  roleIds: z.array(objectIdSchema).min(1, 'Select at least one role').max(10),
  skills: z.array(skillInputSchema).max(50).default([]),
  weeklyCapacityHours: z.number().min(0).max(80).default(40),
  joinedAt: z.iso.date('Use a valid date').optional(),
  phone: z.string().trim().max(30).optional(),
};

export const createUserSchema = z.strictObject(userFields);
export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = z
  .strictObject({
    name: userFields.name,
    email: userFields.email,
    employeeId: userFields.employeeId,
    departmentId: userFields.departmentId,
    designation: userFields.designation,
    managerId: userFields.managerId,
    skills: z.array(skillInputSchema).max(50),
    weeklyCapacityHours: z.number().min(0).max(80),
    joinedAt: userFields.joinedAt,
    phone: userFields.phone,
  })
  .partial();
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const userStatusSchema = z.strictObject({ status: z.enum(EMPLOYMENT_STATUSES) });

export const assignRolesSchema = z.strictObject({
  roleIds: z.array(objectIdSchema).min(1, 'Select at least one role').max(10),
});

export const userListQuerySchema = paginationQuerySchema.extend({
  departmentId: objectIdSchema.optional(),
  roleId: objectIdSchema.optional(),
  status: z.enum(EMPLOYMENT_STATUSES).optional(),
  managerId: objectIdSchema.optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

/* ---------- Departments ---------- */

export const departmentSchema = z.strictObject({
  name: z.string().trim().min(2, 'Enter a department name').max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Use 2–10 characters')
    .max(10, 'Use 2–10 characters')
    .regex(/^[A-Z0-9-]+$/, 'Letters, numbers and dashes only'),
  description: z.string().trim().max(500).optional(),
  headId: objectIdSchema.nullable().optional(),
  parentId: objectIdSchema.nullable().optional(),
});
export type DepartmentInput = z.input<typeof departmentSchema>;
export const updateDepartmentSchema = departmentSchema.partial();

/* ---------- Roles ---------- */

export const grantSchema = z.strictObject({
  permission: z.enum(PERMISSIONS),
  scope: z.enum(SCOPES),
});

export const roleSchema = z.strictObject({
  name: z.string().trim().min(2, 'Enter a role name').max(60),
  description: z.string().trim().max(300).optional(),
  grants: z.array(grantSchema).max(PERMISSIONS.length),
});
export type RoleInput = z.infer<typeof roleSchema>;
export const updateRoleSchema = roleSchema.partial();

/* ---------- Settings ---------- */

export const orgSettingsSchema = z.strictObject({
  organizationName: z.string().trim().min(2).max(120),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown timezone'),
  workingDays: z
    .array(z.number().int().min(0).max(6))
    .min(1, 'Select at least one working day')
    .max(7),
  workingHoursPerDay: z.number().min(1).max(24),
  defaultWeeklyCapacityHours: z.number().min(1).max(80),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

/* ---------- Audit ---------- */

export const auditQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().max(60).optional(),
  actorId: objectIdSchema.optional(),
  entityType: z.string().trim().max(40).optional(),
  entityId: objectIdSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const roleKeySchema = z.enum(SYSTEM_ROLES);
