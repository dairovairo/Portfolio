/**
 * PhotoSourceMenu — action sheet para elegir entre "Hacer una foto" (cámara)
 * y "Elegir de la galería" cuando el usuario quiere subir una imagen.
 *
 * No gestiona los <input type="file"> en sí: cada pantalla mantiene sus
 * propios refs (uno normal para galería y uno con `capture` para cámara) y
 * les pasa el click a través de onCamera / onGallery. Así reutilizamos el
 * mismo handleChange que ya existía en cada pantalla, sin tocar su lógica.
 *
 * Uso:
 *   <PhotoSourceMenu
 *     open={showPhotoMenu}
 *     onClose={() => setShowPhotoMenu(false)}
 *     onCamera={() => cameraInputRef.current?.click()}
 *     onGallery={() => fileRef.current?.click()}
 *   />
 */
export default function PhotoSourceMenu({ open, onClose, onCamera, onGallery }) {
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
            <span className="text-sm font-display font-semibold text-surface-text">Hacer una foto</span>
          </button>
          <button
            type="button"
            onClick={() => { onClose(); onGallery(); }}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl hover:bg-accent-primary/10 active:bg-accent-primary/15 transition-colors text-left"
          >
            <span className="text-xl">🖼️</span>
            <span className="text-sm font-display font-semibold text-surface-text">Elegir de la galería</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full flex items-center justify-center px-4 py-3 mt-1 rounded-2xl text-sm font-display font-semibold text-surface-muted hover:bg-surface-bg transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </>
  );
}
