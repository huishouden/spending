import { useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import { agoWords } from '@huishouden/pwa-kit/time';
import { useClock } from '@huishouden/pwa-kit/react/clock';
import { GoogleWindowWait, ghostButton, overline, primaryButton, secondaryButton } from '@huishouden/pwa-kit/react/ui';
import type { AlertInboxes as Inboxes, SpendingStore } from '../data/store';
import type { InboxStatus } from '../services/mailApi';
import { useT } from '../i18n';
import { InboxReview } from './InboxReview';

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
export function AlertInboxSection({ store }: { store: SpendingStore }) {
  const t = useT();
  const { now } = useClock();
  const { inboxes } = store;
  const [reviewing, setReviewing] = useState<InboxStatus | null>(null);
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
                <InboxRow key={i.id} inbox={i} inboxes={inboxes} now={now} onReview={() => setReviewing(i)} />
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
          <GoogleWindowWait waiting={inboxes.awaitingGoogle} blocked={inboxes.blocked} onShow={inboxes.showGoogle} onContinueHere={inboxes.continueHere} />
          {inboxes.error && (
            <p role="alert" className="rounded-xl bg-error-tint px-3 py-2 text-error">
              {inboxes.error}
            </p>
          )}
        </>
      )}
      {reviewing && <InboxReview inbox={reviewing} store={store} onClose={() => setReviewing(null)} />}
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

function InboxRow({ inbox, inboxes, now, onReview }: { inbox: InboxStatus; inboxes: Inboxes; now: number; onReview: () => void }) {
  const t = useT();
  const [confirmUndo, setConfirmUndo] = useState(false);
  const last = inbox.lastImport;
  const canUndo = !!last && last.done && !last.undone && last.added > 0 && (inbox.mine || inboxes.isAdmin);
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
      {last && (
        <p className="text-sm text-muted">
          {last.undone
            ? t('inbox.lastImportUndone', { ago: agoWords(last.at, now) })
            : last.review > 0
              ? t('inbox.lastImportReview', { n: last.added, m: last.review, ago: agoWords(last.at, now) })
              : t('inbox.lastImport', { n: last.added, ago: agoWords(last.at, now) })}
        </p>
      )}
      {(canUndo || (inbox.mine && (inbox.review ?? 0) > 0)) && (
        <div className="flex flex-wrap gap-2">
          {inbox.mine && (inbox.review ?? 0) > 0 && (
            <button type="button" className={secondaryButton} onClick={onReview}>
              {t('inbox.review', { n: inbox.review ?? 0 })}
            </button>
          )}
          {canUndo &&
            (confirmUndo ? (
              <>
                <span className="self-center text-sm text-ink">{t('inbox.undoConfirm', { n: last!.added })}</span>
                <button type="button" className={primaryButton} disabled={inboxes.busy !== null} onClick={() => void inboxes.undo(inbox.id, last!.id).finally(() => setConfirmUndo(false))}>
                  {t('inbox.undoYes')}
                </button>
                <button type="button" className={ghostButton} onClick={() => setConfirmUndo(false)}>
                  {t('common.cancel')}
                </button>
              </>
            ) : (
              <button type="button" className={ghostButton} disabled={inboxes.busy !== null} onClick={() => setConfirmUndo(true)}>
                {t('inbox.undo')}
              </button>
            ))}
        </div>
      )}
      {errorKey && <p className={`text-sm ${stopped ? 'font-medium text-attention' : 'text-muted'}`}>{t(errorKey)}</p>}
    </li>
  );
}
