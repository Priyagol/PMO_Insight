import { Types } from 'mongoose';
import type {
  ChangePasswordInput,
  LoginHistoryDto,
  LoginInput,
  PageMeta,
  PaginationQuery,
  SessionDto,
} from '@arihant/shared';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../core/auth/password';
import { hashToken } from '../../core/auth/tokens';
import { UnauthenticatedError, UnprocessableError, ValidationError } from '../../core/errors';
import { toPageMeta, toPageWindow } from '../../core/pagination';
import { loadAuthContext, requireAuth, type RequestContext } from '../../core/rbac/context';
import { emailTemplates, sendEmail } from '../../services/email';
import { recordAudit } from '../audit/audit.service';
import { loadUserDto } from '../users/user.service';
import { User } from '../users/user.model';
import { LoginHistory, PasswordReset, RefreshToken, type ILoginHistory } from './auth.models';
import { securitySettings } from '../security/security.settings';
import {
  MFA_TOKEN_TTL,
  checkCode,
  enable as enableMfa,
  mfaRequiredFor,
  readMfaToken,
  signMfaToken,
  type MfaPurpose,
} from './mfa.service';
import {
  issueSession,
  revokeAllSessions,
  revokeFamily,
  sendPasswordLink,
  type IssuedSession,
} from './session.service';

/** A refresh token presented again within this window after rotation is treated as a benign race (two tabs). */
const ROTATION_GRACE_MS = 10_000;
const GENERIC_LOGIN_ERROR = 'Invalid email or password';

export interface LoginResult extends IssuedSession {
  session: SessionDto;
}

/** A correct password either completes sign-in or leads to the two-step check. */
export type LoginOutcome =
  | ({ kind: 'session' } & LoginResult)
  | { kind: 'mfa'; purpose: MfaPurpose; mfaToken: string; expiresInSeconds: number };

async function buildSession(userId: string, tokenVersion: number): Promise<SessionDto> {
  const ctx = await loadAuthContext(userId, tokenVersion);
  return { user: await loadUserDto(userId), permissions: ctx.permissions };
}

async function recordLogin(
  rc: RequestContext,
  email: string,
  userId: Types.ObjectId | null,
  success: boolean,
  reason?: ILoginHistory['reason'],
): Promise<void> {
  await LoginHistory.create({
    email,
    userId,
    success,
    reason,
    ip: rc.ip,
    userAgent: rc.userAgent,
  }).catch((err: unknown) => logger.error({ err }, 'Failed to record login history'));
}

export async function login(rc: RequestContext, input: LoginInput): Promise<LoginOutcome> {
  const user = await User.findOne({ email: input.email }).select('+passwordHash +mfa');

  if (!user) {
    await verifyAgainstDummy(input.password);
    await recordLogin(rc, input.email, null, false, 'invalid_credentials');
    throw new UnauthenticatedError(GENERIC_LOGIN_ERROR);
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordLogin(rc, input.email, user._id, false, 'locked');
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new UnauthenticatedError(
      `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'} or reset your password.`,
    );
  }

  if (user.status !== 'active' || !user.passwordHash) {
    await verifyAgainstDummy(input.password);
    await recordLogin(
      rc,
      input.email,
      user._id,
      false,
      user.status !== 'active' ? 'inactive' : 'not_activated',
    );
    throw new UnauthenticatedError(GENERIC_LOGIN_ERROR);
  }

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    // Atomic increment so parallel attempts cannot bypass the lockout threshold.
    const updated = await User.findOneAndUpdate(
      { _id: user._id },
      { $inc: { failedLoginCount: 1 } },
      { returnDocument: 'after' },
    )
      .select('failedLoginCount')
      .lean();
    await recordLogin(rc, input.email, user._id, false, 'invalid_credentials');
    if ((updated?.failedLoginCount ?? 0) >= env.LOGIN_MAX_ATTEMPTS) {
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            lockedUntil: new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000),
            failedLoginCount: 0,
          },
        },
      );
      await recordAudit(rc, {
        action: 'auth.account_locked',
        entityType: 'user',
        entityId: user._id,
        actorId: user._id,
        summary: `Account ${user.email} locked for ${env.LOGIN_LOCK_MINUTES} minutes after ${env.LOGIN_MAX_ATTEMPTS} failed sign-in attempts`,
      });
    }
    throw new UnauthenticatedError(GENERIC_LOGIN_ERROR);
  }

  // With single sign-on enforced, people who use it cannot sign in with a password
  // (super administrators keep password access for emergencies).
  const security = await securitySettings();
  if (security.ssoEnforced && user.ssoSubject) {
    const ctx = await loadAuthContext(user._id.toString(), user.tokenVersion);
    if (!ctx.isSuperAdmin) {
      await recordLogin(rc, input.email, user._id, false, 'sso_required');
      throw new UnauthenticatedError('Sign in with single sign-on');
    }
  }

  // Second step: an authenticator code, or enrolment when it is required but not set up.
  if (user.mfa?.enabled || (await mfaRequiredFor(user))) {
    await User.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0 } });
    const purpose: MfaPurpose = user.mfa?.enabled ? 'verify' : 'enroll';
    return {
      kind: 'mfa',
      purpose,
      mfaToken: signMfaToken(user, purpose),
      expiresInSeconds: MFA_TOKEN_TTL,
    };
  }
  return { kind: 'session', ...(await completeLogin(rc, user, 'password')) };
}

/** Records a successful sign-in and issues the session. */
export async function completeLogin(
  rc: RequestContext,
  user: { _id: Types.ObjectId; email: string; name: string; tokenVersion: number },
  method: 'password' | 'mfa' | 'recovery_code' | 'sso',
): Promise<LoginResult> {
  await User.updateOne(
    { _id: user._id },
    { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } },
  );
  await recordLogin(rc, user.email, user._id, true);
  await recordAudit(rc, {
    action: 'auth.login',
    entityType: 'user',
    entityId: user._id,
    actorId: user._id,
    summary: `${user.name} signed in${method === 'password' ? '' : method === 'sso' ? ' with single sign-on' : method === 'mfa' ? ' (two-step)' : ' with a recovery code'}`,
  });

  const issued = await issueSession(user, rc);
  return { ...issued, session: await buildSession(user._id.toString(), user.tokenVersion) };
}

/** Second sign-in step: a code from the authenticator app or a recovery code. */
export async function loginWithMfa(
  rc: RequestContext,
  mfaToken: string,
  code: string,
): Promise<LoginResult> {
  const { userId, tv } = readMfaToken(mfaToken, 'verify');
  const user = await User.findById(userId).lean();
  if (!user || user.status !== 'active' || user.tokenVersion !== tv)
    throw new UnauthenticatedError();
  const how = await checkCode(rc, userId, code);
  return completeLogin(rc, user, how === 'totp' ? 'mfa' : 'recovery_code');
}

/** Enrolment during sign-in (required by the security settings): turns it on and signs in. */
export async function enrollAndLogin(
  rc: RequestContext,
  mfaToken: string,
  code: string,
): Promise<{ recoveryCodes: string[]; result: LoginResult }> {
  const { tv } = readMfaToken(mfaToken, 'enroll');
  const { recoveryCodes, user } = await enableMfa(rc, code, mfaToken);
  if (user.tokenVersion !== tv) throw new UnauthenticatedError();
  return { recoveryCodes, result: await completeLogin(rc, user, 'mfa') };
}

/**
 * Rotates a refresh token. Presenting an already-rotated token outside the grace window
 * is treated as theft: the whole token family is revoked and the user must sign in again.
 */
export async function refresh(
  rc: RequestContext,
  presented: string | undefined,
): Promise<LoginResult> {
  if (!presented) throw new UnauthenticatedError('No active session');
  const record = await RefreshToken.findOne({ tokenHash: hashToken(presented) });
  if (!record) throw new UnauthenticatedError('Session expired. Please sign in again.');

  if (record.revokedAt) {
    const benignRace =
      record.revokedReason === 'rotated' &&
      Date.now() - record.revokedAt.getTime() < ROTATION_GRACE_MS;
    if (!benignRace) {
      if (record.revokedReason === 'rotated') {
        await revokeFamily(record.familyId, 'reuse_detected');
        await recordAudit(rc, {
          action: 'auth.refresh_reuse_detected',
          entityType: 'user',
          entityId: record.userId,
          actorId: record.userId,
          summary:
            'A previously used refresh token was presented again; all sessions from that sign-in were revoked',
        });
      }
      throw new UnauthenticatedError('Session expired. Please sign in again.');
    }
  }
  if (record.expiresAt <= new Date())
    throw new UnauthenticatedError('Session expired. Please sign in again.');

  const user = await User.findById(record.userId).select('status tokenVersion').lean();
  if (!user || user.status !== 'active') {
    await revokeFamily(record.familyId, 'deactivated');
    throw new UnauthenticatedError('Session expired. Please sign in again.');
  }

  if (!record.revokedAt) {
    // Conditional update: only one concurrent request can rotate this token.
    const rotated = await RefreshToken.updateOne(
      { _id: record._id, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'rotated' } },
    );
    if (rotated.modifiedCount === 0) {
      // Lost the race to a parallel refresh within the same instant: still within grace.
      logger.debug({ familyId: record.familyId }, 'Concurrent refresh rotation');
    }
  }

  const issued = await issueSession(user, rc, record.familyId);
  return { ...issued, session: await buildSession(user._id.toString(), user.tokenVersion) };
}

export async function logout(rc: RequestContext, presented: string | undefined): Promise<void> {
  if (!presented) return;
  const record = await RefreshToken.findOne({ tokenHash: hashToken(presented) }).lean();
  if (!record) return;
  await revokeFamily(record.familyId, 'logout');
  await recordAudit(rc, {
    action: 'auth.logout',
    entityType: 'user',
    entityId: record.userId,
    actorId: record.userId,
    summary: 'Signed out',
  });
}

export async function logoutAll(rc: RequestContext): Promise<void> {
  const auth = requireAuth(rc);
  await revokeAllSessions(auth.userObjectId, 'logout_all');
  await recordAudit(rc, {
    action: 'auth.logout_all',
    entityType: 'user',
    entityId: auth.userObjectId,
    summary: `${auth.name} signed out of all sessions`,
  });
}

export async function getSession(rc: RequestContext): Promise<SessionDto> {
  const auth = requireAuth(rc);
  return { user: await loadUserDto(auth.userId), permissions: auth.permissions };
}

/** Changes the password, signs out every other session and returns a fresh session for this one. */
export async function changePassword(
  rc: RequestContext,
  input: ChangePasswordInput,
): Promise<LoginResult> {
  const auth = requireAuth(rc);
  const user = await User.findById(auth.userObjectId).select('+passwordHash');
  if (!user?.passwordHash) throw new UnauthenticatedError();
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new ValidationError(
      [{ location: 'body', path: 'currentPassword', message: 'Current password is incorrect' }],
      'Current password is incorrect',
    );
  }
  await User.updateOne(
    { _id: user._id },
    {
      $set: { passwordHash: await hashPassword(input.newPassword), passwordChangedAt: new Date() },
    },
  );
  const tokenVersion = await revokeAllSessions(user._id, 'password_changed');
  await recordAudit(rc, {
    action: 'auth.password_changed',
    entityType: 'user',
    entityId: user._id,
    summary: `${user.name} changed their password`,
  });
  await sendEmail({ to: user.email, ...emailTemplates.passwordChanged(user.name) });
  const issued = await issueSession({ _id: user._id, tokenVersion }, rc);
  return { ...issued, session: await buildSession(user._id.toString(), tokenVersion) };
}

/** Always succeeds from the caller's view so the endpoint cannot be used to discover accounts. */
export async function forgotPassword(rc: RequestContext, email: string): Promise<void> {
  const user = await User.findOne({ email }).select('+passwordHash').lean();
  if (!user || user.status !== 'active') return;
  // Not-yet-activated accounts get a fresh invite instead of a reset link.
  await sendPasswordLink(user, user.passwordHash ? 'reset' : 'invite');
  await recordAudit(rc, {
    action: 'auth.password_reset_requested',
    entityType: 'user',
    entityId: user._id,
    actorId: user._id,
    summary: `Password ${user.passwordHash ? 'reset' : 'activation'} link requested for ${user.email}`,
  });
}

/** Completes an invite or reset: sets the password, unlocks the account and revokes old sessions. */
export async function resetPassword(
  rc: RequestContext,
  token: string,
  password: string,
): Promise<{ email: string }> {
  const now = new Date();
  // Claim the token atomically so it can only ever be used once.
  const claimed = await PasswordReset.findOneAndUpdate(
    { tokenHash: hashToken(token), usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { returnDocument: 'after' },
  ).lean();
  if (!claimed)
    throw new UnprocessableError('This link is invalid or has expired. Request a new one.');

  const user = await User.findById(claimed.userId).lean();
  if (!user || user.status !== 'active')
    throw new UnprocessableError('This account is not active.');

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash: await hashPassword(password),
        passwordChangedAt: now,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    },
  );
  await revokeAllSessions(user._id, 'password_changed');
  await recordAudit(rc, {
    action: claimed.purpose === 'invite' ? 'auth.account_activated' : 'auth.password_reset',
    entityType: 'user',
    entityId: user._id,
    actorId: user._id,
    summary:
      claimed.purpose === 'invite'
        ? `${user.name} activated their account`
        : `${user.name} reset their password`,
  });
  return { email: user.email };
}

export async function listLoginHistory(
  query: PaginationQuery & { userId?: string; success?: boolean },
): Promise<{ items: LoginHistoryDto[]; meta: PageMeta }> {
  const filter: Record<string, unknown> = {};
  if (query.userId) filter.userId = new Types.ObjectId(query.userId);
  if (query.success !== undefined) filter.success = query.success;
  if (query.q) filter.email = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const win = toPageWindow(query, ['createdAt'], { createdAt: -1, _id: -1 });
  const [docs, total] = await Promise.all([
    LoginHistory.find(filter).sort(win.sort).skip(win.skip).limit(win.limit).lean(),
    LoginHistory.countDocuments(filter),
  ]);
  return {
    items: docs.map((d) => ({
      id: d._id.toString(),
      email: d.email,
      success: d.success,
      reason: d.reason,
      ip: d.ip,
      userAgent: d.userAgent,
      createdAt: d.createdAt.toISOString(),
    })),
    meta: toPageMeta(query, total),
  };
}
