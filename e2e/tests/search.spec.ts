import { expect, test } from '@playwright/test';
import { apiSession, createProject, signIn, USERS } from './helpers';

test('a project manager searches with the query language, saves a filter and opens it on the board', async ({
  page,
  request,
}) => {
  const dev = await apiSession(request, USERS.developer);
  const { project, pm } = await createProject(request, 'DEV E2E Search', [dev.me.id]);
  const bug = await pm.call<{ id: string; key: string }>('post', '/tasks', {
    projectId: project.id,
    title: 'DEV E2E crash on login',
    type: 'bug',
    bug: { severity: 'major' },
    priority: 'critical',
  });
  await pm.call('post', '/tasks', {
    projectId: project.id,
    title: 'DEV E2E export',
    priority: 'low',
  });

  await signIn(page, USERS.pm);
  await page.goto('/search');
  const box = page.getByRole('textbox', { name: 'Query' });
  await box.fill('projct = X');
  await expect(page.getByRole('alert')).toContainText('Unknown field "projct"');

  await box.fill(`project = ${project.key} AND priority >= high`);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('1 task', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'DEV E2E crash on login' })).toBeVisible();

  await page.getByRole('button', { name: 'Save as filter' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save filter' });
  const filterName = `DEV E2E ${project.key} urgent`;
  await dialog.getByLabel('Name').fill(filterName);
  await dialog.getByRole('button', { name: 'Save filter' }).click();
  await expect(page.getByRole('region', { name: 'Saved filters' })).toContainText(filterName);

  await page.getByRole('button', { name: 'Open on board' }).click();
  await expect(page).toHaveURL(/\/tasks\/board\?aql=/);
  await expect(page.getByRole('group', { name: 'Quick filters' })).toContainText(
    'priority >= high',
  );
  await expect(page.getByText(bug.key)).toBeVisible();
  await expect(page.getByText('DEV E2E export')).toHaveCount(0);

  // Tidy up the saved filter.
  const filters = await pm.call<{ id: string; name: string }[]>('get', '/filters');
  const mine = filters.find((f) => f.name === filterName);
  if (mine) await pm.call('delete', `/filters/${mine.id}`);
});
