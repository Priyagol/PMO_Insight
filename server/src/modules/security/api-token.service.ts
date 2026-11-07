import { randomBytes } from 'node:crypto';
import mongoose, { Schema, Types } from 'mongoose';
import {
  API_TOKEN_SCOPES,
  createApiTokenSchema,
  type ApiTokenDto,
  type ApiTokenScope,
  type CreateApiTokenInput,
  type CreatedApiTokenDto,
} from '@arihant/shared';
import { hashToken } from '../../core/auth/tokens';
import {
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  UnprocessableError,
} from '../../core/errors';
import { can } from '../../core/rbac/policy';
import {
  loadAuthContext,
  requireAuth,
  type AuthContext,
  type RequestContext,
} from '../../core/rbac/context';
import { recordAudit } from '../audit/audit.service';
import { User } from '../users/user.model';
import { securitySettings } from './security.settings';

/*
 * Personal API tokens for scripts and integrations. A token acts as its owner, with the owner's
 * permissions; "read" tokens can only read. Only a hash is stored; the token is shown once.
 */

export const TOKEN_PREFIX = 'awt_';
const MAX_ACTIVE = 10;

interface IApiToken {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  prefix: string;
  tokenHash: string;
  scope: ApiTokenScope;
  expiresAt: Date;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  revokedAt: Date | null;
  createdAt: Date;
}

const apiTokenSchema = new Schema<IApiToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: 60 },
    prefix: { type: String, required: true },
    tokenHash: { type: String, required: true },
    scope: { type: String, enum: API_TOKEN_SCOPES, required: true },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: null },
    lastUsedIp: { type: String, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'apiTokens' },
);
apiTokenSchema.index({ tokenHash: 1 }, { unique: true });
apiTokenSchema.index({ userId: 1, createdAt: -1 });

export const ApiToken =
  (mongoose.models.ApiToken as mongoose.Model<IApiToken> | undefined) ??
  mongoose.model<IApiToken>('ApiToken', apiTokenSchema);

const present = (t: IApiToken, owner?: { _id: Types.ObjectId; name: string }): ApiTokenDto => ({
  id: t._id.toString(),
  name: t.name,
  prefix: t.prefix,
  scope: t.scope,
  expiresAt: t.expiresAt.toISOString(),
  lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
  revokedAt: t.revokedAt?.toISOString() ?? null,
  createdAt: t.createdAt.toISOString(),
  ...(owner ? { owner: { id: owner._id.toString(), name: owner.name } } : {}),
});

export async function listMyTokens(rc: RequestContext): Promise<ApiTokenDto[]> {
  const auth = requireAuth(rc);
  const rows = await ApiToken.find({ userId: auth.userObjectId })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return rows.map((t) => present(t));
}

export async function createToken(
  rc: RequestContext,
  raw: CreateApiTokenInput,
): Promise<CreatedApiTokenDto> {
  const auth = requireAuth(rc);
  if (rc.viaApiToken) throw new ForbiddenError('API tokens cannot create other tokens');
  const settings = await securitySettings();
  if (!settings.apiTokensEnabled)
    throw new ForbiddenError('API tokens are switched off. Ask an administrator.');
  if (auth.roleKeys.includes('external_stakeholder'))
    throw new ForbiddenError('External stakeholders cannot create API tokens');
  const input = createApiTokenSchema.parse(raw);
  if (input.expiresInDays > settings.apiTokenMaxDays)
    throw new UnprocessableError(`Tokens can last at most ${settings.apiTokenMaxDays} days`);
  const active = await ApiToken.countDocuments({
    userId: auth.userObjectId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (active >= MAX_ACTIVE)
    throw new UnprocessableError(`You can have ${MAX_ACTIVE} active tokens`);
  const token = TOKEN_PREFIX + randomBytes(30).toString('base64url');
  const doc = await ApiToken.create({
    userId: auth.userObjectId,
    name: input.name,
    prefix: token.slice(0, 10),
    tokenHash: hashToken(token),
    scope: input.scope,
    expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000),
  });
  await recordAudit(rc, {
    action: 'auth.api_token_created',
    entityType: 'api_token',
    entityId: doc._id,
    summary: `${auth.name} created API token “${input.name}” (${input.scope}, ${input.expiresInDays} days)`,
  });
  return { ...present(doc.toObject()), token };
}

export async function revokeToken(rc: RequestContext, id: string): Promise<void> {
  const auth = requireAuth(rc);
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Token');
  const t = await ApiToken.findById(id).lean();
  const admin = can(auth, 'settings:manage', 'org');
  if (!t || (!t.userId.equals(auth.userObjectId) && !admin)) throw new NotFoundError('Token');
  if (t.revokedAt) return;
  await ApiToken.updateOne({ _id: t._id }, { $set: { revokedAt: new Date() } });
  await recordAudit(rc, {
    action: 'auth.api_token_revoked',
    entityType: 'api_token',
    entityId: t._id,
    summary: `${auth.name} revoked API token “${t.name}”${t.userId.equals(auth.userObjectId) ? '' : ' of another user'}`,
  });
}

/** Administrators: every token, newest first. */
export async function listAllTokens(rc: RequestContext): Promise<ApiTokenDto[]> {
  const auth = requireAuth(rc);
  if (!can(auth, 'settings:manage', 'org')) throw new ForbiddenError();
  const rows = await ApiToken.find().sort({ createdAt: -1 }).limit(500).lean();
  const owners = await User.find({ _id: { $in: rows.map((r) => r.userId) } })
    .select('name')
    .lean();
  return rows.map((t) =>
    present(
      t,
      owners.find((o) => o._id.equals(t.userId)),
    ),
  );
}

/** Resolves a presented token to its owner's permissions, or throws 401. */
export async function authenticateApiToken(
  token: string,
  ip: string | undefined,
): Promise<{ auth: AuthContext; scope: ApiTokenScope }> {
  const t = await ApiToken.findOne({ tokenHash: hashToken(token) }).lean();
  if (!t || t.revokedAt || t.expiresAt <= new Date())
    throw new UnauthenticatedError('Invalid or expired API token');
  if (!(await securitySettings()).apiTokensEnabled)
    throw new UnauthenticatedError('API tokens are switched off');
  const user = await User.findById(t.userId).select('tokenVersion status').lean();
  if (!user || user.status !== 'active')
    throw new UnauthenticatedError('Invalid or expired API token');
  const auth = await loadAuthContext(t.userId.toString(), user.tokenVersion);
  // Record use at most once a minute.
  if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > 60_000)
    await ApiToken.updateOne(
      { _id: t._id },
      { $set: { lastUsedAt: new Date(), lastUsedIp: ip ?? null } },
    );
  return { auth, scope: t.scope };
}
