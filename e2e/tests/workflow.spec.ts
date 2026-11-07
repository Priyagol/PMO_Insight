import { expect, test } from '@playwright/test';
import { apiSession, createProject, signIn, USERS } from './helpers';

test('a project manager switches a project to a custom workflow and moves a task with a comment', async ({
  page,
  request,
}) => {
  const dev = await apiSession(request, USERS.developer);
  const { project, pm } = await createProject(request, 'DEV E2E Workflow', [dev.me.id]);
  const workflowName = `DEV E2E ${project.key} review`;
  // Workflows are maintained by department heads and above. The DEV administrator's sign-in is
  // read from the environment (never stored in the repository); without it this test is skipped.
  const adminEmail = process.env.E2E_ADMIN_EMAIL;
  const adminPassword = process.env.E2E_ADMIN_PASSWORD;
  test.skip(!adminEmail || !adminPassword, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run');
  const admin = await apiSession(request, adminEmail!, adminPassword!);
  const wf = await admin.call<{ id: string }>('post', '/workflows', {
    name: workflowName,
    definition: {
      statuses: ['todo', 'in_progress', 'in_review', 'done'],
      labels: { in_review: 'Code review' },
      transitions: [
        { id: 'start', name: 'Start work', from: ['todo'], to: 'in_progress' },
        {
          id: 'review',
          name: 'Send to code review',
          from: ['in_progress'],
          to: 'in_review',
          requireComment: true,
        },
        { id: 'accept', name: 'Accept', from: ['in_review'], to: 'done' },
      ],
    },
  });
  const task = await pm.call<{ id: string; key: string }>('post', '/tasks', {
    projectId: project.id,
    title: 'DEV E2E workflow task',
    status: 'in_progress',
  });

  await signIn(page, USERS.pm);
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('tab', { name: /Setup/ }).click();
  const panel = page.getByRole('region', { name: 'Task workflow' });
  await panel.getByRole('combobox', { name: 'Workflow' }).click();
  await page.getByRole('option', { name: workflowName }).click();
  await panel.getByRole('button', { name: 'Use this workflow' }).click();
  await expect(panel).toContainText(`Currently: ${workflowName}`);
  await expect(panel.getByRole('list', { name: 'Statuses' })).toContainText('Code review');

  await page.goto(`/projects/${project.id}?task=${task.id}`);
  await page.getByRole('button', { name: /Change status/ }).click();
  await page.getByRole('menuitem', { name: /Send to code review/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Send to code review' });
  await dialog.getByLabel('Comment').fill('DEV E2E ready for review');
  await dialog.getByRole('button', { name: 'Send to code review' }).click();
  await expect(page.getByRole('region', { name: 'Status history' })).toContainText(
    'DEV E2E ready for review',
  );
  await expect(page.getByRole('button', { name: /Status: Code review/ })).toBeVisible();

  // Tidy: back to the standard workflow, then delete the test workflow.
  await pm.call('put', `/projects/${project.id}/workflow`, { workflowId: null });
  await admin.call('delete', `/workflows/${wf.id}`);
});
