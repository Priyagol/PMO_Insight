/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rolldownOptions: {
      output: {
        // Long-lived vendor code in its own chunks so app releases do not invalidate it in browser caches.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[/\\](react|react-dom|scheduler|react-router)[/\\]/,
            },
            { name: 'zod', test: /node_modules[/\\]zod[/\\]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Same-origin in development so the HttpOnly refresh cookie works exactly as behind Nginx.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Lazy-loaded pages + realistic typing make some UI tests slower than the 5 s default.
    testTimeout: 40_000,
  },
});
