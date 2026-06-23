import { useCallback, useEffect, useRef, useState } from 'react';
import { loadImageData, floodFillMask, recolorWithMask, hexToHslDegrees, hslDegreesToHex } from '../lib/colorZones';
import HslColorSquarePicker from './HslColorSquarePicker';

/**
 * HeadColorEditorModal — "personalización extrema" para prendas de cabeza:
 * el usuario toca una zona del gorro/sombrero y la app selecciona toda la
 * región conectada de ese color (flood fill) para repintarla. Se puede
 * repetir con tantas zonas como quiera (copa, visera, logo…). El resultado
 * se guarda como una receta de zonas asociada al id de la prenda, y se
 * aplica al vuelo en cualquier sitio donde ese ítem se muestre.
 *
 * El color de cada zona se elige con HslColorSquarePicker: cuadrado
 * tono×saturación deslizando el dedo + sliders de saturación y luminosidad.
 *
 * Props:
 *   item          ítem del catálogo MASCOT_HEAD que se está personalizando
 *   initialZones  receta de zonas ya guardada para este ítem (o [])
 *   onClose       cierra el modal sin guardar
 *   onSave(zones) confirma y guarda la receta final
 */

const DISPLAY_SIZE = 270;

export default function HeadColorEditorModal({ item, initialZones = [], onClose, onSave }) {
  const canvasRef    = useRef(null);
  const masterDataRef = useRef(null);

  const [zones,     setZones]     = useState(initialZones);
  const [tolerance, setTolerance] = useState(90);
  const [pending,   setPending]   = useState(null);
  const [draftHsl,  setDraftHsl]  = useState({ h: 0, s: 0, l: 50 });
  const [loading,   setLoading]   = useState(true);

  function drawToVisibleCanvas(imageData) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width  = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
  }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getCanvasPixelCoords(e) {
    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (canvas.width  / rect.width));
    const y = Math.floor((e.clientY - rect.top)  * (canvas.height / rect.height));
    return { x, y };
  }

  function handleCanvasClick(e) {
    if (loading) return;
    const imageData = masterDataRef.current;
    if (!imageData) return;
    drawToVisibleCanvas(imageData);

    const { x, y } = getCanvasPixelCoords(e);
    if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) {
      setPending(null);
      return;
    }
    const idx = (y * imageData.width + x) * 4;
    if (imageData.data[idx + 3] < 10) {
      setPending(null);
      return;
    }
    const mask = floodFillMask(imageData, x, y, tolerance);
    if (!mask) { setPending(null); return; }
    const originalColor = `#${[imageData.data[idx], imageData.data[idx + 1], imageData.data[idx + 2]]
      .map(v => v.toString(16).padStart(2, '0')).join('')}`;
    setPending({ mask, x, y, originalColor, tolerance });
    setDraftHsl(hexToHslDegrees(originalColor));
  }

  function previewColor(color) {
    if (!pending || !masterDataRef.current) return;
    const master = masterDataRef.current;
    const clone  = new ImageData(new Uint8ClampedArray(master.data), master.width, master.height);
    recolorWithMask(clone, pending.mask, color);
    drawToVisibleCanvas(clone);
  }

  // El cuadrado tono×saturación y los sliders de saturación/luminosidad
  // actualizan el color "borrador" y refrescan la vista previa al instante.
  function handleHslChange(nextHsl) {
    setDraftHsl(nextHsl);
    previewColor(hslDegreesToHex(nextHsl.h, nextHsl.s, nextHsl.l));
  }

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
            Toca una zona del gorro para seleccionarla y elige el color que quieras. Repite con tantas zonas como necesites (copa, visera, logo…).
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

            {/* Slider de sensibilidad */}
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

            {/* Panel de color */}
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
