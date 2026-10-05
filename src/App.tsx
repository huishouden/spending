import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { signInSilently } from '@huishouden/pwa-kit/auth';
import { markJoined, saveMyProfile, watchHousehold, type HouseholdState } from '@huishouden/pwa-kit/household';
import { householdRole, refusal } from '@huishouden/pwa-kit/roles';
import { seesMoney } from './lib/access';
import { popupCancelled } from '@huishouden/pwa-kit/feedback';
import { ClockProvider } from '@huishouden/pwa-kit/react/clock';
import { cardClass, primaryButton, SampleBanner, useToast } from '@huishouden/pwa-kit/react/ui';
import { auth, googleClientId, signInWithGoogle, signOutEverywhere } from './services/auth';
import { getDb } from './services/firestoreTransactions';
import { useLiveStore } from './data/useLiveStore';
import { chooserCode, chooserRedirect, chooserReturn, useAlertInboxes } from './data/useAlertInboxes';
import { SAMPLE_NOW, useSampleStore } from './data/sample';
import { DEFAULT_SPEND_SETTINGS } from './data/model';
import { PORTAL_URL } from './config/portal';
import { Frame, SpendingApp, type FrameProps } from './SpendingApp';
import { t, useT } from './i18n';

/** Who is here decides what shows: the sample household, a "not in a household yet" note, or the household's own spending. */
export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  // Signs in without a click when the browser is signed in to Google and has used the app before.
  useEffect(() => {
    if (googleClientId) void signInSilently(auth, googleClientId);
  }, []);

  const signIn = useCallback(async () => {
    setSigningIn(true);
    setSignInError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      if (!popupCancelled(e)) setSignInError(t('signIn.failed'));
    } finally {
      setSigningIn(false);
    }
  }, []);
  const signOut = useCallback(() => void signOutEverywhere(), []);
  const frame: FrameProps = { user, onSignIn: signIn, onSignOut: signOut, signingIn };

  if (user === undefined) return <Frame {...frame} />;
  // `?sample=helper`: what a helper or kid sees when signed in, for screenshots and tests.
  if (user === null && new URLSearchParams(location.search).get('sample') === 'helper') return <MoneyRefusal frame={frame} />;
  if (user === null) return <SampleApp frame={frame} signInError={signInError} />;
  return <SignedIn key={user.uid} user={user} frame={frame} />;
}

function SignedIn({ user, frame }: { user: User; frame: FrameProps }) {
  const t = useT();
  const email = (user.email ?? '').toLowerCase();
  const [state, setState] = useState<HouseholdState>({ status: 'loading' });
  useEffect(() => (email ? watchHousehold(getDb(), email, setState) : undefined), [email]);
  const household = state.status === 'ready' ? state.household : null;
  useEffect(() => {
    if (!household) return;
    markJoined(getDb(), household, email).catch(() => {});
    // Members' names and photos come from their own sign-ins (shown in the portal).
    saveMyProfile(getDb(), household.id, user).catch(() => {});
  }, [household, email, user]);

  // Helpers and kids never see the household's money (the rules refuse every read): no listeners, no email checks.
  if (state.status === 'ready' && !seesMoney(state.household, email)) return <MoneyRefusal frame={frame} />;
  if (state.status === 'ready') return <LiveApp householdId={state.household.id} currency={state.household.currency} email={email} isAdmin={householdRole(state.household, email) === 'admin'} frame={frame} />;
  if (state.status === 'loading') return <Note frame={frame}>{t('household.finding')}</Note>;
  if (state.status === 'error') return <Note frame={frame}>{t('household.unreachable')}</Note>;
  return (
    <Note frame={frame}>
      <h2 className="text-2xl font-semibold text-ink">{t('household.noneTitle')}</h2>
      <p className="mt-2">{t('household.noneBody', { email: user.email ?? '' })}</p>
      <a className={`${primaryButton} mt-5`} href={PORTAL_URL}>
        {t('household.openPortal')}
      </a>
    </Note>
  );
}

function LiveApp({ householdId, currency, email, isAdmin, frame }: { householdId: string; currency?: string; email: string; isAdmin: boolean; frame: FrameProps }) {
  const toasts = useToast();
  const code = useMemo(() => chooserCode(auth, googleClientId), []);
  const redirect = useMemo(() => chooserRedirect(auth, googleClientId), []);
  const returned = useMemo(() => chooserReturn(auth), []);
  const inboxes = useAlertInboxes({ householdId, caller: () => auth.currentUser, isAdmin, code, redirect, returned });
  const store = useLiveStore(householdId, email, DEFAULT_SPEND_SETTINGS, toasts.fail, inboxes, currency);
  return (
    <ClockProvider read={Date.now}>
      <SpendingApp store={store} frame={frame} toasts={toasts} />
    </ClockProvider>
  );
}

/** Signed out: an invented household on its own clock, kept in memory, so the app can be tried and screenshotted. */
function SampleApp({ frame, signInError }: { frame: FrameProps; signInError: string | null }) {
  const loadedAt = useMemo(() => Date.now(), []);
  const read = useCallback(() => SAMPLE_NOW + (Date.now() - loadedAt), [loadedAt]);
  const t = useT();
  const toasts = useToast();
  const store = useSampleStore(read);
  const banner = <SampleBanner text={t('sample.banner')} notice={signInError ?? undefined} />;
  return (
    <ClockProvider read={read}>
      <SpendingApp store={store} frame={frame} toasts={toasts} banner={banner} />
    </ClockProvider>
  );
}

function MoneyRefusal({ frame }: { frame: FrameProps }) {
  const t = useT();
  return (
    <Note frame={frame}>
      <h2 className="text-2xl font-semibold text-ink">{t('app.name')}</h2>
      <p className="mt-2">{refusal('see-money')}</p>
      <a className={`${primaryButton} mt-5`} href={PORTAL_URL}>
        {t('household.openPortal')}
      </a>
    </Note>
  );
}

function Note({ frame, children }: { frame: FrameProps; children: ReactNode }) {
  return (
    <Frame {...frame}>
      <div className={`${cardClass} max-w-2xl p-6 text-lg text-muted`}>{children}</div>
    </Frame>
  );
}
