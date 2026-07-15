import { useEffect, useRef } from 'react';
import { hslToRgb } from '../lib/colorZones';

/**
 * HslColorSquarePicker — selector de color táctil que sustituye al antiguo
 * <input type="color"> + paleta de presets fijos. Combina tres controles que
 * trabajan siempre sobre el mismo color HSL:
 *
 *   · Cuadrado tono×saturación — deslizando el dedo se elige a la vez el
 *     tono (eje horizontal, 0–360°) y la saturación (eje vertical: 100%
 *     arriba → 0%/gris abajo). El típico selector de color "con un cuadrado".
 *   · Slider de Saturación — sincronizado con el eje vertical del cuadrado,
 *     para un ajuste más preciso que el gesto táctil.
 *   · Slider de Luminosidad — controla el brillo final del color, eje que no
 *     vive en el cuadrado.
 *
 * Es un componente "controlado": recibe { h, s, l } y notifica cada cambio
 * via onChange({ h, s, l }); quien lo usa decide cuándo convertir a hex y
 * cuándo confirmar el color sobre la prenda.
 */
export default function HslColorSquarePicker({ h, s, l, onChange }) {
  const canvasRef = useRef(null);
  const squareRef = useRef(null);
  const draggingRef = useRef(false);

  // Pinta el cuadrado tono×saturación a la luminosidad actual. Se recalcula
  // solo cuando cambia `l` (el arrastre dentro del cuadrado no repinta nada,
  // solo mueve el marcador, así el gesto va fluido).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const SIZE = 96;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(SIZE, SIZE);
    const lNorm = l / 100;
    for (let y = 0; y < SIZE; y++) {
      const sat = 1 - y / (SIZE - 1);
      for (let x = 0; x < SIZE; x++) {
        const hue = x / (SIZE - 1);
        const [r, g, b] = hslToRgb(hue, sat, lNorm);
        const idx = (y * SIZE + x) * 4;
        imageData.data[idx] = r;
        imageData.data[idx + 1] = g;
        imageData.data[idx + 2] = b;
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [l]);

  function updateFromPoint(clientX, clientY) {
    const el = squareRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fracX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const fracY = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    onChange({ h: Math.round(fracX * 360), s: Math.round((1 - fracY) * 100), l });
  }

  function handlePointerDown(e) {
    e.preventDefault();
    draggingRef.current = true;
    squareRef.current?.setPointerCapture?.(e.pointerId);
    updateFromPoint(e.clientX, e.clientY);
  }
  function handlePointerMove(e) {
    if (!draggingRef.current) return;
    updateFromPoint(e.clientX, e.clientY);
  }
  function handlePointerUp(e) {
    draggingRef.current = false;
    squareRef.current?.releasePointerCapture?.(e.pointerId);
  }

  return (
    <div>
      {/* Cuadrado tono × saturación */}
      <div
        ref={squareRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative w-full rounded-xl overflow-hidden cursor-crosshair select-none"
        style={{ height: 130, touchAction: 'none' }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ imageRendering: 'auto' }}
        />
        <div
          className="absolute w-5 h-5 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.5)] pointer-events-none"
          style={{
            left: `${(h / 360) * 100}%`,
            top: `${100 - s}%`,
            transform: 'translate(-50%, -50%)',
            background: `hsl(${h} ${s}% ${l}%)`,
          }}
        />
      </div>

      {/* Slider de saturación — sincronizado con el eje vertical del cuadrado */}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-display font-semibold text-surface-muted">
            Saturación
          </span>
          <span className="text-[10px] font-mono text-surface-muted">{s}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={s}
          onChange={e => onChange({ h, s: Number(e.target.value), l })}
          className="w-full accent-accent-primary"
          style={{
            background: `linear-gradient(to right, hsl(${h} 0% ${l}%), hsl(${h} 100% ${l}%))`,
          }}
        />
      </div>

      {/* Slider de luminosidad */}
      <div className="mt-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-display font-semibold text-surface-muted">
            Luminosidad
          </span>
          <span className="text-[10px] font-mono text-surface-muted">{l}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={l}
          onChange={e => onChange({ h, s, l: Number(e.target.value) })}
          className="w-full accent-accent-primary"
          style={{
            background: `linear-gradient(to right, #000, hsl(${h} ${s}% 50%), #fff)`,
          }}
        />
      </div>
    </div>
  );
}
