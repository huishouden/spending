import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { agoWords } from '@huishouden/pwa-kit/time';
import { chartColours } from '@huishouden/pwa-kit/chart';
import { useTheme } from '@huishouden/pwa-kit/react/theme';
import { cardClass, ErrorNotice, ghostButton, iconButton, primaryButton } from '@huishouden/pwa-kit/react/ui';
import { STOPPED } from './AlertInboxes';
import type { SpendingStore } from '../data/store';
import type { useEmailCheck } from '../data/useEmailCheck';
import { lastUpdate, money, standing, type MonthKey, type MonthSummary } from '../lib/month';
import { useT } from '../i18n';

interface Props {
  summary: MonthSummary;
  /** Months that can be shown, newest first. */
  months: MonthKey[];
  onMonth: (key: MonthKey) => void;
  currency: string;
  store: SpendingStore;
  now: number;
  email: ReturnType<typeof useEmailCheck>;
  onAdd: () => void;
  onRetry: () => void;
  /** Settings > Email, where an inbox that stopped is reconnected. */
  onInboxes: () => void;
}

/** The answer to "how are we doing this month?", big enough to read across the room. */
export function Glance({ summary, months, onMonth, currency, store, now, email, onAdd, onRetry, onInboxes }: Props) {
  const t = useT();
  const line = standing(summary, currency);
  const i = months.indexOf(summary.key);
  const older = months[i + 1];
  const newer = i > 0 ? months[i - 1] : undefined;
  // The alert inboxes' last check (the Worker checks every few minutes), or the last in-app check.
  const updated = lastUpdate(store.records, Math.max(store.settings.emailCheckedAt ?? 0, store.inboxes.status?.lastChecked ?? 0) || undefined);
  const stopped = store.inboxes.status?.inboxes.find((i) => i.error && STOPPED.includes(i.error));
  const status =
    email.state.status === 'checking'
      ? t('glance.checking')
      : updated
        ? t(updated.how === 'email' ? 'glance.updatedEmail' : 'glance.updatedStatement', { ago: agoWords(updated.at, now) })
        : t('glance.notUpdated');

  return (
    <section aria-label={t('glance.label')} className={`${cardClass} shrink-0 p-5 sm:p-6`}>
      <div className="flex items-start gap-3">
        <h2 className="min-w-0 flex-1 text-ink" aria-live="polite">
          <span className="block text-5xl leading-tight font-semibold tabular-nums sm:inline sm:text-6xl">{money(summary.spentCents, currency, true)}</span>{' '}
          <span className="text-xl font-medium text-muted sm:text-3xl">{t('glance.spentIn', { month: summary.name })}</span>
        </h2>
        <div className="flex shrink-0 items-center">
          <button type="button" className={iconButton} aria-label={t('glance.previous')} disabled={!older} onClick={() => older && onMonth(older)}>
            <ChevronLeft size={22} />
          </button>
          <button type="button" className={iconButton} aria-label={t('glance.next')} disabled={!newer} onClick={() => newer && onMonth(newer)}>
            <ChevronRight size={22} />
          </button>
        </div>
      </div>
      {line && <p className={`mt-1 text-xl tabular-nums sm:text-2xl ${line.attention ? 'font-medium text-attention' : 'text-ink-soft'}`}>{line.text}</p>}
      {summary.budget && <PaceBar budget={summary.budget} isCurrent={summary.isCurrent} />}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="min-w-0 flex-1 text-base text-muted" aria-live="polite">
          {status}
        </p>
        <button type="button" className={primaryButton} onClick={onAdd}>
          <Plus size={18} /> {t('add.title')}
        </button>
        {stopped && (
          <p className="flex w-full flex-wrap items-center gap-x-3 font-medium text-attention">
            {t('glance.inboxStopped', { address: stopped.address })}
            <button type="button" className={ghostButton} onClick={onInboxes}>
              {t('glance.reconnect')}
            </button>
          </p>
        )}
        {email.state.status === 'error' && (
          <div className="w-full">
            <ErrorNotice message={email.state.message} onRetry={onRetry} />
          </div>
        )}
      </div>
    </section>
  );
}

/** Spent against the budget, with a mark where spending would be at an even pace today. */
function PaceBar({ budget, isCurrent }: { budget: NonNullable<MonthSummary['budget']>; isCurrent: boolean }) {
  const t = useT();
  const [spent, over] = chartColours(useTheme().dark);
  const used = Math.min(1, Math.max(0, budget.used));
  const mark = Math.min(97, Math.max(3, budget.elapsed * 100));
  const used100 = Math.round(budget.used * 100);
  const label = isCurrent ? t('pace.labelCurrent', { used: used100, gone: Math.round(budget.elapsed * 100) }) : t('pace.label', { used: used100 });
  return (
    <div className="mt-4" role="img" aria-label={label}>
      <div className="relative">
        <div className="h-3 overflow-hidden rounded-full bg-stone-200 dark:bg-forest-900">
          <div className="h-full rounded-full" style={{ width: `${used * 100}%`, background: budget.pace === 'over' ? over : spent }} />
        </div>
        {isCurrent && <div className="absolute -top-1.5 h-6 w-0.5 rounded-full bg-ink" style={{ left: `${mark}%` }} />}
      </div>
      {isCurrent && (
        <div className="relative mt-1 h-5 text-sm text-muted" aria-hidden="true">
          <span className="absolute -translate-x-1/2" style={{ left: `${mark}%` }}>
            {t('pace.today')}
          </span>
        </div>
      )}
    </div>
  );
}
