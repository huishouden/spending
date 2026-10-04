import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { longDate, type Ymd } from '@huishouden/pwa-kit/time';
import { Checkbox, Chip, deleteButton, Dialog, ghostButton, inputClass, primaryButton } from '@huishouden/pwa-kit/react/ui';
import type { SpendingStore } from '../data/store';
import { ruleId, type SpendingRecord } from '../data/model';
import { categoryChoices, categoryLabel, cents, money, rulePhrase } from '../lib/month';
import { useT } from '../i18n';

interface Props {
  record: SpendingRecord;
  store: SpendingStore;
  today: Ymd;
  notify: (message: string, undo?: () => void) => void;
  onClose: () => void;
}

/** One purchase: put it in another category (and, if wanted, every later one from the same shop), or remove it. */
export function PurchaseDialog({ record, store, today, notify, onClose }: Props) {
  const t = useT();
  const [category, setCategory] = useState(record.category);
  const [always, setAlways] = useState(false);
  const phrase = rulePhrase(record.description);
  const choices = categoryChoices(store.rules, [record.category]);
  const chosen = category.trim();
  const { actions } = store;

  const save = () => {
    const moved = chosen !== record.category;
    if (moved) void actions.recategorise(record, chosen);
    const rule = always && phrase ? { contains: phrase, category: chosen } : null;
    const before = rule ? store.rules.find((r) => r.id === ruleId(phrase)) : undefined;
    if (rule) void actions.saveRule(rule);
    onClose();
    if (!moved && !rule) return;
    const undo = () => {
      if (moved) void actions.recategorise({ ...record, category: chosen }, record.category);
      if (rule) void (before ? actions.saveRule(before) : actions.deleteRule(ruleId(phrase)));
    };
    notify(moved ? t('toast.moved', { name: record.description, category: categoryLabel(chosen) }) : t('toast.always', { name: record.description, category: categoryLabel(chosen) }), undo);
  };

  const remove = () => {
    void actions.deleteTransaction(record.id);
    onClose();
    // Writing the purchase back as it was puts it back.
    notify(t('toast.removed', { name: record.description }), () => void actions.recategorise(record, record.category));
  };

  return (
    <Dialog
      title={record.description}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={deleteButton} onClick={remove}>
            <Trash2 size={18} /> {t('common.remove')}
          </button>
          <button type="button" className={ghostButton} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className={primaryButton} onClick={save} disabled={!chosen}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <p className="text-lg text-ink">
        <span className="font-semibold tabular-nums">{money(cents(record.amount), store.currency)}</span> {t('purchase.on', { date: longDate(record.date, today) })}
      </p>
      <p className="mb-5 text-base text-muted">
        {record.card} · {record.source === 'alert' ? t('purchase.fromAlert') : t('purchase.fromStatement')}
      </p>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-soft">{t('purchase.category')}</legend>
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <Chip key={c} active={c === chosen} onClick={() => setCategory(c)}>
              {categoryLabel(c)}
            </Chip>
          ))}
        </div>
        <input
          className={`${inputClass} mt-3`}
          aria-label={t('purchase.another')}
          placeholder={t('purchase.another')}
          maxLength={60}
          value={choices.includes(category) ? '' : category}
          onChange={(e) => setCategory(e.target.value)}
        />
      </fieldset>

      {phrase && (
        <div className="mt-4">
          <Checkbox checked={always} onChange={setAlways}>
            {chosen ? t('purchase.always', { phrase, category: categoryLabel(chosen) }) : t('purchase.alwaysThis', { phrase })}
          </Checkbox>
        </div>
      )}
    </Dialog>
  );
}
