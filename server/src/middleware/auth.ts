import type { RequestHandler } from 'express';
import type { Permission, Scope } from '@arihant/shared';
import { verifyAccessToken } from '../core/auth/jwt';
import { ForbiddenError, UnauthenticatedError } from '../core/errors';
import { loadAuthContext } from '../core/rbac/context';
import { can } from '../core/rbac/policy';
import { API_PREFIX } from '../config/app';
import { TOKEN_PREFIX, authenticateApiToken } from '../modules/security/api-token.service';

/** Requires a valid bearer access token and an active account; sets `req.auth`. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) throw new UnauthenticatedError();
  const presented = header.slice(7).trim();
  if (presented.startsWith(TOKEN_PREFIX)) {
    // Personal API token: never for account settings; read tokens only read.
    if (req.originalUrl.startsWith(`${API_PREFIX}/auth`))
      throw new ForbiddenError('API tokens cannot be used for account settings');
    const { auth, scope } = await authenticateApiToken(presented, req.ip);
    if (scope === 'read' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method))
      throw new ForbiddenError('This API token can only read');
    req.auth = auth;
    req.apiTokenScope = scope;
    return next();
  }
  const claims = verifyAccessToken(presented);
  req.auth = await loadAuthContext(claims.sub, claims.tv);
  next();
};

/**
 * Requires a permission (optionally at a minimum scope). Resource-level scoping
 * (which records) is applied inside services via the policy helpers.
 */
export function authorize(permission: Permission, minScope: Scope = 'own'): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw new UnauthenticatedError();
    if (!can(req.auth, permission, minScope)) throw new ForbiddenError();
    next();
  };
}

/** Passes if the user holds any one of the permissions. */
export function authorizeAny(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw new UnauthenticatedError();
    if (!permissions.some((p) => can(req.auth!, p))) throw new ForbiddenError();
    next();
  };
}
