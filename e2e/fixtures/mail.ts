import type { Page, Route } from '@playwright/test';

// A stubbed calendar Worker and Google's code client, shared by the alert-inbox specs. All addresses are invented.

export const WORKER = 'https://mail-worker.example.test';

export interface Inbox {
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
export async function stubWorker(page: Page, first: Inbox[] = []) {
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
export async function stubGoogle(page: Page, answer: Record<string, string> | 'blocked' | 'hidden' = { code: 'one-time-code', scope: 'https://www.googleapis.com/auth/gmail.readonly' }) {
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
