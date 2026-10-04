import { X } from 'lucide-react';
import { shortDate, type Ymd } from '@huishouden/pwa-kit/time';
import { cardClass, ghostButton } from '@huishouden/pwa-kit/react/ui';
import type { SpendingRecord } from '../data/model';
import { categoryLabel, cents, money, type CategoryTotal, type MonthSummary } from '../lib/month';
import { useT } from '../i18n';

interface Props {
  summary: MonthSummary;
  /** Only this category's purchases, when one is chosen. */
  category: CategoryTotal | null;
  currency: string;
  today: Ymd;
  onOpen: (record: SpendingRecord) => void;
  onAll: () => void;
}

/** The month's purchases, newest first, or one category's. */
export function Purchases({ summary, category, currency, today, onOpen, onAll }: Props) {
  const t = useT();
  const list = category ? summary.purchases.filter((p) => category.covers.includes(p.category)) : summary.purchases;
  return (
    <section aria-labelledby="purchases-heading" className={`${cardClass} flex min-h-0 min-w-0 flex-col p-5 sm:p-6`}>
      <div className="mb-2 flex min-h-11 items-center gap-3">
        <h2 id="purchases-heading" className="min-w-0 flex-1 text-xl font-semibold text-ink">
          {category ? (
            <>
              {categoryLabel(category.name)} <span className="font-normal text-muted tabular-nums">· {money(category.cents, currency)}</span>
            </>
          ) : (
            t('purchases.latest')
          )}
        </h2>
        {category && (
          <button type="button" className={`${ghostButton} -mr-2`} onClick={onAll}>
            <X size={18} /> {t('purchases.all')}
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="py-2 text-base text-muted">{t('purchases.empty', { month: summary.name })}</p>
      ) : (
        <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto" aria-label={category ? t('purchases.ofCategory', { category: categoryLabel(category.name) }) : t('purchases.label')}>
          {list.map((p) => {
            const amount = money(cents(p.amount), currency);
            const date = shortDate(p.date, today);
            return (
              <li key={p.id} className="border-b border-line last:border-0">
                <button
                  type="button"
                  onClick={() => onOpen(p)}
                  aria-label={[p.description, amount, categoryLabel(p.category), p.card, date].join(', ')}
                  className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-150 hover:bg-stone-100 dark:hover:bg-forest-700"
                >
                  <span className="w-14 shrink-0 text-sm text-muted tabular-nums">{date}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium text-ink">{p.description}</span>
                    <span className="block truncate text-sm text-muted">{category?.covers.length === 1 ? p.card : `${categoryLabel(p.category)} · ${p.card}`}</span>
                  </span>
                  <span className={`shrink-0 text-base font-medium tabular-nums ${p.amount < 0 ? 'text-positive' : 'text-ink'}`}>{amount}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
