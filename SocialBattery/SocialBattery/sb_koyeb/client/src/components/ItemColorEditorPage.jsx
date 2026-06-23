import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadImageData, floodFillMask, recolorWithMask,
  hexToHslDegrees, hslDegreesToHex,
} from '../lib/colorZones';
import HslColorSquarePicker from './HslColorSquarePicker';
import MascotDisplay from './MascotDisplay';
import { MASCOT_ACCESSORIES, useMascot } from '../context/MascotContext';

/**
 * ItemColorEditorPage — editor de personalización de color a pantalla
 * completa. Reemplaza FeetColorEditorModal y HeadColorEditorModal.
 *
 * Muestra el ítem en un canvas (para selección de zonas por flood-fill)
 * junto al mascot completo en tiempo real. Todos los controles están
 * siempre visibles desde el primer momento.
 *
 * Props:
 *   item          ítem del catálogo que se está personalizando
 *   itemType      'feet' | 'outfit' | 'head' | 'accessory'
 *   previewTier   'high' | 'mid' | 'low'
 *   initialZones  receta de zonas ya guardada (o [])
 *   onClose       cierra sin guardar
 *   onSave(zones) confirma y guarda
 *   helpText      texto de ayuda contextual
 */
export default function ItemColorEditorPage({
  item,
  itemType = 'feet',
  previewTier = 'mid',
  initialZones = [],
  onClose,
  onSave,
  helpText = 'Toca una zona para seleccionarla y elige el color que quieras.',
}) {
  const { activeAccessories, getCustomAccessoryItems } = useMascot();

  const canvasRef     = useRef(null);
  const masterDataRef = useRef(null);

  const [zones,          setZones]          = useState(initialZones);
  const [tolerance,      setTolerance]      = useState(90);
  const [pending,        setPending]        = useState(null);
  const [draftHsl,       setDraftHsl]       = useState({ h: 0, s: 0, l: 50 });
  const [loading,        setLoading]        = useState(true);
  const [previewDataUrl, setPreviewDataUrl] = useState(null);

  // Dibuja en el canvas visible y actualiza el dataURL para la preview del mascot.
  function drawToVisibleCanvas(imageData) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width  = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    try { setPreviewDataUrl(canvas.toDataURL('image/png')); } catch (_) {}
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
    // Solo se reconstruye al montar; undo/reset llaman a rebuildFromZones directamente.
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
    if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) { setPending(null); return; }
    const idx = (y * imageData.width + x) * 4;
    if (imageData.data[idx + 3] < 10) { setPending(null); return; }
    const mask = floodFillMask(imageData, x, y, tolerance);
    if (!mask) { setPending(null); return; }
    const originalColor = `#${[imageData.data[idx], imageData.data[idx + 1], imageData.data[idx + 2]]
      .map(v => v.toString(16).padStart(2, '0')).join('')}`;
    setPending({ mask, x, y, originalColor, tolerance });
    setDraftHsl(hexToHslDegrees(originalColor));
  }

  // Vista previa en vivo (no confirma, no toca masterDataRef).
  function previewColor(color) {
    if (!pending || !masterDataRef.current) return;
    const master = masterDataRef.current;
    const clone  = new ImageData(new Uint8ClampedArray(master.data), master.width, master.height);
    recolorWithMask(clone, pending.mask, color);
    drawToVisibleCanvas(clone);
  }

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

  function applyDraftColor() { commitColor(hslDegreesToHex(draftHsl.h, draftHsl.s, draftHsl.l)); }

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

  // ── Props de override para MascotDisplay ─────────────────────────────────────
  // Solo se aplica cuando ya hay un dataURL generado (después de que el
  // canvas haya cargado por primera vez). Mientras tanto el mascot muestra
  // los ítems activos del contexto sin override.
  function buildMascotOverrides() {
    if (!previewDataUrl) return {};
    if (itemType === 'feet') {
      return {
        feetSrc:     previewDataUrl,
        feetItemId:  null,              // no re-aplicar zonas guardadas
        feetOffsetY: item.offsetY  ?? null,
        feetOffsetX: item.offsetX  ?? null,
        feetScale:   item.scale    ?? null,
      };
    }
    if (itemType === 'outfit') {
      return {
        outfitSrc:         previewDataUrl,
        outfitItemId:      null,
        outfitSubcategory: item.subcategory    ?? 'camiseta',
        outfitItemOffsetY: item.offsetY        ?? null,
        outfitItemScale:   item.scale          ?? null,
        outfitOffsetY:     '20%',
      };
    }
    if (itemType === 'head') {
      return {
        headSrc:     previewDataUrl,
        headItemId:  null,
        headScale:   item.scale    ?? null,
        headOffsetY: item.offsetY  ?? null,
        headOffsetX: item.offsetX  ?? null,
        headBox:     item.box      ?? null,
      };
    }
    if (itemType === 'accessory') {
      const customizedAccessoryItems = getCustomAccessoryItems();
      const allAccessories = [...MASCOT_ACCESSORIES, ...customizedAccessoryItems];
      const activeAccs = allAccessories.filter(a => activeAccessories.has(a.id));
      const liveAcc    = { ...item, src: previewDataUrl };
      // Reemplaza el ítem editado en el array de activos o lo añade si no estaba equipado.
      const withLive   = activeAccs.some(a => a.id === item.id)
        ? activeAccs.map(a => a.id === item.id ? liveAcc : a)
        : [...activeAccs, liveAcc];
      return { accessories: withLive };
    }
    return {};
  }

  const mascotOverrides = buildMascotOverrides();

  return (
    <div className="fixed inset-0 z-50 bg-surface-bg flex flex-col">

      {/* Header */}
      <nav className="sticky top-0 bg-surface-bg/90 backdrop-blur-xl border-b border-surface-border flex-shrink-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-surface-muted hover:text-surface-text hover:bg-surface-card transition-all"
          >
            ←
          </button>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="text-base" style={{ fontVariantEmoji: 'emoji' }}>🎨</span>
            <span className="font-display font-bold text-surface-text text-sm truncate">
              Personalizar · {item.name}
            </span>
          </div>
          <button
            onClick={() => onSave(zones)}
            className="flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-display font-bold bg-accent-primary text-white hover:bg-accent-primary/80 transition-all shadow-sm shadow-accent-primary/30"
          >
            Guardar
          </button>
        </div>
      </nav>

      {/* Contenido principal (scrollable) */}
      <div className="flex-1 overflow-y-auto">
        <div
          className="max-w-lg mx-auto px-4 pt-4 flex flex-col gap-4"
          style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}
        >

          {/* ── Fila superior: canvas de edición + preview del mascot ── */}
          <div className="flex gap-3">

            {/* Canvas — selección de zonas por flood-fill */}
            <div className="flex-1 relative bg-surface-hover/30 rounded-2xl overflow-hidden aspect-square">
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-surface-muted text-xs font-mono">Cargando…</span>
                </div>
              )}
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                className="w-full h-full rounded-2xl"
                style={{ cursor: 'crosshair', opacity: loading ? 0 : 1 }}
              />
            </div>

            {/* Mascot completo con el ítem aplicado en tiempo real */}
            <div className="flex-1 bg-surface-card border border-surface-border rounded-2xl flex items-center justify-center aspect-square">
              <MascotDisplay
                tier={previewTier}
                size={130}
                {...mascotOverrides}
              />
            </div>
          </div>

          {/* Texto de ayuda */}
          <p className="text-[11px] text-surface-muted leading-snug -mt-1">
            {helpText}
          </p>

          {/* ── Sensibilidad de zona ── */}
          <div>
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

          {/* ── Panel de color — siempre visible ── */}
          <div className="bg-surface-hover/40 border border-surface-border rounded-2xl p-3">

            {/* Indicador original → nuevo */}
            <div className="flex items-center gap-2 mb-3 min-h-[24px]">
              {pending ? (
                <>
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
                </>
              ) : (
                <span className="text-[11px] text-surface-muted/60 italic">
                  Toca una zona del item para seleccionar el color
                </span>
              )}
            </div>

            {/* Selector de color — inactivo hasta que se toca una zona */}
            <div className={!pending ? 'opacity-50 pointer-events-none' : ''}>
              <HslColorSquarePicker
                h={draftHsl.h}
                s={draftHsl.s}
                l={draftHsl.l}
                onChange={handleHslChange}
              />
            </div>

            {/* Cancelar / Aplicar */}
            <div className="flex gap-2 mt-3">
              <button
                onClick={cancelPending}
                disabled={!pending}
                className="flex-1 py-2 rounded-xl text-[11px] font-display font-semibold text-surface-muted hover:text-surface-text disabled:opacity-30 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={applyDraftColor}
                disabled={!pending}
                className="flex-[2] py-2 rounded-xl text-[11px] font-display font-bold bg-accent-primary hover:bg-accent-primary/80 text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ✓ Aplicar color
              </button>
            </div>
          </div>

          {/* ── Deshacer / Restaurar ── */}
          <div className="flex gap-2">
            <button
              onClick={handleUndo}
              disabled={zones.length === 0}
              className="flex-1 py-2.5 rounded-xl text-[11px] font-display font-semibold bg-surface-hover border border-surface-border text-surface-text disabled:opacity-40 hover:border-accent-primary/40 transition-all"
            >
              ↩ Deshacer
            </button>
            <button
              onClick={handleResetAll}
              disabled={zones.length === 0}
              className="flex-1 py-2.5 rounded-xl text-[11px] font-display font-semibold bg-surface-hover border border-surface-border text-surface-text disabled:opacity-40 hover:border-accent-primary/40 transition-all"
            >
              ✨ Restaurar original
            </button>
          </div>

          {/* ── Guardar ── */}
          <button
            onClick={() => onSave(zones)}
            className="w-full py-3 rounded-xl text-sm font-display font-bold bg-accent-primary hover:bg-accent-primary/80 text-white transition-all shadow-md shadow-accent-primary/20"
          >
            Guardar personalización
          </button>

        </div>
      </div>
    </div>
  );
}
