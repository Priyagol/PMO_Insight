import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a running stack (local `npm run dev`, or a staging URL in CI)
 * seeded with the synthetic DEV data (`npm run seed:dev -w server`). They never touch production.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
if (/arihant/i.test(new URL(baseURL).hostname) && !process.env.E2E_ALLOW_REMOTE) {
  throw new Error(
    `Refusing to run E2E tests against ${baseURL}. Set E2E_ALLOW_REMOTE=1 for staging.`,
  );
}

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: './test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
