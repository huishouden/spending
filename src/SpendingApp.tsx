import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppFrame, AppOpening } from '@huishouden/pwa-kit/react/frame';
import { useClock } from '@huishouden/pwa-kit/react/clock';
import { secondaryButton, Toast, type useToast } from '@huishouden/pwa-kit/react/ui';
import { useUrlParam } from '@huishouden/pwa-kit/react/url-state';
import { toYmd } from '@huishouden/pwa-kit/time';
import { track, trackView } from '@huishouden/pwa-kit/observability';
import type { SpendingStore } from './data/store';
import type { SpendingRecord } from './data/model';
import { useEmailCheck } from './data/useEmailCheck';
import { counted, monthOf, months, summarise, type CategoryTotal, type MonthKey } from './lib/month';
import { monthRange, monthsSince } from './lib/window';
import { spendingFrame, type FrameProps } from './components/frame';
import { Glance } from './components/Glance';
import { WhereItWent } from './components/WhereItWent';
import { Purchases } from './components/Purchases';
import { PurchaseDialog } from './components/PurchaseDialog';
import { AddSpendingDialog } from './components/AddSpendingDialog';
import { ImportDialog } from './components/ImportDialog';
import { SettingsDialog, type SettingsTab } from './components/SettingsDialog';
import { googleRedirectReturned } from '@huishouden/pwa-kit/google-token';
import { useT } from './i18n';


interface Props {
  store: SpendingStore;
  frame: FrameProps;
  toasts: ReturnType<typeof useToast>;
  /** Above everything: the sample-data label. */
  banner?: ReactNode;
}

/** How are we doing this month: the glance, where it went, the latest purchases. */
export function SpendingApp({ store, frame, toasts, banner }: Props) {
  const t = useT();
  const { now } = useClock();
  const today = toYmd(now);
  const { notify, toast, clear } = toasts;
  // The month, the category and the purchase on screen live in the address, so a reload (an
  // update) and Back return to them: `?month=2031-04&category=Groceries&purchase=<id>`.
  const [monthParam, setMonthParam] = useUrlParam('month');
  const month: MonthKey | null = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : null;
  const [category, setCategoryParam] = useUrlParam('category');
  const setCategory = (c: CategoryTotal | null) => setCategoryParam(c?.name ?? null);
  const [openId, setOpenId] = useUrlParam('purchase');
  const open = useMemo(() => (openId ? store.records.find((r) => r.id === openId) ?? null : null), [openId, store.records]);
  const setOpen = (r: SpendingRecord | null) => setOpenId(r?.id ?? null, { replace: true });
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  // Back from Google's account chooser in this tab ("Continue in this tab"): the inbox, where it connects.
  const [settings, setSettings] = useState<SettingsTab | null>(() => (googleRedirectReturned() ? 'email' : null));
  useEffect(() => {
    if (adding) track('add spending');
  }, [adding]);
  useEffect(() => {
    if (importing) track('import statement');
  }, [importing]);

  const purchases = useMemo(() => counted(store.records, store.settings.ignoredKeywords), [store.records, store.settings.ignoredKeywords]);
  // Every month back to the household's oldest purchase, though only recent ones are read until picked.
  const shownMonths = useMemo(() => [...new Set([...months(purchases, today), ...monthsSince(store.oldestMonth, today)])].sort((a, b) => b.localeCompare(a)), [purchases, today, store.oldestMonth]);
  const key = month ?? monthOf(today);
  const { need } = store;
  useEffect(() => need(monthRange(key)), [need, key]);
  const monthState = store.rangeState(monthRange(key));
  const monthLoading = monthState !== 'ready';
  const summary = useMemo(() => summarise(purchases, key, today, store.settings.monthlyBudget), [purchases, key, today, store.settings.monthlyBudget]);
  const currency = store.currency;
  // The open category follows the data (a purchase moved out of it, a month changed).
  const shownCategory = category ? summary.categories.find((c) => c.name === category) : undefined;

  const email = useEmailCheck(store);
  const asked = useRef(false);
  useEffect(() => {
    const s = email.state;
    if (s.status !== 'done' || (!asked.current && s.added === 0)) return;
    asked.current = false;
    notify(s.added ? t('toast.addedFromEmail', { n: s.added }) : t('toast.noneInEmail'));
  }, [email.state, notify, t]);
  const checkEmail = () => {
    setAdding(false);
    const inboxes = store.inboxes.status?.inboxes;
    // With alert inboxes and none connected yet: connect one first (Settings > Email).
    if (store.inboxes.available && inboxes && store.inboxes.status?.available && inboxes.length === 0) {
      setSettings('email');
      return;
    }
    asked.current = true;
    void email.check(true);
  };

  const title = t('app.title');
  useEffect(() => {
    document.title = title;
  }, [title]);

  const goMonth = (k: MonthKey) => setMonthParam(k === monthOf(today) ? null : k, { also: { category: null, purchase: null } });

  const shell = spendingFrame(t, frame);
  // The first data still on its way: the opening frame, which counts no view and offers no settings
  // (the settings dialog takes its fields from the household's settings once, on opening).
  // The toast stays mounted: a first load that fails says so (useLiveStore reports it there).
  if (!store.ready) return <AppOpening {...shell} phase="data" after={<Toast toast={toast} onDone={clear} />} />;

  return (
    // Anonymous counts of what is used, per visit (the portal's /privacy page): the frame counts `view`.
    <AppFrame {...shell} onSettings={() => setSettings('budget')} settingsLabel={t('settings.open')} onView={trackView} view={settings ? `settings:${settings}` : category ? 'category' : 'overview'}>
      {banner}
      <>
          <Glance loading={monthLoading} summary={summary} months={shownMonths} onMonth={goMonth} currency={currency} store={store} now={now} email={email} onAdd={() => setAdding(true)} onRetry={checkEmail} onInboxes={() => setSettings('email')} />
          {monthLoading ? (
            monthState === 'failed' ? (
              <p className="p-2 text-lg text-ink-soft">
                {t('app.monthFailed')}{' '}
                <button type="button" className={secondaryButton} onClick={() => store.retry(monthRange(key))}>
                  {t('app.tryAgain')}
                </button>
              </p>
            ) : (
              <p className="p-2 text-lg text-muted">{t('app.loadingMonth')}</p>
            )
          ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
            <WhereItWent summary={summary} currency={currency} selected={shownCategory?.name ?? null} onSelect={(c) => setCategory(c && c.name !== shownCategory?.name ? c : null)} />
            <Purchases summary={summary} category={shownCategory ?? null} currency={currency} today={today} onOpen={setOpen} onAll={() => setCategory(null)} />
          </div>
          )}
      </>

      {open && <PurchaseDialog record={open} store={store} today={today} notify={notify} onClose={() => setOpen(null)} />}
      {adding && (
        <AddSpendingDialog
          store={store}
          checking={email.state.status === 'checking'}
          onCheckEmail={checkEmail}
          onImport={() => (setAdding(false), setImporting(true))}
          onCards={() => (setAdding(false), setSettings('cards'))}
          onInboxes={() => (setAdding(false), setSettings('email'))}
          onClose={() => setAdding(false)}
        />
      )}
      {importing && <ImportDialog store={store} onClose={() => setImporting(false)} onDone={notify} />}
      {settings && <SettingsDialog store={store} tab={settings} onTab={setSettings} notify={notify} onClose={() => setSettings(null)} />}
      <Toast toast={toast} onDone={clear} />
    </AppFrame>
  );
}
