import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getBatteryColor } from '../lib/battery';
import MascotDisplay from './MascotDisplay';
import MascotPreviewOverlay from './MascotPreviewOverlay';
import { useTranslation } from '../i18n';

// Fallback t() para cuando los helpers puros de este módulo se llaman
// desde código aún no migrado a i18n. Devuelve el string ES tal cual usaba
// antes el sitio original, para que la app siga funcionando exactamente
// igual mientras se van traduciendo las páginas una a una. Se elimina en
// cuanto todas las llamadas a formatPoolDate*, etc. pasen su propio `t`
// desde arriba — que es lo que hacen ya PoolsPage y PoolDetailPage.
const ES_FALLBACK = {
  'poolShared.alreadyPassed':    'Ya pasó',
  'poolShared.startsNow':        'Empieza ya',
  'poolShared.minsLeftOne':      'Falta 1 min',
  'poolShared.minsLeftMany':     'Faltan {n} min',
  'poolShared.hoursLeftOne':     'Falta 1 hora',
  'poolShared.hoursLeftMany':    'Faltan {n} horas',
  'poolShared.daysLeftOne':      'Falta 1 día',
  'poolShared.daysLeftMany':     'Faltan {n} días',
  'poolShared.todayAt':          'Hoy a las {time}',
  'poolShared.tomorrowAt':       'Mañana a las {time}',
  'poolShared.activeNow':        '🟢 Activo ahora',
  'poolShared.activeUntil':      '🟢 Activo ahora - fin {end}',
  'poolShared.dateWithEnd':      '{start} - fin {end}',
  'poolShared.statusOpen':       'Abierto',
  'poolShared.statusFull':       'Completo',
  'poolShared.statusClosed':     'Cerrado',
  'poolShared.statusCancelled':  'Cancelado',
  'poolShared.peopleUnlimited':  '{n} personas',
};
function tFallback(key, params = {}) {
  let s = ES_FALLBACK[key] || key;
  Object.entries(params).forEach(([k, v]) => { s = s.replace(`{${k}}`, v); });
  return s;
}
function localeTagFor(lang) {
  return lang === 'en' ? 'en-US' : lang === 'fr' ? 'fr-FR' : 'es-ES';
}

// ── Activity emoji mapping ────────────────────────────────────────────────────
export function getActivityEmoji(activity = '') {
  const a = activity.toLowerCase();
  if (/café|cafe|coffee|cafetera/.test(a)) return '☕';
  if (/cine|película|pelicula|movie/.test(a)) return '🎬';
  if (/cerveza|bar|birra|drink|copa/.test(a)) return '🍺';
  if (/comida|comer|restaurante|almuerzo|cena/.test(a)) return '🍽️';
  if (/parque|paseo|walk|caminar|jardín/.test(a)) return '🌳';
  if (/deporte|gym|fútbol|futbol|tenis|paddle|sport/.test(a)) return '⚽';
  if (/playa|piscina|pool|swim/.test(a)) return '🏊';
  if (/música|musica|concierto|concert/.test(a)) return '🎵';
  if (/juego|gaming|videojuego|partida/.test(a)) return '🎮';
  if (/estudio|estudiar|trabajo|trabajar|biblioteca/.test(a)) return '📚';
  if (/fiesta|party|celebrar/.test(a)) return '🎉';
  if (/yoga|meditación|meditacion/.test(a)) return '🧘';
  if (/senderismo|hiking|montaña|montana/.test(a)) return '🥾';
  if (/compras|shopping/.test(a)) return '🛍️';
  return '🤝';
}

// ── Date formatting ───────────────────────────────────────────────────────────
// Todos estos helpers aceptan `t` y `lang` opcionales. Si no llegan, caen
// al español (comportamiento antiguo). PoolsPage y PoolDetailPage ya
// pasan ambos desde useTranslation(); el resto de páginas irán migrando.
export function formatPoolDate(dateStr, t = tFallback, lang = 'es') {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = d - now;
  const diffHours = diffMs / (1000 * 60 * 60);
  const tag = localeTagFor(lang);

  if (diffMs < 0) return t('poolShared.alreadyPassed');
  if (diffHours < 24) {
    return t('poolShared.todayAt', { time: d.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' }) });
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) {
    return t('poolShared.tomorrowAt', { time: d.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' }) });
  }
  return d.toLocaleDateString(tag, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function getPoolDaysUntilLabel(dateStr, t = tFallback) {
  if (!dateStr) return '';
  const time = new Date(dateStr).getTime();
  if (Number.isNaN(time)) return '';
  const diffMs = time - Date.now();
  if (diffMs < 0) return '';
  const MIN_MS = 60 * 1000;
  const HOUR_MS = 60 * MIN_MS;
  const DAY_MS = 24 * HOUR_MS;
  if (diffMs < MIN_MS) return t('poolShared.startsNow');
  if (diffMs < HOUR_MS) {
    const mins = Math.max(1, Math.round(diffMs / MIN_MS));
    return mins === 1 ? t('poolShared.minsLeftOne') : t('poolShared.minsLeftMany', { n: mins });
  }
  if (diffMs < DAY_MS) {
    const hours = Math.max(1, Math.round(diffMs / HOUR_MS));
    return hours === 1 ? t('poolShared.hoursLeftOne') : t('poolShared.hoursLeftMany', { n: hours });
  }
  const days = Math.ceil(diffMs / DAY_MS);
  if (days === 1) return t('poolShared.daysLeftOne');
  return t('poolShared.daysLeftMany', { n: days });
}

const NO_END_GRACE_MS = 2 * 60 * 60 * 1000;

export function getPoolEffectiveEnd(pool) {
  if (pool?.ends_at) return new Date(pool.ends_at);
  return new Date(new Date(pool?.scheduled_at).getTime() + NO_END_GRACE_MS);
}

export function formatPoolDateRange(pool, t = tFallback, lang = 'es') {
  const now = new Date();
  const start = new Date(pool.scheduled_at);
  const end = getPoolEffectiveEnd(pool);
  const tag = localeTagFor(lang);

  if (start <= now && now < end) {
    if (pool.ends_at) {
      const endLabel = end.toLocaleDateString(tag, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return t('poolShared.activeUntil', { end: endLabel });
    }
    return t('poolShared.activeNow');
  }

  const startLabel = formatPoolDate(pool.scheduled_at, t, lang);
  if (!pool.ends_at) return startLabel;
  if (Number.isNaN(end.getTime())) return startLabel;
  const endLabel = end.toLocaleDateString(tag, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return t('poolShared.dateWithEnd', { start: startLabel, end: endLabel });
}

// ── Status badge ──────────────────────────────────────────────────────────────
export function StatusBadge({ status }) {
  const { t } = useTranslation();
  const map = {
    open:      { label: t('poolShared.statusOpen'),      cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
    full:      { label: t('poolShared.statusFull'),      cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    closed:    { label: t('poolShared.statusClosed'),    cls: 'bg-slate-600/30 text-surface-muted border-slate-600/30' },
    cancelled: { label: t('poolShared.statusCancelled'), cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
  };
  const cfg = map[status] || map.open;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-mono ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ── Punto de "mensaje sin leer" (chat de la quedada) ──────────────────────────
export function UnreadChatDot({ className = '' }) {
  return (
    <span className={`absolute flex h-3 w-3 ${className}`}>
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 border-2 border-surface-card" />
    </span>
  );
}

// ── Pool capacity bar ─────────────────────────────────────────────────────────
export function CapacityBar({ current, max }) {
  const { t } = useTranslation();
  if (max === null || max === undefined) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-surface-bg rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: '0%' }} />
        </div>
        <span className="text-xs font-mono text-surface-muted flex-shrink-0">
          {t('poolShared.peopleUnlimited', { n: current })}
        </span>
      </div>
    );
  }
  const pct = Math.min(100, (current / max) * 100);
  const color = pct >= 100 ? '#f97316' : pct >= 75 ? '#facc15' : '#4ade80';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-surface-bg rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 6px ${color}60` }}
        />
      </div>
      <span className="text-xs font-mono text-surface-muted flex-shrink-0">
        {current}/{max}
      </span>
    </div>
  );
}

// Nº de mascotas de participantes que se muestran en el panel de la
// quedada antes de agrupar el resto en un "+N" (ver PoolCard en PoolsPage.jsx).
export const PARTICIPANT_MASCOTS_VISIBLE = 5;

export function getMascotTier(level) {
  if (level <= 33) return 'low';
  if (level <= 66) return 'mid';
  return 'high';
}

export function MiniMascot({ user, size = 32 }) {
  const { profile } = useAuth();
  const isMe = Boolean(profile?.id) && user?.id === profile.id;
  const color = getBatteryColor(user?.battery_level ?? 50);
  const tier = getMascotTier(user?.battery_level ?? 50);

  if (isMe) {
    return (
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <MascotDisplay tier={tier} size={size} glowColor={color.hex} />
      </div>
    );
  }

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <MascotDisplay
        tier={tier}
        size={size}
        glowColor={color.hex}
        outfitSrc={null}
        feetSrc={null}
        headSrc={null}
        accessories={[]}
        activityLayers={[]}
      />
      <MascotPreviewOverlay src={user?.mascot_preview_url} />
    </div>
  );
}

export function BadgeDescriptionPopover({ badge, align = 'left', placement = 'top' }) {
  return (
    <div
      className={`absolute z-50 ${placement === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'} ${align === 'right' ? 'right-0' : 'left-0'} w-52 max-w-[70vw] bg-surface-card border border-surface-border rounded-xl p-3 shadow-2xl text-left animate-fade-in`}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg leading-none">{badge.emoji}</span>
        <span className="font-display font-bold text-surface-text text-sm">{badge.name}</span>
      </div>
      <p className="text-xs text-surface-muted leading-relaxed">{badge.description}</p>
    </div>
  );
}

export function IdentityBadge({ identity, size = 'panel', align = 'left', showName = false, popoverPlacement = 'top' }) {
  const [open, setOpen] = useState(false);

  const buttonClass = {
    panel: 'w-[2.475rem] h-[2.475rem] rounded-xl bg-accent-primary/10 border border-accent-primary/25 flex items-center justify-center text-[1.375rem]',
  }[size];

  return (
    <div className="relative flex-shrink-0 flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className={buttonClass}
      >
        {identity.badge.emoji}
      </button>
      {showName && (
        <span className="text-[9px] text-accent-glow font-display font-semibold text-center leading-tight max-w-[56px] truncate">
          {identity.badge.name}
        </span>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <BadgeDescriptionPopover badge={identity.badge} align={align} placement={popoverPlacement} />
        </>
      )}
    </div>
  );
}
