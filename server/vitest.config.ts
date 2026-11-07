import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['tests/setup-env.ts'],
    // In-memory MongoDB replica set download/startup can be slow on first run.
    hookTimeout: 120_000,
    // Integration suites run in parallel against in-memory MongoDB; slow laptops need headroom.
    testTimeout: 60_000,
    pool: 'forks',
  },
});
