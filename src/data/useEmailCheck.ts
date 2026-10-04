import { useCallback, useEffect, useRef, useState } from 'react';
import { checkAlerts, NothingToSearch } from '@huishouden/pwa-kit/spending-core';
import { gmailError } from '@huishouden/pwa-kit/gmail';
import type { SpendingStore } from './store';
import { track } from '@huishouden/pwa-kit/observability';
import { t } from '../i18n';

export type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'done'; added: number; duplicates: number }
  | { status: 'error'; message: string };

/** How long a Check now waits for the Worker's checks to finish, asking every POLL_MS. */
const POLL_MS = 3000;
const POLL_MAX = 20;
/** After the checks finish, the new transactions arrive through the listener. */
const SETTLE_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Email checks for card alerts.
 *
 * - With alert inboxes (the calendar Worker; `store.inboxes.available`): the Worker checks every
 *   inbox every few minutes on its own. `check()` asks it to check now, waits for it, and counts the
 *   alerts that arrived.
 * - Without (a build with no Worker): the member's own Gmail in the browser, as before. `check()`
 *   from a tap may ask Google for access; the automatic check when the app opens only uses access
 *   granted in the last hour, so it never opens a window.
 */
export function useEmailCheck(store: SpendingStore) {
  const [state, setState] = useState<CheckState>({ status: 'idle' });
  const running = useRef(false);
  const storeRef = useRef(store);
  storeRef.current = store;

  const check = useCallback(async (interactive = true) => {
    if (running.current) return;
    running.current = true;
    try {
      const s = storeRef.current;
      if (s.inboxes.available) {
        if (!interactive) return;
        track('check email', { interactive, server: true });
        setState({ status: 'checking' });
        const before = new Set(s.records.filter((r) => r.source === 'alert').map((r) => r.id));
        let status = await s.inboxes.checkNow();
        for (let i = 0; i < POLL_MAX && status?.inboxes.some((x) => x.checking); i++) {
          await sleep(POLL_MS);
          status = await storeRef.current.inboxes.refresh();
        }
        // The new transactions arrive through the listener (in the sample, with the next render).
        await sleep(s.live ? SETTLE_MS : 100);
        const added = storeRef.current.records.filter((r) => r.source === 'alert' && !before.has(r.id)).length;
        setState({ status: 'done', added, duplicates: 0 });
        return;
      }
      const box = s.mail.stored() ?? (interactive ? await s.mail.request() : null);
      if (!box) return;
      track('check email', { interactive });
      setState({ status: 'checking' });
      const result = await checkAlerts(box, {
        cards: s.cards,
        labels: s.settings.alertLabels,
        rules: s.rules,
        existing: s.records,
        seen: s.mail.seen(),
      });
      await s.actions.addAlerts(result.create);
      await s.actions.recordEmailCheck();
      s.mail.markSeen(result.read);
      setState({ status: 'done', added: result.create.length, duplicates: result.duplicates });
    } catch (e) {
      setState({ status: 'error', message: e instanceof NothingToSearch ? t('email.nothingToSearch') : storeRef.current.inboxes.available ? (e as Error).message : gmailError(e) });
    } finally {
      running.current = false;
    }
  }, []);

  // Once per open, without inboxes, for a live household whose cards have alert words, when access is still fresh.
  const autoChecked = useRef(false);
  const ready = store.live && store.ready && !store.inboxes.available && store.cards.some((c) => c.alertWords.length > 0);
  useEffect(() => {
    if (!ready || autoChecked.current) return;
    autoChecked.current = true;
    if (store.mail.stored()) void check(false);
  }, [ready, store, check]);

  return { state, check };
}
