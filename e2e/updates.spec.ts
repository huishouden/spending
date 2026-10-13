import { expect, test } from '@playwright/test';

// A reload (an update applying, kit STANDARD.md "Updates") and Back return to the screen in the
// address: the month, the category and the purchase on screen. The signed-out sample household.

test('a reload and Back return to the screen in the address', async ({ page }) => {
  const glance = page.getByRole('region', { name: 'This month' });
  await page.goto('./');
  await expect(glance.getByRole('heading')).toHaveText(/spent in September/);
  await glance.getByRole('button', { name: 'Previous month' }).click();
  await expect(page).toHaveURL(/[?&]month=\d{4}-08/);
  await expect(glance.getByRole('heading')).toHaveText(/spent in August/);
  const category = page.getByRole('list', { name: /August/ }).getByRole('button').first();
  const name = (await category.getAttribute('aria-label'))!.split(',')[0];
  await category.click();
  await expect(page).toHaveURL(/[?&]category=/);
  const list = page.getByRole('list', { name: `${name} purchases` });
  await expect(list).toBeVisible();
  const purchase = list.getByRole('button').first();
  const merchant = (await purchase.getAttribute('aria-label'))!.split(',')[0];
  await purchase.click();
  await expect(page.getByRole('dialog', { name: merchant })).toBeVisible();
  await expect(page).toHaveURL(/[?&]purchase=/);

  await page.reload();
  await expect(glance.getByRole('heading')).toHaveText(/spent in August/);
  await expect(page.getByRole('list', { name: `${name} purchases` })).toBeVisible();
  await expect(page.getByRole('dialog', { name: merchant })).toBeVisible();

  await page.getByRole('dialog', { name: merchant }).getByRole('button', { name: 'Close' }).click();
  await expect(page).not.toHaveURL(/[?&]purchase=/);
  // The purchase replaced the address rather than adding to it: Back leaves the category.
  await page.goBack();
  await expect(page.getByRole('list', { name: 'Purchases' })).toBeVisible();
  await expect(glance.getByRole('heading')).toHaveText(/spent in August/);
  await page.goBack();
  await expect(glance.getByRole('heading')).toHaveText(/spent in September/);
  await page.goForward();
  await expect(glance.getByRole('heading')).toHaveText(/spent in August/);
});
