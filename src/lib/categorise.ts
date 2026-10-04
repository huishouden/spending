import { cleanCategoryName } from '../services/sheets';
import { t } from '../i18n';

/**
 * Categories come from the household's own rules: "when the merchant contains X, it's category Y".
 * A new household starts with DEFAULT_RULES (national chains and generic words, the same ground the
 * Apps Script's built-in rules covered); the household edits, adds and removes them as data.
 */

export interface CategoryRule {
  contains: string;
  category: string;
}

/** The dashboard's categories, in the order the Settings screen offers them. */
export const CATEGORIES = [
  'Groceries',
  'Dining & Food',
  'Shopping & Retail',
  'Gas & Transport',
  'Subscriptions & Tech',
  'Bills & Utilities',
  'Home & Garden',
  'Health & Personal Care',
  'Travel & Lodging',
  'Entertainment',
  'Miscellaneous',
] as const;

/** Where a charge goes when no rule matches and the statement file names no category. */
export const FALLBACK_CATEGORY = 'Miscellaneous';

/** The chart's bucket for the smallest categories past eight. */
export const OTHER_CATEGORY = 'Other';

const CATEGORY_KEYS = {
  Groceries: 'category.groceries',
  'Dining & Food': 'category.dining',
  'Shopping & Retail': 'category.shopping',
  'Gas & Transport': 'category.transport',
  'Subscriptions & Tech': 'category.subscriptions',
  'Bills & Utilities': 'category.bills',
  'Home & Garden': 'category.home',
  'Health & Personal Care': 'category.health',
  'Travel & Lodging': 'category.travel',
  Entertainment: 'category.entertainment',
  Miscellaneous: 'category.miscellaneous',
  Other: 'category.other',
} as const satisfies Record<(typeof CATEGORIES)[number] | typeof OTHER_CATEGORY, string>;

/**
 * A category as shown. Categories are stored in English, as the rules, statements and the legacy
 * Sheet write them: the app's own show in the page's language, a household's own as written.
 */
export function categoryLabel(name: string): string {
  const key = (CATEGORY_KEYS as Record<string, (typeof CATEGORY_KEYS)[keyof typeof CATEGORY_KEYS]>)[name];
  return key ? t(key) : name;
}

const rules = (category: string, words: string[]): CategoryRule[] => words.map((contains) => ({ contains, category }));

export const DEFAULT_RULES: CategoryRule[] = [
  ...rules('Groceries', ['grocery', 'supermarket', 'farmers market', 'whole foods', 'wholefds', 'trader joe', 'safeway', 'kroger', 'costco', 'aldi', 'publix']),
  ...rules('Dining & Food', ['restaurant', 'cafe', 'coffee', 'bakery', 'pizza', 'taco', 'burger', 'grill', 'diner', 'doordash', 'uber eats', 'grubhub', 'starbucks', 'mcdonald', 'chipotle']),
  ...rules('Shopping & Retail', ['amazon', 'mktplace pmts', 'target', 'walmart', 'etsy', 'best buy', 'nike', 'macy']),
  ...rules('Gas & Transport', ['fuel', 'gas station', 'chevron', 'shell oil', 'exxon', 'mobil', 'circle k', 'parking', 'toll', 'transit', 'lyft', 'uber trip']),
  ...rules('Subscriptions & Tech', ['netflix', 'spotify', 'hulu', 'disney plus', 'apple.com', 'google storage', 'amazon web services', 'subscription']),
  ...rules('Bills & Utilities', ['utility', 'utilities', 'electric', 'water bill', 'internet', 'wireless', 'insurance', 'comcast', 'xfinity', 'verizon', 't-mobile']),
  ...rules('Home & Garden', ['home depot', "lowe's", 'lowes', 'ikea', 'wayfair', 'hardware', 'garden', 'nursery']),
  ...rules('Health & Personal Care', ['pharmacy', 'cvs', 'walgreens', 'clinic', 'hospital', 'medical', 'doctor', 'dental', 'veterinar', 'animal hospital', 'salon', 'barber', 'fitness', 'gym']),
  ...rules('Travel & Lodging', ['airline', 'airways', 'airbnb', 'hotel', 'motel', 'resort']),
  ...rules('Entertainment', ['cinema', 'theater', 'theatre', 'tickets', 'museum', 'concert']),
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Whether `needle` occurs in `text` starting at a word boundary, so "market" finds "FARMERS MARKET"
 * and "MARKETPLACE" but "gas" does not find "VEGAS".
 */
export function matchesRule(text: string, needle: string): boolean {
  const n = norm(needle);
  if (!n) return false;
  const t = norm(text);
  let from = 0;
  for (;;) {
    const i = t.indexOf(n, from);
    if (i < 0) return false;
    if (i === 0 || !/[a-z0-9]/.test(t[i - 1])) return true;
    from = i + 1;
  }
}

/**
 * The household's category for a merchant: the rule with the longest matching phrase wins, so
 * "amazon web services" beats "amazon", and a household's "example cafe → Groceries" beats the
 * default "cafe". On a tie the later rule (usually the household's own) wins.
 * Returns null when no rule matches.
 */
export function ruleCategory(merchant: string, list: CategoryRule[]): string | null {
  let best: CategoryRule | null = null;
  for (const r of list) {
    if (!r.contains.trim() || !r.category.trim()) continue;
    if (!matchesRule(merchant, r.contains)) continue;
    if (!best || norm(r.contains).length >= norm(best.contains).length) best = r;
  }
  return best ? best.category.trim() : null;
}

/** Rule first, then the category the bank's file gave (in the dashboard's words), then Miscellaneous. */
export function categorise(merchant: string, list: CategoryRule[], bankCategory?: string): string {
  const rule = ruleCategory(merchant, list);
  if (rule) return rule;
  return bankCategory?.trim() ? cleanCategoryName(bankCategory) : FALLBACK_CATEGORY;
}
