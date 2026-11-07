import {
  securitySettingsSchema,
  type PublicAuthConfigDto,
  type SecuritySettings,
  type SecuritySettingsDto,
  type SecuritySettingsInput,
} from '@arihant/shared';
import { env } from '../../config/env';
import { ForbiddenError, UnprocessableError } from '../../core/errors';
import { can } from '../../core/rbac/policy';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { recordAudit } from '../audit/audit.service';
import { Setting } from '../settings/settings.model';
import { oidcConfig } from './oidc-config';

const KEY = 'security';

/** OIDC needs an issuer, a client id and a client secret on the server. */
export const ssoConfigured = () => Boolean(oidcConfig());

export async function securitySettings(): Promise<SecuritySettings> {
  const doc = await Setting.findOne({ key: KEY }).lean();
  return securitySettingsSchema.parse((doc?.value as object | undefined) ?? {});
}

export async function getSecuritySettings(rc: RequestContext): Promise<SecuritySettingsDto> {
  const auth = requireAuth(rc);
  return {
    ...(await securitySettings()),
    ssoConfigured: ssoConfigured(),
    ssoProviderName: ssoConfigured() ? env.OIDC_PROVIDER_NAME : null,
    canEdit: can(auth, 'settings:manage', 'org'),
  };
}

export async function saveSecuritySettings(
  rc: RequestContext,
  raw: SecuritySettingsInput,
): Promise<SecuritySettingsDto> {
  const auth = requireAuth(rc);
  if (!can(auth, 'settings:manage', 'org')) throw new ForbiddenError();
  const value = securitySettingsSchema.parse(raw);
  if (value.ssoEnabled && !ssoConfigured())
    throw new UnprocessableError(
      'Single sign-on needs OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET on the server first',
    );
  if (value.ssoEnforced && !value.ssoEnabled)
    throw new UnprocessableError('Turn single sign-on on before enforcing it');
  const before = await securitySettings();
  await Setting.updateOne(
    { key: KEY },
    { $set: { value, updatedBy: auth.userObjectId } },
    { upsert: true },
  );
  await recordAudit(rc, {
    action: 'settings.security_updated',
    entityType: 'settings',
    summary: `Changed security settings (two-step required for ${value.mfaRequiredRoles.length} role(s); API tokens ${value.apiTokensEnabled ? 'on' : 'off'}; SSO ${value.ssoEnabled ? (value.ssoEnforced ? 'enforced' : 'on') : 'off'})`,
    before,
    after: value,
  });
  return getSecuritySettings(rc);
}

export async function publicAuthConfig(): Promise<PublicAuthConfigDto> {
  const s = await securitySettings();
  const on = s.ssoEnabled && ssoConfigured();
  return {
    sso: {
      enabled: on,
      providerName: on ? env.OIDC_PROVIDER_NAME : null,
      enforced: on && s.ssoEnforced,
    },
  };
}
