import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { planImport } from '@huishouden/pwa-kit/spending-core';
import { detectMapping, parseStatement, readCsv } from './csvImport';
import { applyWrites, DEFAULT_RULE_DOCS, derive, emptyDocs, makeActions, type Docs, type Write } from '../data/store';
import { DEFAULT_SPEND_SETTINGS } from '../data/model';
import { beforeWindow, liveFrom, mergeRanges, monthRange, monthsSince, rangeKey, statementRange } from './window';

describe('the live window', () => {
  test('starts on last month’s first day, or 40 days back when that is earlier', () => {
    expect(liveFrom('2026-10-05')).toBe('2026-08-26');
    expect(liveFrom('2026-10-20')).toBe('2026-09-01');
    expect(liveFrom('2026-03-02')).toBe('2026-01-21');
    expect(liveFrom('2026-01-15')).toBe('2025-12-01');
  });

  test('a range inside it needs nothing; one reaching before it needs only the part before', () => {
    expect(beforeWindow({ from: '2026-09-01', to: '2026-11-01' }, '2026-09-01')).toBeNull();
    expect(beforeWindow({ from: '2026-06-01', to: '2026-08-01' }, '2026-09-01')).toEqual({ from: '2026-06-01', to: '2026-08-01' });
    expect(beforeWindow({ from: '2026-08-01', to: '2026-10-01' }, '2026-09-01')).toEqual({ from: '2026-08-01', to: '2026-09-01' });
    expect(beforeWindow({ from: '2026-08-01', to: '2026-08-01' }, '2026-09-01')).toBeNull();
    expect(rangeKey({ from: '2026-06-01', to: '2026-08-01' })).toBe('2026-06-01|2026-08-01');
  });

  test('a month’s glance needs that month and the one before', () => {
    expect(monthRange('2026-01')).toEqual({ from: '2025-12-01', to: '2026-02-01' });
  });

  test('a statement’s days are widened by the matching window', () => {
    expect(statementRange(['2026-03-10', 'not a date', '2026-03-02'])).toEqual({ from: '2026-02-26', to: '2026-03-15' });
    expect(statementRange([])).toBeNull();
  });

  test('the picker lists every month back to the oldest purchase', () => {
    expect(monthsSince('2026-07', '2026-10-05')).toEqual(['2026-10', '2026-09', '2026-08', '2026-07']);
    expect(monthsSince(undefined, '2026-10-05')).toEqual(['2026-10']);
    expect(monthsSince('2027-01', '2026-10-05')).toEqual(['2026-10']);
  });

  test('ranges merge into one list, a purchase in two of them once', () => {
    const a = new Map([['x', { n: 1 }], ['y', { n: 2 }]]);
    const b = new Map([['y', { n: 3 }], ['z', { n: 4 }]]);
    expect([...mergeRanges([a, b])]).toEqual([['x', { n: 1 }], ['y', { n: 3 }], ['z', { n: 4 }]]);
  });
});

describe('a statement older than the window', () => {
  const file = readCsv(readFileSync(new URL('./__fixtures__/csv/purchases-positive_1111.csv', import.meta.url), 'utf8'));
  const rows = () => parseStatement(file, detectMapping(file).mapping!, { card: 'Card One', cards: [], rules: DEFAULT_RULE_DOCS, ignoredKeywords: [] }).rows;

  test('finds its duplicates once the statement’s days are read', async () => {
    // The household imported this statement long ago: its purchases are stored, outside the live window.
    let stored: Docs = emptyDocs();
    const commit = async (w: Write[]) => void (stored = applyWrites(stored, w));
    await makeActions(() => derive(stored, DEFAULT_SPEND_SETTINGS), 'sam@example.com', commit).importStatements([{ rows: rows() }]);
    const all = derive(stored, DEFAULT_SPEND_SETTINGS).records;
    const span = statementRange(rows().map((r) => r.date))!;
    const today = '2099-01-15';
    const older = beforeWindow(span, liveFrom(today));
    expect(older).toEqual(span);
    // Only the live window: nothing of the statement is known, every row would be added again.
    const live = all.filter((r) => r.date >= liveFrom(today));
    expect(planImport(rows(), live, 'statement').create.length).toBe(rows().length);
    // With the statement's days read (what `need(span)` follows), all are duplicates.
    const read = all.filter((r) => r.date >= older!.from && r.date < older!.to);
    expect(read.length).toBe(all.length);
    const plan = planImport(rows(), [...live, ...read], 'statement');
    expect(plan.create.length).toBe(0);
    expect(plan.duplicates).toBe(rows().length);
  });
});
