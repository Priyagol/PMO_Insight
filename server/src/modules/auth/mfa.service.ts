import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Types } from 'mongoose';
import {
  mfaCodeSchema,
  roleRequiresMfa,
  type MfaEnabledDto,
  type MfaSetupDto,
  type MfaStatusDto,
} from '@arihant/shared';
import { env } from '../../config/env';
import { verifyPassword } from '../../core/auth/password';
import { hashToken } from '../../core/auth/tokens';
import {
  generateTotpSecret,
  openSecret,
  otpauthUrl,
  sealSecret,
  verifyTotp,
} from '../../core/auth/totp';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  UnprocessableError,
} from '../../core/errors';
import { can } from '../../core/rbac/policy';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { recordAudit } from '../audit/audit.service';
import { Role } from '../roles/role.model';
import { securitySettings } from '../security/security.settings';
import { User, type IUser } from '../users/user.model';

/*
 * Two-step verification. After a correct password, sign-in returns a short-lived "mfa token"
 * instead of a session; the session is issued only after a valid authenticator or recovery code.
 * When the security settings require two-step verification for the person's role and they have
 * not set it up, the mfa token lets them enrol first.
 */

const ISSUER = 'arihant-workspace';
const AUDIENCE = 'arihant-workspace-mfa';
const MFA_TOKEN_SECONDS = 300;
const RECOVERY_CODES = 10;

export type MfaPurpose = 'verify' | 'enroll';

export function signMfaToken(
  user: Pick<IUser, '_id' | 'tokenVersion'>,
  purpose: MfaPurpose,
): string {
  return jwt.sign(
    { sub: user._id.toString(), tv: user.tokenVersion, purpose },
    env.JWT_ACCESS_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: MFA_TOKEN_SECONDS,
      issuer: ISSUER,
      audience: AUDIENCE,
    },
  );
}
export const MFA_TOKEN_TTL = MFA_TOKEN_SECONDS;

export function readMfaToken(token: string, purpose: MfaPurpose): { userId: string; tv: number } {
  try {
    const d = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof d !== 'object' || d.purpose !== purpose || typeof d.sub !== 'string')
      throw new Error('bad');
    return { userId: d.sub, tv: Number(d.tv) };
  } catch {
    throw new UnauthenticatedError('The sign-in step has expired. Sign in again.');
  }
}

/** Whether the security settings require two-step verification for this person. */
export async function mfaRequiredFor(user: Pick<IUser, 'roleIds'>): Promise<boolean> {
  const s = await securitySettings();
  if (!s.mfaRequiredRoles.length) return false;
  const roles = await Role.find({ _id: { $in: user.roleIds } })
    .select('key')
    .lean();
  return roleRequiresMfa(
    roles.map((r) => r.key),
    s.mfaRequiredRoles,
  );
}

const withMfa = (id: string | Types.ObjectId) => User.findById(id).select('+mfa +passwordHash');

function newRecoveryCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: RECOVERY_CODES }, () => {
    const s = randomBytes(5).toString('hex').slice(0, 8);
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  return { plain, hashes: plain.map((c) => hashToken(c.replace('-', ''))) };
}

export async function mfaStatus(rc: RequestContext): Promise<MfaStatusDto> {
  const auth = requireAuth(rc);
  const user = await withMfa(auth.userId).lean();
  if (!user) throw new NotFoundError('User');
  return {
    enabled: Boolean(user.mfa?.enabled),
    enabledAt: user.mfa?.enabledAt?.toISOString() ?? null,
    recoveryCodesLeft: user.mfa?.recoveryCodeHashes.length ?? 0,
    required: await mfaRequiredFor(user),
  };
}

/** Resolves who is enrolling: the signed-in user, or the holder of an enrolment mfa token. */
async function enrollingUser(rc: RequestContext, mfaToken?: string) {
  const id = mfaToken ? readMfaToken(mfaToken, 'enroll').userId : requireAuth(rc).userId;
  const user = await withMfa(id);
  if (!user || user.status !== 'active') throw new UnauthenticatedError();
  return user;
}

export async function startSetup(rc: RequestContext, mfaToken?: string): Promise<MfaSetupDto> {
  const user = await enrollingUser(rc, mfaToken);
  if (user.mfa?.enabled) throw new ConflictError('Two-step verification is already on');
  const secret = generateTotpSecret();
  await User.updateOne({ _id: user._id }, { $set: { 'mfa.pendingSecretEnc': sealSecret(secret) } });
  return { secret, otpauthUrl: otpauthUrl(secret, user.email, 'Arihant Workspace') };
}

/** Confirms enrolment with a code from the app; returns one-time recovery codes. */
export async function enable(
  rc: RequestContext,
  code: string,
  mfaToken?: string,
): Promise<{ recoveryCodes: string[]; user: IUser }> {
  const user = await enrollingUser(rc, mfaToken);
  if (user.mfa?.enabled) throw new ConflictError('Two-step verification is already on');
  const pending = user.mfa?.pendingSecretEnc;
  if (!pending) throw new UnprocessableError('Start the setup again');
  const secret = openSecret(pending);
  const step = verifyTotp(secret, code, null);
  if (step === null)
    throw new UnprocessableError(
      'That code is not correct. Check the time on your phone and try again.',
    );
  const codes = newRecoveryCodes();
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        mfa: {
          enabled: true,
          secretEnc: pending,
          pendingSecretEnc: null,
          enabledAt: new Date(),
          lastUsedStep: step,
          recoveryCodeHashes: codes.hashes,
        },
      },
    },
  );
  await recordAudit(rc, {
    action: 'auth.mfa_enabled',
    entityType: 'user',
    entityId: user._id,
    actorId: user._id,
    summary: `${user.name} turned on two-step verification`,
  });
  return { recoveryCodes: codes.plain, user: user.toObject() };
}

/**
 * Checks a sign-in code (authenticator or recovery). Wrong codes count towards the account lockout.
 * Returns how it was verified.
 */
export async function checkCode(
  rc: RequestContext,
  userId: string,
  rawCode: string,
): Promise<'totp' | 'recovery'> {
  const code = mfaCodeSchema.parse(rawCode);
  const user = await withMfa(userId);
  if (!user?.mfa?.enabled || !user.mfa.secretEnc) throw new UnauthenticatedError();
  if (user.lockedUntil && user.lockedUntil > new Date())
    throw new UnauthenticatedError('Too many failed attempts. Try again later.');
  if (/^\d{6}$/.test(code)) {
    const step = verifyTotp(openSecret(user.mfa.secretEnc), code, user.mfa.lastUsedStep ?? null);
    if (step !== null) {
      // Conditional update: the same code cannot be used twice, even in parallel.
      const ok = await User.updateOne(
        {
          _id: user._id,
          $or: [{ 'mfa.lastUsedStep': null }, { 'mfa.lastUsedStep': { $lt: step } }],
        },
        { $set: { 'mfa.lastUsedStep': step, failedLoginCount: 0 } },
      );
      if (ok.modifiedCount) return 'totp';
    }
  } else {
    const hash = hashToken(code.replace('-', '').toLowerCase());
    const ok = await User.updateOne(
      { _id: user._id, 'mfa.recoveryCodeHashes': hash },
      { $pull: { 'mfa.recoveryCodeHashes': hash }, $set: { failedLoginCount: 0 } },
    );
    if (ok.modifiedCount) {
      await recordAudit(rc, {
        action: 'auth.mfa_recovery_code_used',
        entityType: 'user',
        entityId: user._id,
        actorId: user._id,
        summary: `${user.name} signed in with a recovery code (${user.mfa.recoveryCodeHashes.length - 1} left)`,
      });
      return 'recovery';
    }
  }
  const updated = await User.findOneAndUpdate(
    { _id: user._id },
    { $inc: { failedLoginCount: 1 } },
    { returnDocument: 'after' },
  )
    .select('failedLoginCount')
    .lean();
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
  }
  throw new UnauthenticatedError('That code is not correct');
}

export async function disable(
  rc: RequestContext,
  input: { password: string; code: string },
): Promise<void> {
  const auth = requireAuth(rc);
  const user = await withMfa(auth.userId);
  if (!user?.mfa?.enabled) throw new UnprocessableError('Two-step verification is not on');
  if (await mfaRequiredFor(user))
    throw new ForbiddenError('Two-step verification is required for your role');
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.password)))
    throw new UnauthenticatedError('The password is not correct');
  await checkCode(rc, auth.userId, input.code);
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        mfa: {
          enabled: false,
          secretEnc: null,
          pendingSecretEnc: null,
          enabledAt: null,
          lastUsedStep: null,
          recoveryCodeHashes: [],
        },
      },
    },
  );
  await recordAudit(rc, {
    action: 'auth.mfa_disabled',
    entityType: 'user',
    entityId: user._id,
    summary: `${user.name} turned off two-step verification`,
  });
}

export async function regenerateRecoveryCodes(
  rc: RequestContext,
  code: string,
): Promise<MfaEnabledDto> {
  const auth = requireAuth(rc);
  await checkCode(rc, auth.userId, code);
  const codes = newRecoveryCodes();
  await User.updateOne(
    { _id: auth.userObjectId },
    { $set: { 'mfa.recoveryCodeHashes': codes.hashes } },
  );
  await recordAudit(rc, {
    action: 'auth.mfa_recovery_codes_regenerated',
    entityType: 'user',
    entityId: auth.userObjectId,
    summary: `${auth.name} created new recovery codes`,
  });
  return { recoveryCodes: codes.plain };
}

/** Administrators reset two-step verification for someone who lost their phone. */
export async function adminReset(rc: RequestContext, userId: string): Promise<void> {
  const auth = requireAuth(rc);
  if (!can(auth, 'user:manage', 'org')) throw new ForbiddenError();
  const user = await withMfa(userId);
  if (!user) throw new NotFoundError('User');
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        mfa: {
          enabled: false,
          secretEnc: null,
          pendingSecretEnc: null,
          enabledAt: null,
          lastUsedStep: null,
          recoveryCodeHashes: [],
        },
      },
      // Sign the person out everywhere.
      $inc: { tokenVersion: 1 },
    },
  );
  await recordAudit(rc, {
    action: 'auth.mfa_reset_by_admin',
    entityType: 'user',
    entityId: user._id,
    summary: `${auth.name} reset two-step verification for ${user.name}`,
  });
}
