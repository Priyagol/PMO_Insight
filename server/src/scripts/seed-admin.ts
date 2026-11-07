/**
 * Bootstraps the system roles and the first Super Admin account.
 *
 *   SEED_ADMIN_EMAIL=... SEED_ADMIN_NAME=... SEED_ADMIN_EMPLOYEE_ID=... SEED_ADMIN_PASSWORD=... \
 *   npm run seed:admin -w server
 *
 * Idempotent: if the account exists it is left unchanged.
 */
import { passwordSchema } from '@arihant/shared';
import { z } from 'zod';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../config/db';
import { logger } from '../config/logger';
import { hashPassword } from '../core/auth/password';
import { ensureSystemRoles, getRoleIdByKey } from '../modules/roles/role.service';
import { User } from '../modules/users/user.model';

const input = z
  .object({
    SEED_ADMIN_EMAIL: z.email().toLowerCase(),
    SEED_ADMIN_NAME: z.string().min(2),
    SEED_ADMIN_EMPLOYEE_ID: z.string().min(1).default('ADMIN-001'),
    SEED_ADMIN_PASSWORD: passwordSchema,
  })
  .safeParse(process.env);

async function main(): Promise<void> {
  if (!input.success) {
    const issues = input.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Missing or invalid seed variables:\n${issues}`);
  }
  const cfg = input.data;
  await connectMongo(env.MONGO_URI);
  await ensureSystemRoles();
  logger.info('System roles ensured');

  const existing = await User.findOne({ email: cfg.SEED_ADMIN_EMAIL }).lean();
  if (existing) {
    logger.info({ email: cfg.SEED_ADMIN_EMAIL }, 'Admin account already exists; nothing to do');
    return;
  }
  await User.create({
    employeeId: cfg.SEED_ADMIN_EMPLOYEE_ID,
    name: cfg.SEED_ADMIN_NAME,
    email: cfg.SEED_ADMIN_EMAIL,
    passwordHash: await hashPassword(cfg.SEED_ADMIN_PASSWORD),
    passwordChangedAt: new Date(),
    roleIds: [await getRoleIdByKey('super_admin')],
    designation: 'System Administrator',
    status: 'active',
  });
  logger.info({ email: cfg.SEED_ADMIN_EMAIL }, 'Super Admin created');
}

main()
  .catch((err: unknown) => {
    logger.fatal({ err }, 'Admin seed failed');
    process.exitCode = 1;
  })
  .finally(() => void disconnectMongo());
