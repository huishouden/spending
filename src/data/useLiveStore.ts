import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { toYmd } from '@huishouden/pwa-kit/time';
import { writeBatch } from '@huishouden/pwa-kit/firestore';
import { getDb } from '../services/firestoreTransactions';
import { auth } from '../services/auth';
import { gmailMailbox, requestGmailToken, storedGmailToken } from '@huishouden/pwa-kit/gmail';
import type { SpendSettings } from './model';
import { setHouseholdCurrency } from '@huishouden/pwa-kit/household';
import { spendingCurrency } from '../lib/month';
import { t } from '../i18n';
import { derive, emptyDocs, makeActions, type AlertInboxes, type Docs, type SpendingStore, type Write } from './store';
import { beforeWindow, liveFrom, mergeRanges, rangeKey, type DateRange } from '../lib/window';

/** Firestore takes at most 500 writes per batch. */
const BATCH = 400;
const SEEN_MAX = 500;

/**
 * The household's spending data, live from Firestore. Writes go through the persistent cache, so
 * they show at once (also offline) and reach the server when they can; a failure is reported.
 */
/** The first day followed live (src/lib/window.ts), moving on when the month does (checked every minute). */
function useLiveFrom(): string {
  const [from, setFrom] = useState(() => liveFrom(toYmd(Date.now())));
  useEffect(() => {
    const id = setInterval(() => setFrom(liveFrom(toYmd(Date.now()))), 60_000);
    return () => clearInterval(id);
  }, []);
  return from;
}

type TxDocs = Map<string, Record<string, unknown>>;

export function useLiveStore(householdId: string | null, me: string, fallback: SpendSettings, onError: (message: string) => void, inboxes: AlertInboxes, householdCurrency?: string): SpendingStore {
  const [docs, setDocs] = useState<Docs>(emptyDocs);
  const [answered, setAnswered] = useState({ tx: false, settings: false });
  const [oldestMonth, setOldestMonth] = useState<string | undefined>(undefined);
  // Older stretches asked for this visit (`need`), each followed until the household changes.
  const [asked, setAsked] = useState<DateRange[]>([]);
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const from = useLiveFrom();
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  // Each followed range's transactions: the live window under 'live', older ones under their key.
  const ranges = useRef(new Map<string, TxDocs>());
  const publish = useCallback(() => setDocs((d) => ({ ...d, spendingTransactions: mergeRanges(ranges.current.values()) })), []);

  useEffect(() => {
    setDocs(emptyDocs());
    setAnswered({ tx: false, settings: false });
    setOldestMonth(undefined);
    setAsked([]);
    setLoaded(new Set());
    ranges.current = new Map();
    if (!householdId) return;
    const db = getDb();
    const base = ['households', householdId] as const;
    const fail = (what: () => string) => (e: Error) => errorRef.current(t('error.load', { what: what(), detail: e.message }));
    const watch = (name: 'spendingCards' | 'spendingRules') =>
      onSnapshot(
        collection(db, ...base, name),
        (s) => setDocs((d) => ({ ...d, [name]: new Map(s.docs.map((x) => [x.id, x.data()])) })),
        fail(() => (name === 'spendingCards' ? t('error.what.cards') : t('error.what.rules'))),
      );
    // The month picker reaches back to the oldest transaction: one document read, once per visit.
    getDocs(query(collection(db, ...base, 'spendingTransactions'), orderBy('date'), limit(1)))
      .then((s) => {
        const date = s.docs[0]?.data().date;
        if (typeof date === 'string' && /^\d{4}-\d{2}/.test(date)) setOldestMonth(date.slice(0, 7));
      })
      .catch(() => {});
    const unsubs = [
      watch('spendingCards'),
      watch('spendingRules'),
      onSnapshot(
        doc(db, ...base, 'spendingSettings', 'main'),
        (s) => {
          setDocs((d) => ({ ...d, settings: s.exists() ? s.data() : undefined }));
          setAnswered((a) => ({ ...a, settings: true }));
        },
        fail(() => t('error.what.settings')),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [householdId]);

  // Recent transactions, live; the window moves on with the month.
  useEffect(() => {
    if (!householdId) return;
    const db = getDb();
    return onSnapshot(
      query(collection(db, 'households', householdId, 'spendingTransactions'), where('date', '>=', from)),
      (s) => {
        ranges.current.set('live', new Map(s.docs.map((x) => [x.id, x.data()])));
        publish();
        setAnswered((a) => ({ ...a, tx: true }));
      },
      (e) => errorRef.current(t('error.load', { what: t('error.what.transactions'), detail: e.message })),
    );
  }, [householdId, from, publish]);

  // Older stretches asked for, each followed from when it is first asked until the household changes.
  const followed = useRef(new Map<string, () => void>());
  useEffect(() => {
    const subs = followed.current;
    return () => {
      subs.forEach((stop) => stop());
      subs.clear();
    };
  }, [householdId]);
  useEffect(() => {
    if (!householdId) return;
    const db = getDb();
    for (const r of asked) {
      const key = rangeKey(r);
      if (followed.current.has(key)) continue;
      followed.current.set(
        key,
        onSnapshot(
          query(collection(db, 'households', householdId, 'spendingTransactions'), where('date', '>=', r.from), where('date', '<', r.to)),
          (s) => {
            ranges.current.set(key, new Map(s.docs.map((x) => [x.id, x.data()])));
            publish();
            setLoaded((l) => (l.has(key) ? l : new Set([...l, key])));
          },
          (e) => errorRef.current(t('error.load', { what: t('error.what.transactions'), detail: e.message })),
        ),
      );
    }
  }, [householdId, asked, publish]);

  const has = useCallback((range: DateRange) => {
    const older = beforeWindow(range, from);
    return !older || loaded.has(rangeKey(older)) || asked.some((r) => loaded.has(rangeKey(r)) && r.from <= older.from && r.to >= older.to);
  }, [from, loaded, asked]);
  const need = useCallback((range: DateRange) => {
    const older = beforeWindow(range, from);
    if (!older) return;
    setAsked((list) => (list.some((r) => r.from <= older.from && r.to >= older.to) ? list : [...list, older]));
  }, [from]);

  const actions = useMemo(() => {
    const commit = async (writes: Write[]) => {
      if (!householdId) throw new Error(t('error.noHousehold'));
      const db = getDb();
      for (let i = 0; i < writes.length; i += BATCH) {
        const batch = writeBatch(db);
        for (const w of writes.slice(i, i + BATCH)) {
          const ref = doc(db, 'households', householdId, w.collection, w.id);
          if (!w.data) batch.delete(ref);
          else if (w.merge) batch.set(ref, w.data, { merge: true });
          else batch.set(ref, w.data);
        }
        // Not awaited: the cache shows the change now; the server may be a while (or offline).
        batch.commit().catch((e: Error) => errorRef.current(t('error.save', { detail: e.message })));
      }
    };
    return makeActions(() => derive(docsRef.current, fallbackRef.current), me, commit);
  }, [householdId, me]);

  const seenKey = `spending-seen-alerts-${householdId ?? 'none'}`;
  const mail = useMemo(
    () => ({
      stored: () => {
        const token = storedGmailToken(auth);
        return token ? gmailMailbox(token) : null;
      },
      request: async () => gmailMailbox(await requestGmailToken(auth)),
      seen: () => {
        try {
          return new Set<string>(JSON.parse(localStorage.getItem(seenKey) ?? '[]'));
        } catch {
          return new Set<string>();
        }
      },
      markSeen: (ids: string[]) => {
        try {
          const prev: string[] = JSON.parse(localStorage.getItem(seenKey) ?? '[]');
          localStorage.setItem(seenKey, JSON.stringify([...new Set([...ids, ...prev])].slice(0, SEEN_MAX)));
        } catch {
          // A full or unavailable storage only means re-reading those emails next time.
        }
      },
    }),
    [seenKey],
  );

  const derived = useMemo(() => derive(docs, fallback), [docs, fallback]);
  const currency = spendingCurrency(householdCurrency, derived.settings.currencySymbol);
  const saveCurrency = useMemo(
    () => async (code: string) => {
      if (!householdId) throw new Error(t('error.noHousehold'));
      await setHouseholdCurrency(getDb(), householdId, code);
    },
    [householdId],
  );
  return { live: true, ready: answered.tx && answered.settings, me, ...derived, actions, mail, inboxes, currency, saveCurrency, has, need, oldestMonth };
}
