import { expect, test } from '@playwright/test';
import { apiSession, createProject, signIn, USERS } from './helpers';

test('production deployment stays locked until go-live is approved', async ({ page, request }) => {
  const { project, pm } = await createProject(request, 'DEV E2E Release');
  const release = await pm.call<{ id: string }>('post', '/releases', {
    projectId: project.id,
    version: '1.0.0',
    name: 'DEV E2E pilot',
  });

  await signIn(page, USERS.pm);
  await page.goto(`/releases?release=${release.id}`);
  const envs = page.getByRole('region', { name: 'Environments' });
  const deploy = envs.getByRole('button', { name: 'Deploy' });
  await expect(deploy).toHaveCount(4);
  await expect(deploy.nth(3)).toBeDisabled();

  await deploy.nth(2).click();
  const dialog = page.getByRole('dialog', { name: /Record deployment: 1\.0\.0/ });
  await dialog.getByLabel('Build / artefact').fill('dev-e2e-build-1');
  await dialog.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByText('UAT deployment recorded')).toBeVisible();
  await expect(envs).toContainText('build dev-e2e-build-1');

  await page.getByRole('button', { name: 'Request go-live approval' }).click();
  await expect(page.getByText('Go-live approval requested')).toBeVisible();
  await expect(page.getByText(/Go-live APR-\d+: pending/)).toBeVisible();
  await expect(deploy.nth(3)).toBeDisabled();
});

test('a team member uploads a document and requests publication', async ({ page, request }) => {
  const dev = await apiSession(request, USERS.developer);
  const { project } = await createProject(request, 'DEV E2E Documents', [dev.me.id]);

  await signIn(page, USERS.developer);
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('tab', { name: 'Documents' }).click();
  await page.getByRole('button', { name: 'Upload document' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Upload document' });
  await dialog.getByLabel('File').setInputFiles({
    name: 'dev-e2e-plan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% DEV E2E synthetic file\n'),
  });
  await expect(dialog.getByLabel('Title')).toHaveValue('dev-e2e-plan');
  await dialog.getByRole('button', { name: 'Upload' }).click();
  await expect(dialog).toBeHidden();

  await page.getByText('dev-e2e-plan').first().click();
  await expect(page.getByRole('region', { name: 'Versions' })).toContainText('dev-e2e-plan.pdf');
  await page.getByRole('button', { name: /Request publication of v1/ }).click();
  await expect(page.getByText('Awaiting approval').first()).toBeVisible();
});
