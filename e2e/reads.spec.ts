import { expect, test, type Browser, type Page } from '@playwright/test';
import { expectPageReads, resetPageReads, useTestHousehold } from '@huishouden/pwa-kit/e2e';
import { testHousehold } from '@huishouden/pwa-kit/staging';

// Read budgets (pwa-kit STANDARD.md "Read budgets"): what opening Spending costs a household in
// Firestore reads, on the emulators with a build that counts them (`expectPageReads`), each in a
// fresh browser context (a first open, nothing cached). A change that raises a ceiling says why in
// its PR. An invented household: two cards, two category rules, its settings, and purchases this
// month (3), last month (3) and each of the four months before (2 each).
const NOW = new Date();
const by = testHousehold('reads').users.admin.email;
const pad = (n: number) => String(n).padStart(2, '0');
/** The `day` of the month `back` months before this one, as YYYY-MM-DD. */
function dayOf(back: number, day: number): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth() - back, day);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const tx = (id: string, date: string, description: string, amount: number) => ({
  [`spendingTransactions/${id}`]: { date, description, amount, category: 'Groceries', card: 'Test Visa', type: 'Sale', source: 'statement', createdAt: Date.now(), by },
});
// This month's from the 1st (always before today); the 15th of every month before.
const purchases = Object.assign(
  {},
  ...[1, 1, 1].map((_, i) => tx(`now-${i}`, dayOf(0, 1), `Test shop ${i}`, 10 + i)),
  ...[10, 15, 20].map((day, i) => tx(`m1-${i}`, dayOf(1, day), `Test market ${i}`, 20 + i)),
  ...[2, 3, 4, 5].flatMap((back) => [0, 1].map((i) => tx(`m${back}-${i}`, dayOf(back, 15), `Test store ${back}-${i}`, 30 + i))),
);
const hh = useTestHousehold(test, {
  scope: 'reads',
  docs: {
    ...purchases,
    'spendingCards/visa': { name: 'Test Visa', last4: '1234', alertWords: [], createdAt: Date.now(), by },
    'spendingCards/amex': { name: 'Test Amex', last4: '9876', alertWords: [], createdAt: Date.now(), by },
    'spendingRules/r1': { contains: 'market', category: 'Groceries', createdAt: Date.now(), by },
    'spendingRules/r2': { contains: 'store', category: 'Shopping', createdAt: Date.now(), by },
    'spendingSettings/main': { monthlyBudget: 2000, currencySymbol: '$', ignoredKeywords: ['autopay'], alertLabels: [], updatedAt: Date.now(), updatedBy: by },
  },
});

// One open at a time: another open's writes (a sign-in's profile) would reach this page's listeners.
test.describe.configure({ mode: 'serial' });

const loaded = (page: Page) => expect(page.getByRole('region', { name: 'This month' })).toBeVisible({ timeout: 30_000 });

// Each person has used Spending before on another device: a first sign-in's own writes (joined,
// the profile) are done, so they don't land in a measured open.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  for (const as of ['admin', 'member', 'helper'] as const) {
    const page = await hh.open(browser, as);
    if (as === 'helper') await expect(page.getByText(/only admins and members/i).first()).toBeVisible({ timeout: 30_000 });
    else await loaded(page);
    await page.waitForTimeout(2000);
    await page.close();
  }
});

async function fresh(browser: Browser, as: 'admin' | 'member' | 'helper', run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await run(await context.newPage());
  } finally {
    await context.close();
  }
}

// 13: the household (1), its cards (2), rules (2) and settings (1), the six purchases from last
// month's 1st on (live), and one query for the month picker's oldest month.
for (const as of ['admin', 'member'] as const) {
  test(`opening Spending (this month), signed in as ${as === 'admin' ? 'an admin' : 'a member'}`, async ({ browser }) => {
    await fresh(browser, as, async (page) => {
      await expectPageReads(
        page,
        async () => {
          await hh.signIn(page, as);
          await loaded(page);
        },
        { max: 13, min: 13, label: `Spending, ${as}` },
      );
    });
  });
}

// A helper is refused the money: the household and nothing of Spending's.
test('opening Spending, signed in as a helper: nothing of the money read', async ({ browser }) => {
  await fresh(browser, 'helper', async (page) => {
    await expectPageReads(
      page,
      async () => {
        await hh.signIn(page, 'helper');
        await expect(page.getByText(/only admins and members/i).first()).toBeVisible({ timeout: 30_000 });
      },
      { max: 1, min: 1, label: 'Spending, helper' },
    );
  });
});

// Going back a month at a time reads each older month once, as it comes into a glance (each month's
// glance shows it and the month before): its two purchases. Before, each step asked for its whole
// glance, so every month was read twice (4 reads a step).
test('going back four months: each older month read once', async ({ browser }) => {
  await fresh(browser, 'admin', async (page) => {
    await hh.signIn(page, 'admin');
    await loaded(page);
    await page.waitForTimeout(1500);
    for (const back of [1, 2, 3, 4]) {
      await resetPageReads(page);
      await expectPageReads(
        page,
        async () => {
          await page.getByRole('button', { name: 'Previous month' }).click();
          await expect(page.getByText("Loading this month's purchases")).toHaveCount(0, { timeout: 20_000 });
        },
        { max: 2, min: 2, label: `Spending, ${back} month${back > 1 ? 's' : ''} back` },
      );
    }
  });
});
