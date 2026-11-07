import { defineConfig } from 'tsup';

// Bundles the API, worker, combined free-tier entrypoint and seed script.
// The shared workspace package is bundled into dist; third-party dependencies stay external.
export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts', 'src/all.ts', 'src/scripts/seed-admin.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@arihant/shared'],
});
