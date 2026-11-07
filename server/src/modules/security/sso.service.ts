import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose, { Schema } from 'mongoose';
import { publicAppUrl } from '../../config/env';
import { logger } from '../../config/logger';
import { UnauthenticatedError, UnprocessableError } from '../../core/errors';
import type { RequestContext } from '../../core/rbac/context';
import { recordAudit } from '../audit/audit.service';
import { LoginHistory } from '../auth/auth.models';
import { completeLogin, type LoginResult } from '../auth/auth.service';
import { User } from '../users/user.model';
import { securitySettings } from './security.settings';
import { oidcConfig, onOidcConfigChange, type OidcConfig } from './oidc-config';

onOidcConfigChange(() => {
  discoveryCache = null;
});

/*
 * Single sign-on with OpenID Connect (authorization code flow with PKCE). Works with Microsoft
 * Entra ID, Google Workspace, Okta and other OIDC providers. People must already have an active
 * account here with the same e-mail address: accounts are not created automatically.
 */

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}
let discoveryCache: { at: number; doc: Discovery } | null = null;

async function discovery(cfg: OidcConfig): Promise<Discovery> {
  if (discoveryCache && Date.now() - discoveryCache.at < 3_600_000) return discoveryCache.doc;
  const res = await fetch(`${cfg.issuer}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new UnprocessableError('The single sign-on provider could not be reached');
  const doc = (await res.json()) as Discovery;
  if (doc.issuer.replace(/\/$/, '') !== cfg.issuer)
    throw new UnprocessableError('The single sign-on provider returned a different issuer');
  discoveryCache = { at: Date.now(), doc };
  return doc;
}

/* ---------- Pending sign-ins (state, nonce, PKCE verifier), kept 10 minutes ---------- */

interface ISsoState {
  state: string;
  nonce: string;
  verifier: string;
  createdAt: Date;
}
const ssoStateSchema = new Schema<ISsoState>(
  {
    state: { type: String, required: true },
    nonce: { type: String, required: true },
    verifier: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { collection: 'ssoStates' },
);
ssoStateSchema.index({ state: 1 }, { unique: true });
ssoStateSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });
const SsoState =
  (mongoose.models.SsoState as mongoose.Model<ISsoState> | undefined) ??
  mongoose.model<ISsoState>('SsoState', ssoStateSchema);

const b64url = (b: Buffer) => b.toString('base64url');

/** Where to send the browser to sign in at the provider. */
export async function startSso(): Promise<string> {
  const cfg = oidcConfig();
  if (!cfg || !(await securitySettings()).ssoEnabled)
    throw new UnprocessableError('Single sign-on is not switched on');
  const d = await discovery(cfg);
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  await SsoState.create({ state, nonce, verifier });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  });
  return `${d.authorization_endpoint}?${params.toString()}`;
}

async function verifyIdToken(
  cfg: OidcConfig,
  d: Discovery,
  idToken: string,
  nonce: string,
): Promise<jwt.JwtPayload> {
  const header = jwt.decode(idToken, { complete: true })?.header;
  if (!header?.kid && !header?.alg) throw new UnauthenticatedError('Invalid sign-in response');
  const jwksRes = await fetch(d.jwks_uri, { signal: AbortSignal.timeout(10_000) });
  const { keys } = (await jwksRes.json()) as {
    keys: (Record<string, unknown> & { kid?: string })[];
  };
  const jwk = keys.find((k) => !header.kid || k.kid === header.kid);
  if (!jwk) throw new UnauthenticatedError('Unknown signing key');
  // The key set is JSON from the provider; Node validates it as a JWK.
  const key = createPublicKey({ key: jwk as never, format: 'jwk' });
  const claims = jwt.verify(idToken, key, {
    algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'PS256'],
    issuer: [cfg.issuer, `${cfg.issuer}/`],
    audience: cfg.clientId,
    clockTolerance: 60,
  });
  if (typeof claims !== 'object' || claims.nonce !== nonce)
    throw new UnauthenticatedError('Invalid sign-in response');
  return claims;
}

async function failed(rc: RequestContext, email: string, reason: 'sso_no_account') {
  await LoginHistory.create({
    email,
    userId: null,
    success: false,
    reason,
    ip: rc.ip,
    userAgent: rc.userAgent,
  }).catch((err: unknown) => logger.error({ err }, 'Failed to record login history'));
}

/** Completes the provider's redirect: checks everything, then signs the person in. */
export async function finishSso(
  rc: RequestContext,
  query: { code?: string; state?: string; error?: string },
): Promise<LoginResult> {
  if (query.error) throw new UnauthenticatedError('Sign-in was cancelled at the provider');
  const cfg = oidcConfig();
  if (!cfg || !(await securitySettings()).ssoEnabled)
    throw new UnprocessableError('Single sign-on is not switched on');
  if (!query.code || !query.state) throw new UnauthenticatedError('Invalid sign-in response');
  // One use only: the state is deleted as it is read.
  const pending = await SsoState.findOneAndDelete({ state: query.state }).lean();
  if (!pending) throw new UnauthenticatedError('The sign-in link has expired. Try again.');
  const d = await discovery(cfg);
  const tokenRes = await fetch(d.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: query.code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: pending.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) throw new UnauthenticatedError('The provider did not accept the sign-in');
  const { id_token: idToken } = (await tokenRes.json()) as { id_token?: string };
  if (!idToken) throw new UnauthenticatedError('Invalid sign-in response');
  const claims = await verifyIdToken(cfg, d, idToken, pending.nonce);
  const email = String(claims.email ?? claims.preferred_username ?? claims.upn ?? '')
    .trim()
    .toLowerCase();
  if (!email || claims.email_verified === false)
    throw new UnauthenticatedError('The provider did not confirm an e-mail address');
  const user = await User.findOne({ email }).lean();
  if (!user || user.status !== 'active') {
    await failed(rc, email, 'sso_no_account');
    throw new UnauthenticatedError(
      'There is no active account for this e-mail address. Ask an administrator to invite you.',
    );
  }
  const subject = `${cfg.issuer}|${String(claims.sub)}`;
  if (user.ssoSubject && user.ssoSubject !== subject)
    throw new UnauthenticatedError('This account is linked to a different sign-in identity');
  if (!user.ssoSubject) {
    await User.updateOne({ _id: user._id }, { $set: { ssoSubject: subject } });
    await recordAudit(rc, {
      action: 'auth.sso_linked',
      entityType: 'user',
      entityId: user._id,
      actorId: user._id,
      summary: `${user.name} linked single sign-on`,
    });
  }
  // The provider is responsible for its own second factor.
  return completeLogin(rc, user, 'sso');
}

export const ssoErrorRedirect = (message: string) =>
  `${publicAppUrl}/login?sso_error=${encodeURIComponent(message)}`;
export const ssoDoneRedirect = () => `${publicAppUrl}/login?sso=done`;
