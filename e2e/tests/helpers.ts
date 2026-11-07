import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** Synthetic DEV accounts created by the DEV seed (never real people). */
export const DEV_PASSWORD = process.env.E2E_DEV_PASSWORD ?? 'DevPass2026!';
export const USERS = {
  pm: 'dev-003@dev.arihant.local',
  developer: 'dev-008@dev.arihant.local',
} as const;
export const uniqueKey = (prefix: string) =>
  prefix + Math.random().toString(36).slice(2, 5).toUpperCase();

export async function signIn(page: Page, email: string, password = DEV_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Work e-mail').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** API session for fast test setup; the UI under test is still exercised through the browser. */
export async function apiSession(
  request: APIRequestContext,
  email: string,
  password: string = DEV_PASSWORD,
) {
  const res = await request.post('/api/v1/auth/login', { data: { email, password } });
  expect(res.status(), `login ${email}`).toBe(200);
  const body = await res.json();
  const headers = { Authorization: `Bearer ${body.data.accessToken}` };
  const me = body.data.user as { id: string; department?: { id: string } | null };
  const call = async <T>(
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    data?: unknown,
  ) => {
    const r = await request[method](`/api/v1${path}`, { headers, data });
    expect(
      r.ok(),
      `${method.toUpperCase()} ${path} -> ${r.status()} ${await r.text()}`,
    ).toBeTruthy();
    if (r.status() === 204) return undefined as T;
    return (await r.json()).data as T;
  };
  return { me, call };
}

export async function createProject(
  request: APIRequestContext,
  name: string,
  memberIds: string[] = [],
) {
  const pm = await apiSession(request, USERS.pm);
  const key = uniqueKey('E');
  // The PM's department gives approvals a department head (a PM cannot approve their own request).
  const today = new Date().toISOString().slice(0, 10);
  const project = await pm.call<{ id: string; key: string }>('post', '/projects', {
    key,
    name,
    managerId: pm.me.id,
    departmentId: pm.me.department?.id,
    memberIds,
    startDate: today,
  });
  return { project, pm };
}
