import { createHash, randomBytes } from 'node:crypto';

/** Cryptographically random opaque token (refresh tokens, reset/invite links). */
export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

/** Only hashes are stored, so a database leak does not expose usable tokens. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
