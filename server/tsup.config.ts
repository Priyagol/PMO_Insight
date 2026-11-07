import { defineConfig } from 'tsup';

// Bundles the server and the workspace `@arihant/shared` package (TypeScript source)
// into dist/. Third-party dependencies stay external and are installed in the image.
export default defineConfig({
  // seed-admin is shipped so the first Super Admin can be created inside the deployed container.
  entry: ['src/server.ts', 'src/worker.ts', 'src/scripts/seed-admin.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@arihant/shared'],
});
