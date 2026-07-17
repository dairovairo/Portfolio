import { useCallback, useEffect, useRef, useState } from 'react';
import { loadImageData, floodFillMask, recolorWithMask, hexToHslDegrees, hslDegreesToHex } from '../lib/colorZones';
import HslColorSquarePicker from './HslColorSquarePicker';

/**
 * FeetColorEditorModal — "personalización extrema": el usuario toca una
 * zona del calzado (p. ej. solo la suela, o toda la zapatilla) y la app
 * selecciona automáticamente toda la región conectada de ese mismo color
 * (flood fill), para poder repintarla con cualquier color que elija. Puede
 * repetirse con tantas zonas como quiera (suela de un color, cuerpo de
 * otro, cordones de otro…). El resultado se guarda como una receta ligera
 * de zonas (ver lib/colorZones.js) asociada al id de la prenda, así que se
 * aplica automáticamente en cualquier sitio donde esa prenda se muestre
 * (tienda y mascota).
 *
 * El color de cada zona se elige con HslColorSquarePicker: cuadrado
 * tono×saturación deslizando el dedo + sliders de saturación y luminosidad.
 *
 * Props:
 *   item          ítem del catálogo MASCOT_FEET que se está personalizando
 *   initialZones  receta de zonas ya guardada para este ítem (o [])
 *   onClose       cierra el modal sin guardar
 *   onSave(zones) confirma y guarda la receta final
 */

const DISPLAY_SIZE = 270; // tamaño visible del lienzo de edición (px CSS)

export default function FeetColorEditorModal({
  item,
  initialZones = [],
  onClose,
  onSave,
  helpText = 'Toca una zona de la zapatilla para seleccionarla y elige el color que quieras. Repite con tantas zonas como necesites (suela, cuerpo, cordones…).',
}) {
  const canvasRef = useRef(null);
  const masterDataRef = useRef(null); // ImageData "confirmada" actual

  const [zones, setZones] = useState(initialZones);
  const [tolerance, setTolerance] = useState(90);
  const [pending, setPending] = useState(null); // { mask, x, y, originalColor, tolerance }
  const [draftHsl, setDraftHsl] = useState({ h: 0, s: 0, l: 50 });
  const [loading, setLoading] = useState(true);

  function drawToVisibleCanvas(imageData) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
  }

  // Reconstruye el lienzo "confirmado" desde el PNG original aplicando una
  // lista de zonas en orden — exactamente igual que applyColorZones, para
  // que lo que se ve en el editor coincida siempre con lo que se guarda.
  const rebuildFromZones = useCallback(async (zonesToApply) => {
    const { imageData } = await loadImageData(item.src);
    for (const zone of zonesToApply) {
      const mask = floodFillMask(imageData, zone.x, zone.y, zone.tolerance ?? 30);
      if (mask) recolorWithMask(imageData, mask, zone.color);
    }
    masterDataRef.current = imageData;
    drawToVisibleCanvas(imageData);
  }, [item.src]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    rebuildFromZones(initialZones).then(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Solo se reconstruye al montar; deshacer/restaurar llaman a
    // rebuildFromZones directamente con su propio control de `loading`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getCanvasPixelCoords(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
    return { x, y };
  }

  function handleCanvasClick(e) {
    if (loading) return;
    const imageData = masterDataRef.current;
    if (!imageData) return;
    // Descarta cualquier vista previa sin confirmar de la selección anterior.
    drawToVisibleCanvas(imageData);

    const { x, y } = getCanvasPixelCoords(e);
    if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) {
      setPending(null);
      return;
    }
    const idx = (y * imageData.width + x) * 4;
    if (imageData.data[idx + 3] < 10) {
      setPending(null);
      return; // clic en zona transparente: no hay nada que seleccionar
    }
    const mask = floodFillMask(imageData, x, y, tolerance);
    if (!mask) { setPending(null); return; }
    const originalColor = `#${[imageData.data[idx], imageData.data[idx + 1], imageData.data[idx + 2]]
      .map(v => v.toString(16).padStart(2, '0')).join('')}`;
    setPending({ mask, x, y, originalColor, tolerance });
    setDraftHsl(hexToHslDegrees(originalColor));
  }

  // Vista previa en vivo (no confirma el cambio, no toca masterDataRef).
  function previewColor(color) {
    if (!pending || !masterDataRef.current) return;
    const master = masterDataRef.current;
    const clone = new ImageData(new Uint8ClampedArray(master.data), master.width, master.height);
    recolorWithMask(clone, pending.mask, color);
    drawToVisibleCanvas(clone);
  }

  // El cuadrado tono×saturación y los sliders de saturación/luminosidad
  // actualizan el color "borrador" y refrescan la vista previa al instante.
  function handleHslChange(nextHsl) {
    setDraftHsl(nextHsl);
    previewColor(hslDegreesToHex(nextHsl.h, nextHsl.s, nextHsl.l));
  }

  // Confirma el color: lo aplica sobre el lienzo "master" y añade la zona
  // a la receta final de esta prenda.
  function commitColor(color) {
    if (!pending || !masterDataRef.current) return;
    recolorWithMask(masterDataRef.current, pending.mask, color);
    drawToVisibleCanvas(masterDataRef.current);
    setZones(prev => [...prev, { x: pending.x, y: pending.y, tolerance: pending.tolerance, color }]);
    setPending(null);
  }

  function applyDraftColor() {
    commitColor(hslDegreesToHex(draftHsl.h, draftHsl.s, draftHsl.l));
  }

  function cancelPending() {
    setPending(null);
    if (masterDataRef.current) drawToVisibleCanvas(masterDataRef.current);
  }

  function handleUndo() {
    if (zones.length === 0) return;
    const next = zones.slice(0, -1);
    setPending(null);
    setLoading(true);
    setZones(next);
    rebuildFromZones(next).then(() => setLoading(false));
  }

  function handleResetAll() {
    if (zones.length === 0) return;
    setPending(null);
    setLoading(true);
    setZones([]);
    rebuildFromZones([]).then(() => setLoading(false));
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-sm bg-surface-card border border-accent-primary/40 rounded-3xl shadow-2xl shadow-accent-primary/20 flex flex-col"
          style={{ maxHeight: '88dvh' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header (fijo, siempre visible) */}
          <div className="flex items-center justify-between px-5 pt-5 pb-1 flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg" style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
              <div className="font-display font-bold text-surface-text text-sm truncate">
                Personalizar · {item.name}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-surface-muted hover:text-surface-text p-1 rounded-lg flex-shrink-0"
            >
              ✕
            </button>
          </div>

          <p className="text-[11px] text-surface-muted leading-snug px-5 mb-3 flex-shrink-0">
            {helpText}
          </p>

          {/* Cuerpo: única zona que hace scroll si el contenido no cabe */}
          <div className="px-5 overflow-y-auto flex-1 min-h-0">
            {/* Lienzo de edición */}
            <div
              className="relative flex items-center justify-center bg-surface-hover/30 rounded-2xl mb-3"
              style={{ height: DISPLAY_SIZE }}
            >
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center text-surface-muted text-xs font-mono">
                  Cargando…
                </div>
              )}
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                style={{
                  width: DISPLAY_SIZE,
                  height: DISPLAY_SIZE,
                  cursor: 'crosshair',
                  opacity: loading ? 0 : 1,
                }}
                className="rounded-xl"
              />
            </div>

            {/* Slider de sensibilidad de zona */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-display font-semibold text-surface-muted">
                  Sensibilidad de zona
                </span>
                <span className="text-[10px] font-mono text-surface-muted">{tolerance}</span>
              </div>
              <input
                type="range"
                min={5}
                max={90}
                value={tolerance}
                onChange={e => setTolerance(Number(e.target.value))}
                className="w-full accent-accent-primary"
              />
              <div className="flex justify-between text-[9px] text-surface-muted/70 mt-0.5">
                <span>Solo este tono</span>
                <span>Toda la zona (con sombras)</span>
              </div>
            </div>

            {/* Panel de color — solo si hay una zona seleccionada pendiente */}
            {pending && (
              <div className="bg-surface-hover/40 border border-surface-border rounded-2xl p-3 mb-3">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[11px] text-surface-muted">Original</span>
                  <span
                    className="w-5 h-5 rounded-full border border-surface-border flex-shrink-0"
                    style={{ background: pending.originalColor }}
                  />
                  <span className="text-surface-muted text-xs">→</span>
                  <span className="text-[11px] text-surface-muted">Nuevo</span>
                  <span
                    className="w-5 h-5 rounded-full border border-surface-border flex-shrink-0"
                    style={{ background: `hsl(${draftHsl.h} ${draftHsl.s}% ${draftHsl.l}%)` }}
                  />
                </div>

                <HslColorSquarePicker
                  h={draftHsl.h}
                  s={draftHsl.s}
                  l={draftHsl.l}
                  onChange={handleHslChange}
                />

                <div className="flex gap-2 mt-3">
                  <button
                    onClick={cancelPending}
                    className="flex-1 py-2 rounded-xl text-[11px] font-display font-semibold text-surface-muted hover:text-surface-text"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={applyDraftColor}
                    className="flex-[2] py-2 rounded-xl text-[11px] font-display font-bold bg-accent-primary hover:bg-accent-primary/80 text-white transition-all"
                  >
                    ✓ Aplicar color
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer (fijo, siempre visible): deshacer/restaurar + guardar */}
          <div
            className="px-5 pt-3 pb-5 flex-shrink-0 border-t border-surface-border/60 mt-1"
            style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
          >
            <div className="flex gap-2 mb-2">
              <button
                onClick={handleUndo}
                disabled={zones.length === 0}
                className="flex-1 py-2 rounded-xl text-[11px] font-display font-semibold bg-surface-hover border border-surface-border text-surface-text disabled:opacity-40 hover:border-accent-primary/40 transition-all"
              >
                ↩ Deshacer
              </button>
              <button
                onClick={handleResetAll}
                disabled={zones.length === 0}
                className="flex-1 py-2 rounded-xl text-[11px] font-display font-semibold bg-surface-hover border border-surface-border text-surface-text disabled:opacity-40 hover:border-accent-primary/40 transition-all"
              >
                ✨ Restaurar original
              </button>
            </div>

            <button
              onClick={() => onSave(zones)}
              className="w-full py-2.5 rounded-xl text-sm font-display font-bold bg-accent-primary hover:bg-accent-primary/80 text-white transition-all"
            >
              Guardar personalización
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
