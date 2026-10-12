import { addDays, type Ymd } from '@huishouden/pwa-kit/time';
import { ALERT_LOOKBACK_DAYS, MATCH_WINDOW_DAYS } from '@huishouden/pwa-kit/spending-core';
import { addMonth, monthOf, type MonthKey } from './month';

/**
 * Which transactions the live store reads. Opening Spending used to read every transaction the
 * household ever saved (a year of them is about 1,500 Firestore reads, and growing), on every open
 * after half an hour away. Now it follows only the recent ones live (`liveFrom`), and reads an
 * older stretch only when something needs it: a month picked further back, or a statement whose
 * dates reach before the window (to find its duplicates). Each stretch asked for stays followed for
 * the visit, so going back to it costs nothing.
 *
 * Dates are the transactions' own `YYYY-MM-DD`; a range is `from` (included) to `to` (excluded).
 */

/** Further back than an email alert can be dated: the kit's lookback, its matching window, and a week of slack. */
const ALERT_DAYS = ALERT_LOOKBACK_DAYS + MATCH_WINDOW_DAYS + 7;

/** The first day followed live: last month's first day (this month's glance compares with it), or 40 days back if earlier. */
export function liveFrom(today: Ymd): Ymd {
  const lastMonth = `${addMonth(monthOf(today), -1)}-01`;
  const alerts = addDays(today, -ALERT_DAYS);
  return alerts < lastMonth ? alerts : lastMonth;
}

export interface DateRange {
  from: Ymd;
  to: Ymd;
}

/** What of `range` lies before the live window, or null when the window already has all of it. */
export function beforeWindow(range: DateRange, live: Ymd): DateRange | null {
  if (range.from >= live || range.from >= range.to) return null;
  return { from: range.from, to: range.to < live ? range.to : live };
}

export const rangeKey = (r: DateRange) => `${r.from}|${r.to}`;

/**
 * The parts of `range` none of `ranges` covers, oldest first. Asking only for those means a stretch
 * already followed is never read again: going back a month at a time reads each month once, not
 * once as a month and again as the month before the next one's.
 */
export function uncovered(range: DateRange, ranges: readonly DateRange[]): DateRange[] {
  let gaps: DateRange[] = range.from < range.to ? [range] : [];
  for (const r of ranges) {
    gaps = gaps.flatMap((g) => {
      if (r.to <= g.from || r.from >= g.to) return [g];
      const out: DateRange[] = [];
      if (r.from > g.from) out.push({ from: g.from, to: r.from });
      if (r.to < g.to) out.push({ from: r.to, to: g.to });
      return out;
    });
  }
  return gaps;
}

/** The asked ranges by how they stand: read, failed, or still on their way. */
export interface AskedRanges {
  answered: readonly DateRange[];
  pending: readonly DateRange[];
  failed: readonly DateRange[];
}

/**
 * Whether the asked ranges have all of `range`: 'ready' once the answered ones together cover it;
 * 'failed' when a part of it only failed ones cover (a person's Try again); 'loading' otherwise,
 * also for a part nothing covers yet (it is about to be asked).
 */
export function coverageState(range: DateRange, { answered, pending, failed }: AskedRanges): 'ready' | 'loading' | 'failed' {
  if (!uncovered(range, answered).length) return 'ready';
  const failedOnly = uncovered(range, [...answered, ...pending]).length > 0 && !uncovered(range, [...answered, ...pending, ...failed]).length;
  return failedOnly ? 'failed' : 'loading';
}

/** The ranges that share a day with `range`. */
export const overlapping = <R extends DateRange>(range: DateRange, ranges: readonly R[]): R[] => ranges.filter((r) => r.from < range.to && r.to > range.from);

/** The days a month's glance needs: the month and the one before (its comparison). */
export function monthRange(key: MonthKey): DateRange {
  return { from: `${addMonth(key, -1)}-01`, to: `${addMonth(key, 1)}-01` };
}

/** The days a statement's rows could have duplicates on: their dates, widened by the matching window. */
export function statementRange(dates: string[]): DateRange | null {
  const valid = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!valid.length) return null;
  return { from: addDays(valid[0], -(MATCH_WINDOW_DAYS + 1)), to: addDays(valid[valid.length - 1], MATCH_WINDOW_DAYS + 2) };
}

/** Every month from `oldest` to this one (newest first): the months that can be picked. */
export function monthsSince(oldest: MonthKey | undefined, today: Ymd): MonthKey[] {
  const now = monthOf(today);
  if (!oldest || !/^\d{4}-\d{2}$/.test(oldest) || oldest > now) return [now];
  const out: MonthKey[] = [];
  for (let m = now; m >= oldest && out.length < 1200; m = addMonth(m, -1)) out.push(m);
  return out;
}

/** The transactions of every followed range as one map: a document in two ranges once. */
export function mergeRanges<T>(ranges: Iterable<Map<string, T>>): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of ranges) for (const [id, d] of r) out.set(id, d);
  return out;
}
