import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { writeBatch } from '@huishouden/pwa-kit/firestore';
import { getDb } from '../services/firestoreTransactions';
import { auth } from '../services/auth';
import { gmailMailbox, requestGmailToken, storedGmailToken } from '@huishouden/pwa-kit/gmail';
import type { SpendSettings } from './model';
import { setHouseholdCurrency } from '@huishouden/pwa-kit/household';
import { spendingCurrency } from '../lib/month';
import { t } from '../i18n';
import { derive, emptyDocs, makeActions, type Docs, type SpendingStore, type Write } from './store';

/** Firestore takes at most 500 writes per batch. */
const BATCH = 400;
const SEEN_MAX = 500;

/**
 * The household's spending data, live from Firestore. Writes go through the persistent cache, so
 * they show at once (also offline) and reach the server when they can; a failure is reported.
 */
export function useLiveStore(householdId: string | null, me: string, fallback: SpendSettings, onError: (message: string) => void, householdCurrency?: string): SpendingStore {
  const [docs, setDocs] = useState<Docs>(emptyDocs);
  const [answered, setAnswered] = useState({ tx: false, settings: false });
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    setDocs(emptyDocs());
    setAnswered({ tx: false, settings: false });
    if (!householdId) return;
    const db = getDb();
    const base = ['households', householdId] as const;
    const fail = (what: () => string) => (e: Error) => errorRef.current(t('error.load', { what: what(), detail: e.message }));
    const watch = (name: 'spendingTransactions' | 'spendingCards' | 'spendingRules', done?: () => void) =>
      onSnapshot(
        collection(db, ...base, name),
        (s) => {
          setDocs((d) => ({ ...d, [name]: new Map(s.docs.map((x) => [x.id, x.data()])) }));
          done?.();
        },
        fail(() => (name === 'spendingTransactions' ? t('error.what.transactions') : name === 'spendingCards' ? t('error.what.cards') : t('error.what.rules'))),
      );
    const unsubs = [
      watch('spendingTransactions', () => setAnswered((a) => ({ ...a, tx: true }))),
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
  return { live: true, ready: answered.tx && answered.settings, me, ...derived, actions, mail, currency, saveCurrency };
}
