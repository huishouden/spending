import { expect, test } from '@playwright/test';
import { expectOpeningLinesUp } from '@huishouden/pwa-kit/e2e';

// While Spending opens it shows the kit's opening frame (AppOpening): the same app bar and column as
// the loaded app, so nothing jumps when the glance arrives (kit STANDARD.md "Updates"). No tabs.

test('the opening frame lines up with the loaded app: phone and tablet, light and dark', async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  await expectOpeningLinesUp(browser, {
    baseURL,
    tabs: 'none',
    loaded: (p) => expect(p.getByRole('button', { name: /^Dining & Food, / })).toBeVisible(),
  });
});
