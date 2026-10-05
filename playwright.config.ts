import { defineConfig, devices } from '@playwright/test';

// Smoke tests against a deployed site: BASE_URL defaults to the staging suite, never production (Hosting's 10 GB a month, pwa-kit docs/one-site.md "Bandwidth"): Spending's path on the suite's
// one site. Specs use relative paths (`./`, `./?sample=x`): a leading `/` would open the portal.
export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.BASE_URL || `https://huishouden-staging.web.app/spending/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'tablet', use: { ...devices['Galaxy Tab S4'], viewport: { width: 1280, height: 800 } } },
  ],
});
