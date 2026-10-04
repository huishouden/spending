import { defineConfig, devices } from '@playwright/test';
import { SUITE_ORIGIN } from '@huishouden/pwa-kit/site';

// Smoke tests against a deployed site: BASE_URL defaults to production, Spending's path on the suite's
// one site. Specs use relative paths (`./`, `./?sample=x`): a leading `/` would open the portal.
export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.BASE_URL || `${SUITE_ORIGIN}/spending/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'tablet', use: { ...devices['Galaxy Tab S4'], viewport: { width: 1280, height: 800 } } },
  ],
});
