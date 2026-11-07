import { expect, test } from '@playwright/test';
import { apiSession, signIn, uniqueKey, USERS } from './helpers';

test('a project manager creates a project and a task through the UI', async ({ page, request }) => {
  await signIn(page, USERS.pm);
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  const key = uniqueKey('E');
  await dialog.getByLabel('Key').fill(key);
  await dialog.getByLabel('Project name').fill('DEV E2E Project');
  await dialog.getByRole('button', { name: 'Create project' }).click();

  await expect(page).toHaveURL(/\/projects\/[0-9a-f]{24}/);
  await expect(page.getByRole('heading', { name: /DEV E2E Project/ })).toBeVisible();

  await page.getByRole('tab', { name: /Tasks/ }).click();
  await page.getByRole('button', { name: 'New task' }).first().click();
  const taskDialog = page.getByRole('dialog', { name: 'New task' });
  await taskDialog.getByLabel('Title').fill('DEV E2E prepare test data');
  await taskDialog.getByLabel('Estimate (h)').fill('3');
  await taskDialog.getByRole('button', { name: 'Create task' }).click();
  await expect(taskDialog).toBeHidden();
  await expect(page.getByText('DEV E2E prepare test data').first()).toBeVisible();

  // The task is stored with the project key (checked through the API, not the UI).
  const pm = await apiSession(request, USERS.pm);
  const tasks = await pm.call<{ key: string; title: string }[]>(
    'get',
    `/tasks?q=${encodeURIComponent('DEV E2E prepare test data')}&limit=5`,
  );
  expect(tasks.some((t) => t.key.startsWith(`${key}-`))).toBeTruthy();
});
