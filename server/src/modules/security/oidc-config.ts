import { API_PREFIX } from '../../config/app';
import { env, publicAppUrl } from '../../config/env';

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

let override: OidcConfig | null = null;
/** Tests point single sign-on at a local provider. */
export function setOidcConfig(next: OidcConfig | null): void {
  override = next;
  listeners.forEach((l) => l());
}

const listeners: (() => void)[] = [];
export const onOidcConfigChange = (l: () => void) => listeners.push(l);

export function oidcConfig(): OidcConfig | null {
  if (override) return override;
  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) return null;
  return {
    issuer: env.OIDC_ISSUER.replace(/\/$/, ''),
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    redirectUri: env.OIDC_REDIRECT_URI ?? `${publicAppUrl}${API_PREFIX}/auth/sso/callback`,
  };
}
