import { expect, test, type Page } from '@playwright/test';
import { captureScreenshot } from '@huishouden/pwa-kit/e2e';

// The settings sit in the app bar's menu; the live site the "before" images come from may still have the gear.
async function openSettings(p: Page) {
  const bar = p.locator('hh-app-bar');
  const gear = bar.locator('button[slot="actions"]');
  if (await gear.count()) return gear.click();
  await bar.locator('[data-trigger]').click();
  await bar.getByRole('button', { name: 'Spending settings' }).click();
}

// README images of the signed-out app, which shows its built-in sample household (invented cards,
// shops and amounts) on the sample's own clock, so every run renders the same month.
// Refreshed by CI after each deploy; committed only when they change.

const statement = new URL('./fixtures/statement_1111.csv', import.meta.url).pathname;
const phone = (page: Page) => page.setViewportSize({ width: 390, height: 844 });

// The glance: this month against the budget, where it went, the latest purchases.
test('dashboard', ({ page }) => captureScreenshot(page, 'dashboard'));

test('phone: dashboard', async ({ page }) => {
  await phone(page);
  await captureScreenshot(page, 'phone-dashboard');
});

// One category's purchases.
test('category', ({ page }) =>
  captureScreenshot(page, 'category', {
    prepare: async (p) => {
      await p.getByRole('button', { name: /^Dining & Food, / }).click();
      await expect(p.getByRole('list', { name: 'Dining & Food purchases' })).toBeVisible();
    },
  }));

// A purchase opened to change its category.
test('purchase', ({ page }) =>
  captureScreenshot(page, 'purchase', {
    prepare: async (p) => {
      await p.getByRole('button', { name: /^Sushi Blossom, / }).click();
      const dialog = p.getByRole('dialog', { name: 'Sushi Blossom' });
      await dialog.getByRole('button', { name: 'Entertainment' }).click();
      await dialog.getByRole('checkbox').check();
    },
  }));

test('phone: purchase', async ({ page }) => {
  await phone(page);
  await captureScreenshot(page, 'phone-purchase', {
    prepare: async (p) => {
      await p.getByRole('button', { name: /^Sushi Blossom, / }).click();
    },
  });
});

test('add spending', ({ page }) =>
  captureScreenshot(page, 'add-spending', {
    prepare: async (p) => {
      await p.getByRole('button', { name: 'Add spending' }).click();
    },
  }));

// A statement file (invented rows) matched to its card, before anything is added.
test('import a statement', ({ page }) =>
  captureScreenshot(page, 'import-statement', {
    prepare: async (p) => {
      await p.getByRole('button', { name: 'Add spending' }).click();
      await p.getByRole('button', { name: /Import a statement/ }).click();
      const dialog = p.getByRole('dialog', { name: 'Import a statement' });
      await dialog.getByLabel('Statement files').setInputFiles(statement);
      await expect(dialog.getByRole('button', { name: /^Add \d+ purchases?$/ })).toBeVisible();
    },
  }));

test('settings: budget', ({ page }) =>
  captureScreenshot(page, 'settings-budget', {
    prepare: async (p) => {
      await openSettings(p);
    },
  }));

// The household's cards in Settings (the sample household's invented cards).
test('settings: cards', ({ page }) =>
  captureScreenshot(page, 'settings-cards', {
    prepare: async (p) => {
      await openSettings(p);
      await p.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Cards' }).click();
    },
  }));

// The app bar with an invented signed-in person and the account menu open.
test('account menu', ({ page }) =>
  captureScreenshot(page, 'account-menu', {
    prepare: async (p) => {
      await p.locator('hh-app-bar').evaluate((bar: HTMLElementTagNameMap['hh-app-bar']) => {
        bar.user = { name: 'Sam Example', email: 'sam@example.com', photoURL: null };
      });
      await p.getByRole('button', { name: 'Signed in as sam@example.com' }).click();
      await expect(p.getByRole('link', { name: 'All apps' })).toBeVisible();
    },
  }));

// What a helper or kid sees: no money, a way back to the portal.
test('helper', ({ page }) => captureScreenshot(page, 'helper', { path: './?sample=helper' }));
