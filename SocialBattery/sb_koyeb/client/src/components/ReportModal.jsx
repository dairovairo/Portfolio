import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useTranslation } from '../i18n';

// Modal reutilizable de "Denunciar contenido/usuario". Ver comentario
// original en la versión anterior — los usos siguen siendo los mismos
// (chat 1:1, mensajes de grupo/pool/community, publicaciones, perfil).

export default function ReportModal({ targetType, targetId, targetLabel, onClose }) {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Los motivos vienen del hook para que se retraduzcan al cambiar idioma
  // (mientras el modal esté abierto). El `id` sí es estable — es lo que se
  // envía al backend en `reason`.
  const REASONS = useMemo(() => [
    { id: 'spam',           label: t('reportModal.reasonSpam') },
    { id: 'harassment',     label: t('reportModal.reasonHarassment') },
    { id: 'hate',           label: t('reportModal.reasonHate') },
    { id: 'sexual',         label: t('reportModal.reasonSexual') },
    { id: 'minor',          label: t('reportModal.reasonMinor'), highlight: true },
    { id: 'dangerous',      label: t('reportModal.reasonDangerous') },
    { id: 'impersonation',  label: t('reportModal.reasonImpersonation') },
    { id: 'other',          label: t('reportModal.reasonOther') },
  ], [t]);

  async function handleSubmit() {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      await api.post('/reports', {
        target_type: targetType,
        target_id: targetId,
        reason,
        details: details.trim() || undefined,
      });
      showToast(t('reportModal.thanksToast'));
      onClose();
    } catch (err) {
      showToast(err?.message || t('reportModal.submitError'));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="bg-surface-card border border-surface-border rounded-t-2xl sm:rounded-2xl p-5 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-display font-bold text-surface-text text-lg">{t('reportModal.title')}</h3>
            {targetLabel && (
              <p className="text-xs text-surface-muted mt-0.5">{targetLabel}</p>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-surface-muted hover:text-surface-text text-xl leading-none px-1"
            aria-label={t('reportModal.closeLabel')}
          >
            ×
          </button>
        </div>

        <p className="text-xs text-surface-muted mb-4 leading-relaxed">
          {t('reportModal.intro')}
        </p>

        <div className="space-y-1.5 mb-4">
          {REASONS.map((r) => (
            <label
              key={r.id}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-colors
                border ${reason === r.id
                  ? 'border-accent-primary/60 bg-accent-primary/10'
                  : 'border-surface-border bg-surface-bg hover:bg-surface-border/30'}`}
            >
              <input
                type="radio"
                name="reason"
                value={r.id}
                checked={reason === r.id}
                onChange={(e) => setReason(e.target.value)}
                className="h-4 w-4 shrink-0 text-accent-primary focus:ring-accent-primary/40"
              />
              <span className={`text-sm ${r.highlight ? 'text-red-400 font-semibold' : 'text-surface-text'}`}>
                {r.label}
              </span>
            </label>
          ))}
        </div>

        <label className="block text-xs text-surface-muted mb-1.5">
          {t('reportModal.detailsLabel')}
        </label>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
          placeholder={t('reportModal.detailsPh')}
          rows={3}
          disabled={submitting}
          className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-2 text-sm
            text-surface-text focus:outline-none focus:border-accent-primary/50 resize-none disabled:opacity-50"
        />
        <p className="text-[10px] text-surface-muted/60 text-right mt-1 font-mono">
          {details.length}/1000
        </p>

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
            onClick={handleSubmit}
            disabled={!reason || submitting}
            className="flex-1 bg-red-500/20 text-red-400 border border-red-500/40 rounded-xl py-2.5
              text-sm font-display font-semibold hover:bg-red-500/30 transition-all
              disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {submitting ? t('reportModal.submitting') : t('reportModal.submitCta')}
          </button>
        </div>
      </div>
    </div>
  );
}
