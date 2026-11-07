import { z } from 'zod';
import { SYSTEM_ROLES, type SystemRole } from './enums';
import type { LoginResponse } from './dto';

/* ============================ Two-step verification ============================ */

/** A 6-digit authenticator code, or a recovery code (xxxx-xxxx). */
export const mfaCodeSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^(\d{6}|[a-z0-9]{4}-?[a-z0-9]{4})$/i, 'Enter the 6-digit code'));

export const mfaLoginSchema = z.strictObject({
  mfaToken: z.string().min(20).max(2000),
  code: mfaCodeSchema,
});
export type MfaLoginInput = z.input<typeof mfaLoginSchema>;

/** Starting or confirming enrolment; `mfaToken` is used during sign-in when enrolment is required. */
export const mfaSetupSchema = z.strictObject({ mfaToken: z.string().min(20).max(2000).optional() });
export const mfaEnableSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
  mfaToken: z.string().min(20).max(2000).optional(),
});
export type MfaEnableInput = z.input<typeof mfaEnableSchema>;
export const mfaDisableSchema = z.strictObject({
  password: z.string().min(1).max(128),
  code: mfaCodeSchema,
});
export const mfaRegenerateSchema = z.strictObject({ code: mfaCodeSchema });

/** Sign-in either completes, or asks for a second step. */
export type LoginStepResponse =
  | (LoginResponse & { mfaRequired?: undefined })
  | { mfaRequired: 'verify' | 'enroll'; mfaToken: string; expiresInSeconds: number };

export interface MfaStatusDto {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  /** Required for this person by the security settings. */
  required: boolean;
}

export interface MfaSetupDto {
  /** Base32 secret for manual entry. */
  secret: string;
  /** otpauth:// URI for the QR code. */
  otpauthUrl: string;
}

export interface MfaEnabledDto {
  /** Shown once; each works one time. */
  recoveryCodes: string[];
  /** Present when enrolment completed a sign-in. */
  session?: LoginResponse;
}

/* ============================ Personal API tokens ============================ */

export const API_TOKEN_SCOPES = ['read', 'write'] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export const createApiTokenSchema = z.strictObject({
  name: z.string().trim().min(1, 'Name the token').max(60),
  scope: z.enum(API_TOKEN_SCOPES).default('read'),
  /** Days until it expires (limited by the security settings). */
  expiresInDays: z.number().int().min(1).max(365).default(30),
});
export type CreateApiTokenInput = z.input<typeof createApiTokenSchema>;

export interface ApiTokenDto {
  id: string;
  name: string;
  /** First characters, to recognise the token. */
  prefix: string;
  scope: ApiTokenScope;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  owner?: { id: string; name: string };
}

export interface CreatedApiTokenDto extends ApiTokenDto {
  /** The full token, shown once. */
  token: string;
}

/* ============================ Security settings ============================ */

export const securitySettingsSchema = z.strictObject({
  /** Roles that must use two-step verification. */
  mfaRequiredRoles: z.array(z.enum(SYSTEM_ROLES)).max(SYSTEM_ROLES.length).default([]),
  apiTokensEnabled: z.boolean().default(false),
  apiTokenMaxDays: z.number().int().min(1).max(365).default(90),
  /** Single sign-on (OIDC) buttons on the sign-in page; needs the OIDC_* settings on the server. */
  ssoEnabled: z.boolean().default(false),
  /** When on, people with SSO cannot use a password. */
  ssoEnforced: z.boolean().default(false),
});
export type SecuritySettings = z.output<typeof securitySettingsSchema>;
export type SecuritySettingsInput = z.input<typeof securitySettingsSchema>;

export interface SecuritySettingsDto extends SecuritySettings {
  /** OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET are set on the server. */
  ssoConfigured: boolean;
  ssoProviderName: string | null;
  canEdit: boolean;
}

/** What the sign-in page needs before anyone signs in. */
export interface PublicAuthConfigDto {
  sso: { enabled: boolean; providerName: string | null; enforced: boolean };
}

export const roleRequiresMfa = (roles: readonly string[], required: readonly SystemRole[]) =>
  roles.some((r) => (required as readonly string[]).includes(r));

/* ============================ Restricted tasks, confidential projects ============================ */

export const taskRestrictionSchema = z.strictObject({
  restricted: z.boolean(),
  /** People (besides the assignee, reporter and project managers) who may see the task. */
  allowedUserIds: z
    .array(z.string().regex(/^[a-f\d]{24}$/i))
    .max(50)
    .default([]),
});
export type TaskRestrictionInput = z.input<typeof taskRestrictionSchema>;

export const projectConfidentialSchema = z.strictObject({ confidential: z.boolean() });
