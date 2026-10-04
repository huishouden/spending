import { DEFAULT_RULES } from '../lib/categorise';
import type { CsvMapping, StatementRow } from '../lib/csvImport';
import type { Mailbox } from '../lib/mail';
import type { MailStatus } from '../services/mailApi';
import { planImport, statementIds, type AlertTx, type Plan } from '@huishouden/pwa-kit/spending-core';
import type { SheetSettings } from '../lib/sheetSettings';
import {
  cardDoc,
  DEFAULT_SPEND_SETTINGS,
  ruleDoc,
  ruleId,
  toCard,
  toRecord,
  toRule,
  toSettings,
  transactionDoc,
  type Card,
  type Rule,
  type SpendSettings,
  type SpendingRecord,
} from './model';

/**
 * The household's spending data and the actions that change it, the same for the live household
 * (Firestore) and the signed-out sample (in memory). Each backend only stores documents; deciding
 * what to write (de-duplication, ids, document shapes, first-use defaults) happens here once.
 */

export type Collection = 'spendingTransactions' | 'spendingCards' | 'spendingRules' | 'spendingSettings';

export interface Write {
  collection: Collection;
  id: string;
  /** Absent for a delete. */
  data?: Record<string, unknown>;
  /** Merge into the document instead of replacing it. */
  merge?: boolean;
}

export interface Docs {
  spendingTransactions: Map<string, Record<string, unknown>>;
  spendingCards: Map<string, Record<string, unknown>>;
  spendingRules: Map<string, Record<string, unknown>>;
  /** spendingSettings/main, once anyone has saved it. */
  settings?: Record<string, unknown>;
}

export const emptyDocs = (): Docs => ({ spendingTransactions: new Map(), spendingCards: new Map(), spendingRules: new Map() });

export interface ImportResult {
  added: number;
  replaced: number;
  duplicates: number;
}

export interface SpendingActions {
  /** Plans statement files' rows against what the household has (for the preview). */
  planStatements(files: StatementRow[][]): Plan<StatementRow & { id: string }>;
  /** Writes statement files' rows; remembers each file's columns on its card. */
  importStatements(files: { rows: StatementRow[]; remember?: { cardId: string; mapping: CsvMapping } }[]): Promise<ImportResult>;
  addAlerts(alerts: AlertTx[]): Promise<void>;
  recordEmailCheck(): Promise<void>;
  saveSettings(patch: Partial<Omit<SpendSettings, 'emailCheckedAt' | 'emailCheckedBy'>>): Promise<void>;
  /** Returns the card's id. */
  saveCard(id: string | null, card: Omit<Card, 'id'>): Promise<string>;
  deleteCard(id: string): Promise<void>;
  saveRule(rule: Omit<Rule, 'id'>, replacing?: string): Promise<void>;
  deleteRule(id: string): Promise<void>;
  recategorise(record: SpendingRecord, category: string): Promise<void>;
  deleteTransaction(id: string): Promise<void>;
  /** The one-time move of a legacy Sheet's Cards, Categories and Alert labels tabs. */
  importSheetSettings(s: SheetSettings): Promise<{ cards: number; rules: number; labels: number }>;
}

export interface MailAccess {
  /** A mailbox usable now without asking anyone, or null. */
  stored(): Mailbox | null;
  /** Asks for access (a Google popup); only from a tap. */
  request(): Promise<Mailbox>;
  /** Alert emails already read on this device, so a check reads only new ones. */
  seen(): Set<string>;
  markSeen(ids: string[]): void;
}

/**
 * Gmail accounts the household's card alerts arrive at, connected by any admin or member and checked
 * every few minutes by the calendar Worker as that member, with no app open.
 */
export interface AlertInboxes {
  /** False in a build without the Worker: the in-browser check of the member's own Gmail stays. */
  available: boolean;
  /** Null until the Worker has answered. */
  status: MailStatus | null;
  /** The last action's failure, in words. */
  error: string | null;
  busy: 'connect' | 'check' | 'disconnect' | null;
  /** Admins may disconnect any inbox; members their own. */
  isAdmin: boolean;
  refresh(): Promise<MailStatus | null>;
  /** Google's account chooser (from a tap), then the Worker keeps read-only access to that account. */
  connect(): Promise<void>;
  /** Every inbox checked now, with the household's latest cards and labels. Rejects with the failure in words. */
  checkNow(): Promise<MailStatus | null>;
  disconnect(id: string): Promise<void>;
}

export interface SpendingStore {
  live: boolean;
  /** False until the first answer from the store. */
  ready: boolean;
  me: string;
  settings: SpendSettings;
  /** Whether the household has saved settings yet (until then the defaults apply and are written on first change). */
  settingsSaved: boolean;
  cards: Card[];
  rules: Rule[];
  records: SpendingRecord[];
  actions: SpendingActions;
  mail: MailAccess;
  inboxes: AlertInboxes;
  /** The currency amounts are shown in: the household's (see `spendingCurrency`). */
  currency: string;
  /** Sets the household's currency, for every app (households/{id}.currency). */
  saveCurrency(code: string): Promise<void>;
}

export interface Derived {
  settings: SpendSettings;
  settingsSaved: boolean;
  cards: Card[];
  rules: Rule[];
  records: SpendingRecord[];
}

export const DEFAULT_RULE_DOCS = DEFAULT_RULES.map((r) => ({ id: ruleId(r.contains), ...r }));

/** What the screens read, from the stored documents; defaults until the household saves its own. */
export function derive(docs: Docs, fallback: SpendSettings): Derived {
  const saved = toSettings(docs.settings);
  const rules = [...docs.spendingRules].map(([id, d]) => toRule(id, d));
  return {
    settings: saved ?? fallback,
    settingsSaved: !!saved,
    cards: [...docs.spendingCards].map(([id, d]) => toCard(id, d)).sort((a, b) => a.name.localeCompare(b.name)),
    rules: saved ? rules : DEFAULT_RULE_DOCS,
    records: [...docs.spendingTransactions].map(([id, d]) => toRecord(id, d)),
  };
}

export function deviceFallback(device: { monthlyBudget: number; currencySymbol: string; ignoredKeywords: string[] }): SpendSettings {
  return { ...DEFAULT_SPEND_SETTINGS, monthlyBudget: device.monthlyBudget, currencySymbol: device.currencySymbol, ignoredKeywords: device.ignoredKeywords };
}

/**
 * The actions over a backend. `current()` is read at call time so an action always plans against the
 * latest data; `commit` stores a list of writes (the live backend batches them).
 */
export function makeActions(current: () => Derived, me: string, commit: (writes: Write[]) => Promise<void>, now: () => number = Date.now): SpendingActions {
  /** First change: the household's settings and default rules become its own documents. */
  const firstUse = (): Write[] => {
    const d = current();
    if (d.settingsSaved) return [];
    const t = now();
    return [
      { collection: 'spendingSettings', id: 'main', data: { ...settingsDoc(d.settings), updatedAt: t, updatedBy: me }, merge: true },
      ...DEFAULT_RULE_DOCS.map((r) => ({ collection: 'spendingRules' as const, id: r.id, data: ruleDoc(r, me, t) })),
    ];
  };

  const planStatements = (files: StatementRow[][]) => {
    const rows = files.flatMap((f, group) => {
      const ids = statementIds(f);
      return f.map((r, i) => ({ ...r, id: ids[i], group }));
    });
    return planImport(rows, current().records, 'statement');
  };

  return {
    planStatements,

    async importStatements(files) {
      const plan = planStatements(files.map((f) => f.rows));
      const t = now();
      const writes: Write[] = [
        ...firstUse(),
        ...plan.create.map((tx) => ({ collection: 'spendingTransactions' as const, id: tx.id, data: transactionDoc(tx, 'statement', me, t) })),
        ...plan.replace.map(({ id, tx }) => ({ collection: 'spendingTransactions' as const, id, data: transactionDoc(tx, 'statement', me, t, t) })),
      ];
      const cards = current().cards;
      for (const { remember } of files) {
        const card = remember && cards.find((c) => c.id === remember.cardId);
        if (card) writes.push({ collection: 'spendingCards', id: card.id, data: cardDoc({ ...card, csv: remember!.mapping }, me, t, t) });
      }
      await commit(writes);
      return { added: plan.create.length, replaced: plan.replace.length, duplicates: plan.duplicates };
    },

    async addAlerts(alerts) {
      if (!alerts.length) return;
      const t = now();
      await commit([...firstUse(), ...alerts.map((a) => ({ collection: 'spendingTransactions' as const, id: a.id, data: transactionDoc(a, 'alert', me, t) }))]);
    },

    async recordEmailCheck() {
      const t = now();
      await commit([...firstUse(), { collection: 'spendingSettings', id: 'main', data: { emailCheckedAt: t, emailCheckedBy: me, updatedAt: t, updatedBy: me }, merge: true }]);
    },

    async saveSettings(patch) {
      const t = now();
      const clean: Record<string, unknown> = {};
      if (patch.monthlyBudget !== undefined) clean.monthlyBudget = Math.max(0, Math.round(patch.monthlyBudget * 100) / 100);
      if (patch.currencySymbol !== undefined) clean.currencySymbol = patch.currencySymbol.trim().slice(0, 4) || '$';
      if (patch.ignoredKeywords !== undefined) clean.ignoredKeywords = uniqueWords(patch.ignoredKeywords, 100);
      if (patch.alertLabels !== undefined) clean.alertLabels = uniqueWords(patch.alertLabels, 20, false);
      await commit([...firstUse(), { collection: 'spendingSettings', id: 'main', data: { ...clean, updatedAt: t, updatedBy: me }, merge: true }]);
    },

    async saveCard(id, card) {
      const t = now();
      const existing = id ? current().cards.find((c) => c.id === id) : undefined;
      const docId = existing?.id ?? `c-${t.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      await commit([...firstUse(), { collection: 'spendingCards', id: docId, data: cardDoc({ ...existing, ...card }, me, t, existing ? t : undefined) }]);
      return docId;
    },

    async deleteCard(id) {
      await commit([{ collection: 'spendingCards', id }]);
    },

    async saveRule(rule, replacing) {
      const t = now();
      const id = ruleId(rule.contains);
      const writes: Write[] = [...firstUse()];
      if (replacing && replacing !== id) writes.push({ collection: 'spendingRules', id: replacing });
      writes.push({ collection: 'spendingRules', id, data: ruleDoc(rule, me, t) });
      await commit(writes);
    },

    async deleteRule(id) {
      // Seeding first, or the defaults would come back with this rule among them.
      const seed = firstUse().filter((w) => !(w.collection === 'spendingRules' && w.id === id));
      await commit([...seed, { collection: 'spendingRules', id }]);
    },

    async recategorise(record, category) {
      const t = now();
      const source = record.source === 'alert' ? 'alert' : 'statement';
      await commit([{ collection: 'spendingTransactions', id: record.id, data: transactionDoc({ ...record, category }, source, me, record.createdAt ?? t, t) }]);
    },

    async deleteTransaction(id) {
      await commit([{ collection: 'spendingTransactions', id }]);
    },

    async importSheetSettings(s) {
      const d = current();
      const t = now();
      const writes: Write[] = [...firstUse()];
      let cards = 0;
      for (const [i, c] of s.cards.entries()) {
        const same = d.cards.find((x) => x.name.toLowerCase() === c.name.toLowerCase() && (x.last4 ?? '') === (c.last4 ?? ''));
        const merged = same ? { ...same, issuer: same.issuer || c.issuer, alertWords: [...same.alertWords, ...c.alertWords] } : c;
        writes.push({ collection: 'spendingCards', id: same?.id ?? `c-${t.toString(36)}-${i}`, data: cardDoc(merged, me, t, same ? t : undefined) });
        if (!same) cards++;
      }
      for (const r of s.rules) writes.push({ collection: 'spendingRules', id: ruleId(r.contains), data: ruleDoc(r, me, t) });
      const labels = uniqueWords([...d.settings.alertLabels, ...s.labels], 20, false);
      writes.push({ collection: 'spendingSettings', id: 'main', data: { alertLabels: labels, updatedAt: t, updatedBy: me }, merge: true });
      await commit(writes);
      return { cards, rules: s.rules.length, labels: labels.length - d.settings.alertLabels.length };
    },
  };
}

function settingsDoc(s: SpendSettings) {
  return {
    monthlyBudget: s.monthlyBudget,
    currencySymbol: s.currencySymbol,
    ignoredKeywords: uniqueWords(s.ignoredKeywords, 100),
    alertLabels: uniqueWords(s.alertLabels, 20, false),
  };
}

function uniqueWords(list: string[], max: number, lower = true): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const w = (lower ? raw.toLowerCase() : raw).trim().slice(0, 100);
    if (!w || seen.has(w.toLowerCase())) continue;
    seen.add(w.toLowerCase());
    out.push(w);
  }
  return out.slice(0, max);
}

/** Applies writes to in-memory documents (the sample backend, and tests). */
export function applyWrites(docs: Docs, writes: Write[]): Docs {
  const next: Docs = {
    spendingTransactions: new Map(docs.spendingTransactions),
    spendingCards: new Map(docs.spendingCards),
    spendingRules: new Map(docs.spendingRules),
    settings: docs.settings,
  };
  for (const w of writes) {
    if (w.collection === 'spendingSettings') {
      next.settings = w.data ? (w.merge ? { ...next.settings, ...w.data } : w.data) : undefined;
      continue;
    }
    const map = next[w.collection];
    if (!w.data) map.delete(w.id);
    else map.set(w.id, w.merge ? { ...map.get(w.id), ...w.data } : w.data);
  }
  return next;
}
