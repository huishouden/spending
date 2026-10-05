import { expect, test, type Page, type Route } from '@playwright/test';
import { openAppSettings } from '@huishouden/pwa-kit/e2e';

// Alert inboxes: Gmail accounts the household's card alerts arrive at, checked by the calendar
// Worker. The sample household keeps one in memory; with window.__mailTestUrl the sample talks to a
// stubbed Worker (page.route) the way a signed-in member's app does, and Google's code client is
// stubbed, so the whole Settings > Email flow runs without Google. All addresses are invented.

const WORKER = 'https://mail-worker.example.test';
const glance = (page: Page) => page.getByRole('region', { name: 'This month' });

async function openEmail(page: Page) {
  await openAppSettings(page, 'Spending settings');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Email', exact: true }).click();
  return settings.getByRole('region', { name: 'Alert inbox' });
}

test.describe('the sample household', () => {
  test('one connected inbox, checked a few minutes ago; another connects, and disconnects', async ({ page }) => {
    await page.goto('./');
    await expect(glance(page)).toContainText('Updated 3 minutes ago from email');
    const section = await openEmail(page);
    const list = section.getByRole('list', { name: 'Connected inboxes' });
    await expect(list.getByRole('listitem', { name: 'card-alerts@example.com' })).toContainText('Connected by you · Checked 3 minutes ago · 1 purchase found 2 hours ago');
    await section.getByRole('button', { name: 'Connect another inbox' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await list.getByRole('button', { name: 'Disconnect partner-alerts@example.com' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await section.getByText('About Gmail access').click();
    await expect(section).toContainText('at most 100 Google accounts can connect');
  });

  test('last import: what it added and what needs review; an unreadable email entered by hand; undo', async ({ page }) => {
    await page.goto('./');
    const section = await openEmail(page);
    const item = section.getByRole('listitem', { name: 'card-alerts@example.com' });
    await expect(item).toContainText('Last import: 1 added, 1 needs review · 2 hours ago');
    await item.getByRole('button', { name: 'Couldn’t read 1 email — check it' }).click();
    const review = page.getByRole('dialog', { name: 'Emails to check' });
    const email = review.getByRole('listitem', { name: 'Card activity on your account' });
    await expect(email).toContainText('$23.10');
    await email.getByRole('button', { name: 'Enter it' }).click();
    const form = email.getByRole('form', { name: 'Enter the purchase' });
    await expect(form.getByLabel('Amount')).toHaveValue('23.10');
    await expect(form.getByRole('button', { name: 'Add purchase' })).toBeDisabled();
    await form.getByLabel('Shop').fill('Corner Bakery');
    await form.getByRole('button', { name: 'Add purchase' }).click();
    await expect(review).toContainText('Nothing left to check.');
    await review.getByRole('button', { name: 'Close' }).click();
    await expect(item).toContainText('Last import: 1 added · 2 hours ago');
    await expect(item.getByRole('button', { name: /Couldn’t read/ })).toHaveCount(0);

    await item.getByRole('button', { name: 'Undo last import' }).click();
    await expect(item).toContainText('Remove the 1 purchase it added?');
    await item.getByRole('button', { name: 'Remove' }).click();
    await expect(item).toContainText('Last import undone');
    await expect(item.getByRole('button', { name: 'Undo last import' })).toHaveCount(0);
  });
});

interface Inbox {
  id: string;
  address: string;
  by: string;
  mine: boolean;
  connectedAt: number;
  lastChecked: number | null;
  lastAlertAt: number | null;
  lastAdded: number | null;
  error: string | null;
  checking: boolean;
  lastImport?: { id: string; at: number; added: number; review: number; done: boolean; undone: boolean } | null;
  review?: number;
}

/** A stubbed calendar Worker: answers /api/mail/* and records what the app sent. */
async function stubWorker(page: Page, first: Inbox[] = []) {
  const state = {
    inboxes: first,
    calls: [] as { path: string; body: Record<string, unknown> | null; auth: string | null }[],
    checking: 0,
    review: [] as { msg: string; subject: string; sent: number; date: string; amount: number | null; reason: string }[],
  };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  const status = () => ({ available: true, inboxes: state.inboxes, lastChecked: Math.max(0, ...state.inboxes.map((i) => i.lastChecked ?? 0)) || null });
  await page.route(`${WORKER}/**`, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = new URL(req.url()).pathname;
    const body = req.postData() ? (JSON.parse(req.postData()!) as Record<string, unknown>) : null;
    state.calls.push({ path, body, auth: req.headers()['authorization'] ?? null });
    const now = Date.now();
    if (path === '/api/mail/connect') {
      state.inboxes = [...state.inboxes.filter((i) => i.id !== 'ib-alerts'), { id: 'ib-alerts', address: 'alerts.example@example.com', by: 'sample@example.com', mine: true, connectedAt: now, lastChecked: null, lastAlertAt: null, lastAdded: null, error: null, checking: true }];
    } else if (path === '/api/mail/check') {
      state.inboxes = state.inboxes.map((i) => ({ ...i, checking: true }));
      state.checking = 1;
    } else if (path === '/api/mail/disconnect') {
      state.inboxes = state.inboxes.filter((i) => i.id !== body?.inbox);
    } else if (path === '/api/mail/review') {
      if (body) {
        state.review = state.review.filter((r) => r.msg !== body.msg);
        state.inboxes = state.inboxes.map((i) => ({ ...i, review: state.review.length }));
      }
      return route.fulfill({ json: { items: state.review }, headers: cors });
    } else if (path === '/api/mail/undo') {
      state.inboxes = state.inboxes.map((i) => (i.id === body?.inbox && i.lastImport ? { ...i, lastImport: { ...i.lastImport, undone: true } } : i));
    } else if (path === '/api/mail/status' && state.checking-- <= 0) {
      state.inboxes = state.inboxes.map((i) => ({ ...i, checking: false, lastChecked: now, error: null }));
    }
    return route.fulfill({ json: status(), headers: cors });
  });
  return state;
}

/** Google's code client, stubbed: the account chooser "returns" a one-time code, and what was asked is kept. */
async function stubGoogle(page: Page, answer: Record<string, string> | 'blocked' | 'hidden' = { code: 'one-time-code', scope: 'https://www.googleapis.com/auth/gmail.readonly' }) {
  await page.addInitScript(
    ({ worker, answer }) => {
      window.__mailTestUrl = worker;
      const asked: Record<string, unknown>[] = [];
      (window as unknown as { __codeRequests: unknown[] }).__codeRequests = asked;
      (window as unknown as { google: unknown }).google = {
        accounts: {
          id: {},
          oauth2: {
            initCodeClient: (cfg: Record<string, unknown> & { callback: (r: Record<string, string>) => void; error_callback?: (e: { type: string; message?: string }) => void }) => ({
              requestCode: () => {
                const { callback: _c, error_callback: _e, ...rest } = cfg;
                if (cfg.ux_mode === 'redirect') {
                  // Google's account chooser in this tab, then back to Spending with a one-time code.
                  location.assign(`${cfg.redirect_uri}?state=${cfg.state}&code=4%2F0-redirect-code&scope=${encodeURIComponent(String(cfg.scope))}&authuser=1&prompt=consent`);
                  return;
                }
                asked.push(rest);
                // A blocked window ends at once; a window out of sight never answers.
                if (answer === 'blocked') setTimeout(() => cfg.error_callback?.({ type: 'popup_failed_to_open', message: 'Failed to open popup window' }), 10);
                else if (answer !== 'hidden') setTimeout(() => cfg.callback(answer), 10);
              },
            }),
          },
        },
      };
    },
    { worker: WORKER, answer },
  );
}

test.describe('with the calendar Worker (stubbed)', () => {
  test('connect: any Google account, from the account chooser; then Check now and Disconnect', async ({ page }) => {
    const worker = await stubWorker(page);
    await stubGoogle(page);
    await page.goto('./');

    // Add spending says to connect one first.
    await page.getByRole('button', { name: 'Add spending' }).click();
    await page.getByRole('dialog', { name: 'Add spending' }).getByRole('button', { name: /Connect alert inbox/ }).click();
    const section = page.getByRole('dialog', { name: 'Settings' }).getByRole('region', { name: 'Alert inbox' });
    await expect(section).toContainText('No inbox connected yet.');

    await section.getByRole('button', { name: 'Connect alert inbox' }).click();
    const list = section.getByRole('list', { name: 'Connected inboxes' });
    await expect(list.getByRole('listitem', { name: 'alerts.example@example.com' })).toBeVisible();
    // Google was asked for read-only Gmail with the account chooser, not the signed-in account.
    const asked = (await page.evaluate(() => (window as unknown as { __codeRequests: Record<string, unknown>[] }).__codeRequests))[0];
    expect(asked).toMatchObject({ scope: 'https://www.googleapis.com/auth/gmail.readonly', ux_mode: 'popup', select_account: true, include_granted_scopes: false });
    expect(asked.login_hint).toBeUndefined();
    const connect = worker.calls.find((c) => c.path === '/api/mail/connect')!;
    expect(connect.body).toMatchObject({ household: 'sample', code: 'one-time-code', refreshToken: 'test-refresh-token-for-the-sample' });
    expect(connect.auth).toBe('Bearer test-id-token');

    await section.getByRole('button', { name: 'Check now' }).click();
    await expect(list.getByRole('listitem', { name: 'alerts.example@example.com' })).toContainText('Checked just now', { timeout: 15_000 });
    expect(worker.calls.some((c) => c.path === '/api/mail/check')).toBe(true);

    await list.getByRole('button', { name: 'Disconnect alerts.example@example.com' }).click();
    await expect(section).toContainText('No inbox connected yet.');
    expect(worker.calls.find((c) => c.path === '/api/mail/disconnect')!.body).toMatchObject({ household: 'sample', inbox: 'ib-alerts' });
  });

  test('a blocked Google window says so, and connecting can be tried again', async ({ page }) => {
    const worker = await stubWorker(page);
    await stubGoogle(page, 'blocked');
    await page.goto('./');
    const section = await openEmail(page);
    await section.getByRole('button', { name: 'Connect alert inbox' }).click();
    await expect(section.getByRole('alert')).toHaveText('Your browser blocked Google’s window. Allow pop-ups for this site, or use Continue in this tab.');
    await expect(section.getByRole('button', { name: 'Connect alert inbox' })).toBeEnabled();
    expect(worker.calls.some((c) => c.path === '/api/mail/connect')).toBe(false);
  });

  test('Continue in this tab: the account chooser here, back to Spending’s inbox, connected with that page’s code', async ({ page }) => {
    const worker = await stubWorker(page);
    await stubGoogle(page, 'blocked');
    await page.goto('./');
    let section = await openEmail(page);
    await section.getByRole('button', { name: 'Connect alert inbox' }).click();
    await section.getByRole('button', { name: 'Continue in this tab' }).click();
    // Back on Spending: Settings > Email opens by itself and the inbox connects.
    section = page.getByRole('dialog', { name: 'Settings' }).getByRole('region', { name: 'Alert inbox' });
    await expect(section.getByRole('list', { name: 'Connected inboxes' }).getByRole('listitem', { name: 'alerts.example@example.com' })).toBeVisible({ timeout: 15_000 });
    const connect = worker.calls.find((c) => c.path === '/api/mail/connect')!;
    expect(connect.body).toMatchObject({ household: 'sample', code: '4/0-redirect-code', redirectUri: `${new URL(page.url()).origin}/spending/` });
    expect(new URL(page.url()).searchParams.has('code')).toBe(false);
  });

  test('a Google window out of sight: after a few seconds, a way to bring it back', async ({ page }) => {
    await stubWorker(page);
    await stubGoogle(page, 'hidden');
    await page.goto('./');
    const section = await openEmail(page);
    await section.getByRole('button', { name: 'Connect alert inbox' }).click();
    await expect(section.getByRole('status').filter({ hasText: 'Can’t see it? It may be behind this window, or continue in this tab instead.' })).toBeVisible({ timeout: 10_000 });
    await expect(section.getByRole('button', { name: 'Continue in this tab' })).toBeVisible();
    await section.getByRole('button', { name: 'Show Google’s window' }).click();
    expect(await page.evaluate(() => (window as unknown as { __codeRequests: unknown[] }).__codeRequests.length)).toBe(2);
  });

  test('Google access removed: the glance says so, and Reconnect leads to the inbox', async ({ page }) => {
    const now = Date.now();
    await stubWorker(page, [{ id: 'ib-alerts', address: 'alerts.example@example.com', by: 'sample@example.com', mine: true, connectedAt: now, lastChecked: now - 60_000, lastAlertAt: null, lastAdded: null, error: 'revoked', checking: false }]);
    await stubGoogle(page);
    await page.route(`${WORKER}/api/mail/status**`, (route) =>
      route.fulfill({
        json: { available: true, inboxes: [{ id: 'ib-alerts', address: 'alerts.example@example.com', by: 'sample@example.com', mine: true, connectedAt: now, lastChecked: now - 60_000, lastAlertAt: null, lastAdded: null, error: 'revoked', checking: false }], lastChecked: now - 60_000 },
        headers: { 'Access-Control-Allow-Origin': '*' },
      }),
    );
    await page.goto('./');
    await expect(glance(page)).toContainText('alerts.example@example.com needs reconnecting: Google access was removed.');
    await glance(page).getByRole('button', { name: 'Reconnect' }).click();
    const item = page.getByRole('dialog', { name: 'Settings' }).getByRole('listitem', { name: 'alerts.example@example.com' });
    await expect(item).toContainText('Google access was removed. Reconnect to keep checking.');
    await expect(item.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  });

  test('review and undo go to the Worker for that inbox and import', async ({ page }) => {
    const now = Date.now();
    const worker = await stubWorker(page, [
      { id: 'ib-alerts', address: 'alerts.example@example.com', by: 'sample@example.com', mine: true, connectedAt: now, lastChecked: now - 60_000, lastAlertAt: now - 60_000, lastAdded: 2, error: null, checking: false, lastImport: { id: 'im-abc', at: now - 60_000, added: 2, review: 1, done: true, undone: false }, review: 1 },
    ]);
    worker.review = [{ msg: 'm-1', subject: 'Your card was used', sent: now - 120_000, date: '2026-10-02', amount: 4.5, reason: 'no-merchant' }];
    await stubGoogle(page);
    await page.goto('./');
    const section = await openEmail(page);
    const item = section.getByRole('listitem', { name: 'alerts.example@example.com' });
    await expect(item).toContainText('Last import: 2 added, 1 needs review');
    await item.getByRole('button', { name: 'Couldn’t read 1 email — check it' }).click();
    const review = page.getByRole('dialog', { name: 'Emails to check' });
    await review.getByRole('listitem', { name: 'Your card was used' }).getByRole('button', { name: 'Not a purchase' }).click();
    await expect(review).toContainText('Nothing left to check.');
    expect(worker.calls.find((c) => c.path === '/api/mail/review' && c.body)!.body).toEqual({ household: 'sample', inbox: 'ib-alerts', msg: 'm-1', answer: 'not-purchase' });
    await review.getByRole('button', { name: 'Close' }).click();
    await item.getByRole('button', { name: 'Undo last import' }).click();
    await item.getByRole('button', { name: 'Remove' }).click();
    await expect(item).toContainText('Last import undone');
    expect(worker.calls.find((c) => c.path === '/api/mail/undo')!.body).toEqual({ household: 'sample', inbox: 'ib-alerts', importId: 'im-abc' });
  });

  test('Gmail left unticked in Google’s window is said in words', async ({ page }) => {
    await stubWorker(page);
    await stubGoogle(page, { code: 'c', scope: 'openid email' });
    await page.goto('./');
    const section = await openEmail(page);
    await section.getByRole('button', { name: 'Connect alert inbox' }).click();
    await expect(section.getByRole('alert')).toHaveText('Google didn’t allow reading that inbox. In Google’s window, tick the box to view your email messages.');
  });
});
