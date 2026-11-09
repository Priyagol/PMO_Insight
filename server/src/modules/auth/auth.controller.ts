import type { CookieOptions, Request, Response } from 'express';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  LoginResponse,
  ResetPasswordInput,
} from '@arihant/shared';
import { API_PREFIX } from '../../config/app';
import { cookieSecure } from '../../config/env';
import { sendNoContent, sendOk } from '../../core/http';
import { requestContext } from '../../core/rbac/context';
import { publicAuthConfig } from '../security/security.settings';
import * as auth from './auth.service';
import * as mfa from './mfa.service';

export const REFRESH_COOKIE = 'aw_rt';

/** HttpOnly, SameSite=Strict and scoped to the auth routes: unreadable by scripts, never sent elsewhere. */
function cookieOptions(expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'strict',
    path: `${API_PREFIX}/auth`,
    ...(expires ? { expires } : {}),
  };
}

/**
 * Each browser tab sends its own id in this header and gets its own refresh cookie, so a new
 * tab or window starts signed out and different people can work in different tabs. Per-tab
 * cookies last only for the browser session. Requests without the header (single sign-on
 * callback, API clients) use the shared cookie.
 */
export const TAB_HEADER = 'x-session-tab';
const TAB_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function sessionTab(req: Request): string | null {
  const v = req.get(TAB_HEADER);
  return v && TAB_ID.test(v) ? v : null;
}

const cookieName = (tab: string | null) => (tab ? `${REFRESH_COOKIE}_${tab}` : REFRESH_COOKIE);
const readCookie = (req: Request, name: string): string | undefined => {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : undefined;
};

/** Sets the refresh cookie for this tab (a browser-session cookie) or the shared one. */
export function setRefreshCookie(
  req: Request,
  res: Response,
  result: { refreshToken: string; refreshExpiresAt: Date },
): void {
  const tab = sessionTab(req);
  res.cookie(
    cookieName(tab),
    result.refreshToken,
    cookieOptions(tab ? undefined : result.refreshExpiresAt),
  );
}

function clearRefreshCookie(req: Request, res: Response): void {
  res.clearCookie(cookieName(sessionTab(req)), cookieOptions());
}

function respondWithSession(req: Request, res: Response, result: auth.LoginResult): void {
  setRefreshCookie(req, res, result);
  const body: LoginResponse = { accessToken: result.accessToken, ...result.session };
  sendOk(res, body);
}

const presentedToken = (req: Request): string | undefined =>
  readCookie(req, cookieName(sessionTab(req)));

export async function loginHandler(req: Request, res: Response): Promise<void> {
  const outcome = await auth.login(requestContext(req), req.valid!.body as LoginInput);
  if (outcome.kind === 'mfa') {
    // No session yet: the second step completes the sign-in.
    sendOk(res, {
      mfaRequired: outcome.purpose,
      mfaToken: outcome.mfaToken,
      expiresInSeconds: outcome.expiresInSeconds,
    });
    return;
  }
  respondWithSession(req, res, outcome);
}

export async function mfaLoginHandler(req: Request, res: Response): Promise<void> {
  const { mfaToken, code } = req.valid!.body as { mfaToken: string; code: string };
  respondWithSession(req, res, await auth.loginWithMfa(requestContext(req), mfaToken, code));
}

export async function mfaSetupHandler(req: Request, res: Response): Promise<void> {
  const { mfaToken } = req.valid!.body as { mfaToken?: string };
  sendOk(res, await mfa.startSetup(requestContext(req), mfaToken));
}

export async function mfaEnableHandler(req: Request, res: Response): Promise<void> {
  const { code, mfaToken } = req.valid!.body as { code: string; mfaToken?: string };
  const rc = requestContext(req);
  if (mfaToken) {
    const { recoveryCodes, result } = await auth.enrollAndLogin(rc, mfaToken, code);
    setRefreshCookie(req, res, result);
    sendOk(res, { recoveryCodes, session: { accessToken: result.accessToken, ...result.session } });
    return;
  }
  const { recoveryCodes } = await mfa.enable(rc, code);
  sendOk(res, { recoveryCodes });
}

/** Lets the sign-in page show single sign-on before anyone is signed in. */
export async function authConfigHandler(_req: Request, res: Response): Promise<void> {
  sendOk(res, await publicAuthConfig());
}

export { cookieOptions, respondWithSession };

export async function refreshHandler(req: Request, res: Response): Promise<void> {
  // A tab with no session of its own takes over a shared one once (after single sign-on, or a
  // sign-in from before per-tab sessions). The shared cookie is then removed, so other tabs
  // still have to sign in.
  let token = presentedToken(req);
  const tab = sessionTab(req);
  if (!token && tab) {
    token = readCookie(req, REFRESH_COOKIE);
    if (token) res.clearCookie(REFRESH_COOKIE, cookieOptions());
  }
  try {
    respondWithSession(req, res, await auth.refresh(requestContext(req), token));
  } catch (err) {
    clearRefreshCookie(req, res);
    throw err;
  }
}

export async function logoutHandler(req: Request, res: Response): Promise<void> {
  await auth.logout(requestContext(req), presentedToken(req));
  clearRefreshCookie(req, res);
  sendNoContent(res);
}

export async function logoutAllHandler(req: Request, res: Response): Promise<void> {
  await auth.logoutAll(requestContext(req));
  clearRefreshCookie(req, res);
  sendNoContent(res);
}

export async function meHandler(req: Request, res: Response): Promise<void> {
  sendOk(res, await auth.getSession(requestContext(req)));
}

export async function changePasswordHandler(req: Request, res: Response): Promise<void> {
  respondWithSession(
    req,
    res,
    await auth.changePassword(requestContext(req), req.valid!.body as ChangePasswordInput),
  );
}

export async function forgotPasswordHandler(req: Request, res: Response): Promise<void> {
  await auth.forgotPassword(requestContext(req), (req.valid!.body as ForgotPasswordInput).email);
  sendOk(res, { message: 'If an account exists for this e-mail, a link has been sent.' });
}

export async function resetPasswordHandler(req: Request, res: Response): Promise<void> {
  const { token, password } = req.valid!.body as ResetPasswordInput;
  const result = await auth.resetPassword(requestContext(req), token, password);
  sendOk(res, { message: 'Your password has been set. You can now sign in.', email: result.email });
}
