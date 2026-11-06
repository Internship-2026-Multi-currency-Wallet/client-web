import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  // React + MUI + GraphQL clients make one ~180 kB (gzip) vendor bundle; fine for this app.
  build: { chunkSizeWarningLimit: 800 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 20_000,
    // Tests run as dev user 1 against MSW mocks.
    env: { VITE_DEV_USER: '1:wallet' },
  },
});
