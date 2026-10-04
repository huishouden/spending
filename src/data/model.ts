import type { CsvMapping } from '../lib/csvImport';
import { transactionDoc, TRANSACTION_FIELDS, type NewTransaction } from '@huishouden/pwa-kit/spending-core';

export { transactionDoc, TRANSACTION_FIELDS, type NewTransaction };

/**
 * The household's spending data in Firestore, under households/{householdId}/:
 *
 *   spendingTransactions/{id}  one card charge or refund (also written by the legacy Apps Script mirror)
 *   spendingSettings/main      budget, currency, skipped words, Gmail labels, last email check
 *   spendingCards/{id}         the household's cards: name, last 4, issuer, alert words, file columns
 *   spendingRules/{id}         "merchant contains X → category Y"
 *
 * Field lists here are the ones the security rules allow (huishouden/rules firestore.rules).
 */

export interface SpendingRecord {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  card: string;
  type: string;
  source: string;
  last4?: string;
  emailId?: string;
  createdAt?: number;
  by?: string;
}

export interface Card {
  id: string;
  name: string;
  last4?: string;
  issuer?: string;
  alertWords: string[];
  csv?: CsvMapping;
}

export interface Rule {
  id: string;
  contains: string;
  category: string;
}

export interface SpendSettings {
  monthlyBudget: number;
  currencySymbol: string;
  ignoredKeywords: string[];
  alertLabels: string[];
  emailCheckedAt?: number;
  emailCheckedBy?: string;
}

export const SETTINGS_FIELDS = ['monthlyBudget', 'currencySymbol', 'ignoredKeywords', 'alertLabels', 'emailCheckedAt', 'emailCheckedBy', 'updatedAt', 'updatedBy'] as const;
export const CARD_FIELDS = ['name', 'last4', 'issuer', 'alertWords', 'csv', 'createdAt', 'updatedAt', 'by'] as const;
export const CSV_FIELDS = ['date', 'description', 'amount', 'debit', 'credit', 'category', 'type', 'card', 'purchases', 'dayFirst'] as const;
export const RULE_FIELDS = ['contains', 'category', 'createdAt', 'updatedAt', 'by'] as const;

/** Skipped words a new household starts with: what is never card spending. */
export const DEFAULT_IGNORED_KEYWORDS = ['mortgage', 'rent payment', 'lease', 'direct debit', 'payment thank you', 'autopay', 'card payment', 'escrow', 'payroll'];

export const DEFAULT_SPEND_SETTINGS: SpendSettings = {
  monthlyBudget: 2000,
  currencySymbol: '$',
  ignoredKeywords: DEFAULT_IGNORED_KEYWORDS,
  alertLabels: [],
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function toRecord(id: string, d: Record<string, unknown>): SpendingRecord {
  return {
    id,
    date: str(d.date),
    description: str(d.description),
    amount: typeof d.amount === 'number' ? d.amount : Number(d.amount) || 0,
    category: str(d.category),
    card: str(d.card),
    type: str(d.type),
    source: str(d.source) || 'statement',
    ...(d.last4 ? { last4: str(d.last4) } : {}),
    ...(d.emailId ? { emailId: str(d.emailId) } : {}),
    ...(typeof d.createdAt === 'number' ? { createdAt: d.createdAt } : {}),
    ...(d.by ? { by: str(d.by) } : {}),
  };
}

export function toCard(id: string, d: Record<string, unknown>): Card {
  const csv = d.csv && typeof d.csv === 'object' ? (d.csv as CsvMapping) : undefined;
  return {
    id,
    name: str(d.name),
    ...(d.last4 ? { last4: str(d.last4) } : {}),
    ...(d.issuer ? { issuer: str(d.issuer) } : {}),
    alertWords: strList(d.alertWords),
    ...(csv ? { csv } : {}),
  };
}

export const toRule = (id: string, d: Record<string, unknown>): Rule => ({ id, contains: str(d.contains), category: str(d.category) });

export function toSettings(d: Record<string, unknown> | undefined): SpendSettings | null {
  if (!d) return null;
  return {
    monthlyBudget: typeof d.monthlyBudget === 'number' ? d.monthlyBudget : DEFAULT_SPEND_SETTINGS.monthlyBudget,
    currencySymbol: str(d.currencySymbol) || DEFAULT_SPEND_SETTINGS.currencySymbol,
    ignoredKeywords: strList(d.ignoredKeywords),
    alertLabels: strList(d.alertLabels),
    ...(typeof d.emailCheckedAt === 'number' ? { emailCheckedAt: d.emailCheckedAt } : {}),
    ...(d.emailCheckedBy ? { emailCheckedBy: str(d.emailCheckedBy) } : {}),
  };
}

/** A card document; the remembered file columns keep only the fields the rules allow. */
export function cardDoc(card: Omit<Card, 'id'>, by: string, createdAt: number, updatedAt?: number) {
  const csv = card.csv
    ? Object.fromEntries(CSV_FIELDS.filter((k) => card.csv![k] !== undefined).map((k) => [k, card.csv![k]]))
    : undefined;
  return {
    name: card.name.trim().slice(0, 60),
    ...(card.last4 && /^\d{4}$/.test(card.last4) ? { last4: card.last4 } : {}),
    ...(card.issuer?.trim() ? { issuer: card.issuer.trim().slice(0, 40) } : {}),
    alertWords: [...new Set(card.alertWords.map((w) => w.trim()).filter(Boolean))].slice(0, 20).map((w) => w.slice(0, 100)),
    ...(csv ? { csv } : {}),
    createdAt,
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    by,
  };
}

export const ruleDoc = (rule: Omit<Rule, 'id'>, by: string, createdAt: number) => ({
  contains: rule.contains.trim().slice(0, 80),
  category: rule.category.trim().slice(0, 60),
  createdAt,
  by,
});

/** A stable id for a seeded or imported rule, so two members seeding at once write the same documents. */
export const ruleId = (contains: string) => `r-${contains.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'rule'}`;
