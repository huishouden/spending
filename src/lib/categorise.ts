import { t } from '../i18n';

/**
 * Categories come from the household's own rules ("when the merchant contains X, it's category Y"),
 * in the kit's spending-core, shared with the calendar Worker's mail checker so both categorise an
 * alert alike. Here: only how a category is shown.
 */
export { CATEGORIES, categorise, DEFAULT_RULES, FALLBACK_CATEGORY, matchesRule, OTHER_CATEGORY, ruleCategory, type CategoryRule } from '@huishouden/pwa-kit/spending-core';
import type { CATEGORIES, OTHER_CATEGORY } from '@huishouden/pwa-kit/spending-core';

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

