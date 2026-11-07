import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env';
import { UnauthenticatedError } from '../errors';

/** Claims carried by short-lived access tokens. Permissions are resolved server-side per request. */
export interface AccessTokenClaims {
  sub: string;
  /** User.tokenVersion; bumping it invalidates every outstanding access token. */
  tv: number;
}

const ISSUER = 'arihant-workspace';
const AUDIENCE = 'arihant-workspace-api';

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (
      typeof decoded !== 'object' ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.tv !== 'number'
    ) {
      throw new UnauthenticatedError('Malformed access token');
    }
    return { sub: decoded.sub, tv: decoded.tv };
  } catch (err) {
    if (err instanceof UnauthenticatedError) throw err;
    if (err instanceof jwt.TokenExpiredError)
      throw new UnauthenticatedError('Access token expired');
    throw new UnauthenticatedError('Invalid access token');
  }
}
