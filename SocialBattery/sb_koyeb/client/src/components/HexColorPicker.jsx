import { useEffect, useState } from 'react';
import { hexToHslDegrees, hslDegreesToHex } from '../lib/colorZones';
import HslColorSquarePicker from './HslColorSquarePicker';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * HexColorPicker — sustituye al <input type="color"> nativo en los ajustes
 * de personalización. En escritorio, ese input abre el selector del
 * navegador (cuadrado + campo hexadecimal); en móvil abre el selector del
 * sistema operativo, que no siempre ofrece un campo hex y varía de un
 * teléfono a otro. Este componente da la MISMA experiencia en cualquier
 * dispositivo: una fila con el color actual + un campo hexadecimal editable,
 * y un desplegable con el cuadrado tono×saturación (HslColorSquarePicker,
 * el mismo que ya se usa para personalizar prendas) para elegir con el dedo.
 *
 * Es un componente controlado: recibe `value` (hex) y notifica cambios via
 * `onChange(hex)`.
 */
export default function HexColorPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(value || '#000000');

  // Si el color cambia desde fuera (p. ej. "Restaurar colores por defecto"
  // o al cambiar de tema), refleja el nuevo valor en el campo de texto.
  useEffect(() => {
    setHexDraft(value || '#000000');
  }, [value]);

  function commitIfValid(raw) {
    if (HEX_RE.test(raw)) onChange(raw.toLowerCase());
  }

  function handleHexInput(raw) {
    let v = raw.trim();
    if (v && !v.startsWith('#')) v = '#' + v;
    v = '#' + v.slice(1).replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    setHexDraft(v);
    commitIfValid(v);
  }

  function handleHexBlur() {
    if (!HEX_RE.test(hexDraft)) setHexDraft(value || '#000000');
  }

  function handleSquareChange(nextHsl) {
    const hex = hslDegreesToHex(nextHsl.h, nextHsl.s, nextHsl.l);
    setHexDraft(hex);
    onChange(hex);
  }

  const hsl = HEX_RE.test(value) ? hexToHslDegrees(value) : { h: 0, s: 0, l: 0 };

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="w-9 h-9 rounded-lg border border-surface-border flex-shrink-0"
          style={{ background: HEX_RE.test(value) ? value : '#000000' }}
          aria-label="Elegir color"
        />
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-surface-muted pointer-events-none">
            #
          </span>
          <input
            type="text"
            inputMode="text"
            value={hexDraft.replace('#', '').toUpperCase()}
            onChange={e => handleHexInput(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={handleHexBlur}
            maxLength={6}
            spellCheck={false}
            autoCapitalize="characters"
            autoCorrect="off"
            className="w-full pl-6 pr-2 h-9 rounded-lg bg-surface-bg border border-surface-border text-xs font-mono tracking-wider uppercase text-surface-text focus:outline-none focus:border-accent-primary/60"
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className={`text-surface-muted text-xs px-1.5 py-1 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-label={open ? 'Cerrar selector de color' : 'Abrir selector de color'}
        >
          ▾
        </button>
      </div>

      {open && (
        <div className="mt-2 p-3 rounded-xl bg-surface-hover/40 border border-surface-border animate-slide-down">
          <HslColorSquarePicker
            h={hsl.h}
            s={hsl.s}
            l={hsl.l}
            onChange={handleSquareChange}
          />
        </div>
      )}
    </div>
  );
}
