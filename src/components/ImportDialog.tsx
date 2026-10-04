import { useMemo, useRef, useState } from 'react';
import { FileUp, Trash2 } from 'lucide-react';
import type { SpendingStore } from '../data/store';
import { cardFromFileName, detectMapping, mappingFits, parseStatement, readCsv, type CsvFile, type CsvMapping, type StatementRow } from '../lib/csvImport';
import { Dialog, ghostButton, iconButton, inputClass, primaryButton, secondaryButton, selectClass } from '@huishouden/pwa-kit/react/ui';
import { shortDate, toYmd } from '@huishouden/pwa-kit/time';
import { useClock } from '@huishouden/pwa-kit/react/clock';
import { categoryLabel, cents, money } from '../lib/month';
import { formatList, formatNumber } from '@huishouden/pwa-kit/i18n';
import { t as tt, useT } from '../i18n';

const labelClass = 'mb-1.5 block text-sm font-medium text-ink-soft';

/**
 * Statement files (CSV) from any bank or card into the household's transactions. Columns are found
 * from the file's headers (or the ones remembered for its card) and can be corrected; the preview
 * says what is new before anything is written.
 */

const NEW_CARD = '__new';

type Column = 'date' | 'description' | 'amount';
const COLUMN_KEYS = { date: 'import.col.date', description: 'import.col.description', amount: 'import.col.amount' } as const satisfies Record<Column, string>;

const missingColumns = (m: CsvMapping): Column[] =>
  ([!m.date && 'date', !m.description && 'description', !m.amount && !(m.debit && m.credit) && 'amount'] as const).filter((x): x is Column => !!x);

/** What the file's columns are, or which are still to choose: the summary line of its columns. */
function columnsLine(m: CsvMapping | null, missing: string[]): string {
  if (m && missing.length === 0)
    return m.amount
      ? tt('import.columnsAmount', { date: m.date, description: m.description, amount: m.amount, sign: m.purchases })
      : tt('import.columnsSplit', { date: m.date, description: m.description, debitAndCredit: formatList([m.debit ?? '', m.credit ?? '']) });
  return tt('import.chooseColumns', { n: missing.length, columns: formatList(missing.map((c) => (c in COLUMN_KEYS ? tt(COLUMN_KEYS[c as Column]) : c))) });
}

/** "12 new, 1 replacing email alerts, 3 already here; 2 skipped (…)." */
function previewLine(counts: { added: number; replaced: number }, rows: number, skipped: number, unreadable: number[]): string {
  const first = [tt('import.previewNew', { n: counts.added })];
  if (counts.replaced) first.push(tt('import.previewReplacing', { n: counts.replaced }));
  first.push(tt('import.previewAlready', { n: rows - counts.added - counts.replaced }));
  const parts = [first.join(', ')];
  if (skipped) parts.push(tt('import.previewSkipped', { n: skipped }));
  if (unreadable.length) parts.push(tt('import.previewUnreadable', { n: unreadable.length, rows: unreadable.join(', ') }));
  return tt('import.previewEnd', { text: parts.join('; ') });
}

interface Loaded {
  key: string;
  fileName: string;
  file: CsvFile;
  mapping: CsvMapping | null;
  missing: string[];
  cardId: string;
  newCard: { name: string; last4: string };
}

interface Props {
  onClose: () => void;
  store: SpendingStore;
  onDone: (message: string) => void;
}

export function ImportDialog({ onClose, store, onDone }: Props) {
  const t = useT();
  const today = toYmd(useClock().now);
  const [files, setFiles] = useState<Loaded[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const cardName = (f: Loaded) => (f.cardId === NEW_CARD ? f.newCard.name.trim() : store.cards.find((c) => c.id === f.cardId)?.name ?? '');

  const parsed = useMemo(
    () =>
      files.map((f) =>
        f.mapping && missingColumns(f.mapping).length === 0 && cardName(f)
          ? parseStatement(f.file, f.mapping, {
              card: cardName(f),
              cards: [...store.cards, ...(f.cardId === NEW_CARD && /^\d{4}$/.test(f.newCard.last4) ? [{ name: f.newCard.name.trim(), last4: f.newCard.last4 }] : [])],
              rules: store.rules,
              ignoredKeywords: store.settings.ignoredKeywords,
            })
          : null,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, store.cards, store.rules, store.settings.ignoredKeywords],
  );
  const plan = useMemo(() => store.actions.planStatements(parsed.map((p) => p?.rows ?? [])), [parsed, store.actions, store.records]);
  const perFile = (i: number) => ({
    added: plan.create.filter((r) => r.group === i).length,
    replaced: plan.replace.filter((r) => r.tx.group === i).length,
  });

  const load = async (list: FileList | null) => {
    setError(null);
    const next: Loaded[] = [];
    for (const f of Array.from(list ?? [])) {
      const file = readCsv(await f.text());
      if (file.headers.length === 0) {
        setError(t('import.noRows', { name: f.name }));
        continue;
      }
      const card = cardFromFileName(f.name, store.cards);
      const remembered = card?.csv && mappingFits(card.csv, file.headers) ? card.csv : null;
      const detected = remembered ? { mapping: remembered, missing: [] } : detectMapping(file);
      const digits = f.name.match(/\d{4}(?=\D*$)/)?.[0] ?? '';
      next.push({
        key: `${f.name}-${f.size}-${f.lastModified}`,
        fileName: f.name,
        file,
        ...detected,
        cardId: card?.id ?? (store.cards.length === 1 ? store.cards[0].id : store.cards.length === 0 ? NEW_CARD : ''),
        newCard: { name: '', last4: card ? '' : digits },
      });
    }
    setFiles((prev) => [...prev, ...next.filter((n) => !prev.some((p) => p.key === n.key))]);
    if (input.current) input.current.value = '';
  };

  const update = (i: number, patch: Partial<Loaded>) => setFiles((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const setMapping = (i: number, patch: Partial<CsvMapping>) => {
    const f = files[i];
    const base: CsvMapping = f.mapping ?? { date: '', description: '', purchases: 'negative', dayFirst: false };
    const next = { ...base, ...patch };
    update(i, { mapping: next, missing: missingColumns(next) });
  };

  const ready = files.length > 0 && files.every((f, i) => parsed[i] && cardName(f));
  const total = plan.create.length + plan.replace.length;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const batches: { rows: StatementRow[]; remember?: { cardId: string; mapping: CsvMapping } }[] = [];
      for (const [i, f] of files.entries()) {
        let cardId = f.cardId;
        if (cardId === NEW_CARD) cardId = await store.actions.saveCard(null, { name: f.newCard.name.trim(), last4: f.newCard.last4 || undefined, alertWords: [] });
        batches.push({ rows: parsed[i]!.rows, remember: { cardId, mapping: f.mapping! } });
      }
      const r = await store.actions.importStatements(batches);
      const parts = [t('import.added', { n: r.added })];
      if (r.replaced) parts.push(t('import.replaced', { n: r.replaced }));
      if (r.duplicates) parts.push(t('import.duplicates', { n: r.duplicates }));
      onDone(parts.join('; '));
      setFiles([]);
      onClose();
    } catch (e) {
      setError((e as Error).message || t('import.failed'));
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <>
      <button type="button" className={ghostButton} onClick={onClose}>
        {t('common.cancel')}
      </button>
      <button type="button" className={primaryButton} disabled={!ready || busy || total === 0} onClick={save}>
        {total === 0 && ready ? t('import.nothingNew') : t('import.addN', { n: total })}
      </button>
    </>
  );

  return (
    <Dialog title={t('import.title')} onClose={onClose} footer={footer}>
      <div className="space-y-5">
        <p className="text-muted">{t('import.intro')}</p>
        <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line p-5 text-center hover:border-forest-400 dark:hover:border-forest-300">
          <FileUp size={24} className="text-link" />
          <span className="font-medium">{t('import.choose')}</span>
          <span className="text-sm text-muted">{t('import.csvHint')}</span>
          <input ref={input} type="file" accept=".csv,text/csv" multiple className="sr-only" aria-label={t('import.files')} onChange={(e) => void load(e.target.files)} />
        </label>
        {error && (
          <p role="alert" className="rounded-xl bg-error-tint px-3 py-2 text-error">
            {error}
          </p>
        )}

        {files.map((f, i) => {
          const result = parsed[i];
          const counts = perFile(i);
          const cols = f.file.headers;
          const colSelect = (label: string, key: keyof CsvMapping, optional = false) => (
            <div>
              <label className={labelClass} htmlFor={`${f.key}-${key}`}>
                {label}
              </label>
              <select id={`${f.key}-${key}`} className={selectClass} value={(f.mapping?.[key] as string | undefined) ?? ''} onChange={(e) => setMapping(i, { [key]: e.target.value || undefined })}>
                <option value="">{optional ? t('import.none') : t('import.chooseColumn')}</option>
                {cols.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          );
          const split = !!f.mapping && !f.mapping.amount && (!!f.mapping.debit || !!f.mapping.credit);
          return (
            <section key={f.key} aria-label={f.fileName} className="space-y-4 rounded-2xl border border-line p-4">
              <div className="flex items-center gap-3">
                <h3 className="min-w-0 flex-1 truncate font-semibold">{f.fileName}</h3>
                <button type="button" className={iconButton} aria-label={t('import.remove', { name: f.fileName })} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                  <Trash2 size={18} />
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor={`${f.key}-card`}>
                    {t('import.card')}
                  </label>
                  <select id={`${f.key}-card`} className={selectClass} value={f.cardId} onChange={(e) => update(i, { cardId: e.target.value })}>
                    <option value="" disabled>
                      {t('import.chooseCard')}
                    </option>
                    {store.cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.last4 ? ` (${c.last4})` : ''}
                      </option>
                    ))}
                    <option value={NEW_CARD}>{t('import.newCard')}</option>
                  </select>
                </div>
                {f.cardId === NEW_CARD && (
                  <div className="grid grid-cols-[2fr_1fr] gap-3">
                    <div>
                      <label className={labelClass} htmlFor={`${f.key}-new-name`}>
                        {t('import.cardName')}
                      </label>
                      <input id={`${f.key}-new-name`} className={inputClass} value={f.newCard.name} maxLength={60} placeholder={t('card.namePlaceholder')} onChange={(e) => update(i, { newCard: { ...f.newCard, name: e.target.value } })} />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor={`${f.key}-new-last4`}>
                        {t('import.last4')}
                      </label>
                      <input id={`${f.key}-new-last4`} className={`${inputClass} tabular-nums`} inputMode="numeric" maxLength={4} value={f.newCard.last4} onChange={(e) => update(i, { newCard: { ...f.newCard, last4: e.target.value.replace(/\D/g, '') } })} />
                    </div>
                  </div>
                )}
              </div>

              <details open={!f.mapping || f.missing.length > 0} className="rounded-xl bg-sunken px-4 py-3">
                <summary className="min-h-8 cursor-pointer font-medium">
                  {columnsLine(f.mapping, f.missing)}
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {colSelect(t('common.date'), 'date')}
                  {colSelect(t('import.description'), 'description')}
                  {split ? (
                    <>
                      {colSelect(t('import.moneyOut'), 'debit')}
                      {colSelect(t('import.moneyIn'), 'credit')}
                    </>
                  ) : (
                    colSelect(t('common.amount'), 'amount')
                  )}
                  {colSelect(t('import.categoryOptional'), 'category', true)}
                  {!split && (
                    <div>
                      <p className={labelClass}>{t('import.purchasesAre')}</p>
                      <div className="flex gap-4">
                        {(['negative', 'positive'] as const).map((s) => (
                          <label key={s} className="flex min-h-11 items-center gap-2">
                            <input type="radio" className="h-5 w-5 accent-forest-700 dark:accent-forest-400" name={`${f.key}-sign`} checked={f.mapping?.purchases === s} onChange={() => setMapping(i, { purchases: s })} />
                            {s === 'negative' ? t('import.negative', { example: formatNumber(-12.5, undefined, { minimumFractionDigits: 2 }) }) : t('import.positive', { example: formatNumber(12.5, undefined, { minimumFractionDigits: 2 }) })}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="checkbox" className="h-5 w-5 accent-forest-700 dark:accent-forest-400" checked={!!f.mapping?.dayFirst} onChange={(e) => setMapping(i, { dayFirst: e.target.checked })} />
                    {t('import.dayFirst')}
                  </label>
                </div>
                <p className="mt-2 text-sm text-muted">{t('import.remembered')}</p>
              </details>

              {result && (
                <div className="space-y-2">
                  <p aria-live="polite">{previewLine(counts, result.rows.length, result.skipped, result.unreadable)}</p>
                  <table className="w-full text-sm">
                    <caption className="sr-only">{t('import.firstRows', { name: f.fileName })}</caption>
                    <tbody className="divide-y divide-line">
                      {result.rows.slice(0, 5).map((r) => (
                        <tr key={r.row}>
                          <td className="py-1.5 pr-3 whitespace-nowrap text-muted tabular-nums">{shortDate(r.date, today)}</td>
                          <td className="py-1.5 pr-3">{r.description}</td>
                          <td className="py-1.5 pr-3 text-muted">{categoryLabel(r.category)}</td>
                          <td className="py-1.5 text-right whitespace-nowrap tabular-nums">{money(cents(r.amount), store.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!cardName(f) && <p className="text-sm text-attention">{t('import.chooseCardHint')}</p>}
            </section>
          );
        })}
        {files.length > 0 && (
          <button type="button" className={secondaryButton} onClick={() => input.current?.click()}>
            {t('import.another')}
          </button>
        )}
      </div>
    </Dialog>
  );
}
