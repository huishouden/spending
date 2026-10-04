import { describe, expect, test } from 'bun:test';
import { formatCents } from '@huishouden/pwa-kit/money';
import { setLangForTests } from '@huishouden/pwa-kit/i18n';
import records from './__fixtures__/month-records.json';
import { addMonth, counted, lastUpdate, money, monthName, months, rulePhrase, spendingCurrency, standing, summarise } from './month';

const purchases = counted(records, ['rent payment']);
const today = '2031-03-15';

test('rent, card payments and zero amounts never count; a missing category is Miscellaneous', () => {
  expect(purchases.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'h', 'i']);
  expect(purchases.find((p) => p.id === 'e')?.category).toBe('Miscellaneous');
});

test('months: this one and every earlier month with a purchase, newest first', () => {
  expect(months(purchases, today)).toEqual(['2031-03', '2031-02', '2031-01']);
  expect(months(purchases, '2031-05-01')).toEqual(['2031-05', '2031-03', '2031-02', '2031-01']);
  expect(addMonth('2031-01', -1)).toBe('2030-12');
  expect(addMonth('2030-12', 1)).toBe('2031-01');
});

describe('a month', () => {
  test('spent in cents, refunds netted, categories largest first', () => {
    const s = summarise(purchases, '2031-03', today, 0);
    expect(s.spentCents).toBe(6115 + 2340 - 1800 + 4010 + 999);
    expect(s.categories.map((c) => [c.name, c.cents])).toEqual([
      ['Groceries', 6115],
      ['Dining & Food', 2340],
      ['Shopping & Retail', 2210],
      ['Miscellaneous', 999],
    ]);
    expect(s.categories.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1, 6);
    expect(s.name).toBe('March');
    expect(s.previous).toEqual({ name: 'February', cents: 18050 });
  });

  test('no budget: compared with last month', () => {
    expect(standing(summarise(purchases, '2031-03', today, 0), 'USD')).toEqual({ text: '$64 less than February', attention: false });
    expect(standing(summarise(purchases, '2031-01', today, 0), 'USD')).toBeNull();
  });

  test('a budget: on track, ahead of pace, over', () => {
    // 15 of 31 days gone; $116.64 spent.
    expect(standing(summarise(purchases, '2031-03', today, 500), 'USD')).toEqual({ text: '$383 left of $500 · on track', attention: false });
    expect(standing(summarise(purchases, '2031-03', today, 200), 'USD')).toEqual({ text: '$83 left of $200 · ahead of pace', attention: false });
    expect(standing(summarise(purchases, '2031-03', today, 100), 'USD')).toEqual({ text: '$17 over the $100 budget', attention: true });
    expect(standing(summarise(purchases, '2031-02', today, 500), 'USD')).toEqual({ text: '$320 under the $500 budget', attention: false });
    expect(summarise(purchases, '2031-03', today, 500).budget?.elapsed).toBeCloseTo(15 / 31, 6);
    expect(summarise(purchases, '2031-02', today, 500).budget?.elapsed).toBe(1);
  });

  test('more than eight categories: the smallest are Other', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...records[0], id: `m${i}`, category: `Cat ${i}`, amount: 100 - i }));
    const s = summarise(many, '2031-03', today, 0);
    expect(s.categories).toHaveLength(8);
    expect(s.categories[7]).toMatchObject({ name: 'Other', cents: 9200 + 9100 + 9300, covers: ['Cat 7', 'Cat 8', 'Cat 9'] });
  });
});

test('last update: the later of the email check and the last statement import', () => {
  expect(lastUpdate(records, undefined)).toEqual({ at: 1900000000000, how: 'statement' });
  expect(lastUpdate(records, 1950000000000)).toEqual({ at: 1950000000000, how: 'email' });
  expect(lastUpdate([], undefined)).toBeNull();
});

test('money in the household currency, in the page locale', () => {
  expect(money(138831, 'USD', true)).toBe('$1,388');
  expect(money(138831, 'USD')).toBe('$1,388.31');
  expect(money(-1800, 'EUR')).toBe('-€18.00');
  expect(formatCents(138831, { currency: 'EUR', locale: 'nl-NL' })).toBe('€\u00a01.388,31');
});

test('the currency: the household’s, else an older Spending symbol’s, else dollars', () => {
  expect(spendingCurrency('EUR', '$')).toBe('EUR');
  expect(spendingCurrency(undefined, '€')).toBe('EUR');
  expect(spendingCurrency(undefined, '£')).toBe('GBP');
  expect(spendingCurrency(undefined, 'sek')).toBe('SEK');
  expect(spendingCurrency(undefined, 'kr')).toBe('USD');
  expect(spendingCurrency(undefined, undefined)).toBe('USD');
});

test('month names and the standing line follow the page language', async () => {
  await setLangForTests('es', ['es-MX']);
  try {
    expect(monthName('2031-03', '2031-03-20')).toBe('marzo');
    expect(monthName('2030-12', '2031-03-20')).toBe('diciembre de 2030');
    expect(standing(summarise(purchases, '2031-03', today, 0), 'USD')?.text).toBe('$64 menos que en febrero');
  } finally {
    await setLangForTests('en');
  }
});

test('a rule phrase from a description', () => {
  expect(rulePhrase('EXAMPLE NOODLE BAR #12 SPRINGFIELD')).toBe('example noodle bar');
});
