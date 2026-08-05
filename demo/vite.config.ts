import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * The playground compiles the engine from source rather than from `dist`, so
 * what the page shows is always the code in this repository, not a stale build.
 */
export default defineConfig({
  base: process.env.VITE_BASE ?? '/route-navigation-engine/',
  plugins: [react()],
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
