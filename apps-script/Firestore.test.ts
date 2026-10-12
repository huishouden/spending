import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import fixture from './fixtures/mirror-rows.json';
import { billedReads } from '@huishouden/pwa-kit/read-budget';

// Firestore.gs is plain Apps Script; only its pure helpers run here.
const ctx = vm.createContext({});
vm.runInContext(
  readFileSync(new URL('./Firestore.gs', import.meta.url), 'utf8') +
    ';globalThis.rowsToDocs = rowsToDocs; globalThis.planMirror = planMirror;' +
    'globalThis.toFirestoreFields = toFirestoreFields; globalThis.chunkString = chunkString;',
  ctx,
);
type Doc = { id: string; fields: Record<string, string | number>; fingerprint: string };
const { rowsToDocs, planMirror, toFirestoreFields, chunkString } = ctx as unknown as {
  rowsToDocs: (rows: unknown[][]) => Doc[];
  planMirror: (docs: Doc[], previous: Record<string, string>) => { upserts: Doc[]; deletes: string[] };
  toFirestoreFields: (fields: object, iso: string) => Record<string, object>;
  chunkString: (s: string, n: number) => string[];
};
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('rowsToDocs', () => {
  const docs = rowsToDocs(fixture.rows);

  test('skips rows without a date or a numeric amount', () => {
    expect(docs).toHaveLength(3);
  });

  test('identical rows keep distinct ids via an occurrence suffix', () => {
    expect(docs[0].id).not.toBe(docs[1].id);
    expect(docs[1].id).toBe(`${docs[0].id}-1`);
  });

  test('ids are stable across runs and ignore category, type and source', () => {
    const edited = fixture.rows.map((r) => r.slice());
    edited[2][3] = 'Groceries';
    edited[2][5] = 'Sale';
    expect(rowsToDocs(edited)[2].id).toBe(docs[2].id);
    expect(rowsToDocs(edited)[2].fingerprint).not.toBe(docs[2].fingerprint);
  });

  test('normalises amount and defaults source to statement', () => {
    expect(plain(docs[2].fields)).toEqual({
      date: '2031-03-11', description: 'EXAMPLE OUTFITTERS', amount: -29.9,
      category: 'Shopping', card: 'Card Two', type: 'Return', source: 'alert',
    });
    expect(docs[0].fields.source).toBe('statement');
  });
});

describe('planMirror', () => {
  const docs = rowsToDocs(fixture.rows);
  const synced = Object.fromEntries(docs.map((d) => [d.id, d.fingerprint]));

  test('first run writes everything', () => {
    expect(planMirror(docs, {}).upserts).toHaveLength(3);
  });

  test('steady state writes nothing', () => {
    expect(plain(planMirror(docs, synced))).toEqual({ upserts: [], deletes: [] });
  });

  test('changed rows are upserted and removed rows deleted', () => {
    const plan = planMirror(docs.slice(1), { ...synced, [docs[1].id]: 'stale' });
    expect(plan.upserts.map((d) => d.id)).toEqual([docs[1].id]);
    expect(plain(plan.deletes)).toEqual([docs[0].id]);
  });
});

test('toFirestoreFields encodes numbers as doubles, the rest as strings, plus updatedAt', () => {
  expect(plain(toFirestoreFields({ amount: 12.5, card: 'X' }, '2031-03-14T00:00:00.000Z'))).toEqual({
    amount: { doubleValue: 12.5 },
    card: { stringValue: 'X' },
    updatedAt: { timestampValue: '2031-03-14T00:00:00.000Z' },
  });
});

test('chunkString splits under the Script Properties value cap and round-trips', () => {
  const s = 'x'.repeat(20_001);
  const chunks = chunkString(s, 8000);
  expect(chunks.map((c) => c.length)).toEqual([8000, 8000, 4001]);
  expect(chunks.join('')).toBe(s);
});

// Read budget (pwa-kit STANDARD.md "Read budgets"): a mirror run is billed as Firestore bills the
// requests it makes (`billedReads`, the Workers' rule). It reads only to find the household once,
// then writes; each later run reads nothing.
describe('mirrorSheetToFirestore read budget', () => {
  const HH = 'households/h1';
  function sandbox() {
    const props = new Map<string, string>();
    const calls: { method: string; url: string; reads: number }[] = [];
    const sb = vm.createContext({
      UrlFetchApp: {
        fetch(url: string, o: { method: string; payload?: string }) {
          const body = o.method === 'get' ? { documents: [{ name: `projects/p/databases/(default)/documents/${HH}` }] } : {};
          calls.push({ method: o.method, url, reads: billedReads(o.method, url, 200, body, o.payload ? JSON.parse(o.payload) : undefined) });
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
        },
      },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (k: string) => props.get(k) ?? null,
          setProperty: (k: string, v: string) => void props.set(k, v),
          getProperties: () => Object.fromEntries(props),
          setProperties: (v: Record<string, string>) => Object.entries(v).forEach(([k, x]) => props.set(k, x)),
          deleteProperty: (k: string) => void props.delete(k),
        }),
      },
      ScriptApp: { getOAuthToken: () => 'test-token' },
      Session: { getScriptTimeZone: () => 'GMT' },
      Utilities: { formatDate: (d: Date) => d.toISOString().slice(0, 10) },
      Logger: { log: () => undefined },
      getTargetSheet: () => ({ getLastRow: () => fixture.rows.length + 1, getRange: () => ({ getValues: () => fixture.rows.map((r) => r.slice()) }) }),
    });
    vm.runInContext(readFileSync(new URL('./Firestore.gs', import.meta.url), 'utf8') + ';globalThis.mirror = mirrorSheetToFirestore;', sb);
    return { run: () => (sb as unknown as { mirror: () => { upserted: number } }).mirror(), calls };
  }
  const reads = (calls: { reads: number }[]) => calls.reduce((n, c) => n + c.reads, 0);

  test('the first run: one list of the households (1 read), then the writes; the next run: none', () => {
    const { run, calls } = sandbox();
    expect(run().upserted).toBe(3);
    expect(reads(calls)).toBe(1);
    calls.length = 0;
    run();
    expect(reads(calls)).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
