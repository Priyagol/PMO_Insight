import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id with the library defaults (m=19 MiB, t=2, p=1), matching the OWASP minimum
 * recommendation. Parameters are embedded in each hash, so they can be raised later
 * without invalidating existing passwords.
 */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// A real hash of a random string. Verifying against it when the account does not exist
// keeps login timing similar for known and unknown e-mail addresses.
let dummyHash: Promise<string> | null = null;
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hash(`dummy-${Math.random()}-${Date.now()}`);
  await verify(await dummyHash, password).catch(() => false);
  return false;
}
