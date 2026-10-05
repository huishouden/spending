import { expect, test } from '@playwright/test';
import { expectLocalized, openAppSettings, useLanguage } from '@huishouden/pwa-kit/e2e';
import { stubGoogle, stubWorker } from './fixtures/mail';
import es from '../src/locales/es.json' with { type: 'json' };
import nl from '../src/locales/nl.json' with { type: 'json' };

// The signed-out sample (September 2026) in Spanish and Dutch: Spending's own chrome, its fixed
// categories and the kit's, no English left. Shop names and cards are sample data and stay as written.
const ENGLISH = ['Where it went', 'Latest purchases', 'Add spending', 'spent in', 'September', 'August', 'Groceries', 'Dining & Food', 'Gas & Transport', 'left of', 'on track', 'Updated'];

for (const [lang, messages, month] of [
  ['es', es, 'septiembre'],
  ['nl', nl, 'september'],
] as const) {
  test(`the sample in ${lang}`, async ({ page }) => {
    await expectLocalized(page, lang, { words: ENGLISH });
    const glance = page.getByRole('region', { name: messages['glance.label'] });
    await expect(glance).toContainText(messages['glance.spentIn'].replace('{month}', month));
    await expect(page.getByRole('heading', { name: messages['where.title'] })).toBeVisible();
    await expect(page.getByText(messages['category.groceries'], { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: messages['add.title'] }).click();
    const dialog = page.getByRole('dialog', { name: messages['add.title'] });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(messages['import.title'], { exact: true })).toBeVisible();
  });
}

test('a budget typed the Dutch way is saved as typed', async ({ page }) => {
  await useLanguage(page, 'nl');
  await page.goto('./', { waitUntil: 'networkidle' });
  await openAppSettings(page, nl['settings.open']);
  const settings = page.getByRole('dialog', { name: nl['settings.title'] });
  await settings.getByLabel(nl['settings.budget']).fill('1.500');
  await settings.getByRole('button', { name: nl['settings.saveBudget'] }).click();
  await expect(settings.getByRole('status')).toHaveText('Opgeslagen');
  await settings.getByRole('button', { name: /Sluiten/ }).click();
  await expect(page.getByRole('region', { name: nl['glance.label'] })).toContainText('1.500');
  await expect(page.getByRole('region', { name: nl['glance.label'] })).not.toContainText('$ 2');
});

test('the household currency: euros, written the Spanish way in Spain', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'es-ES' });
  const page = await context.newPage();
  await useLanguage(page, 'es');
  await page.goto('./', { waitUntil: 'networkidle' });
  await openAppSettings(page, es['settings.open']);
  const settings = page.getByRole('dialog', { name: es['settings.title'] });
  await settings.getByLabel(es['settings.currency']).selectOption('EUR');
  await settings.getByRole('button', { name: es['settings.saveBudget'] }).click();
  await settings.getByRole('button', { name: /Cerrar/ }).click();
  await expect(page.getByRole('region', { name: es['glance.label'] })).toContainText('€');
  await expect(page.getByRole('region', { name: es['glance.label'] })).not.toContainText('$');
  await context.close();
});

// The kit's "Continue in this tab" path (Google's window blocked) in Settings > Email: its message and
// both buttons in the household's language, with the English gone.
for (const [lang, messages, words] of [
  ['es', es, { blocked: 'Tu navegador bloqueó la ventana de Google', button: 'Continuar en esta pestaña', english: ['Continue in this tab', 'blocked Google'] }],
  ['nl', nl, { blocked: 'Je browser heeft het venster van Google geblokkeerd', button: 'Doorgaan in dit tabblad', english: ['Continue in this tab', 'blocked Google'] }],
] as const) {
  test(`Continue in this tab, in ${lang}`, async ({ page }) => {
    await useLanguage(page, lang);
    await stubWorker(page);
    await stubGoogle(page, 'blocked');
    await page.goto('./', { waitUntil: 'networkidle' });
    await openAppSettings(page, messages['settings.open']);
    const settings = page.getByRole('dialog', { name: messages['settings.title'] });
    await settings.getByRole('button', { name: messages['settings.tab.email'], exact: true }).click();
    const section = settings.getByRole('region', { name: messages['inbox.title'] });
    await section.getByRole('button', { name: messages['inbox.connect'] }).click();
    await expect(section.getByRole('alert')).toContainText(words.blocked);
    await expect(section.getByRole('button', { name: words.button })).toBeVisible();
    for (const english of words.english) await expect(section).not.toContainText(english);
  });
}
