import { useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useTranslation } from '../i18n';

// Modal de eliminación de cuenta — misma lógica de siempre. La palabra
// clave de confirmación se mantiene como 'ELIMINAR' en los tres idiomas
// (misma comparación en cliente y servidor); el usuario la ve como
// palabra codificada, no como palabra a traducir.
export default function DeleteAccountModal({ onClose, onDeleted }) {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = confirmation === 'ELIMINAR' && !submitting;

  async function handleDelete() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await api.delete('/users/me', { confirmation: 'ELIMINAR' });
      onDeleted();
    } catch (err) {
      showToast(err?.message || t('deleteAccount.deleteError'));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-surface-card border border-red-500/30 rounded-2xl p-5 max-w-md w-full">
        <h3 className="font-display font-bold text-red-400 text-lg mb-2">{t('deleteAccount.title')}</h3>
        <p className="text-sm text-surface-muted mb-3 leading-relaxed">
          {t('deleteAccount.permanentPrefix')}{' '}
          <strong className="text-surface-text">{t('deleteAccount.permanentBold')}</strong>
          {t('deleteAccount.permanentSuffix')}
        </p>
        <ul className="text-xs text-surface-muted/80 list-disc pl-5 mb-4 space-y-1">
          <li>{t('deleteAccount.bulletProfile')}</li>
          <li>{t('deleteAccount.bulletMessages')}</li>
          <li>{t('deleteAccount.bulletCommunity')}</li>
          <li>{t('deleteAccount.bulletMascot')}</li>
          <li>{t('deleteAccount.bulletBattery')}</li>
        </ul>
        <p className="text-xs text-surface-muted mb-2">
          {t('deleteAccount.confirmPrefix')}{' '}
          <strong className="text-red-400 font-mono">{t('deleteAccount.confirmWord')}</strong>{' '}
          {t('deleteAccount.confirmSuffix')}
        </p>
        <input
          type="text"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          placeholder="ELIMINAR"
          autoFocus
          disabled={submitting}
          className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-2 text-sm
            text-surface-text font-mono focus:outline-none focus:border-red-500/50 disabled:opacity-50"
        />
        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 bg-surface-bg border border-surface-border text-surface-text rounded-xl py-2.5
              text-sm font-display font-semibold hover:bg-surface-border/40 transition-all disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleDelete}
            disabled={!canSubmit}
            className="flex-1 bg-red-500/20 text-red-400 border border-red-500/40 rounded-xl py-2.5
              text-sm font-display font-semibold hover:bg-red-500/30 transition-all
              disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {submitting ? t('deleteAccount.deleting') : t('deleteAccount.deleteCta')}
          </button>
        </div>
      </div>
    </div>
  );
}
