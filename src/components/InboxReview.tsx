import { useEffect, useState } from 'react';
import { longDate, type Ymd } from '@huishouden/pwa-kit/time';
import { alertId, categorise } from '@huishouden/pwa-kit/spending-core';
import { Dialog, Field, ghostButton, inputClass, primaryButton, secondaryButton, selectClass } from '@huishouden/pwa-kit/react/ui';
import type { SpendingStore } from '../data/store';
import type { InboxStatus, ReviewItem } from '../services/mailApi';
import { money, cents } from '../lib/month';
import { useT } from '../i18n';

/**
 * The emails of an alert inbox that looked like purchases but couldn't be read: nothing was written
 * for them. Shown only to the member who connected the inbox (it is their mail): each email's subject
 * and date, and Not a purchase, or Enter it (the shop, amount, date and card by hand).
 */
export function InboxReview({ inbox, store, onClose }: { inbox: InboxStatus; store: SpendingStore; onClose: () => void }) {
  const t = useT();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entering, setEntering] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    store.inboxes.review(inbox.id).then(setItems, (e: Error) => setError(e.message));
  }, [inbox.id, store.inboxes]);

  const answer = async (item: ReviewItem, how: 'not-purchase' | 'entered') => {
    setBusy(true);
    setError(null);
    try {
      setItems(await store.inboxes.answer(inbox.id, item.msg, how));
      setEntering(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const enter = async (item: ReviewItem, tx: { description: string; amount: number; date: string; card: string }) => {
    setBusy(true);
    setError(null);
    try {
      await store.actions.addAlerts([
        { id: alertId(item.msg), emailId: item.msg, ...tx, category: categorise(tx.description, store.rules), type: tx.amount < 0 ? 'Return' : 'Sale' },
      ]);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      return;
    }
    await answer(item, 'entered');
  };

  return (
    <Dialog title={t('review.title')} onClose={onClose}>
      <p className="mb-4 text-sm text-muted">{t('review.intro')}</p>
      {error && (
        <p role="alert" className="mb-3 rounded-xl bg-error-tint px-3 py-2 text-error">
          {error}
        </p>
      )}
      {items === null && !error && <p className="text-sm text-muted">{t('review.loading')}</p>}
      {items !== null && items.length === 0 && <p className="text-sm text-muted">{t('review.none')}</p>}
      {items !== null && items.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line" aria-label={t('review.list')}>
          {items.map((item) => (
            <li key={item.msg} aria-label={item.subject || t('review.noSubject')} className="space-y-2 px-4 py-3">
              <p className="font-medium text-ink">{item.subject || t('review.noSubject')}</p>
              <p className="text-sm text-muted">
                {longDate(item.date as Ymd)}
                {item.amount !== null ? ` · ${money(cents(item.amount), store.currency)}` : ''}
              </p>
              {entering === item.msg ? (
                <EnterForm item={item} store={store} busy={busy} onCancel={() => setEntering(null)} onSave={(tx) => void enter(item, tx)} />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={secondaryButton} disabled={busy} onClick={() => void answer(item, 'not-purchase')}>
                    {t('review.notPurchase')}
                  </button>
                  <button type="button" className={secondaryButton} disabled={busy} onClick={() => setEntering(item.msg)}>
                    {t('review.enter')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function EnterForm({ item, store, busy, onCancel, onSave }: { item: ReviewItem; store: SpendingStore; busy: boolean; onCancel: () => void; onSave: (tx: { description: string; amount: number; date: string; card: string }) => void }) {
  const t = useT();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState(item.amount !== null ? item.amount.toFixed(2) : '');
  const [date, setDate] = useState(item.date);
  const [card, setCard] = useState(store.cards[0]?.name ?? '');
  const value = Number(amount.replace(',', '.'));
  const ok = description.trim().length > 0 && Number.isFinite(value) && value !== 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);
  return (
    <form
      className="space-y-3"
      aria-label={t('review.enterTitle')}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSave({ description: description.trim(), amount: Math.round(value * 100) / 100, date, card });
      }}
    >
      <Field label={t('review.shop')}>
        <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('review.amount')}>
          <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t('review.date')}>
          <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      {store.cards.length > 0 && (
        <Field label={t('review.card')}>
          <select className={selectClass} value={card} onChange={(e) => setCard(e.target.value)}>
            {store.cards.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={ghostButton} onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className={primaryButton} disabled={!ok || busy}>
          {t('review.add')}
        </button>
      </div>
    </form>
  );
}
