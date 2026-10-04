import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import formats from './__fixtures__/csv-formats.json';
import { DEFAULT_RULES } from './categorise';
import { cardFromFileName, detectMapping, mappingFits, parseDate, parseMoney, parseStatement, readCsv } from './csvImport';

const cards = [
  { name: 'Card One', last4: '1111' },
  { name: 'Card Two', last4: '2222' },
  { name: 'Card Three', last4: '3333' },
];
const read = (file: string) => readCsv(readFileSync(new URL(`./__fixtures__/${file}`, import.meta.url), 'utf8'));

describe('statement file formats', () => {
  for (const f of formats) {
    test(f.name, () => {
      const file = read(f.file);
      const { mapping, missing } = detectMapping(file);
      expect(missing).toEqual([]);
      expect(mapping).toEqual(f.mapping as typeof mapping);
      const result = parseStatement(file, mapping!, { card: f.card, cards, rules: DEFAULT_RULES, ignoredKeywords: ['rent payment'] });
      expect(result.rows.map((r) => [r.date, r.description, r.amount, r.card, r.category, r.type])).toEqual(f.rows);
      expect(result.skipped).toBe(f.skipped);
      expect(result.unreadable).toEqual(f.unreadable);
    });
  }
});

test("a file without an amount column says what's missing", () => {
  expect(detectMapping(readCsv('Date,Description,Balance\n2031-03-01,EXAMPLE,10.00\n'))).toEqual({ mapping: null, missing: ['amount'] });
});

test('a remembered mapping fits a file only when all its columns are there', () => {
  const file = read('csv/purchases-positive_1111.csv');
  const { mapping } = detectMapping(file);
  expect(mappingFits(mapping!, file.headers)).toBe(true);
  expect(mappingFits({ ...mapping!, category: 'Category' }, file.headers)).toBe(false);
});

test("the card from a last-4 in the file's name", () => {
  expect(cardFromFileName('purchases-positive_1111.csv', cards)?.name).toBe('Card One');
  expect(cardFromFileName('Activity20310321.csv', cards)).toBeNull();
  expect(cardFromFileName('statement-xxxx3333.csv', cards)?.name).toBe('Card Three');
});

describe('cells', () => {
  test('money', () => {
    expect(parseMoney('$1,234.50')).toBe(1234.5);
    expect(parseMoney('(12.00)')).toBe(-12);
    expect(parseMoney('12.00-')).toBe(-12);
    expect(parseMoney('-$3.10')).toBe(-3.1);
    expect(parseMoney('5.00 CR')).toBe(-5);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('n/a')).toBeNull();
  });

  test('dates', () => {
    expect(parseDate('2031-03-04')).toBe('2031-03-04');
    expect(parseDate('3/4/2031')).toBe('2031-03-04');
    expect(parseDate('3/4/31')).toBe('2031-03-04');
    expect(parseDate('04/03/2031', true)).toBe('2031-03-04');
    expect(parseDate('Mar 4, 2031')).toBe('2031-03-04');
    expect(parseDate('4 Mar 2031')).toBe('2031-03-04');
    expect(parseDate('13/13/2031')).toBeNull();
    expect(parseDate('soon')).toBeNull();
  });
});

test('statement amounts with a decimal comma', () => {
  expect(parseMoney('-12,50')).toBe(-12.5);
  expect(parseMoney('1.234,56 €')).toBe(1234.56);
  expect(parseMoney('€ 120,50')).toBe(120.5);
  expect(parseMoney('1,234')).toBe(1234);
  expect(parseMoney('1,234.56')).toBe(1234.56);
});
