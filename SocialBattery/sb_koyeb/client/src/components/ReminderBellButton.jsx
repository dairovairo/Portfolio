import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../i18n';

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

function normalizeMinutes(value, fallback) {
  const minutes = Number.parseInt(value, 10);
  if (Number.isFinite(minutes) && minutes >= MIN_REMINDER_MINUTES && minutes <= MAX_REMINDER_MINUTES) {
    return minutes;
  }
  return fallback;
}

// Etiqueta legible del "cuánto antes se avisa" — se traduce con el t()
// del componente. Recibe t como parámetro para poder llamarse fuera del
// componente si hiciera falta (por ahora solo lo llama el propio botón).
export function formatReminderLead(minutes, t) {
  // Fallback ES si el llamador no pasa t (compatibilidad con código no
  // migrado — algunas pantallas pintan la lead label en otro sitio).
  const _t = t || ((k, p = {}) => {
    const map = {
      'reminderBell.leadOneWeek': '1 semana',
      'reminderBell.leadOneDay':  '1 día',
      'reminderBell.leadNDays':   `${p.n} días`,
      'reminderBell.leadOneHour': '1 hora',
      'reminderBell.leadNHours':  `${p.n} horas`,
      'reminderBell.leadOneMin':  '1 minuto',
      'reminderBell.leadNMins':   `${p.n} minutos`,
    };
    return map[k] || k;
  });
  const value = normalizeMinutes(minutes, DEFAULT_POOL_REMINDER_MINUTES);
  if (value === 7 * 24 * 60) return _t('reminderBell.leadOneWeek');
  if (value >= 24 * 60 && value % (24 * 60) === 0) {
    const days = value / (24 * 60);
    return days === 1 ? _t('reminderBell.leadOneDay') : _t('reminderBell.leadNDays', { n: days });
  }
  if (value >= 60 && value % 60 === 0) {
    const hours = value / 60;
    return hours === 1 ? _t('reminderBell.leadOneHour') : _t('reminderBell.leadNHours', { n: hours });
  }
  return value === 1 ? _t('reminderBell.leadOneMin') : _t('reminderBell.leadNMins', { n: value });
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
  const { t } = useTranslation();
  const UNITS = useMemo(() => [
    { key: 'minutes', label: t('reminderBell.unitMin'),  factor: 1,        min: 10, max: MAX_REMINDER_MINUTES },
    { key: 'hours',   label: t('reminderBell.unitHour'), factor: 60,       min: 1,  max: 7 * 24 },
    { key: 'days',    label: t('reminderBell.unitDay'),  factor: 24 * 60,  min: 1,  max: 7 },
  ], [t]);

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
        title={t('reminderBell.tooltip')}
        aria-label={t('reminderBell.tooltip')}
        disabled={disabled || saving}
        onClick={() => setOpen(prev => !prev)}
        className={`${wide ? 'w-full justify-center' : ''} min-h-[42px] px-3 py-2 rounded-xl border border-accent-primary/25 bg-accent-primary/10 text-accent-glow hover:border-accent-primary/45 hover:bg-accent-primary/15 text-xs font-display font-semibold transition-all disabled:opacity-50 disabled:hover:bg-accent-primary/10 flex items-center gap-2 whitespace-nowrap`}
      >
        <span className="text-base leading-none">{BELL_ICON}</span>
        <span>{saving ? t('reminderBell.saving') : formatReminderLead(minutes, t)}</span>
      </button>

      {open && (
        <div className={`absolute z-50 ${menuPlacement} ${menuAlign} w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-surface-border bg-surface-card p-3 shadow-2xl shadow-black/40`}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-display font-bold text-surface-text">{t('reminderBell.title')}</p>
            <span className="text-[10px] font-mono text-surface-muted">{t('reminderBell.range')}</span>
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
                  {formatReminderLead(option, t)}
                </button>
              );
            })}
          </div>

          <div className="mt-3 pt-3 border-t border-surface-border">
            <p className="text-[10px] font-mono text-surface-muted uppercase mb-2">{t('reminderBell.custom')}</p>
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
