import MascotDisplay from './MascotDisplay';

/**
 * MyCustomizationsModal — galería de todas las prendas a las que el usuario
 * les ha cambiado el color (ver FeetColorEditorModal / lib/colorZones.js).
 * Desde aquí puede reabrir el editor de una prenda ya personalizada o
 * restaurarla a su color original, sin tener que ir a buscarla de nuevo en
 * su carrusel o sub-tab.
 *
 * Props:
 *   items     lista de ítems del catálogo (p. ej. MASCOT_FEET) que ya
 *             tienen una receta de color guardada
 *   onEdit(item)    reabre el editor de color para ese ítem
 *   onRemove(item)  restaura ese ítem a su color original
 *   onClose         cierra el modal
 */
export default function MyCustomizationsModal({ items, onEdit, onRemove, onClose }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-sm bg-surface-card border border-accent-primary/40 rounded-3xl p-5 shadow-2xl shadow-accent-primary/20 max-h-[85vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg" style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
              <div className="font-display font-bold text-surface-text text-sm">
                Mis personalizaciones
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-surface-muted hover:text-surface-text p-1 rounded-lg flex-shrink-0"
            >
              ✕
            </button>
          </div>

          {items.length === 0 ? (
            <div className="py-8 flex flex-col items-center text-center gap-2">
              <span className="text-4xl opacity-60" style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
              <p className="text-surface-muted text-xs leading-snug max-w-[230px]">
                Aún no has personalizado ninguna prenda. Toca el botón 🎨 de cualquier zapatilla para cambiarle el color a tu gusto.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {items.map(item => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 bg-surface-hover/40 border border-surface-border rounded-2xl p-2.5"
                >
                  <div className="flex-shrink-0 rounded-xl overflow-hidden bg-surface-hover/30">
                    <MascotDisplay
                      tier="mid"
                      size={64}
                      feetSrc={item.src}
                      feetItemId={item.id}
                      feetOffsetY={item.offsetY ?? null}
                      feetOffsetX={item.offsetX ?? null}
                      feetScale={item.scale ?? null}
                      outfitSrc={null}
                      headSrc={null}
                      accessories={[]}
                      activityLayers={[]}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-semibold text-surface-text text-xs truncate" title={item.name}>
                      {item.name}
                    </div>
                    <div className="flex gap-2 mt-1.5">
                      <button
                        onClick={() => onEdit(item)}
                        className="text-[10px] font-display font-semibold px-2 py-1 rounded-lg bg-accent-primary/10 border border-accent-primary/30 text-accent-glow hover:bg-accent-primary/20 transition-all"
                      >
                        🎨 Editar
                      </button>
                      <button
                        onClick={() => onRemove(item)}
                        className="text-[10px] font-display font-semibold px-2 py-1 rounded-lg bg-surface-hover border border-surface-border text-surface-muted hover:text-surface-text transition-all"
                      >
                        ↩ Restaurar original
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
