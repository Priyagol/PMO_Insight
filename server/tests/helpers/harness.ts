import type { Express } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { SystemRole } from '@arihant/shared';
import { createApp } from '../../src/app';
import type { MailMessage } from '../../src/config/mail';
import { connectMongo, disconnectMongo } from '../../src/config/db';
import { hashPassword } from '../../src/core/auth/password';
import { Department } from '../../src/modules/departments/department.model';
import { ensureSystemRoles, getRoleIdByKey } from '../../src/modules/roles/role.service';
import { User } from '../../src/modules/users/user.model';
import { setEmailTransport } from '../../src/services/email';
import { eventBus } from '../../src/core/events';
import { registerNotificationSubscribers } from '../../src/modules/notifications/notification.subscribers';
import { registerAutomationSubscribers } from '../../src/modules/automations/automation.engine';
import { setStorageDriver } from '../../src/services/storage';
import { executePlan, setPlanDispatcher } from '../../src/modules/assignment/assignment.service';

/** In-memory object storage for tests. */
export const storedObjects = new Map<string, { body: Buffer; type: string }>();

export const PASSWORD = 'Str0ngPassw0rd';

export interface Harness {
  app: Express;
  emails: MailMessage[];
}

/**
 * Per-file test harness: in-memory MongoDB replica set, real Express app, captured e-mails.
 * Collections are wiped before each test and system roles re-created.
 */
export function useHarness(): Harness {
  const h = { emails: [] as MailMessage[] } as Harness;
  let replSet: MongoMemoryReplSet;
  let stopNotifications: (() => void) | undefined;
  let stopAutomations: (() => void) | undefined;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await connectMongo(replSet.getUri('arihant_test'));
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    h.app = createApp({ readinessChecks: {} });
    // Approved plans execute inline (production uses the BullMQ worker).
    setPlanDispatcher(async (planId) => {
      await executePlan(planId);
    });
    setStorageDriver({
      put: async (key, body, type) => {
        storedObjects.set(key, { body, type });
      },
      signedDownloadUrl: async (key) => 'https://storage.test/' + key + '?signed=1',
      remove: async (key) => {
        storedObjects.delete(key);
      },
    });
    setEmailTransport(async (m) => {
      h.emails.push(m);
    });
    stopNotifications = registerNotificationSubscribers();
    stopAutomations = registerAutomationSubscribers();
  });

  beforeEach(async () => {
    // Let notifications from the previous test finish before wiping the database.
    await eventBus.settle();
    h.emails.length = 0;
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
    await ensureSystemRoles();
  });

  afterAll(async () => {
    await eventBus.settle();
    stopNotifications?.();
    stopAutomations?.();
    setEmailTransport(null);
    setStorageDriver(null);
    await disconnectMongo();
    await replSet?.stop();
  });

  return h;
}

let seq = 0;

export async function createDepartment(code: string, name = `${code} Department`) {
  return Department.create({ code, name });
}

/** Inserts an active user with a password directly (bypassing the invite flow). */
export async function createUser(opts: {
  role: SystemRole | SystemRole[];
  email?: string;
  name?: string;
  departmentId?: mongoose.Types.ObjectId | null;
  managerId?: mongoose.Types.ObjectId | null;
  status?: 'active' | 'inactive' | 'terminated';
  password?: string | null;
}) {
  seq += 1;
  const roles = Array.isArray(opts.role) ? opts.role : [opts.role];
  return User.create({
    employeeId: `T-${seq}`,
    name: opts.name ?? `Test User ${seq}`,
    email: opts.email ?? `user${seq}@example.test`,
    passwordHash: opts.password === null ? null : await hashPassword(opts.password ?? PASSWORD),
    roleIds: await Promise.all(roles.map(getRoleIdByKey)),
    departmentId: opts.departmentId ?? null,
    managerId: opts.managerId ?? null,
    status: opts.status ?? 'active',
  });
}

export interface LoggedIn {
  token: string;
  cookie: string;
  body: Record<string, unknown> & { permissions: Record<string, string> };
}

export async function login(app: Express, email: string, password = PASSWORD): Promise<LoggedIn> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200)
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = setCookie.find((c) => c.startsWith('aw_rt='))!.split(';')[0]!;
  return { token: res.body.data.accessToken, cookie, body: res.body.data };
}

/** Logs in a freshly created user with the given role. */
export async function loginAs(
  app: Express,
  role: SystemRole,
  extra: Parameters<typeof createUser>[0] extends infer T ? Partial<T> : never = {},
) {
  const user = await createUser({ role, ...extra });
  const session = await login(app, user.email);
  return { user, ...session, auth: { Authorization: `Bearer ${session.token}` } };
}

/** Extracts the token from the most recent invite/reset e-mail. */
export function tokenFromEmail(emails: MailMessage[]): string {
  const last = emails[emails.length - 1];
  const match = last?.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('No token link in captured e-mails');
  return decodeURIComponent(match[1]!);
}
