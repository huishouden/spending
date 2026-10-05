import { expect, test, type Page } from '@playwright/test';
import { openAppSettings, useTestHousehold } from '@huishouden/pwa-kit/e2e';

// Signed in as the invented people of a household of this run's own (pwa-kit STANDARD.md
// "Staging"), against the real rules: on the emulators (app-tests, `bun run e2e:emulator`), and on
// staging for a kit bump (@smoke). No flow here needs another app or a Worker, so none is @staging.
const hh = useTestHousehold(test);

async function budgetSettings(page: Page) {
  await openAppSettings(page, 'Spending settings');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Budget', exact: true }).click();
  return settings;
}

test('a budget one member saves is the household budget for the other', { tag: '@smoke' }, async ({ browser }) => {
  const page = await hh.open(browser, 'admin');
  await expect(page.getByText('Sample data')).toHaveCount(0);
  const budget = '2750';
  const settings = await budgetSettings(page);
  await settings.getByLabel('Monthly budget').fill(budget);
  await settings.getByRole('button', { name: 'Save budget' }).click();
  await expect(settings.getByRole('status')).toHaveText('Saved');

  // Saved in the household, not just on this screen: the other member's own browser reads it.
  const theirs = await hh.open(browser, 'member');
  await expect((await budgetSettings(theirs)).getByLabel('Monthly budget')).toHaveValue(budget, { timeout: 20_000 });
});

// The other member had the form open before the save reached the server (a slow network): the form
// follows the household's budget until they edit it, so their own Save can't put back the old one.
test("a member's open Budget form shows another member's save when it arrives", async ({ browser }) => {
  const page = await hh.open(browser, 'admin', 'about:blank');
  // The server gets the admin's settings write 4 s late.
  await page.context().route('**/Write/channel**', async (r) => {
    if (r.request().method() === 'POST' && (r.request().postData() ?? '').includes('spendingSettings')) await new Promise((ok) => setTimeout(ok, 4_000));
    await r.continue();
  });
  await page.goto('./');
  await expect(page.getByText('Sample data')).toHaveCount(0);
  const theirs = await hh.open(browser, 'member');
  const form = (await budgetSettings(theirs)).getByLabel('Monthly budget');
  const before = await form.inputValue();
  const budget = '3150';
  expect(before).not.toBe(budget);
  const settings = await budgetSettings(page);
  await settings.getByLabel('Monthly budget').fill(budget);
  await settings.getByRole('button', { name: 'Save budget' }).click();
  await expect(settings.getByRole('status')).toHaveText('Saved');
  await expect(form).toHaveValue(budget, { timeout: 20_000 });
  await page.context().unrouteAll({ behavior: 'ignoreErrors' });
});

// Roles: a helper is refused the household's money and nothing loads; the app bar still works for them.
test('a helper opening Spending is told only admins and members can see the money, and loads none', async ({ page }) => {
  const reads: string[] = [];
  page.on('request', (r) => {
    if (/spending(Transactions|Settings|Cards|Rules)/.test(decodeURIComponent(r.url()) + (r.postData() ?? ''))) reads.push(r.url());
  });
  await hh.signIn(page, 'helper');
  await expect(page.getByText('Only admins and members can see the household’s money.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: 'Open Huishouden' })).toBeVisible();
  await expect(page.locator('hh-app-bar [part="app-settings"]')).toHaveCount(0);
  expect(reads).toEqual([]);
});
