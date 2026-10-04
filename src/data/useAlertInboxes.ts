import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Auth } from 'firebase/auth';
import { googleAuthCode } from '@huishouden/pwa-kit/google-token';
import { GMAIL_READONLY_SCOPE } from '@huishouden/pwa-kit/gmail';
import { popupBlocked, popupCancelled } from '@huishouden/pwa-kit/feedback';
import { track } from '@huishouden/pwa-kit/observability';
import { mailApi, MailCallError, MAIL_URL, type Caller, type MailStatus, type ReviewAnswer } from '../services/mailApi';
import { t } from '../i18n';
import type { AlertInboxes } from './store';

/** Status is asked again this often while the app is open, and when it comes back into view after a while. */
const REFRESH_MS = 10 * 60_000;
const STALE_MS = 2 * 60_000;
/** While a check is under way (just connected, Check now), status is asked this often, at most FOLLOW_MAX times. */
const FOLLOW_MS = 3000;
const FOLLOW_MAX = 20;

/** A failed call in words. */
export function inboxError(e: unknown): string | null {
  if (popupCancelled(e)) return null;
  if (popupBlocked(e)) return t('inbox.err.popupBlocked');
  const code = e instanceof MailCallError ? e.code : (e as { code?: string })?.code;
  switch (code) {
    case 'access_denied':
    case 'google-denied':
      return t('inbox.err.denied');
    case 'not-allowed':
      return t('inbox.err.notAllowed');
    case 'firestore-quota':
      return t('inbox.err.quota');
    case 'not-last-import':
      return t('inbox.err.notLastImport');
    case 'google-config':
    case 'not-configured':
      return t('inbox.err.unavailable');
    default:
      return t('inbox.err.network');
  }
}

export interface InboxDeps {
  householdId: string | null;
  /** The signed-in member (or a stand-in in browser tests). */
  caller: () => Caller | null;
  isAdmin: boolean;
  /** Google's one-time code for gmail.readonly, from the account chooser. */
  code: () => Promise<string>;
  base?: string;
}

/** Google's account chooser, then read-only Gmail for the account picked: any account, not only the signed-in one. */
export const chooserCode = (auth: Auth, clientId?: string) => async () =>
  (await googleAuthCode(auth, [GMAIL_READONLY_SCOPE], { selectAccount: true, deniedMessage: t('inbox.err.denied'), ...(clientId ? { clientId } : {}) })).code;

/** The household's alert inboxes, through the calendar Worker. */
export function useAlertInboxes({ householdId, caller, isAdmin, code, base = MAIL_URL }: InboxDeps): AlertInboxes {
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<AlertInboxes['busy']>(null);
  const askedAt = useRef(0);
  const api = useMemo(() => mailApi(base), [base]);
  const deps = useRef({ caller, code });
  deps.current = { caller, code };

  const run = useCallback(
    async (what: (c: Caller, household: string) => Promise<MailStatus>): Promise<MailStatus | null> => {
      const c = deps.current.caller();
      if (!c || !householdId) return null;
      const s = await what(c, householdId);
      askedAt.current = Date.now();
      setStatus(s);
      return s;
    },
    [householdId],
  );

  const refresh = useCallback(async () => {
    try {
      const s = await run((c, h) => api.status(c, h));
      setError(null);
      return s;
    } catch (e) {
      // A status that can't be had is not worth a message on its own; actions say why they failed.
      if (e instanceof MailCallError && e.code === 'not-allowed') setError(inboxError(e));
      return null;
    }
  }, [api, run]);

  useEffect(() => {
    if (!base || !householdId) return;
    void refresh();
    const timer = setInterval(() => document.visibilityState === 'visible' && void refresh(), REFRESH_MS);
    const onShow = () => document.visibilityState === 'visible' && Date.now() - askedAt.current > STALE_MS && void refresh();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [base, householdId, refresh]);

  // A check under way: follow it until it is done, so "Checking" turns into "Checked just now".
  const follows = useRef(0);
  const checking = !!status?.inboxes.some((i) => i.checking);
  useEffect(() => {
    if (!checking) {
      follows.current = 0;
      return;
    }
    if (follows.current >= FOLLOW_MAX) return;
    const timer = setTimeout(() => {
      follows.current++;
      void refresh();
    }, FOLLOW_MS);
    return () => clearTimeout(timer);
  }, [checking, status, refresh]);

  const act = useCallback(
    async (kind: NonNullable<AlertInboxes['busy']>, what: () => Promise<MailStatus | null>, rethrow = false) => {
      setBusy(kind);
      setError(null);
      try {
        return await what();
      } catch (e) {
        const message = inboxError(e);
        setError(message);
        if (rethrow && message) throw new Error(message);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  return useMemo(
    () => ({
      available: !!base,
      status,
      error,
      busy,
      isAdmin,
      refresh,
      connect: async () => {
        track('connect alert inbox');
        await act('connect', async () => {
          const one = await deps.current.code();
          return run((c, h) => api.connect(c, h, one));
        });
      },
      checkNow: () => act('check', () => run((c, h) => api.check(c, h)), true),
      disconnect: async (id: string) => {
        await act('disconnect', () => run((c, h) => api.disconnect(c, h, id)));
      },
      review: async (inbox: string) => {
        const c = deps.current.caller();
        if (!c || !householdId) return [];
        try {
          return (await api.review(c, householdId, inbox)).items;
        } catch (e) {
          throw new Error(inboxError(e) ?? t('inbox.err.network'));
        }
      },
      answer: async (inbox: string, msg: string, answer: ReviewAnswer) => {
        const c = deps.current.caller();
        if (!c || !householdId) return [];
        try {
          const { items } = await api.answer(c, householdId, inbox, msg, answer);
          void refresh();
          return items;
        } catch (e) {
          throw new Error(inboxError(e) ?? t('inbox.err.network'));
        }
      },
      undo: async (inbox: string, importId: string) => {
        track('undo alert import');
        await act('undo', () => run((c, h) => api.undo(c, h, inbox, importId)));
      },
    }),
    [base, status, error, busy, isAdmin, refresh, act, run, api, householdId],
  );
}
