import { Router, type RequestHandler } from 'express';
import { sendNoContent, sendOk } from '../../core/http';
import { requestContext } from '../../core/rbac/context';
import * as mfa from './mfa.service';
import { finishSso, ssoDoneRedirect, ssoErrorRedirect, startSso } from '../security/sso.service';
import { REFRESH_COOKIE, cookieOptions } from './auth.controller';
import {
  mfaDisableSchema,
  mfaEnableSchema,
  mfaLoginSchema,
  mfaRegenerateSchema,
  mfaSetupSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from '@arihant/shared';
import { authenticate } from '../../middleware/auth';
import {
  authLimiter,
  loginLimiter,
  loginNetworkLimiter,
  refreshLimiter,
} from '../../middleware/rate-limit';
import { validate } from '../../middleware/validate';
import * as c from './auth.controller';

export const authRoutes = Router();

authRoutes.post(
  '/login',
  loginNetworkLimiter,
  loginLimiter,
  validate({ body: loginSchema }),
  c.loginHandler,
);
authRoutes.post('/login/mfa', authLimiter, validate({ body: mfaLoginSchema }), c.mfaLoginHandler);
authRoutes.get('/config', c.authConfigHandler);

/* Single sign-on (OpenID Connect): the browser is redirected to the provider and back. */
authRoutes.get('/sso/start', authLimiter, async (_req, res) => {
  try {
    res.redirect(302, await startSso());
  } catch (err) {
    res.redirect(
      302,
      ssoErrorRedirect(err instanceof Error ? err.message : 'Single sign-on failed'),
    );
  }
});
authRoutes.get('/sso/callback', authLimiter, async (req, res) => {
  try {
    const q = req.query as { code?: string; state?: string; error?: string };
    const result = await finishSso(requestContext(req), {
      code: typeof q.code === 'string' ? q.code : undefined,
      state: typeof q.state === 'string' ? q.state : undefined,
      error: typeof q.error === 'string' ? q.error : undefined,
    });
    // Only the refresh cookie is set here; the app then restores the session with /auth/refresh.
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions(result.refreshExpiresAt));
    res.redirect(302, ssoDoneRedirect());
  } catch (err) {
    res.redirect(
      302,
      ssoErrorRedirect(err instanceof Error ? err.message : 'Single sign-on failed'),
    );
  }
});

/* Two-step verification. Setup and enable also work during sign-in with an enrolment token. */
const optionalAuth: RequestHandler = (req, res, next) => {
  const body = req.body as { mfaToken?: unknown } | undefined;
  if (typeof body?.mfaToken === 'string') return next();
  return authenticate(req, res, next);
};
authRoutes.get('/mfa', authenticate, async (req, res) => {
  sendOk(res, await mfa.mfaStatus(requestContext(req)));
});
authRoutes.post(
  '/mfa/setup',
  authLimiter,
  validate({ body: mfaSetupSchema }),
  optionalAuth,
  c.mfaSetupHandler,
);
authRoutes.post(
  '/mfa/enable',
  authLimiter,
  validate({ body: mfaEnableSchema }),
  optionalAuth,
  c.mfaEnableHandler,
);
authRoutes.post(
  '/mfa/disable',
  authenticate,
  authLimiter,
  validate({ body: mfaDisableSchema }),
  async (req, res) => {
    await mfa.disable(requestContext(req), req.valid!.body as { password: string; code: string });
    sendNoContent(res);
  },
);
authRoutes.post(
  '/mfa/recovery-codes',
  authenticate,
  authLimiter,
  validate({ body: mfaRegenerateSchema }),
  async (req, res) => {
    sendOk(
      res,
      await mfa.regenerateRecoveryCodes(
        requestContext(req),
        (req.valid!.body as { code: string }).code,
      ),
    );
  },
);
authRoutes.post('/refresh', refreshLimiter, c.refreshHandler);
authRoutes.post('/logout', c.logoutHandler);
authRoutes.post('/logout-all', authenticate, c.logoutAllHandler);
authRoutes.get('/me', authenticate, c.meHandler);
authRoutes.post(
  '/change-password',
  authenticate,
  authLimiter,
  validate({ body: changePasswordSchema }),
  c.changePasswordHandler,
);
authRoutes.post(
  '/forgot-password',
  authLimiter,
  validate({ body: forgotPasswordSchema }),
  c.forgotPasswordHandler,
);
authRoutes.post(
  '/reset-password',
  authLimiter,
  validate({ body: resetPasswordSchema }),
  c.resetPasswordHandler,
);
