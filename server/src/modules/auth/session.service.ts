import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { env, publicAppUrl } from '../../config/env';
import { signAccessToken } from '../../core/auth/jwt';
import { generateOpaqueToken, hashToken } from '../../core/auth/tokens';
import { emailTemplates, sendEmail } from '../../services/email';
import { User } from '../users/user.model';
import { PasswordReset, RefreshToken, type IRefreshToken } from './auth.models';

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

/** Issues an access token plus a new refresh token (new family unless one is given). */
export async function issueSession(
  user: { _id: Types.ObjectId; tokenVersion: number },
  meta: ClientMeta,
  familyId: string = randomUUID(),
): Promise<IssuedSession> {
  const refreshToken = generateOpaqueToken();
  const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600_000);
  await RefreshToken.create({
    userId: user._id,
    familyId,
    tokenHash: hashToken(refreshToken),
    expiresAt: refreshExpiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return {
    accessToken: signAccessToken({ sub: user._id.toString(), tv: user.tokenVersion }),
    refreshToken,
    refreshExpiresAt,
  };
}

export async function revokeFamily(
  familyId: string,
  reason: IRefreshToken['revokedReason'],
): Promise<void> {
  await RefreshToken.updateMany(
    { familyId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
}

/**
 * Signs the user out everywhere: revokes all refresh tokens and bumps tokenVersion so
 * outstanding access tokens stop working on their next request.
 */
export async function revokeAllSessions(
  userId: Types.ObjectId | string,
  reason: IRefreshToken['revokedReason'],
): Promise<number> {
  const id = new Types.ObjectId(userId.toString());
  await RefreshToken.updateMany(
    { userId: id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  const updated = await User.findByIdAndUpdate(
    id,
    { $inc: { tokenVersion: 1 } },
    { returnDocument: 'after' },
  )
    .select('tokenVersion')
    .lean();
  return updated?.tokenVersion ?? 0;
}

/**
 * Creates a single-use invite or reset link and e-mails it. Earlier unused links of the
 * same purpose are invalidated so only the newest link works.
 */
export async function sendPasswordLink(
  user: { _id: Types.ObjectId; name: string; email: string },
  purpose: 'invite' | 'reset',
  createdBy?: Types.ObjectId,
): Promise<boolean> {
  const now = new Date();
  await PasswordReset.updateMany(
    { userId: user._id, purpose, usedAt: null },
    { $set: { usedAt: now } },
  );
  const token = generateOpaqueToken(32);
  const ttlMs =
    purpose === 'invite'
      ? env.INVITE_TTL_HOURS * 3600_000
      : env.PASSWORD_RESET_TTL_MINUTES * 60_000;
  await PasswordReset.create({
    userId: user._id,
    purpose,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + ttlMs),
    createdBy,
  });
  const url = `${publicAppUrl}/reset-password?token=${encodeURIComponent(token)}${purpose === 'invite' ? '&mode=invite' : ''}`;
  const template =
    purpose === 'invite'
      ? emailTemplates.invite(user.name, url, env.INVITE_TTL_HOURS)
      : emailTemplates.passwordReset(user.name, url, env.PASSWORD_RESET_TTL_MINUTES);
  return sendEmail({ to: user.email, ...template });
}
