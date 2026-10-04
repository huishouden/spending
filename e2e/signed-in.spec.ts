import { expect, test, type Page } from '@playwright/test';
import { signInTestUser } from '@huishouden/pwa-kit/e2e';

// Signed in as an invented test user on the staging site (pwa-kit STANDARD.md "Staging"): the real
// staging Firestore and rules, the seeded test household. Each run saves a value unique to it and
// looks for exactly that.
test.skip(!process.env.HH_STAGING_SA, 'signed-in tests run against staging, in CI');

async function budgetSettings(page: Page) {
  await page.locator('hh-app-bar').getByRole('button', { name: /^Signed in as/ }).click({ timeout: 20_000 });
  await page.locator('hh-app-bar').getByRole('button', { name: 'Spending settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Budget', exact: true }).click();
  return settings;
}

test('a budget one member saves is the household budget for the other', async ({ page, browser }) => {
  await signInTestUser(page, { email: 'test-a@example.com' });
  await expect(page.getByText('Sample data')).toHaveCount(0);
  // A round number unique to this run: $1,010 to $9,990.
  const budget = String((101 + (Date.now() % 899)) * 10);
  const settings = await budgetSettings(page);
  await settings.getByLabel('Monthly budget').fill(budget);
  await settings.getByRole('button', { name: 'Save budget' }).click();
  await expect(settings.getByRole('status')).toHaveText('Saved');

  // Saved in the household, not just on this screen: the other member's own browser reads it.
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const theirs = await other.newPage();
    await signInTestUser(theirs, { email: 'test-b@example.com' });
    await expect((await budgetSettings(theirs)).getByLabel('Monthly budget')).toHaveValue(budget, { timeout: 20_000 });
  } finally {
    await other.close();
  }
});

// Roles: a helper (test-helper) is refused the household's money and nothing loads; the app bar
// still works for them.
test.describe('as a helper', () => {
  test.beforeAll(async () => {
    // Another app's run may have reseeded the household with an older kit that has no helper.
    const { seedTestHousehold } = await import('@huishouden/pwa-kit/staging');
    await seedTestHousehold({ accessToken: process.env.HH_STAGING_ACCESS_TOKEN! });
  });

  test('opening Spending says only admins and members can see the money, and loads none', async ({ page }) => {
    const reads: string[] = [];
    page.on('request', (r) => {
      if (/spending(Transactions|Settings|Cards|Rules)/.test(decodeURIComponent(r.url()) + (r.postData() ?? ''))) reads.push(r.url());
    });
    await signInTestUser(page, { email: 'test-helper@example.com' });
    await expect(page.getByText('Only admins and members can see the household’s money.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: 'Open Huishouden' })).toBeVisible();
    await expect(page.locator('hh-app-bar [part="app-settings"]')).toHaveCount(0);
    expect(reads).toEqual([]);
  });
});
