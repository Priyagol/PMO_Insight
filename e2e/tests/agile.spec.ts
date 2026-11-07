import { expect, test } from '@playwright/test';
import { apiSession, createProject, signIn, USERS } from './helpers';

test('a project manager plans a sprint from the backlog and starts it', async ({
  page,
  request,
}) => {
  const dev = await apiSession(request, USERS.developer);
  const { project, pm } = await createProject(request, 'DEV E2E Agile', [dev.me.id]);
  const story = await pm.call<{ id: string; key: string }>('post', '/tasks', {
    projectId: project.id,
    title: 'DEV E2E upload KYC documents',
    type: 'story',
    storyPoints: 5,
  });

  await signIn(page, USERS.pm);
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('tab', { name: 'Backlog & sprints' }).click();
  const backlog = page.getByRole('region', { name: 'Backlog' });
  await expect(backlog).toContainText(story.key);
  await expect(backlog).toContainText('5 pts');

  await page.getByRole('button', { name: 'New sprint' }).click();
  const sprintName = `${project.key} Sprint 1`;
  const sprint = page.getByRole('region', { name: sprintName });
  await expect(sprint).toBeVisible();

  await backlog.getByRole('combobox', { name: `Sprint for ${story.key}` }).click();
  await page.getByRole('option', { name: sprintName }).click();
  await expect(sprint).toContainText(story.key);
  await expect(sprint).toContainText('0/5 pts done');

  await sprint.getByRole('button', { name: 'Start' }).click();
  const dialog = page.getByRole('dialog', { name: `Start ${sprintName}` });
  await expect(dialog).toContainText('1 task(s), 5 story point(s)');
  await dialog.getByLabel('Sprint goal').fill('DEV E2E goal');
  await dialog.getByRole('button', { name: 'Start sprint' }).click();
  await expect(sprint).toContainText('Running');
  await expect(sprint).toContainText('committed 5');

  // The task drawer shows the agile fields.
  await sprint.getByRole('button', { name: new RegExp(story.key) }).click();
  await expect(page.getByRole('combobox', { name: 'Type', exact: true })).toContainText('Story');
  await expect(page.getByLabel('Story points', { exact: true })).toHaveValue('5');
  await expect(page.getByRole('combobox', { name: 'Sprint', exact: true })).toContainText(
    `${sprintName} (running)`,
  );
});
