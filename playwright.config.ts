import { defineConfig, devices } from '@playwright/test';

const PORT = 4180;
/** Second dev server WITHOUT mocks: there Playwright's `page.route` can fake wallet-core. */
const NO_MOCKS_PORT = 4181;

/**
 * Smoke tests run against the app with MSW mocks — no backends needed (`e2e/smoke.spec.ts`).
 * `e2e/settings-startup.spec.ts` runs against a second server without mocks.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `npx vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      env: { VITE_USE_MOCKS: 'true', VITE_DEV_USER: '1:wallet' },
    },
    {
      command: `npx vite --port ${NO_MOCKS_PORT} --strictPort`,
      url: `http://localhost:${NO_MOCKS_PORT}`,
      reuseExistingServer: !process.env.CI,
      // Same-origin wallet-core URL: no CORS, and no service worker to bypass `page.route`.
      env: { VITE_USE_MOCKS: 'false', VITE_WALLET_CORE_URL: '/wallet-core/graphql' },
    },
  ],
});
