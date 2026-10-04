import type { ReactNode } from 'react';
import { ChevronRight, FileUp, Mail } from 'lucide-react';
import { Dialog } from '@huishouden/pwa-kit/react/ui';
import type { SpendingStore } from '../data/store';
import { useT } from '../i18n';

interface Props {
  store: SpendingStore;
  checking: boolean;
  onCheckEmail: () => void;
  onImport: () => void;
  /** Settings > Cards, when no card says what its alert emails look like yet. */
  onCards: () => void;
  onClose: () => void;
}

/** The two ways spending comes in: card alert emails, and statement files. */
export function AddSpendingDialog({ store, checking, onCheckEmail, onImport, onCards, onClose }: Props) {
  const t = useT();
  const canSearch = store.cards.some((c) => c.alertWords.length > 0) || store.settings.alertLabels.length > 0;
  const firstTime = store.live && canSearch && !store.mail.stored();
  return (
    <Dialog title={t('add.title')} onClose={onClose}>
      <div className="space-y-3">
        {canSearch ? (
          <Choice icon={<Mail size={22} />} title={t('add.checkEmail')} text={t('add.checkEmailText')} onClick={onCheckEmail} disabled={checking} />
        ) : (
          <Choice
            icon={<Mail size={22} />}
            title={t('add.setUp')}
            text={store.cards.length ? t('add.setUpText') : t('add.setUpTextNoCards')}
            onClick={onCards}
          />
        )}
        <Choice icon={<FileUp size={22} />} title={t('import.title')} text={t('add.importText')} onClick={onImport} />
      </div>
      {firstTime && (
        <p className="mt-4 text-sm text-muted">{t('add.unverified')}</p>
      )}
    </Dialog>
  );
}

function Choice({ icon, title, text, onClick, disabled }: { icon: ReactNode; title: string; text: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-16 w-full items-center gap-4 rounded-2xl border border-line bg-surface px-4 py-3 text-left transition-colors duration-150 hover:border-forest-400 dark:hover:border-forest-300 hover:bg-stone-100 dark:hover:bg-forest-700 disabled:opacity-50"
    >
      <span className="text-link">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-ink">{title}</span>
        <span className="block text-sm text-muted">{text}</span>
      </span>
      <ChevronRight size={20} className="text-muted" />
    </button>
  );
}
