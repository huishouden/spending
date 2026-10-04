import { formatCents, isCurrencyCode } from '@huishouden/pwa-kit/money';
import { daysInMonth, monthName as kitMonthName, monthYear, type Ymd } from '@huishouden/pwa-kit/time';
import { t } from '../i18n';
import type { SpendingRecord } from '../data/model';
import { CATEGORIES, FALLBACK_CATEGORY, OTHER_CATEGORY, categoryLabel } from './categorise';
import { containsKeyword, DEFAULT_IGNORED_PATTERNS } from '../services/sheets';

/**
 * "How are we doing this month?": what was spent, where it went and how that compares with the
 * budget or last month. Pure; amounts are summed in whole cents.
 */

/** 'YYYY-MM' */
export type MonthKey = string;

export const monthOf = (day: Ymd): MonthKey => day.slice(0, 7);

export function addMonth(key: MonthKey, n: number): MonthKey {
  const [y, m] = key.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** "September", with the year when it isn't this year: "December 2025" ("septiembre", "diciembre de 2025"). */
export function monthName(key: MonthKey, today: Ymd): string {
  const [y, m] = key.split('-').map(Number);
  return today.startsWith(`${y}-`) ? kitMonthName(m) : monthYear(`${key}-15`);
}

export const cents = (amount: number) => Math.round(amount * 100);

const SYMBOLS: Record<string, string> = { $: 'USD', US$: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', CHF: 'CHF', C$: 'CAD', A$: 'AUD', MX$: 'MXN', R$: 'BRL' };

/**
 * The currency Spending shows money in: the household's (`households/{id}.currency`, the suite's one
 * setting), else what an older Spending setting's symbol stands for, else US dollars.
 */
export function spendingCurrency(household: string | undefined, legacySymbol: string | undefined): string {
  if (isCurrencyCode(household)) return household;
  const s = legacySymbol?.trim() ?? '';
  if (isCurrencyCode(s.toUpperCase())) return s.toUpperCase();
  return SYMBOLS[s] ?? 'USD';
}

/** The kit's money format in the household's currency and the page's locale: "$1,388.31", "1388,31 €", or "$1,388" as a headline. */
export function money(amountCents: number, currency: string, headline = false): string {
  return formatCents(amountCents, { headline, currency });
}

/**
 * The purchases that count as spending, newest first: never-counted words (rent, card payments) and
 * zero amounts left out, and a category for every one.
 */
export function counted(records: SpendingRecord[], ignoredKeywords: string[]): SpendingRecord[] {
  const ignored = [...DEFAULT_IGNORED_PATTERNS, ...ignoredKeywords].map((k) => k.toLowerCase().trim()).filter(Boolean);
  return records
    .filter((r) => cents(r.amount) !== 0 && !ignored.some((k) => containsKeyword(r.description, k) || containsKeyword(r.category, k)))
    .map((r) => (r.category.trim() ? r : { ...r, category: FALLBACK_CATEGORY }))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** This month and every earlier month with a purchase, newest first. */
export function months(purchases: SpendingRecord[], today: Ymd): MonthKey[] {
  const now = monthOf(today);
  const set = new Set([now, ...purchases.map((p) => monthOf(p.date)).filter((m) => /^\d{4}-\d{2}$/.test(m) && m <= now)]);
  return [...set].sort((a, b) => b.localeCompare(a));
}

export interface CategoryTotal {
  name: string;
  cents: number;
  /** Of the month's spending, 0 to 1. */
  share: number;
  /** The categories it covers ("Other" covers several). */
  covers: string[];
}

/** Charts never show more than eight; past that, the smallest share "Other". */
const MAX_CATEGORIES = 8;

export type Pace = 'on-track' | 'ahead' | 'over' | 'under';

export interface MonthSummary {
  key: MonthKey;
  name: string;
  isCurrent: boolean;
  spentCents: number;
  previous: { name: string; cents: number } | null;
  categories: CategoryTotal[];
  purchases: SpendingRecord[];
  budget: {
    cents: number;
    /** Spent as a share of the budget (may pass 1). */
    used: number;
    /** How much of the month has gone, 0 to 1; 1 for a past month. */
    elapsed: number;
    pace: Pace;
  } | null;
}

export function summarise(purchases: SpendingRecord[], key: MonthKey, today: Ymd, budget: number): MonthSummary {
  const inMonth = purchases.filter((p) => monthOf(p.date) === key);
  const spentCents = inMonth.reduce((s, p) => s + cents(p.amount), 0);
  const prevKey = addMonth(key, -1);
  const prev = purchases.filter((p) => monthOf(p.date) === prevKey);

  const byCategory = new Map<string, number>();
  for (const p of inMonth) byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + cents(p.amount));
  const sorted = [...byCategory].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = sorted.length > MAX_CATEGORIES ? sorted.slice(0, MAX_CATEGORIES - 1) : sorted;
  const rest = sorted.slice(shown.length);
  const share = (c: number) => (spentCents > 0 ? Math.max(0, c) / spentCents : 0);
  const categories: CategoryTotal[] = shown.map(([name, c]) => ({ name, cents: c, share: share(c), covers: [name] }));
  if (rest.length) {
    const c = rest.reduce((s, [, x]) => s + x, 0);
    categories.push({ name: OTHER_CATEGORY, cents: c, share: share(c), covers: rest.map(([n]) => n) });
  }

  const isCurrent = key === monthOf(today);
  let summaryBudget: MonthSummary['budget'] = null;
  const budgetCents = cents(budget);
  if (budgetCents > 0 && key <= monthOf(today)) {
    const [y, m] = key.split('-').map(Number);
    const elapsed = isCurrent ? Number(today.slice(8, 10)) / daysInMonth(y, m) : 1;
    const pace: Pace = spentCents > budgetCents ? 'over' : !isCurrent ? 'under' : spentCents > budgetCents * elapsed ? 'ahead' : 'on-track';
    summaryBudget = { cents: budgetCents, used: spentCents / budgetCents, elapsed, pace };
  }

  return {
    key,
    name: monthName(key, today),
    isCurrent,
    spentCents,
    previous: prev.length ? { name: monthName(prevKey, today), cents: prev.reduce((s, p) => s + cents(p.amount), 0) } : null,
    categories,
    purchases: inMonth,
    budget: summaryBudget,
  };
}

/** The line under the headline: against the budget, or against last month when there is none. */
export function standing(s: MonthSummary, currency: string): { text: string; attention: boolean } | null {
  const $ = (c: number) => money(c, currency, true);
  const b = s.budget;
  if (b) {
    if (b.pace === 'over') return { text: t('standing.over', { amount: $(s.spentCents - b.cents), budget: $(b.cents) }), attention: true };
    if (b.pace === 'under') return { text: t('standing.under', { amount: $(b.cents - s.spentCents), budget: $(b.cents) }), attention: false };
    return { text: t(b.pace === 'on-track' ? 'standing.leftOnTrack' : 'standing.leftAhead', { amount: $(b.cents - s.spentCents), budget: $(b.cents) }), attention: false };
  }
  if (!s.previous) return null;
  const diff = s.spentCents - s.previous.cents;
  if (Math.abs(diff) < 100) return { text: t('standing.same', { month: s.previous.name }), attention: false };
  return { text: t(diff < 0 ? 'standing.less' : 'standing.more', { amount: $(Math.abs(diff)), month: s.previous.name }), attention: false };
}

/** When the numbers were last brought up to date, and how. */
export function lastUpdate(records: SpendingRecord[], emailCheckedAt: number | undefined): { at: number; how: 'email' | 'statement' } | null {
  const statementAt = Math.max(0, ...records.filter((r) => r.source === 'statement' && r.createdAt).map((r) => r.createdAt!));
  const emailAt = emailCheckedAt ?? 0;
  if (!statementAt && !emailAt) return null;
  return emailAt >= statementAt ? { at: emailAt, how: 'email' } : { at: statementAt, how: 'statement' };
}

/** The words of a description worth a rule: "EXAMPLE NOODLE BAR #12 SPRINGFIELD" → "example noodle bar". */
export function rulePhrase(description: string): string {
  return description
    .toLowerCase()
    .replace(/[#*].*$/, '')
    .replace(/[^a-z&'\s.-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
}

/** A category as shown: the app's own in the page's language, the household's own as written. */
export { categoryLabel };

/** The categories a purchase can go in: the usual ones, then the household's own. */
export function categoryChoices(rules: { category: string }[], extra: string[] = []): string[] {
  return [...new Set([...CATEGORIES, ...rules.map((r) => r.category), ...extra].filter(Boolean))];
}
