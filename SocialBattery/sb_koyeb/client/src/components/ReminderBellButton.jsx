import { useEffect, useRef, useState } from 'react';

export const MIN_REMINDER_MINUTES = 10;
export const MAX_REMINDER_MINUTES = 7 * 24 * 60;
export const DEFAULT_POOL_REMINDER_MINUTES = 10;
export const DEFAULT_EVENT_REMINDER_MINUTES = 24 * 60;

const BELL_ICON = '\u{1F514}';

const PRESETS = [
  10,
  30,
  60,
  120,
  360,
  720,
  24 * 60,
  3 * 24 * 60,
  7 * 24 * 60,
];

const UNITS = [
  { key: 'minutes', label: 'min', factor: 1, min: 10, max: MAX_REMINDER_MINUTES },
  { key: 'hours', label: 'h', factor: 60, min: 1, max: 7 * 24 },
  { key: 'days', label: 'dias', factor: 24 * 60, min: 1, max: 7 },
];

function normalizeMinutes(value, fallback) {
  const minutes = Number.parseInt(value, 10);
  if (Number.isFinite(minutes) && minutes >= MIN_REMINDER_MINUTES && minutes <= MAX_REMINDER_MINUTES) {
    return minutes;
  }
  return fallback;
}

export function formatReminderLead(minutes) {
  const value = normalizeMinutes(minutes, DEFAULT_POOL_REMINDER_MINUTES);
  if (value === 7 * 24 * 60) return '1 semana';
  if (value >= 24 * 60 && value % (24 * 60) === 0) {
    const days = value / (24 * 60);
    return days === 1 ? '1 dia' : `${days} dias`;
  }
  if (value >= 60 && value % 60 === 0) {
    const hours = value / 60;
    return hours === 1 ? '1 hora' : `${hours} horas`;
  }
  return value === 1 ? '1 minuto' : `${value} minutos`;
}

function splitMinutes(minutes) {
  if (minutes >= 24 * 60 && minutes % (24 * 60) === 0) {
    return { amount: minutes / (24 * 60), unit: 'days' };
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    return { amount: minutes / 60, unit: 'hours' };
  }
  return { amount: minutes, unit: 'minutes' };
}

export default function ReminderBellButton({
  value,
  defaultMinutes = DEFAULT_POOL_REMINDER_MINUTES,
  onChange,
  saving = false,
  disabled = false,
  placement = 'bottom',
  align = 'right',
  wide = false,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const minutes = normalizeMinutes(value, defaultMinutes);
  const initialCustom = splitMinutes(minutes);
  const [customAmount, setCustomAmount] = useState(initialCustom.amount);
  const [customUnit, setCustomUnit] = useState(initialCustom.unit);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const next = splitMinutes(minutes);
    setCustomAmount(next.amount);
    setCustomUnit(next.unit);
  }, [minutes, open]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const currentUnit = UNITS.find(unit => unit.key === customUnit) || UNITS[0];
  const customMinutes = Number.parseInt(customAmount, 10) * currentUnit.factor;
  const customIsValid = Number.isFinite(customMinutes)
    && customMinutes >= MIN_REMINDER_MINUTES
    && customMinutes <= MAX_REMINDER_MINUTES;

  async function save(nextMinutes) {
    if (saving || disabled || !onChange) return;
    await onChange(nextMinutes);
    setOpen(false);
  }

  const menuPlacement = placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2';
  const menuAlign = align === 'left' ? 'left-0' : 'right-0';

  return (
    <div
      ref={rootRef}
      className={`relative ${wide ? 'w-full' : 'flex-shrink-0'} ${className}`}
      onClick={event => event.stopPropagation()}
    >
      <button
        type="button"
        title="Ajustar aviso"
        aria-label="Ajustar aviso"
        disabled={disabled || saving}
        onClick={() => setOpen(prev => !prev)}
        className={`${wide ? 'w-full justify-center' : ''} min-h-[42px] px-3 py-2 rounded-xl border border-accent-primary/25 bg-accent-primary/10 text-accent-glow hover:border-accent-primary/45 hover:bg-accent-primary/15 text-xs font-display font-semibold transition-all disabled:opacity-50 disabled:hover:bg-accent-primary/10 flex items-center gap-2 whitespace-nowrap`}
      >
        <span className="text-base leading-none">{BELL_ICON}</span>
        <span>{saving ? 'Guardando...' : formatReminderLead(minutes)}</span>
      </button>

      {open && (
        <div className={`absolute z-50 ${menuPlacement} ${menuAlign} w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-surface-border bg-surface-card p-3 shadow-2xl shadow-black/40`}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-display font-bold text-surface-text">Aviso</p>
            <span className="text-[10px] font-mono text-surface-muted">10 min - 1 semana</span>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {PRESETS.map(option => {
              const selected = option === minutes;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => save(option)}
                  disabled={saving}
                  className={`px-2 py-2 rounded-lg border text-[11px] font-mono transition-all disabled:opacity-50 ${
                    selected
                      ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-glow'
                      : 'border-surface-border bg-surface-bg text-surface-muted hover:text-surface-text hover:border-accent-primary/30'
                  }`}
                >
                  {formatReminderLead(option)}
                </button>
              );
            })}
          </div>

          <div className="mt-3 pt-3 border-t border-surface-border">
            <p className="text-[10px] font-mono text-surface-muted uppercase mb-2">Personalizado</p>
            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
              <input
                type="number"
                min={currentUnit.min}
                max={currentUnit.max}
                value={customAmount}
                onChange={event => setCustomAmount(event.target.value)}
                className="min-w-0 bg-surface-bg border border-surface-border rounded-lg px-2 py-2 text-sm text-surface-text focus:outline-none focus:border-accent-primary/50"
              />
              <select
                value={customUnit}
                onChange={event => setCustomUnit(event.target.value)}
                className="bg-surface-bg border border-surface-border rounded-lg px-2 py-2 text-xs text-surface-text focus:outline-none focus:border-accent-primary/50"
              >
                {UNITS.map(unit => (
                  <option key={unit.key} value={unit.key}>{unit.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => save(customMinutes)}
                disabled={saving || !customIsValid}
                className="px-3 py-2 rounded-lg bg-accent-primary text-white text-xs font-display font-bold transition-all disabled:opacity-50"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
