import type { AppBarUser } from '@huishouden/pwa-kit/react/app-bar';
import { AppOpening, type AppFrameProps, type OpeningPhase } from '@huishouden/pwa-kit/react/frame';
import { PORTAL_URL } from '../config/portal';
import { useT } from '../i18n';

/** Who is signed in and the app bar's sign-in controls. */
export interface FrameProps {
  /** Undefined while the session is being restored: neither the avatar nor Sign in shows. */
  user: AppBarUser | null | undefined;
  onSignIn: () => void;
  onSignOut: () => void;
  signingIn: boolean;
}

const VERSION = `${import.meta.env.VITE_APP_VERSION} (${import.meta.env.VITE_BUILD_SHA})`;

/**
 * Spending's frame (the kit's `AppFrame`): the same props while the app opens and once it has
 * loaded, so nothing moves between them. Spending has no tabs.
 */
export function spendingFrame(t: ReturnType<typeof useT>, account: FrameProps): AppFrameProps {
  return { app: t('app.name'), glyph: 'card', portalUrl: PORTAL_URL, version: VERSION, ...account, layout: 'fit' };
}

/** The app while it opens: the kit's opening frame. */
export function SpendingOpening({ phase, frame }: { phase: OpeningPhase; frame: FrameProps }) {
  const t = useT();
  return <AppOpening {...spendingFrame(t, frame)} phase={phase} />;
}
