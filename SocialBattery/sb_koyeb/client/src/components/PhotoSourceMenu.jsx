import { useTranslation } from '../i18n';

/**
 * PhotoSourceMenu — action sheet para elegir entre cámara y galería.
 * Ver documentación en la versión anterior — la lógica no cambia.
 */
export default function PhotoSourceMenu({ open, onClose, onCamera, onGallery }) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 animate-fade-in"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-sm bg-surface-card border border-surface-border rounded-3xl p-2 shadow-2xl animate-slide-up"
          onClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => { onClose(); onCamera(); }}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl hover:bg-accent-primary/10 active:bg-accent-primary/15 transition-colors text-left"
          >
            <span className="text-xl">📷</span>
            <span className="text-sm font-display font-semibold text-surface-text">{t('photoMenu.takePhoto')}</span>
          </button>
          <button
            type="button"
            onClick={() => { onClose(); onGallery(); }}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl hover:bg-accent-primary/10 active:bg-accent-primary/15 transition-colors text-left"
          >
            <span className="text-xl">🖼️</span>
            <span className="text-sm font-display font-semibold text-surface-text">{t('photoMenu.fromGallery')}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full flex items-center justify-center px-4 py-3 mt-1 rounded-2xl text-sm font-display font-semibold text-surface-muted hover:bg-surface-bg transition-colors"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </>
  );
}
