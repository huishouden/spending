import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { Chip, Dialog, ghostButton, iconButton, inputClass, overline, primaryButton, secondaryButton, selectClass } from '@huishouden/pwa-kit/react/ui';
import { readError } from '@huishouden/pwa-kit/feedback';
import type { SpendingStore } from '../data/store';
import type { Card } from '../data/model';
import { readSheetTabs, sheetsToken } from '../data/sheetTabs';
import { auth } from '../services/auth';
import { CATEGORIES } from '../lib/categorise';
import { categoryChoices } from '../lib/month';
import { fromSheetTabs, pastedRows, type SheetSettings } from '../lib/sheetSettings';
import { centsToInput, parseCents } from '@huishouden/pwa-kit/money';
import { getLocale } from '@huishouden/pwa-kit/i18n';
import { categoryLabel } from '../lib/month';
import { t as tt, useT } from '../i18n';

export type SettingsTab = 'budget' | 'cards' | 'categories' | 'email';

const TABS = [
  { id: 'budget', label: 'settings.tab.budget' },
  { id: 'cards', label: 'settings.tab.cards' },
  { id: 'categories', label: 'settings.tab.categories' },
  { id: 'email', label: 'settings.tab.email' },
] as const satisfies readonly { id: SettingsTab; label: string }[];

/** Currencies offered first; the household's own is added when it is another. */
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'MXN', 'AUD', 'NZD', 'CHF', 'JPY', 'INR', 'BRL', 'COP', 'ARS', 'CLP', 'PEN', 'SEK', 'NOK', 'DKK', 'PLN', 'ZAR'];

/** "Euro (€)", "euro (EUR)": the currency's name in the page's language, with its symbol. */
function currencyName(code: string): string {
  const name = new Intl.DisplayNames(getLocale(), { type: 'currency' }).of(code) ?? code;
  const symbol = new Intl.NumberFormat(getLocale(), { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value;
  return symbol && symbol !== code ? `${name} (${symbol}, ${code})` : `${name} (${code})`;
}

/** A budget as its field shows it: whole amounts without decimals, the locale's decimal mark otherwise. */
const budgetInput = (amount: number) => (!amount ? '' : Number.isInteger(amount) ? String(amount) : centsToInput(Math.round(amount * 100)));

const labelClass = 'mb-1.5 block text-sm font-medium text-ink-soft';
const hintClass = 'mt-1 text-sm text-muted';

interface Props {
  store: SpendingStore;
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  notify: (message: string) => void;
  onClose: () => void;
}

/** The household's settings, shared by every member. */
export function SettingsDialog({ store, tab, onTab, notify, onClose }: Props) {
  const t = useT();
  return (
    <Dialog title={t('settings.title')} onClose={onClose}>
      <div role="tablist" aria-label={t('settings.sections')} className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1">
        {TABS.map((x) => (
          <Chip key={x.id} active={tab === x.id} onClick={() => onTab(x.id)}>
            {t(x.label)}
          </Chip>
        ))}
      </div>
      {!store.live && <p className="mb-4 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">{t('settings.sample')}</p>}
      {/* Each tab copies the settings into its form when it opens: before they arrive it would show
          the defaults, and saving would overwrite the household's own. */}
      {!store.ready ? (
        <p role="status" className="py-6 text-base text-muted">
          {t('settings.loading')}
        </p>
      ) : (
        <>
          {tab === 'budget' && <BudgetTab store={store} notify={notify} />}
          {tab === 'cards' && <CardsTab store={store} />}
          {tab === 'categories' && <CategoriesTab store={store} />}
          {tab === 'email' && <EmailTab store={store} />}
        </>
      )}
    </Dialog>
  );
}

function WordList({ words, onChange, placeholder, label, lower = true }: { words: string[]; onChange: (w: string[]) => void; placeholder: string; label: string; lower?: boolean }) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const add = () => {
    const w = (lower ? draft.toLowerCase() : draft).trim();
    if (w && !words.some((x) => x.toLowerCase() === w.toLowerCase())) onChange([...words, w]);
    setDraft('');
  };
  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-2" aria-label={label}>
        {words.map((w) => (
          <li key={w} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface py-1 pr-1 pl-3 text-sm">
            {w}
            <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-stone-100 dark:hover:bg-forest-700" aria-label={t('settings.removeWord', { word: w })} onClick={() => onChange(words.filter((x) => x !== w))}>
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          className={inputClass}
          value={draft}
          placeholder={placeholder}
          aria-label={t('settings.addTo', { list: label.toLowerCase() })}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className={secondaryButton} onClick={add}>
          <Plus size={18} /> {t('common.add')}
        </button>
      </div>
    </div>
  );
}

function BudgetTab({ store, notify }: { store: SpendingStore; notify: (m: string) => void }) {
  const t = useT();
  const [budget, setBudget] = useState(budgetInput(store.settings.monthlyBudget));
  const [currency, setCurrency] = useState(store.currency);
  // Typed the reader's way: "1.500" and "1500,50" in Dutch, "1,500" and "1500.50" in English.
  const budgetCents = parseCents(budget, { max: 10_000_000_000 });
  const [words, setWords] = useState(store.settings.ignoredKeywords);
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const save = async () => {
    setStatus({ kind: 'saving' });
    try {
      if (budgetCents === null) return;
      await store.actions.saveSettings({ monthlyBudget: (budgetCents ?? 0) / 100, ignoredKeywords: words });
      // The currency is the household's, for every app.
      if (currency !== store.currency) await store.saveCurrency(currency);
      setStatus({ kind: 'saved' });
      notify(t('settings.budgetSaved'));
    } catch (e) {
      setStatus({ kind: 'error', message: readError(e, t('settings.budgetFailed')) });
    }
  };
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div>
          <label className={labelClass} htmlFor="budget">
            {t('settings.budget')}
          </label>
          <input
            id="budget"
            className={`${inputClass} tabular-nums`}
            type="text"
            inputMode="decimal"
            value={budget}
            placeholder={t('settings.noBudget')}
            aria-invalid={budgetCents === null}
            onChange={(e) => setBudget(e.target.value)}
          />
          <p className={hintClass}>{budgetCents === null ? t('settings.budgetInvalid') : t('settings.budgetHint')}</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="currency">
            {t('settings.currency')}
          </label>
          <select id="currency" className={selectClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {[...new Set([currency, ...CURRENCIES])].map((c) => (
              <option key={c} value={c}>
                {currencyName(c)}
              </option>
            ))}
          </select>
          <p className={hintClass}>{t('settings.currencyHint')}</p>
        </div>
      </div>
      <div>
        <p className={labelClass}>{t('settings.neverCount')}</p>
        <p className={`${hintClass} mb-3`}>{t('settings.neverCountHint')}</p>
        <WordList words={words} onChange={setWords} placeholder={t('settings.neverCountPlaceholder')} label={t('settings.neverCountList')} />
      </div>
      <div className="flex items-center justify-end gap-3">
        <p role="status" className={`text-sm ${status.kind === 'error' ? 'text-error' : 'text-link'}`}>
          {status.kind === 'saved' ? t('common.saved') : status.kind === 'error' ? status.message : ''}
        </p>
        <button type="button" className={primaryButton} onClick={save} disabled={status.kind === 'saving' || budgetCents === null}>
          {status.kind === 'saving' ? t('settings.saving') : t('settings.saveBudget')}
        </button>
      </div>
    </div>
  );
}

const splitWords = (s: string) =>
  s
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);

function CardForm({ card, onSave, onCancel }: { card?: Card; onSave: (c: Omit<Card, 'id'>) => Promise<void>; onCancel: () => void }) {
  const t = useT();
  const [name, setName] = useState(card?.name ?? '');
  const [last4, setLast4] = useState(card?.last4 ?? '');
  const [issuer, setIssuer] = useState(card?.issuer ?? '');
  const [words, setWords] = useState((card?.alertWords ?? []).join(', '));
  const valid = name.trim().length > 0 && (last4 === '' || /^\d{4}$/.test(last4));
  return (
    <form
      className="space-y-4 rounded-2xl border border-line p-4"
      aria-label={card ? t('card.edit', { name: card.name }) : t('card.new')}
      onSubmit={async (e) => {
        e.preventDefault();
        if (valid) await onSave({ ...(card?.csv ? { csv: card.csv } : {}), name: name.trim(), last4: last4 || undefined, issuer: issuer.trim() || undefined, alertWords: splitWords(words) });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div>
          <label className={labelClass} htmlFor="card-name">
            {t('common.name')}
          </label>
          <input id="card-name" className={inputClass} value={name} maxLength={60} placeholder={t('card.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="card-last4">
            {t('card.last4')}
          </label>
          <input id="card-last4" className={`${inputClass} tabular-nums`} inputMode="numeric" maxLength={4} value={last4} placeholder="1111" onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))} />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="card-issuer">
          {t('card.issuer')}
        </label>
        <input id="card-issuer" className={inputClass} value={issuer} maxLength={40} placeholder={t('card.issuerPlaceholder')} onChange={(e) => setIssuer(e.target.value)} />
      </div>
      <div>
        <label className={labelClass} htmlFor="card-words">
          {t('card.alertWords')}
        </label>
        <input id="card-words" className={inputClass} value={words} placeholder={t('card.alertWordsPlaceholder')} onChange={(e) => setWords(e.target.value)} />
        <p className={hintClass}>{t('card.alertWordsHint')}</p>
      </div>
      <div className="flex justify-end gap-3">
        <button type="button" className={ghostButton} onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className={primaryButton} disabled={!valid}>
          {t('card.save')}
        </button>
      </div>
    </form>
  );
}

function CardsTab({ store }: { store: SpendingStore }) {
  const t = useT();
  const [editing, setEditing] = useState<string | 'new' | null>(store.cards.length === 0 ? 'new' : null);
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {t('cards.intro')}
      </p>
      <ul className="divide-y divide-line" aria-label={t('settings.tab.cards')}>
        {store.cards.map((c) =>
          editing === c.id ? (
            <li key={c.id} className="py-3">
              <CardForm
                card={c}
                onCancel={() => setEditing(null)}
                onSave={async (next) => {
                  await store.actions.saveCard(c.id, next);
                  setEditing(null);
                }}
              />
            </li>
          ) : (
            <li key={c.id} aria-label={c.name} className="flex min-h-14 flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.name}
                  {c.last4 && <span className="ml-2 text-muted tabular-nums">•••• {c.last4}</span>}
                </p>
                <p className="text-sm text-muted">
                  {[c.issuer, c.alertWords.length ? t('cards.alerts', { words: c.alertWords.join(', ') }) : t('cards.noAlerts'), c.csv ? t('cards.columnsRemembered') : ''].filter(Boolean).join(' · ')}
                </p>
              </div>
              {confirm === c.id ? (
                <span className="flex items-center gap-2 text-sm">
                  {t('cards.confirmRemove', { name: c.name })}
                  <button type="button" className={secondaryButton} onClick={() => (void store.actions.deleteCard(c.id), setConfirm(null))}>
                    {t('common.remove')}
                  </button>
                  <button type="button" className={ghostButton} onClick={() => setConfirm(null)}>
                    {t('cards.keep')}
                  </button>
                </span>
              ) : (
                <>
                  <button type="button" className={iconButton} aria-label={t('card.edit', { name: c.name })} onClick={() => setEditing(c.id)}>
                    <Pencil size={18} />
                  </button>
                  <button type="button" className={iconButton} aria-label={t('cards.remove', { name: c.name })} onClick={() => setConfirm(c.id)}>
                    <Trash2 size={18} />
                  </button>
                </>
              )}
            </li>
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <CardForm
          onCancel={() => setEditing(null)}
          onSave={async (c) => {
            await store.actions.saveCard(null, c);
            setEditing(null);
          }}
        />
      ) : (
        <button type="button" className={secondaryButton} onClick={() => setEditing('new')}>
          <Plus size={18} /> {t('cards.add')}
        </button>
      )}
    </div>
  );
}

function CategoriesTab({ store }: { store: SpendingStore }) {
  const t = useT();
  const [filter, setFilter] = useState('');
  const [contains, setContains] = useState('');
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const choices = useMemo(() => categoryChoices(store.rules), [store.rules]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return [...store.rules]
      .filter((r) => !q || r.contains.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
      .sort((a, b) => a.category.localeCompare(b.category) || a.contains.localeCompare(b.contains));
  }, [store.rules, filter]);
  const add = async () => {
    if (!contains.trim() || !category.trim()) return;
    await store.actions.saveRule({ contains: contains.trim().toLowerCase(), category: category.trim() });
    setContains('');
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {t('rules.intro')}
      </p>
      <form
        className="grid gap-3 rounded-2xl border border-line p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        aria-label={t('rules.new')}
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div>
          <label className={labelClass} htmlFor="rule-contains">
            {t('rules.contains')}
          </label>
          <input id="rule-contains" className={inputClass} value={contains} maxLength={80} placeholder={t('rules.containsPlaceholder')} onChange={(e) => setContains(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="rule-category">
            {t('purchase.category')}
          </label>
          <input id="rule-category" className={inputClass} list="category-choices" value={category} maxLength={60} onChange={(e) => setCategory(e.target.value)} />
          <datalist id="category-choices">
            {choices.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <button type="submit" className={primaryButton} disabled={!contains.trim() || !category.trim()}>
          {t('rules.add')}
        </button>
      </form>
      <input className={inputClass} value={filter} placeholder={t('rules.find')} aria-label={t('rules.find')} onChange={(e) => setFilter(e.target.value)} />
      <ul className="divide-y divide-line" aria-label={t('rules.list')}>
        {shown.map((r) => (
          <li key={r.id} aria-label={r.contains} className="flex min-h-11 items-center gap-3 py-1">
            <span className="min-w-0 flex-1 truncate">{r.contains}</span>
            <span className="text-sm text-muted">{categoryLabel(r.category)}</span>
            <button type="button" className={iconButton} aria-label={t('rules.remove', { rule: r.contains })} onClick={() => void store.actions.deleteRule(r.id)}>
              <Trash2 size={18} />
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="py-3 text-sm text-muted">{t('rules.none')}</li>}
      </ul>
    </div>
  );
}

function EmailTab({ store }: { store: SpendingStore }) {
  const t = useT();
  const [link, setLink] = useState('');
  const [paste, setPaste] = useState({ cards: '', categories: '', labels: '' });
  const [found, setFound] = useState<SheetSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const read = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setFound(fromSheetTabs(await readSheetTabs(await sheetsToken(auth), link)));
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(code === 'auth/popup-closed-by-user' ? t('sheet.notGiven') : readError(e, t('sheet.readFailed')));
    } finally {
      setBusy(false);
    }
  };
  const fromPaste = () => setFound(fromSheetTabs({ cards: pastedRows(paste.cards), categories: pastedRows(paste.categories), labels: pastedRows(paste.labels) }));
  const bringIn = async () => {
    if (!found) return;
    const r = await store.actions.importSheetSettings(found);
    setDone(t('sheet.added', { cards: t('sheet.cards', { n: r.cards }), rules: t('sheet.rules', { n: r.rules }), labels: t('sheet.labels', { n: r.labels }) }));
    setFound(null);
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-label={t('email.title')}>
        <h3 className={overline}>{t('email.title')}</h3>
        <p className="text-sm text-muted">
          {t('email.intro')}
        </p>
        <WordList words={store.settings.alertLabels} lower={false} onChange={(w) => void store.actions.saveSettings({ alertLabels: w })} placeholder={t('email.labelsPlaceholder')} label={t('email.labels')} />
      </section>

      <details className="rounded-2xl border border-line px-4 py-2">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-ink">{t('sheet.title')}</summary>
        <div className="space-y-3 pb-3">
        <p className="text-sm text-muted">
          {t('sheet.intro')}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className={inputClass} value={link} placeholder="https://docs.google.com/spreadsheets/d/..." aria-label={t('sheet.link')} onChange={(e) => setLink(e.target.value)} />
          <button type="button" className={secondaryButton} onClick={read} disabled={busy || !link.trim() || !store.live}>
            {busy ? t('sheet.reading') : t('sheet.read')}
          </button>
        </div>
        <details className="rounded-xl border border-line px-4 py-3">
          <summary className="min-h-8 cursor-pointer font-medium">{t('sheet.paste')}</summary>
          <div className="mt-3 space-y-3">
            {(
              [
                ['cards', t('sheet.cardsTab')],
                ['categories', t('sheet.categoriesTab')],
                ['labels', t('sheet.labelsTab')],
              ] as const
            ).map(([k, label]) => (
              <div key={k}>
                <label className={labelClass} htmlFor={`paste-${k}`}>
                  {label}
                </label>
                <textarea id={`paste-${k}`} className={`${inputClass} min-h-20 font-mono text-sm`} value={paste[k]} onChange={(e) => setPaste({ ...paste, [k]: e.target.value })} />
              </div>
            ))}
            <button type="button" className={secondaryButton} onClick={fromPaste} disabled={!paste.cards.trim() && !paste.categories.trim() && !paste.labels.trim()}>
              {t('sheet.readRows')}
            </button>
          </div>
        </details>
        {error && (
          <p role="alert" className="rounded-xl bg-error-tint px-3 py-2 text-error">
            {error}
          </p>
        )}
        {found && (
          <div role="region" className="space-y-3 rounded-2xl border border-line p-4" aria-label={t('sheet.found')}>
            <p>
              {t('sheet.foundText', {
                cards: t('sheet.cards', { n: found.cards.length }),
                names: found.cards.map((c) => c.name).join(', ') || t('sheet.noneFound'),
                rules: t('sheet.rules', { n: found.rules.length }),
                labels: t('sheet.labels', { n: found.labels.length }),
              })}
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" className={ghostButton} onClick={() => setFound(null)}>
                {t('common.cancel')}
              </button>
              <button type="button" className={primaryButton} onClick={bringIn}>
                {t('sheet.bringIn')}
              </button>
            </div>
          </div>
        )}
        {done && (
          <p className="text-sm text-positive" aria-live="polite">
            {done} {t('sheet.doneHint')}
          </p>
        )}
      </div>
      </details>
    </div>
  );
}
