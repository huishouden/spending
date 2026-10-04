import { useMemo, useRef, useState } from 'react';
import type { Auth } from 'firebase/auth';
import type { Mailbox, MailMessage } from '../lib/mail';
import { gmailError, gmailMailbox, GmailError } from '@huishouden/pwa-kit/gmail';
import { checkAlerts, NothingToSearch } from '@huishouden/pwa-kit/spending-core';
import type { MailStatus, ReviewItem } from '../services/mailApi';
import { chooserCode, useAlertInboxes } from './useAlertInboxes';
import { t } from '../i18n';
import { cardDoc, DEFAULT_SPEND_SETTINGS, ruleDoc, type SpendSettings } from './model';
import { applyWrites, DEFAULT_RULE_DOCS, derive, emptyDocs, makeActions, type AlertInboxes, type Docs, type SpendingStore } from './store';

declare global {
  interface Window {
    /**
     * Browser tests: the sample talks to a stubbed calendar Worker at this address (page.route) for
     * its alert inboxes, as a signed-in member would, and Google's code client is stubbed too.
     */
    __mailTestUrl?: string;
  }
}

/**
 * The signed-out app: an invented household with its own cards, rules and transactions, kept in
 * memory, so every screen (settings, statement import, email check) can be tried and screenshotted.
 * Nothing is saved; a reload starts over.
 */

const SAMPLE_ME = 'sample@example.com';

/** Sunday 27 September 2026, 10:00 local time. The sample's clock starts here, so its month always reads the same. */
export const SAMPLE_NOW = new Date(2026, 8, 27, 10, 0).getTime();

/** Date, shop, amount, category, card. */
const SAMPLE_PURCHASES: [string, string, number, string, string][] = [
  ['2026-09-26', "Trader Joe's", 142.8, 'Groceries', 'Example Visa'],
  ['2026-09-25', 'The Olive Branch Bistro', 88.5, 'Dining & Food', 'Example Rewards Card'],
  ['2026-09-24', 'Costco Wholesale', 284.15, 'Groceries', 'Example Visa'],
  ['2026-09-23', 'Chevron Fuel', 52.4, 'Gas & Transport', 'Example Visa'],
  ['2026-09-22', 'Target Store #1128', 76.9, 'Shopping & Retail', 'Example Visa'],
  ['2026-09-20', 'Home Depot', 135.2, 'Home & Garden', 'Example Visa'],
  ['2026-09-19', 'Sushi Blossom', 114, 'Dining & Food', 'Example Rewards Card'],
  ['2026-09-18', 'Amazon.com', 45.6, 'Shopping & Retail', 'Example Visa'],
  ['2026-09-16', 'Whole Foods Market', 98.4, 'Groceries', 'Example Visa'],
  ['2026-09-15', 'Netflix Subscription', 22.99, 'Subscriptions & Tech', 'Example Everyday Card'],
  ['2026-09-14', 'Spotify Family', 19.99, 'Subscriptions & Tech', 'Example Everyday Card'],
  ['2026-09-12', 'Blue Bottle Coffee', 16.5, 'Dining & Food', 'Example Rewards Card'],
  ['2026-09-10', 'CVS Pharmacy', 38.75, 'Health & Personal Care', 'Example Everyday Card'],
  ['2026-09-08', 'Shell Oil', 48.2, 'Gas & Transport', 'Example Visa'],
  ['2026-09-06', 'Albertsons Grocers', 112.35, 'Groceries', 'Example Visa'],
  ['2026-09-04', 'Chipotle Mexican Grill', 34.6, 'Dining & Food', 'Example Rewards Card'],
  ['2026-09-02', 'Apple Services', 14.98, 'Subscriptions & Tech', 'Example Visa'],
  ['2026-09-01', 'Cinemark Theatres', 42, 'Entertainment', 'Example Rewards Card'],
  ['2026-08-30', 'Costco Wholesale', 312.45, 'Groceries', 'Example Visa'],
  ['2026-08-28', "Trader Joe's", 154.2, 'Groceries', 'Example Visa'],
  ['2026-08-25', 'Prime Steakhouse', 185, 'Dining & Food', 'Example Rewards Card'],
  ['2026-08-22', 'Target', 118.4, 'Shopping & Retail', 'Example Visa'],
  ['2026-08-18', 'Delta Airlines', 462.8, 'Travel & Lodging', 'Example Rewards Card'],
  ['2026-08-15', 'Chevron Gas', 54, 'Gas & Transport', 'Example Visa'],
  ['2026-08-12', 'Online Marketplace', 89.95, 'Shopping & Retail', 'Example Visa'],
  ['2026-08-10', 'Whole Foods Market', 122.5, 'Groceries', 'Example Visa'],
  ['2026-08-07', 'Thai Basil Kitchen', 64.3, 'Dining & Food', 'Example Rewards Card'],
  ['2026-08-04', 'Home Depot', 168, 'Home & Garden', 'Example Visa'],
  ['2026-08-01', 'Netflix + Spotify + Apple', 57.96, 'Subscriptions & Tech', 'Example Everyday Card'],
  ['2026-07-28', 'Marriott Resort', 540, 'Travel & Lodging', 'Example Rewards Card'],
  ['2026-07-24', 'Costco Wholesale', 275.6, 'Groceries', 'Example Visa'],
  ['2026-07-19', "Trader Joe's", 139.1, 'Groceries', 'Example Visa'],
  ['2026-07-14', 'Local Artisan Pizzeria', 58.7, 'Dining & Food', 'Example Rewards Card'],
  ['2026-07-10', 'REI Outdoor Goods', 145, 'Shopping & Retail', 'Example Visa'],
  ['2026-07-05', 'Chevron Fuel', 61.2, 'Gas & Transport', 'Example Visa'],
];

export const SAMPLE_CARDS = [
  { id: 'c-sample-1', name: 'Example Visa', last4: '1111', issuer: 'Example Bank', alertWords: ['alerts@bank.example.com'] },
  { id: 'c-sample-2', name: 'Example Rewards Card', last4: '2222', issuer: 'Example Card Co', alertWords: ['notices@card.example.com', 'rewards card'] },
  { id: 'c-sample-3', name: 'Example Everyday Card', last4: '3333', issuer: 'Example Bank', alertWords: ['alerts@bank.example.com'] },
];

export function sampleDocs(now = SAMPLE_NOW): Docs {
  const docs = emptyDocs();
  SAMPLE_PURCHASES.forEach(([date, description, amount, category, card], i) => {
    docs.spendingTransactions.set(`tx-sample-${i}`, { date, description, amount, category, card, type: amount < 0 ? 'Return' : 'Sale', source: 'statement' });
  });
  for (const { id, ...c } of SAMPLE_CARDS) docs.spendingCards.set(id, cardDoc(c, SAMPLE_ME, 0));
  for (const { id, ...r } of DEFAULT_RULE_DOCS) docs.spendingRules.set(id, ruleDoc(r, SAMPLE_ME, 0));
  // Email was checked two hours before the sample's clock starts.
  docs.settings = { ...DEFAULT_SPEND_SETTINGS, emailCheckedAt: now - 2 * 3_600_000, emailCheckedBy: SAMPLE_ME, updatedAt: 0, updatedBy: SAMPLE_ME };
  return docs;
}

/** Two card alerts and a payment notice from the last two days, so "Check email" always finds something. */
export function sampleMailbox(now = Date.now()): Mailbox {
  const hours = (h: number) => now - h * 3_600_000;
  const messages: MailMessage[] = [
    {
      id: 'sample-alert-1',
      date: hours(3),
      from: 'Example Card Co <notices@card.example.com>',
      subject: 'You made a $23.40 transaction',
      text: 'You made a $23.40 transaction with EXAMPLE NOODLE BAR on your card ending in 2222.',
    },
    {
      id: 'sample-alert-2',
      date: hours(26),
      from: 'Example Bank <alerts@bank.example.com>',
      subject: 'Purchase alert',
      text: 'You spent $61.15 at EXAMPLE GROCERY with your card ending in 1111.',
    },
    {
      id: 'sample-alert-3',
      date: hours(30),
      from: 'Example Bank <alerts@bank.example.com>',
      subject: 'Payment received',
      text: 'We received your payment of $500.00. Thank you for your payment.',
    },
  ];
  return {
    search: async () => messages.map((m) => m.id),
    get: async (id) => messages.find((m) => m.id === id)!,
  };
}

const MIN = 60_000;
const SAMPLE_INBOX = 'card-alerts@example.com';

/** The sample's inbox: connected a month ago, checked three minutes ago, the last purchase found two hours ago. */
export function sampleInboxStatus(now: number): MailStatus {
  return {
    available: true,
    inboxes: [
      {
        id: 'ib-sample', address: SAMPLE_INBOX, by: SAMPLE_ME, mine: true, connectedAt: now - 30 * 1440 * MIN, lastChecked: now - 3 * MIN, lastAlertAt: now - 120 * MIN, lastAdded: 1, error: null, checking: false,
        lastImport: { id: 'im-sample', at: now - 120 * MIN, added: 1, review: 1, done: true, undone: false },
        review: 1,
      },
    ],
    lastChecked: now - 3 * MIN,
  };
}

/** The sample inbox's one email that couldn't be read: no shop named. */
export function sampleReview(now: number): ReviewItem[] {
  const sent = now - 125 * MIN;
  const d = new Date(sent);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return [{ msg: 'sample-review-1', subject: 'Card activity on your account', sent, date, amount: 23.1, reason: 'no-merchant' }];
}

/** A stand-in signed-in member for browser tests against a stubbed Worker. */
const testCaller = { getIdToken: async () => 'test-id-token', refreshToken: 'test-refresh-token-for-the-sample' };
const testAuth = { currentUser: { email: SAMPLE_ME } } as unknown as Auth;

/** The sample household's store. Browser tests can point it at a stubbed Gmail with window.__gmailTestToken. */
export function useSampleStore(read: () => number = Date.now): SpendingStore {
  const [docs, setDocs] = useState<Docs>(() => sampleDocs(read()));
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const seen = useRef(new Set<string>());
  const settings: SpendSettings = DEFAULT_SPEND_SETTINGS;

  const actions = useMemo(
    () =>
      makeActions(
        () => derive(docsRef.current, settings),
        SAMPLE_ME,
        async (writes) => {
          docsRef.current = applyWrites(docsRef.current, writes);
          setDocs(docsRef.current);
        },
        read,
      ),
    // The fallback and the clock never change for the sample.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const mail = useMemo(() => {
    const box = () => {
      const token = typeof window !== 'undefined' ? window.__gmailTestToken : undefined;
      return token ? gmailMailbox(token) : sampleMailbox(read());
    };
    return {
      stored: box,
      request: async () => box(),
      seen: () => seen.current,
      markSeen: (ids: string[]) => ids.forEach((id) => seen.current.add(id)),
    };
  }, []);
  const derived = useMemo(() => derive(docs, settings), [docs, settings]);

  // Alert inboxes: in memory (one connected, Check now reads the sample mailbox), or a stubbed Worker in browser tests.
  const testBase = typeof window !== 'undefined' ? (window.__mailTestUrl ?? '') : '';
  const testCode = useMemo(() => chooserCode(testAuth, 'test-client.apps.googleusercontent.com'), []);
  const remote = useAlertInboxes({ householdId: testBase ? 'sample' : null, caller: () => (testBase ? testCaller : null), isAdmin: true, code: testCode, base: testBase });
  const [inboxStatus, setInboxStatus] = useState<MailStatus>(() => sampleInboxStatus(read()));
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [inboxBusy, setInboxBusy] = useState<AlertInboxes['busy']>(null);
  const reviewList = useRef<ReviewItem[]>(sampleReview(read()));
  const local = useMemo<AlertInboxes>(() => {
    const update = (patch: (s: MailStatus) => MailStatus) => setInboxStatus((s) => patch(s));
    return {
      available: true,
      status: inboxStatus,
      error: inboxError,
      busy: inboxBusy,
      isAdmin: true,
      refresh: async () => inboxStatus,
      awaitingGoogle: false,
      showGoogle: () => {},
      connect: async () => {
        // No Google window in the sample: a second inbox appears, as a partner's card alerts would.
        update((s) => ({ ...s, inboxes: [...s.inboxes.filter((i) => i.id !== 'ib-partner'), { id: 'ib-partner', address: 'partner-alerts@example.com', by: SAMPLE_ME, mine: true, connectedAt: read(), lastChecked: read(), lastAlertAt: null, lastAdded: null, error: null, checking: false }], lastChecked: read() }));
      },
      checkNow: async () => {
        setInboxBusy('check');
        setInboxError(null);
        try {
          const d = derive(docsRef.current, settings);
          const result = await checkAlerts(mail.stored(), { cards: d.cards, labels: d.settings.alertLabels, rules: d.rules, existing: d.records, seen: seen.current });
          await actions.addAlerts(result.create);
          mail.markSeen(result.read);
          const now = read();
          const next: MailStatus = {
            ...inboxStatus,
            inboxes: inboxStatus.inboxes.map((i) => ({ ...i, error: null, lastChecked: now, ...(result.create.length ? { lastAlertAt: now, lastAdded: result.create.length } : {}) })),
            lastChecked: now,
          };
          setInboxStatus(next);
          return next;
        } catch (e) {
          // Gmail refusing the sample's test token is what a revoked inbox looks like.
          if (e instanceof GmailError && e.status === 401) {
            update((s) => ({ ...s, inboxes: s.inboxes.map((i) => ({ ...i, error: 'revoked' })) }));
          }
          const message = e instanceof NothingToSearch ? t('email.nothingToSearch') : gmailError(e);
          setInboxError(message);
          throw new Error(message);
        } finally {
          setInboxBusy(null);
        }
      },
      disconnect: async (id) => update((s) => ({ ...s, inboxes: s.inboxes.filter((i) => i.id !== id) })),
      review: async (inbox) => (inbox === 'ib-sample' ? reviewList.current : []),
      answer: async (inbox, msg) => {
        reviewList.current = reviewList.current.filter((r) => r.msg !== msg);
        const left = reviewList.current.length;
        update((s) => ({ ...s, inboxes: s.inboxes.map((i) => (i.id === inbox ? { ...i, review: left, ...(i.lastImport ? { lastImport: { ...i.lastImport, review: left } } : {}) } : i)) }));
        return reviewList.current;
      },
      undo: async (inbox, importId) => {
        // The sample's last import wrote nothing that is still here to delete: it is only marked undone.
        update((s) => ({ ...s, inboxes: s.inboxes.map((i) => (i.id === inbox && i.lastImport?.id === importId ? { ...i, lastImport: { ...i.lastImport, undone: true } } : i)) }));
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxStatus, inboxError, inboxBusy]);
  const inboxes = testBase ? remote : local;

  // The sample household's dollars, until someone picks another currency in its settings.
  const [currency, setCurrency] = useState('USD');
  const saveCurrency = useMemo(() => async (code: string) => setCurrency(code), []);
  return { live: false, ready: true, me: SAMPLE_ME, ...derived, actions, mail, inboxes, currency, saveCurrency };
}
