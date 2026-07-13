import MascotDisplay from './MascotDisplay';

/**
 * HeadCustomizationsModal — galería de gorros/sombreros a los que el usuario
 * ha cambiado el color. Cada entrada es un ítem INDEPENDIENTE del catálogo
 * original: desde aquí puede equipar, reeditar o eliminar una personalización.
 *
 * Props:
 *   items          lista de ítems personalizados (ver getCustomHeadItems en
 *                  MascotContext), cada uno con su propio id `head_custom_*`
 *   activeHeadId   id del gorro actualmente equipado (para marcar cuál está puesto)
 *   onEquip(item)  equipa esta personalización
 *   onEdit(item)   reabre el editor de color para ese ítem
 *   onRemove(item) elimina esa personalización por completo
 *   onClose        cierra el modal
 */
export default function HeadCustomizationsModal({ items, activeHeadId, onEquip, onEdit, onRemove, onClose, previewTier = 'mid' }) {
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
                Gorros personalizados
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
                Aún no has personalizado ningún gorro. Toca el botón 🎨 de cualquier prenda de cabeza para crear tu propia variante de color sin tocar el modelo original.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {items.map(item => {
                const isActive = activeHeadId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 bg-surface-hover/40 border rounded-2xl p-2.5 ${isActive ? 'border-accent-primary' : 'border-surface-border'}`}
                  >
                    <div className="flex-shrink-0 rounded-xl overflow-hidden bg-surface-hover/30 relative">
                      {isActive && (
                        <span className="absolute top-0.5 right-0.5 text-[8px] font-mono font-bold px-1 py-0.5 rounded bg-accent-primary text-white z-10">
                          ✓
                        </span>
                      )}
                      <MascotDisplay
                        tier={previewTier}
                        size={64}
                        headSrc={item.src}
                        headItemId={item.id}
                        headScale={item.scale ?? null}
                        headOffsetY={item.offsetY ?? null}
                        headOffsetX={item.offsetX ?? null}
                        headBox={item.box ?? null}
                        outfitSrc={null}
                        feetSrc={null}
                        accessories={[]}
                        activityLayers={[]}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-semibold text-surface-text text-xs truncate" title={item.name}>
                        {item.name}
                      </div>
                      <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        {isActive ? (
                          <span className="text-[10px] font-mono font-semibold px-2 py-1 rounded-lg bg-accent-primary/10 border border-accent-primary/20 text-accent-glow">
                            ✓ Puesto
                          </span>
                        ) : (
                          <button
                            onClick={() => onEquip(item)}
                            className="text-[10px] font-display font-semibold px-2 py-1 rounded-lg bg-surface-hover border border-surface-border text-surface-text hover:border-accent-primary/40 transition-all"
                          >
                            Poner
                          </button>
                        )}
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
                          🗑 Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
