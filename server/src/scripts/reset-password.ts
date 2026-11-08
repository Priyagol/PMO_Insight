/**
 * Sets a new password for an existing account (for example a forgotten Super Admin password
 * when email is not configured). Run on the server that can reach the database:
 *
 *   RESET_EMAIL=... RESET_PASSWORD=... npm run reset:password -w server
 *
 * Clears any lockout and signs the account out of every existing session.
 */
import { passwordSchema } from '@arihant/shared';
import { z } from 'zod';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../config/db';
import { logger } from '../config/logger';
import { hashPassword } from '../core/auth/password';
import { User } from '../modules/users/user.model';

const input = z
  .object({
    RESET_EMAIL: z.email().toLowerCase(),
    RESET_PASSWORD: passwordSchema,
  })
  .safeParse(process.env);

async function main(): Promise<void> {
  if (!input.success) {
    const issues = input.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Missing or invalid variables:\n${issues}`);
  }
  const { RESET_EMAIL, RESET_PASSWORD } = input.data;
  await connectMongo(env.MONGO_URI);
  const res = await User.updateOne(
    { email: RESET_EMAIL, deletedAt: null },
    {
      $set: {
        passwordHash: await hashPassword(RESET_PASSWORD),
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
      $inc: { tokenVersion: 1 },
    },
  );
  if (res.matchedCount === 0) throw new Error(`No active account with email ${RESET_EMAIL}`);
  logger.info({ email: RESET_EMAIL }, 'Password reset');
}

main()
  .catch((err: unknown) => {
    logger.error({ err }, 'Password reset failed');
    process.exitCode = 1;
  })
  .finally(() => void disconnectMongo());
