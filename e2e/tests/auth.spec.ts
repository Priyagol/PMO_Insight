import { expect, test } from '@playwright/test';
import { signIn, USERS } from './helpers';

test('rejects a wrong password with the server message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Work e-mail').fill('no-such-person@dev.arihant.local');
  await page.getByRole('textbox', { name: 'Password' }).fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText(/invalid email or password/i);
});

test('signs in, keeps the session on reload, and returns to the requested page', async ({
  page,
}) => {
  await page.goto('/my-tasks');
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel('Work e-mail').fill(USERS.developer);
  await page
    .getByRole('textbox', { name: 'Password' })
    .fill(process.env.E2E_DEV_PASSWORD ?? 'DevPass2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/my-tasks/);
  await page.reload();
  await expect(page).toHaveURL(/\/my-tasks/);
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).first()).toBeVisible();
});

// Developers may read the employee directory (department scope), but not the audit log or roles.
test('a developer cannot open the audit log or role administration', async ({ page }) => {
  await signIn(page, USERS.developer);
  const nav = page.getByRole('navigation', { name: 'Main navigation' }).first();
  await expect(nav.getByRole('link', { name: /Audit/ })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: /Roles/ })).toHaveCount(0);
  await page.goto('/admin/roles');
  await expect(page.getByText("You don't have access to this page")).toBeVisible();
  await page.goto('/admin/audit-logs');
  await expect(page.getByText("You don't have access to this page")).toBeVisible();
});
