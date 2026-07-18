import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getBatteryColor } from '../lib/battery';
import MascotDisplay from './MascotDisplay';

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
export function formatPoolDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = d - now;
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffMs < 0) return 'Ya pasó';
  if (diffHours < 1) {
    const mins = Math.floor(diffMs / 60000);
    return `En ${mins} min`;
  }
  if (diffHours < 24) {
    return `Hoy a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) {
    return `Mañana a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Margen de "actividad" para quedadas sin ends_at: se consideran en curso
// durante 2 horas desde el inicio. Mismo criterio que isActive() en PoolsPage.jsx.
const NO_END_GRACE_MS = 2 * 60 * 60 * 1000;

export function getPoolEffectiveEnd(pool) {
  if (pool?.ends_at) return new Date(pool.ends_at);
  return new Date(new Date(pool?.scheduled_at).getTime() + NO_END_GRACE_MS);
}

export function formatPoolDateRange(pool) {
  const now = new Date();
  const start = new Date(pool.scheduled_at);
  const end = getPoolEffectiveEnd(pool);

  if (start <= now && now < end) {
    if (pool.ends_at) {
      const endLabel = end.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `🟢 Activo ahora - fin ${endLabel}`;
    }
    return '🟢 Activo ahora';
  }

  const startLabel = formatPoolDate(pool.scheduled_at);
  if (!pool.ends_at) return startLabel;
  if (Number.isNaN(end.getTime())) return startLabel;
  const endLabel = end.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${startLabel} - fin ${endLabel}`;
}

// ── Status badge ──────────────────────────────────────────────────────────────
export function StatusBadge({ status }) {
  const map = {
    open:      { label: 'Abierto',   cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
    full:      { label: 'Completo',  cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    closed:    { label: 'Cerrado',   cls: 'bg-slate-600/30 text-surface-muted border-slate-600/30' },
    cancelled: { label: 'Cancelado', cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
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
  if (max === null || max === undefined) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-surface-bg rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: '0%' }} />
        </div>
        <span className="text-xs font-mono text-surface-muted flex-shrink-0">
          {current} personas
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

// Mismo criterio de tier que usa el resto de la app (ver getMascotTier en
// HomePage.jsx / FriendCard.jsx / GroupChatPage.jsx): 0-33 → low, 34-66 →
// mid, 67-100 → high.
export function getMascotTier(level) {
  if (level <= 33) return 'low';
  if (level <= 66) return 'mid';
  return 'high';
}

// Mascota en miniatura — mismo criterio que en el panel de integrantes del
// grupo (GroupChatPage.jsx): capa base según tier de batería + overlay
// "horneado" (mascot_preview_url) con la personalización del usuario.
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
      {user?.mascot_preview_url && (
        <img
          src={user.mascot_preview_url}
          alt=""
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
        />
      )}
    </div>
  );
}

// Cuadrito de texto con nombre + descripción de la insignia (mismo
// componente que en GroupChatPage.jsx).
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

// Insignia pulsable (mismo componente que en GroupChatPage.jsx): al
// tocarla muestra su descripción en un cuadrito de texto.
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
