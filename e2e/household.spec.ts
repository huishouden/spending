import { expect, test, type Page } from '@playwright/test';
import { openAppSettings } from '@huishouden/pwa-kit/e2e';
import { alerts } from './fixtures/gmail';

// The signed-out sample household on its own clock (27 September 2026): its own cards and rules, in
// memory. Gmail has no emulator: a stand-in token (window.__gmailTestToken) makes the app call the
// real Gmail REST paths, and page.route answers them.

const statement = new URL('./fixtures/statement_1111.csv', import.meta.url).pathname;

async function open(page: Page, gmail = true) {
  const searches: string[] = [];
  if (gmail) {
    await page.route('https://gmail.googleapis.com/gmail/v1/users/me/messages**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/messages')) {
        searches.push(url.searchParams.get('q') ?? '');
        return route.fulfill({ json: { messages: alerts.map((m) => ({ id: m.id, threadId: m.threadId })) } });
      }
      const m = alerts.find((a) => url.pathname.endsWith(`/${a.id}`));
      return m ? route.fulfill({ json: m }) : route.fulfill({ status: 404, json: { error: { message: 'not found' } } });
    });
    await page.addInitScript(() => {
      window.__gmailTestToken = 'test-token';
    });
  }
  await page.goto('./');
  await expect(glance(page)).toContainText('spent in September');
  return searches;
}

const glance = (page: Page) => page.getByRole('region', { name: 'This month' });
const row = (page: Page, merchant: string) => page.getByRole('list', { name: /purchases$|^Purchases$/ }).getByRole('button', { name: new RegExp(`^${merchant}, `) });
const toast = (page: Page) => page.locator('[aria-live="polite"]').filter({ hasText: /\S/ }).last();

async function checkEmail(page: Page) {
  await page.getByRole('button', { name: 'Add spending' }).click();
  await page.getByRole('dialog', { name: 'Add spending' }).getByRole('button', { name: /Check email/ }).click();
}

async function importStatement(page: Page) {
  await page.getByRole('button', { name: 'Add spending' }).click();
  await page.getByRole('dialog', { name: 'Add spending' }).getByRole('button', { name: /Import a statement/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a statement' });
  await dialog.getByLabel('Statement files').setInputFiles(statement);
  return dialog;
}

async function openSettings(page: Page, tab: string) {
  await openAppSettings(page, 'Spending settings');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: tab, exact: true }).click();
  return settings;
}

test('the glance: spent this month, what is left of the budget, and the pace', async ({ page }) => {
  await open(page, false);
  await expect(glance(page).getByRole('heading')).toHaveText('$1,388 spent in September');
  await expect(glance(page)).toContainText('$612 left of $2,000 · on track');
  await expect(glance(page).getByRole('img', { name: '69% of the budget spent, 90% of the month gone' })).toBeVisible();
  await expect(glance(page)).toContainText('Updated 2 hours ago from email');

  // Last month, and back.
  await glance(page).getByRole('button', { name: 'Previous month' }).click();
  await expect(glance(page).getByRole('heading')).toHaveText('$1,790 spent in August');
  await expect(glance(page)).toContainText('$210 under the $2,000 budget');
  await glance(page).getByRole('button', { name: 'Next month' }).click();
  await expect(glance(page).getByRole('heading')).toHaveText('$1,388 spent in September');

  // No budget: compared with last month instead.
  const settings = await openSettings(page, 'Budget');
  await settings.getByLabel('Monthly budget').fill('');
  await settings.getByRole('button', { name: 'Save budget' }).click();
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(glance(page)).toContainText('$401 less than August');
  await expect(glance(page).getByRole('img')).toHaveCount(0);
});

test('a category shows its purchases', async ({ page }) => {
  await open(page, false);
  await page.getByRole('button', { name: 'Dining & Food, $253.60' }).click();
  const list = page.getByRole('list', { name: 'Dining & Food purchases' });
  await expect(list.getByRole('button')).toHaveCount(4);
  await expect(list.getByRole('button').first()).toHaveAccessibleName(/^The Olive Branch Bistro, \$88\.50/);
  await page.getByRole('button', { name: 'All purchases' }).click();
  await expect(page.getByRole('list', { name: 'Purchases' }).getByRole('button')).toHaveCount(18);
});

test('a purchase moves to another category, with a rule for later ones, and Undo puts it back', async ({ page }) => {
  await open(page, false);
  await row(page, 'Sushi Blossom').click();
  const dialog = page.getByRole('dialog', { name: 'Sushi Blossom' });
  await dialog.getByRole('button', { name: 'Entertainment' }).click();
  await dialog.getByRole('checkbox', { name: 'Always put “sushi blossom” in Entertainment' }).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(toast(page)).toContainText('Moved Sushi Blossom to Entertainment');
  await expect(row(page, 'Sushi Blossom')).toContainText('Entertainment');
  await expect(page.getByRole('button', { name: 'Entertainment, $156.00' })).toBeVisible();

  const settings = await openSettings(page, 'Categories');
  await settings.getByLabel('Find a rule').fill('sushi');
  await expect(settings.getByRole('listitem', { name: 'sushi blossom' })).toContainText('Entertainment');
  await settings.getByRole('button', { name: 'Close' }).click();

  await row(page, 'Sushi Blossom').click();
  await dialog.getByRole('button', { name: 'Dining & Food' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Sushi Blossom')).toContainText('Entertainment');
});

test('a removed purchase comes back with Undo', async ({ page }) => {
  await open(page, false);
  await row(page, 'Home Depot').click();
  await page.getByRole('dialog', { name: 'Home Depot' }).getByRole('button', { name: 'Remove' }).click();
  await expect(row(page, 'Home Depot')).toHaveCount(0);
  await expect(glance(page).getByRole('heading')).toHaveText('$1,253 spent in September');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Home Depot')).toHaveCount(1);
  await expect(glance(page).getByRole('heading')).toHaveText('$1,388 spent in September');
});

test('Check email reads card alerts with the household’s alert words, once', async ({ page }) => {
  const searches = await open(page);
  await checkEmail(page);
  await expect(page.getByText('Added 2 purchases from email')).toBeVisible();
  expect(searches[0]).toBe('newer_than:30d (from:(alerts@bank.example.com) OR from:(notices@card.example.com) OR "rewards card")');
  await expect(row(page, 'EXAMPLE GROCERY')).toContainText('Groceries');
  await expect(row(page, 'EXAMPLE GROCERY')).toContainText('Example Visa');
  await expect(row(page, 'EXAMPLE NOODLE BAR')).toContainText('Example Rewards Card');
  await expect(glance(page)).toContainText('Updated just now from email');

  await checkEmail(page);
  await expect(page.getByText('No new purchases in email')).toBeVisible();
  await expect(row(page, 'EXAMPLE GROCERY')).toHaveCount(1);
});

test('an expired Gmail token is reported in words, with a retry', async ({ page }) => {
  await page.route('https://gmail.googleapis.com/**', (route) => route.fulfill({ status: 401, json: { error: { message: 'Invalid Credentials' } } }));
  await page.addInitScript(() => {
    window.__gmailTestToken = 'expired-token';
  });
  await page.goto('./');
  await checkEmail(page);
  const alert = glance(page).getByRole('alert');
  await expect(alert).toContainText('Gmail access has ended; check email again to allow it.');
  await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('a statement file is matched to its card, previewed, and replaces the alert for the same purchase', async ({ page }) => {
  await open(page);
  await checkEmail(page);
  await expect(page.getByText('Added 2 purchases from email')).toBeVisible();

  const dialog = await importStatement(page);
  const file = dialog.getByRole('region', { name: 'statement_1111.csv' });
  await expect(file.getByLabel('Card')).toHaveValue('c-sample-1');
  await expect(file).toContainText('Columns: Transaction Date, Description, Amount; purchases are negative');
  await expect(file).toContainText('2 new, 1 replacing email alerts, 0 already here; 1 skipped (card payments and never-counted words)');
  await dialog.getByRole('button', { name: 'Add 3 purchases' }).click();
  await expect(page.getByText('Added 2 purchases; 1 email alert replaced by the statement')).toBeVisible();

  // The statement's name and date replace the alert's; one grocery purchase, not two.
  await expect(row(page, 'EXAMPLE GROCERY #42')).toHaveCount(1);
  await expect(row(page, 'EXAMPLE GROCERY')).toHaveCount(0);
  await expect(row(page, 'EXAMPLE BOOKSHOP')).toContainText('Shopping & Retail');

  // The same file again adds nothing.
  await importStatement(page);
  await expect(dialog.getByRole('button', { name: 'Nothing new to add' })).toBeDisabled();
});

test('cards and category rules are the household’s data', async ({ page }) => {
  await open(page, false);
  const settings = await openSettings(page, 'Cards');
  await settings.getByRole('button', { name: 'Add a card' }).click();
  await settings.getByLabel('Name').fill('Card Four');
  await settings.getByLabel('Last 4 digits').fill('4444');
  await settings.getByLabel('Alert words').fill('alerts@four.example.com');
  await settings.getByRole('button', { name: 'Save card' }).click();
  await expect(settings.getByRole('listitem', { name: 'Card Four' })).toContainText('•••• 4444');

  await settings.getByRole('button', { name: 'Categories', exact: true }).click();
  await settings.getByLabel("When the shop's name contains").fill('example bookshop');
  await settings.getByLabel('Category', { exact: true }).fill('Entertainment');
  await settings.getByRole('button', { name: 'Add rule' }).click();
  await settings.getByLabel('Find a rule').fill('bookshop');
  await expect(settings.getByRole('listitem', { name: 'example bookshop' })).toContainText('Entertainment');
  await settings.getByRole('button', { name: 'Close' }).click();

  const dialog = await importStatement(page);
  await dialog.getByRole('button', { name: 'Add 3 purchases' }).click();
  await expect(row(page, 'EXAMPLE BOOKSHOP')).toContainText('Entertainment');
});

test("a Sheet's tabs, pasted, become cards and rules", async ({ page }) => {
  await open(page, false);
  const settings = await openSettings(page, 'Email');
  await settings.getByText('Bring settings from a Google Sheet').click();
  await settings.getByText("Or paste the tabs' rows").click();
  await settings.getByLabel('Cards tab (Last4, Card, Alert source, Alert keywords)').fill('Last4\tCard\tAlert source\tAlert keywords\n4444\tCard Four\tExample Bank\tfour rewards');
  await settings.getByLabel('Categories tab (Merchant contains, Category)').fill('example kiosk\tFood & Drink');
  await settings.getByRole('button', { name: 'Read the rows' }).click();
  await expect(settings.getByRole('region', { name: 'Found in the Sheet' })).toContainText('Found 1 card (Card Four), 1 category rule and 0 labels.');
  await settings.getByRole('button', { name: 'Bring them in' }).click();
  await expect(settings).toContainText('Added 1 card, 1 category rule and 0 labels.');
  await settings.getByRole('button', { name: 'Cards', exact: true }).click();
  await expect(settings.getByRole('listitem', { name: 'Card Four' })).toContainText('Alerts: four rewards');
});
