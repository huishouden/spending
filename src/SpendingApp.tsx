import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Settings } from 'lucide-react';
import { AppBar, type AppBarUser } from '@huishouden/pwa-kit/react/app-bar';
import { useClock } from '@huishouden/pwa-kit/react/clock';
import { iconButton, Toast, type useToast } from '@huishouden/pwa-kit/react/ui';
import { toYmd } from '@huishouden/pwa-kit/time';
import { track, trackView } from '@huishouden/pwa-kit/observability';
import type { SpendingStore } from './data/store';
import type { SpendingRecord } from './data/model';
import { useEmailCheck } from './data/useEmailCheck';
import { counted, monthOf, months, summarise, type CategoryTotal, type MonthKey } from './lib/month';
import { PORTAL_URL } from './config/portal';
import { Glance } from './components/Glance';
import { WhereItWent } from './components/WhereItWent';
import { Purchases } from './components/Purchases';
import { PurchaseDialog } from './components/PurchaseDialog';
import { AddSpendingDialog } from './components/AddSpendingDialog';
import { ImportDialog } from './components/ImportDialog';
import { SettingsDialog, type SettingsTab } from './components/SettingsDialog';
import { useT } from './i18n';

const VERSION = `${import.meta.env.VITE_APP_VERSION} (${import.meta.env.VITE_BUILD_SHA})`;

export interface FrameProps {
  /** Undefined while the session is being restored: neither the avatar nor Sign in shows. */
  user: AppBarUser | null | undefined;
  onSignIn: () => void;
  onSignOut: () => void;
  signingIn: boolean;
}

/** The Huishouden app bar and the page under it. */
export function Frame({ user, onSignIn, onSignOut, signingIn, actions, children }: FrameProps & { actions?: ReactNode; children?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex min-h-dvh flex-col bg-page font-sans text-ink antialiased lg:h-dvh lg:overflow-hidden">
      <AppBar app={t('app.name')} glyph="card" portalUrl={PORTAL_URL} version={VERSION} user={user} signingIn={signingIn} onSignIn={onSignIn} onSignOut={onSignOut}>
        {actions}
      </AppBar>
      <main className="mx-auto flex w-full max-w-[1200px] min-h-0 flex-1 flex-col gap-4 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6 sm:pb-6">
        {children}
      </main>
    </div>
  );
}

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
  const [month, setMonth] = useState<MonthKey | null>(null);
  const [category, setCategory] = useState<CategoryTotal | null>(null);
  const [open, setOpen] = useState<SpendingRecord | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  // Anonymous counts of what is used, per visit (the portal's /privacy page).
  useEffect(() => {
    trackView(settings ? `settings:${settings}` : category ? 'category' : 'overview');
  }, [settings, category]);
  useEffect(() => {
    if (adding) track('add spending');
  }, [adding]);
  useEffect(() => {
    if (importing) track('import statement');
  }, [importing]);

  const purchases = useMemo(() => counted(store.records, store.settings.ignoredKeywords), [store.records, store.settings.ignoredKeywords]);
  const shownMonths = useMemo(() => months(purchases, today), [purchases, today]);
  const key = month ?? monthOf(today);
  const summary = useMemo(() => summarise(purchases, key, today, store.settings.monthlyBudget), [purchases, key, today, store.settings.monthlyBudget]);
  const currency = store.currency;
  // The open category follows the data (a purchase moved out of it, a month changed).
  const shownCategory = category && summary.categories.find((c) => c.name === category.name);

  const email = useEmailCheck(store);
  const asked = useRef(false);
  useEffect(() => {
    const s = email.state;
    if (s.status !== 'done' || (!asked.current && s.added === 0)) return;
    asked.current = false;
    notify(s.added ? t('toast.addedFromEmail', { n: s.added }) : t('toast.noneInEmail'));
  }, [email.state, notify, t]);
  const checkEmail = () => {
    asked.current = true;
    setAdding(false);
    void email.check(true);
  };

  const title = t('app.title');
  useEffect(() => {
    document.title = title;
  }, [title]);

  const goMonth = (k: MonthKey) => {
    setMonth(k === monthOf(today) ? null : k);
    setCategory(null);
  };

  const settingsButton = (
    <button slot="actions" type="button" className={iconButton} aria-label={t('settings.open')} onClick={() => setSettings('budget')}>
      <Settings size={22} />
    </button>
  );

  return (
    <Frame {...frame} actions={settingsButton}>
      {banner}
      {!store.ready ? (
        <p className="p-2 text-lg text-muted">{t('app.loading')}</p>
      ) : (
        <>
          <Glance summary={summary} months={shownMonths} onMonth={goMonth} currency={currency} store={store} now={now} email={email} onAdd={() => setAdding(true)} onRetry={checkEmail} />
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
            <WhereItWent summary={summary} currency={currency} selected={shownCategory?.name ?? null} onSelect={(c) => setCategory(c && c.name !== shownCategory?.name ? c : null)} />
            <Purchases summary={summary} category={shownCategory ?? null} currency={currency} today={today} onOpen={setOpen} onAll={() => setCategory(null)} />
          </div>
        </>
      )}

      {open && <PurchaseDialog record={open} store={store} today={today} notify={notify} onClose={() => setOpen(null)} />}
      {adding && (
        <AddSpendingDialog
          store={store}
          checking={email.state.status === 'checking'}
          onCheckEmail={checkEmail}
          onImport={() => (setAdding(false), setImporting(true))}
          onCards={() => (setAdding(false), setSettings('cards'))}
          onClose={() => setAdding(false)}
        />
      )}
      {importing && <ImportDialog store={store} onClose={() => setImporting(false)} onDone={notify} />}
      {settings && <SettingsDialog store={store} tab={settings} onTab={setSettings} notify={notify} onClose={() => setSettings(null)} />}
      <Toast toast={toast} onDone={clear} />
    </Frame>
  );
}
