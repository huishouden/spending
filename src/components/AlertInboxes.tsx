import { Mail, RefreshCw } from 'lucide-react';
import { agoWords } from '@huishouden/pwa-kit/time';
import { useClock } from '@huishouden/pwa-kit/react/clock';
import { ghostButton, overline, primaryButton, secondaryButton } from '@huishouden/pwa-kit/react/ui';
import type { AlertInboxes as Inboxes } from '../data/store';
import type { InboxStatus } from '../services/mailApi';
import { useT } from '../i18n';

/** Errors that stop an inbox's checks until someone connects it again. */
export const STOPPED = ['revoked', 'not-member', 'signed-out'];

const ERROR_KEYS = {
  revoked: 'inbox.error.revoked',
  'not-member': 'inbox.error.notMember',
  'signed-out': 'inbox.error.signedOut',
  'nothing-to-search': 'inbox.error.nothingToSearch',
  gmail: 'inbox.error.gmail',
  firestore: 'inbox.error.firestore',
} as const;

/**
 * Settings > Email: the Gmail accounts the household's card alerts arrive at. Any admin or member
 * connects one (Google's account chooser, read-only); the calendar Worker checks each every few
 * minutes as whoever connected it.
 */
export function AlertInboxSection({ inboxes }: { inboxes: Inboxes }) {
  const t = useT();
  const { now } = useClock();
  const list = inboxes.status?.inboxes ?? [];
  const busy = inboxes.busy !== null;
  return (
    <section className="space-y-3" aria-label={t('inbox.title')}>
      <h3 className={overline}>{t('inbox.title')}</h3>
      <p className="text-sm text-muted">{t('inbox.intro')}</p>
      {inboxes.status && !inboxes.status.available ? (
        <p className="text-sm text-muted">{t('inbox.unavailable')}</p>
      ) : (
        <>
          {inboxes.status && (
            <ul className="divide-y divide-line rounded-2xl border border-line" aria-label={t('inbox.list')}>
              {list.map((i) => (
                <InboxRow key={i.id} inbox={i} inboxes={inboxes} now={now} />
              ))}
              {list.length === 0 && <li className="px-4 py-3 text-sm text-muted">{t('inbox.none')}</li>}
            </ul>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" className={list.length ? secondaryButton : primaryButton} disabled={busy} onClick={() => void inboxes.connect()}>
              <Mail size={18} /> {inboxes.busy === 'connect' ? t('inbox.connecting') : list.length ? t('inbox.connectAnother') : t('inbox.connect')}
            </button>
            {list.length > 0 && (
              <button type="button" className={secondaryButton} disabled={busy} onClick={() => void inboxes.checkNow().catch(() => undefined)}>
                <RefreshCw size={18} /> {inboxes.busy === 'check' || list.some((i) => i.checking) ? t('inbox.checking') : t('inbox.checkNow')}
              </button>
            )}
          </div>
          {inboxes.error && (
            <p role="alert" className="rounded-xl bg-error-tint px-3 py-2 text-error">
              {inboxes.error}
            </p>
          )}
        </>
      )}
      <details className="rounded-2xl border border-line px-4 py-2">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-ink">{t('inbox.privacyTitle')}</summary>
        <div className="space-y-2 pb-3 text-sm text-muted">
          <p>{t('inbox.privacy')}</p>
          <p>{t('inbox.unverified')}</p>
        </div>
      </details>
    </section>
  );
}

function InboxRow({ inbox, inboxes, now }: { inbox: InboxStatus; inboxes: Inboxes; now: number }) {
  const t = useT();
  const stopped = !!inbox.error && STOPPED.includes(inbox.error);
  const errorKey = inbox.error ? ERROR_KEYS[inbox.error as keyof typeof ERROR_KEYS] : undefined;
  return (
    <li aria-label={inbox.address} className="space-y-1 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{inbox.address}</span>
        {stopped && (
          <button type="button" className={primaryButton} disabled={inboxes.busy !== null} onClick={() => void inboxes.connect()}>
            {t('inbox.reconnect')}
          </button>
        )}
        {(inbox.mine || inboxes.isAdmin) && (
          <button type="button" className={ghostButton} aria-label={t('inbox.disconnectLabel', { address: inbox.address })} disabled={inboxes.busy !== null} onClick={() => void inboxes.disconnect(inbox.id)}>
            {t('inbox.disconnect')}
          </button>
        )}
      </div>
      <p className="text-sm text-muted">
        {inbox.mine ? t('inbox.byYou') : t('inbox.by', { who: inbox.by })}
        {' · '}
        {inbox.checking ? t('inbox.checking') : inbox.lastChecked ? t('inbox.checked', { ago: agoWords(inbox.lastChecked, now) }) : t('inbox.notChecked')}
        {inbox.lastAlertAt && inbox.lastAdded ? ` · ${t('inbox.found', { n: inbox.lastAdded, ago: agoWords(inbox.lastAlertAt, now) })}` : ''}
      </p>
      {errorKey && <p className={`text-sm ${stopped ? 'font-medium text-attention' : 'text-muted'}`}>{t(errorKey)}</p>}
    </li>
  );
}
