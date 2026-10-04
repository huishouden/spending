import { chartColours } from '@huishouden/pwa-kit/chart';
import { useTheme } from '@huishouden/pwa-kit/react/theme';
import { cardClass } from '@huishouden/pwa-kit/react/ui';
import { categoryLabel, money, type CategoryTotal, type MonthSummary } from '../lib/month';
import { useT } from '../i18n';

interface Props {
  summary: MonthSummary;
  currency: string;
  selected: string | null;
  onSelect: (category: CategoryTotal) => void;
}

/** The month's categories, largest first; tapping one shows its purchases. */
export function WhereItWent({ summary, currency, selected, onSelect }: Props) {
  const t = useT();
  const [bar] = chartColours(useTheme().dark);
  return (
    <section aria-labelledby="where-heading" className={`${cardClass} flex min-h-0 min-w-0 flex-col p-5 sm:p-6`}>
      <h2 id="where-heading" className="mb-2 flex min-h-11 items-center text-xl font-semibold text-ink">
        {t('where.title')}
      </h2>
      {summary.categories.length === 0 ? (
        <p className="py-2 text-base text-muted">{t('where.empty', { month: summary.name })}</p>
      ) : (
        <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto" aria-label={t('where.list', { month: summary.name })}>
          {summary.categories.map((c) => {
            const active = c.name === selected;
            return (
              <li key={c.name}>
                <button
                  type="button"
                  aria-pressed={active}
                  aria-label={t('where.item', { category: categoryLabel(c.name), amount: money(c.cents, currency) })}
                  onClick={() => onSelect(c)}
                  className={`block w-full rounded-xl px-2 py-2 text-left transition-colors duration-150 ${active ? 'bg-tint' : 'hover:bg-stone-100 dark:hover:bg-forest-700'}`}
                >
                  <span className="flex items-baseline gap-3">
                    <span className={`min-w-0 flex-1 truncate text-base ${active ? 'font-semibold text-link' : 'font-medium text-ink'}`}>{categoryLabel(c.name)}</span>
                    <span className="text-base font-medium text-ink tabular-nums">{money(c.cents, currency, true)}</span>
                  </span>
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-sunken">
                    <span className="block h-full rounded-full" style={{ width: `${c.share * 100}%`, background: bar }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
