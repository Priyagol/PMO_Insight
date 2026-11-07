import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '../../config/env';

/*
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 30-second steps, 6 digits), the format used
 * by Microsoft Authenticator, Google Authenticator and similar apps. Implemented with Node's crypto
 * so no extra dependency handles secrets.
 */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 encoded. */
export const generateTotpSecret = () => base32Encode(randomBytes(20));

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / TOTP_STEP_SECONDS);

export function totpAt(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return bin.toString().padStart(6, '0');
}

/**
 * Returns the matching step (one step of clock drift either way), or null. Steps at or before
 * `lastUsedStep` are refused so a code cannot be replayed.
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  lastUsedStep: number | null,
  now = Date.now(),
): number | null {
  const step = currentStep(now);
  for (const s of [step, step - 1, step + 1]) {
    if (lastUsedStep !== null && s <= lastUsedStep) continue;
    const expected = Buffer.from(totpAt(secretB32, s));
    const given = Buffer.from(code.padStart(6, '0').slice(0, 6));
    if (expected.length === given.length && timingSafeEqual(expected, given)) return s;
  }
  return null;
}

export function otpauthUrl(secretB32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ---------- Secrets at rest (AES-256-GCM) ---------- */

/** Key from DATA_ENCRYPTION_KEY (32 bytes, base64), else derived from JWT_ACCESS_SECRET. */
function key(): Buffer {
  if (env.DATA_ENCRYPTION_KEY) return Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
  return Buffer.from(
    hkdfSync('sha256', env.JWT_ACCESS_SECRET, 'arihant-workspace', 'secret-box', 32),
  );
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    enc.toString('base64'),
  ].join('.');
}

export function openSecret(sealed: string): string {
  const [v, iv, tag, enc] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Unknown secret format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
