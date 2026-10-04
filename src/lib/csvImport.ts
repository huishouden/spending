import { containsKeyword, DEFAULT_IGNORED_PATTERNS, parseCSV } from '../services/sheets';
import { categorise, type CategoryRule } from './categorise';
import type { TxFields } from './matching';

/**
 * Statement files (CSV) from any bank or card: finds the header row, works out which columns hold
 * the date, description and amount and which way the amounts are signed, and turns rows into the
 * household's transactions (positive = spent, negative = refunded). The column choice is kept per
 * card, so the next file from that card needs no questions.
 */

export interface CsvMapping {
  date: string;
  description: string;
  /** One signed amount column... */
  amount?: string;
  /** ...or separate money-out and money-in columns. */
  debit?: string;
  credit?: string;
  category?: string;
  type?: string;
  /** A column naming the card per row (a last-4 or a masked number), for files covering several cards. */
  card?: string;
  /** The sign a purchase has in the amount column. */
  purchases: 'negative' | 'positive';
  /** Dates are day/month/year rather than month/day/year. */
  dayFirst: boolean;
}

export interface CsvFile {
  headers: string[];
  rows: string[][];
}

export interface StatementRow extends TxFields {
  category: string;
  type: string;
  /** Last four digits from the row's card column, when the file has one. */
  last4?: string;
  /** 1-based row number below the header, for messages. */
  row: number;
}

export interface CardRef {
  name: string;
  last4?: string;
}

export interface ParseOptions {
  /** The card this file is for (rows without a card column of their own). */
  card: string;
  cards: CardRef[];
  rules: CategoryRule[];
  /** The household's "never count" words (rent, mortgage, card payments). */
  ignoredKeywords: string[];
}

export interface ParseResult {
  rows: StatementRow[];
  /** Card payments, transfers and anything matching the household's skipped words. */
  skipped: number;
  /** Rows (numbered below the header) whose date or amount couldn't be read. */
  unreadable: number[];
}

const PAYMENT_WORDS = ['payment thank you', 'automatic payment', 'autopay', 'online payment', 'payment received'];

const lower = (h: string) => h.trim().toLowerCase();

/** The file's header row (bank exports sometimes start with an account summary) and the rows after it. */
export function readCsv(text: string): CsvFile {
  const all = parseCSV(text.replace(/^﻿/, '')).map((r) => r.map((c) => c.trim()));
  const at = all.slice(0, 15).findIndex((r) => {
    const h = r.map(lower);
    return h.some((c) => /date/.test(c)) && h.some((c) => /amount|debit|credit|withdrawal|deposit/.test(c));
  });
  const start = at < 0 ? 0 : at;
  const headers = all[start] ?? [];
  const rows = all.slice(start + 1).filter((r) => r.some((c) => c !== ''));
  return { headers, rows };
}

function findHeader(headers: string[], tests: RegExp[], avoid?: RegExp): string | undefined {
  for (const t of tests) {
    const h = headers.find((x) => t.test(lower(x)) && !(avoid && avoid.test(lower(x))));
    if (h) return h;
  }
  return undefined;
}

/** Reads a money cell: "$1,234.50", "-12.00", "(12.00)", "12.00-", "12.00 CR", and the decimal comma: "-12,50", "1.234,56 €". */
export function parseMoney(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/-$/.test(s)) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (/\bCR$/i.test(s)) {
    negative = !negative;
    s = s.replace(/\s*CR$/i, '');
  }
  s = s.replace(/[$€£\s\u00a0\u202f]/g, '');
  // European statements write a decimal comma: "12,50", "1.234,56". A comma with one or two digits
  // after it, and no point after it, is the decimal; otherwise commas group thousands ("1,234.56").
  s = /,\d{1,2}$/.test(s) && s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s);
  return negative ? -n : n;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ymd = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** A date cell as YYYY-MM-DD: 2031-03-14, 2031/03/14, 3/14/2031, 14/03/2031 (dayFirst), 14.03.31, Mar 14 2031, 14 Mar 2031. */
export function parseDate(raw: string | undefined, dayFirst = false): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return dayFirst ? ymd(year, +m[2], +m[1]) : ymd(year, +m[1], +m[2]);
  }
  m = /^([a-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/i.exec(s);
  if (m && MONTHS.includes(m[1].toLowerCase())) return ymd(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  m = /^(\d{1,2})[ -]([a-z]{3})[a-z]*\.?[ -](\d{4})$/i.exec(s);
  if (m && MONTHS.includes(m[2].toLowerCase())) return ymd(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  return null;
}

const isPaymentType = (type: string) => /payment|transfer/i.test(type) || /^other$/i.test(type.trim());

/**
 * Which column is which, from the header names, and which way amounts are signed, from the rows.
 * Returns the columns it could not find (date, description, amount) when the file doesn't say.
 */
export function detectMapping(file: CsvFile): { mapping: CsvMapping | null; missing: string[] } {
  const { headers, rows } = file;
  const date = findHeader(headers, [/^(transaction|trans\.?) ?date$/, /^date$/, /transaction date|trans\.? date/, /^posted?( date)?$/, /date/]);
  const description = findHeader(
    headers,
    [/^description$/, /^(merchant|payee|name|details|narrative|memo)$/, /description|merchant|payee|details/],
    /card|account|category|type|date|amount/,
  );
  const amount = findHeader(headers, [/^amount$/, /^amount \(.*\)$/, /amount/], /balance|original/);
  const debit = findHeader(headers, [/^debit$/, /debit|withdrawal|money out|paid out|charge/]);
  const credit = findHeader(headers, [/^credit$/, /credit|deposit|money in|paid in/], /card/);
  const category = findHeader(headers, [/^category$/, /category/]);
  const type = findHeader(headers, [/^type$/, /^transaction type$/, /^details$/], /card/);
  const card = findHeader(headers, [/^card( no\.?| number| member)?$/, /card no|card number|card ending|last ?4|^account( number)?$/]);

  const split = !amount && !!debit && !!credit;
  const missing = [!date && 'date', !description && 'description', !amount && !split && 'amount'].filter(Boolean) as string[];
  if (missing.length) return { mapping: null, missing };

  const mapping: CsvMapping = {
    date: date!,
    description: description!,
    ...(split ? { debit, credit } : { amount }),
    ...(category ? { category } : {}),
    ...(type && type !== description ? { type } : {}),
    ...(card ? { card } : {}),
    purchases: 'negative',
    dayFirst: false,
  };

  const col = (name?: string) => (name ? headers.indexOf(name) : -1);
  const di = col(mapping.date);
  mapping.dayFirst = rows.some((r) => {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(r[di] ?? '');
    return !!m && +m[1] > 12;
  });

  if (!split) {
    const ai = col(mapping.amount);
    const ti = col(mapping.type);
    const desc = col(mapping.description);
    const signs = (filter: (r: string[]) => boolean) => {
      let neg = 0;
      let pos = 0;
      for (const r of rows.filter(filter)) {
        const n = parseMoney(r[ai]);
        if (n === null || n === 0) continue;
        if (n < 0) neg++;
        else pos++;
      }
      return { neg, pos };
    };
    // A type column ("Sale", "Purchase", "Debit") settles it; otherwise most rows on a card or bank
    // export are purchases, payments excluded.
    let s = ti >= 0 ? signs((r) => /sale|purchase|debit/i.test(r[ti] ?? '')) : { neg: 0, pos: 0 };
    if (s.neg + s.pos === 0) s = signs((r) => !PAYMENT_WORDS.some((w) => containsKeyword(r[desc] ?? '', w)) && !(ti >= 0 && isPaymentType(r[ti] ?? '')));
    mapping.purchases = s.pos > s.neg ? 'positive' : 'negative';
  }
  return { mapping, missing: [] };
}

/** Whether a remembered mapping fits this file (every column it names is present). */
export function mappingFits(mapping: CsvMapping, headers: string[]): boolean {
  const cols = [mapping.date, mapping.description, mapping.amount, mapping.debit, mapping.credit, mapping.category, mapping.type, mapping.card];
  return cols.every((c) => c === undefined || headers.includes(c)) && (!!mapping.amount || (!!mapping.debit && !!mapping.credit));
}

/** The card a file is for, from a last-4 in its name ("Activity1111_2031.csv"). */
export function cardFromFileName<C extends CardRef>(fileName: string, cards: C[]): C | null {
  const groups = fileName.match(/\d{4,}/g) ?? [];
  for (const g of groups) {
    const card = cards.find((c) => c.last4 && (g === c.last4 || g.startsWith(c.last4) || g.endsWith(c.last4)));
    if (card) return card;
  }
  return null;
}

/** The household's transactions from a statement file. */
export function parseStatement(file: CsvFile, mapping: CsvMapping, options: ParseOptions): ParseResult {
  const { headers, rows } = file;
  const col = (name?: string) => (name ? headers.indexOf(name) : -1);
  const idx = {
    date: col(mapping.date),
    description: col(mapping.description),
    amount: col(mapping.amount),
    debit: col(mapping.debit),
    credit: col(mapping.credit),
    category: col(mapping.category),
    type: col(mapping.type),
    card: col(mapping.card),
  };
  const skipWords = [...DEFAULT_IGNORED_PATTERNS, ...PAYMENT_WORDS, ...options.ignoredKeywords].map((k) => k.trim().toLowerCase()).filter(Boolean);
  const result: ParseResult = { rows: [], skipped: 0, unreadable: [] };

  rows.forEach((r, i) => {
    const row = i + 1;
    const description = (r[idx.description] ?? '').trim();
    const bankType = idx.type >= 0 ? (r[idx.type] ?? '').trim() : '';
    if (isPaymentType(bankType) || skipWords.some((k) => containsKeyword(description, k))) {
      result.skipped++;
      return;
    }
    const date = parseDate(r[idx.date], mapping.dayFirst);
    let spend: number | null;
    if (idx.amount >= 0) {
      const n = parseMoney(r[idx.amount]);
      spend = n === null ? null : mapping.purchases === 'negative' ? -n : n;
    } else {
      const out = parseMoney(r[idx.debit]);
      const back = parseMoney(r[idx.credit]);
      spend = out !== null && out !== 0 ? Math.abs(out) : back !== null && back !== 0 ? -Math.abs(back) : out ?? back;
    }
    if (!date || spend === null || !description) {
      result.unreadable.push(row);
      return;
    }
    if (spend === 0) return;
    const amount = Math.round(spend * 100) / 100;

    let card = options.card;
    let last4: string | undefined;
    if (idx.card >= 0) {
      const digits = (r[idx.card] ?? '').match(/(\d{4})\D*$/)?.[1];
      if (digits) {
        // A card the household hasn't listed keeps its digits rather than joining the chosen card.
        card = options.cards.find((c) => c.last4 === digits)?.name ?? `Card ...${digits}`;
        last4 = digits;
      }
    }
    const bankCategory = idx.category >= 0 ? r[idx.category] : undefined;
    result.rows.push({
      date,
      description,
      amount,
      card,
      category: categorise(description, options.rules, bankCategory),
      type: bankType && !/^(debit|credit)$/i.test(bankType) ? bankType : amount < 0 ? 'Return' : 'Sale',
      ...(last4 ? { last4 } : {}),
      row,
    });
  });
  return result;
}
