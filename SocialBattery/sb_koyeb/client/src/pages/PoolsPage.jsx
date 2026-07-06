import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import TutorialOverlay from '../components/TutorialOverlay';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { getBatteryColor } from '../lib/battery';
import { supabase } from '../lib/supabase';
import { isOnline } from '../hooks/usePresence';
import ReminderBellButton, { DEFAULT_POOL_REMINDER_MINUTES } from '../components/ReminderBellButton';
import { usePoolChatNotifications } from '../context/PoolChatNotificationsContext';
import MascotDisplay from '../components/MascotDisplay';

// ── Activity emoji mapping ────────────────────────────────────────────────────
function getActivityEmoji(activity = '') {
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
function formatPoolDate(dateStr) {
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

function formatPoolDateRange(pool) {
  const start = formatPoolDate(pool.scheduled_at);
  if (!pool.ends_at) return start;
  const end = new Date(pool.ends_at);
  if (Number.isNaN(end.getTime())) return start;
  const endLabel = end.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${start} - fin ${endLabel}`;
}

function formatInputDateTime(dateStr) {
  const d = new Date(dateStr);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
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
function UnreadChatDot({ className = '' }) {
  return (
    <span className={`absolute flex h-3 w-3 ${className}`}>
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 border-2 border-surface-card" />
    </span>
  );
}

// ── Pool capacity bar ─────────────────────────────────────────────────────────
function CapacityBar({ current, max }) {
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
// quedada antes de agrupar el resto en un "+N" (ver PoolCard más abajo).
const PARTICIPANT_MASCOTS_VISIBLE = 5;

// Mismo criterio de tier que usa el resto de la app (ver getMascotTier en
// HomePage.jsx / FriendCard.jsx / GroupChatPage.jsx): 0-33 → low, 34-66 →
// mid, 67-100 → high.
function getMascotTier(level) {
  if (level <= 33) return 'low';
  if (level <= 66) return 'mid';
  return 'high';
}

// Mascota en miniatura — mismo criterio que en el panel de integrantes del
// grupo (GroupChatPage.jsx): capa base según tier de batería + overlay
// "horneado" (mascot_preview_url) con la personalización del usuario.
function MiniMascot({ user, size = 32 }) {
  const color = getBatteryColor(user?.battery_level ?? 50);
  const tier = getMascotTier(user?.battery_level ?? 50);
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
// componente que en GroupChatPage.jsx). `placement` controla si se abre
// hacia arriba ('top', por defecto) o hacia abajo ('bottom') del icono —
// necesario para el primer apuntado de la lista, donde abrir hacia arriba
// lo corta contra el borde superior del panel con scroll.
function BadgeDescriptionPopover({ badge, align = 'left', placement = 'top' }) {
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
// tocarla muestra su descripción en un cuadrito de texto. `size` = 'panel'
// es el único tamaño usado aquí, con el nombre debajo del icono.
function IdentityBadge({ identity, size = 'panel', align = 'left', showName = false, popoverPlacement = 'top' }) {
  const [open, setOpen] = useState(false);

  const buttonClass = {
    // +10% sobre el tamaño base (w-9 h-9 / text-xl), igual que en el panel
    // de integrantes del grupo.
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

// ── Participants sheet (bottom drawer) ────────────────────────────────────────
function ParticipantsSheet({ pool, onClose, onJoin, onLeave, onReminderChange, joining, leaving, reminderSaving }) {
  const navigate = useNavigate();
  const { hasUnreadPoolChat } = usePoolChatNotifications();
  const hasUnreadChat = hasUnreadPoolChat(pool.id);
  // Fetch full participant list
  const [participants, setParticipants] = useState(pool.participants_preview || []);
  const [loading, setLoading] = useState(false);
  const [badgeData, setBadgeData] = useState({ assignments: [] });

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/pools/${pool.id}`),
      api.get(`/badges/pool/${pool.id}`).catch(() => ({ assignments: [] })),
    ])
      .then(([{ pool: full }, badges]) => {
        setParticipants(full.participants || []);
        setBadgeData({ assignments: badges.assignments || [] });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [pool.id]);

  const identitiesByUser = badgeData.assignments.reduce((acc, assignment) => {
    if (!acc[assignment.userId]) acc[assignment.userId] = [];
    acc[assignment.userId].push(assignment);
    return acc;
  }, {});

  const isPast = new Date(pool.scheduled_at) <= new Date();
  const canJoin = pool.status === 'open' && !pool.has_joined && !isPast && pool.status !== 'cancelled';
  const canLeave = pool.has_joined && !pool.is_creator && !isPast;
  const canAdjustReminder = pool.has_joined && !isPast && pool.status !== 'cancelled' && pool.status !== 'closed';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle — fijo */}
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mt-3 mb-1 flex-shrink-0" />

        {/* Header — fijo */}
        <div className="flex-shrink-0 px-5 py-3 border-b border-surface-border">
          {pool.cover_image_url && (
            <div className="-mt-1 mb-3 aspect-[16/9] overflow-hidden rounded-xl border border-surface-border bg-surface-bg">
              <img src={pool.cover_image_url} alt="" className="h-full w-full object-cover" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-2xl">{getActivityEmoji(pool.activity)}</span>
            <div className="flex-1 min-w-0">
              <h3 className="font-display font-bold text-surface-text truncate">{pool.activity}</h3>
              <p className="text-xs text-surface-muted font-mono">{formatPoolDateRange(pool)}</p>
            </div>
            <button
              onClick={() => navigate(`/pools/${pool.id}/chat`)}
              title="Abrir chat de la quedada"
              className="relative flex-shrink-0 flex items-center gap-1 text-xs font-display font-semibold px-2.5 py-1.5 rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/25 hover:bg-blue-500/25 hover:border-blue-500/40 hover:text-blue-300 transition-colors transform scale-[1.15] origin-left"
            >
              <span>💬</span> Chat
              {hasUnreadChat && <UnreadChatDot className="-top-1 -right-1" />}
            </button>
          </div>
          {pool.description && (
            <p className="text-sm text-surface-muted mt-2 leading-relaxed">{pool.description}</p>
          )}
          {pool.location_hint && (
            <p className="text-xs text-surface-muted mt-1 flex items-center gap-1.5">
              <span>📍</span>{pool.location_hint}
            </p>
          )}
        </div>

        {/* Lista de participantes — ocupa el espacio restante y hace scroll */}
        <div className="flex-1 overflow-y-auto px-5 py-3 min-h-0">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-display font-bold text-surface-text">Apuntados</h4>
            <span className="text-xs font-mono text-surface-muted">
              {pool.max_people !== null && pool.max_people !== undefined
                ? `${pool.participant_count}/${pool.max_people}`
                : `${pool.participant_count} apuntados`}
            </span>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-10 bg-surface-bg rounded-xl animate-pulse" />
              ))}
            </div>
          ) : participants.length === 0 ? (
            <p className="text-surface-muted text-sm text-center py-4">Nadie apuntado aún</p>
          ) : (
            <div className="space-y-2">
              {participants.map((p, idx) => {
                const batteryColor = getBatteryColor(p.battery_level ?? 50);
                const isFirst = idx === 0;
                const identity = (identitiesByUser[p.id] || [])[0] || null;
                return (
                  <div key={p.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-surface-bg/50 transition-colors">
                    <div className="relative flex-shrink-0">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-display font-bold border-2 flex-shrink-0"
                        style={{ borderColor: batteryColor?.hex, background: `${batteryColor?.hex}15` }}
                      >
                        {p.avatar_url
                          ? <img src={p.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                          : (p.username?.[0] || '?').toUpperCase()
                        }
                      </div>
                      {/* Mascota — izquierda-abajo del avatar, mismo patrón
                          que en el panel de integrantes del grupo
                          (GroupChatPage.jsx). */}
                      <div className="absolute" style={{ bottom: 'calc(-0.25rem - 8%)', left: 'calc(-0.25rem - 6%)' }}>
                        <MiniMascot user={p} size={35} />
                      </div>
                      {/* Punto de en línea — derecha-abajo, mismo patrón que FriendCard.jsx / GroupChatPage.jsx */}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-surface-card ${isOnline(p.last_seen_at) ? 'bg-green-400' : 'bg-slate-600'}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-display font-semibold text-surface-text truncate flex items-center gap-1.5">
                        {p.username}
                        {isFirst && (
                          <span className="text-xs font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 px-1.5 py-0.5 rounded-full">
                            Organiza
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Insignia — a la izquierda del % de batería, centrada
                        verticalmente (la fila ya usa items-center). */}
                    {identity && (
                      <IdentityBadge identity={identity} size="panel" showName align="right" popoverPlacement={isFirst ? 'bottom' : 'top'} />
                    )}
                    {/* % de batería — ancho fijo para que no desplace la
                        insignia al pasar de 1 a 2 dígitos (mismo motivo que
                        en el panel de integrantes del grupo). */}
                    {p.battery_level != null && (
                      <div
                        className="font-display font-bold tabular-nums text-sm text-center flex-shrink-0"
                        style={{ color: batteryColor?.hex, width: 38 }}
                      >
                        {p.battery_level}%
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Plazas vacías — solo si hay límite */}
          {pool.spots_left !== null && pool.spots_left > 0 && pool.status === 'open' && (
            <div className="mt-3 space-y-1.5">
              {Array.from({ length: Math.min(pool.spots_left, 3) }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-xl border border-dashed border-surface-border/50 opacity-40">
                  <div className="w-10 h-10 rounded-full border-2 border-dashed border-slate-600 flex items-center justify-center">
                    <span className="text-slate-600 text-xs">?</span>
                  </div>
                  <span className="text-xs text-slate-600 font-mono">Plaza libre</span>
                </div>
              ))}
              {pool.spots_left > 3 && (
                <p className="text-xs text-slate-600 font-mono text-center">
                  +{pool.spots_left - 3} plazas libres más
                </p>
              )}
            </div>
          )}
        </div>

        {/* Botones — siempre visibles, pegados al fondo */}
        <div className="flex-shrink-0 border-t border-surface-border px-5 py-3">
          {canAdjustReminder && (
            <div className="mb-2">
              <ReminderBellButton
                value={pool.current_user_reminder_minutes_before}
                defaultMinutes={DEFAULT_POOL_REMINDER_MINUTES}
                saving={reminderSaving === pool.id}
                onChange={minutes => onReminderChange(pool.id, minutes)}
                placement="top"
                wide
              />
            </div>
          )}
          {canJoin && (
            <button
              onClick={() => { onJoin(pool.id); onClose(); }}
              disabled={joining === pool.id || pool.status === 'full'}
              className="w-full py-3 rounded-2xl bg-accent-primary hover:bg-accent-primary/80 text-surface-text text-sm font-display font-bold transition-all disabled:opacity-50"
            >
              {joining === pool.id ? 'Uniéndose...' : '🚀 Unirse al plan'}
            </button>
          )}
          {canLeave && (
            <button
              onClick={() => { onLeave(pool.id); onClose(); }}
              disabled={leaving === pool.id}
              className="w-full py-3 rounded-2xl bg-slate-700/50 hover:bg-red-500/20 text-slate-300 hover:text-red-400 text-sm font-display font-bold border border-slate-600/30 hover:border-red-500/30 transition-all disabled:opacity-50"
            >
              {leaving === pool.id ? 'Saliendo...' : 'Salir del plan'}
            </button>
          )}
          <button
            onClick={onClose}
            className="w-full mt-2 py-2 text-surface-muted text-sm font-display font-semibold hover:text-surface-text transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Pool Card ──────────────────────────────────────────────────────────────────
function PoolCard({ pool, onJoin, onLeave, onCancel, onOpenDetail, joining, leaving }) {
  const emoji = getActivityEmoji(pool.activity);
  const canJoin = pool.status === 'open' && !pool.has_joined;
  const isPast = new Date(pool.scheduled_at) <= new Date();
  const { hasUnreadPoolChat } = usePoolChatNotifications();
  const hasUnreadChat = hasUnreadPoolChat(pool.id);

  return (
    <div
      className={`relative bg-surface-card border rounded-2xl p-4 transition-all duration-200 cursor-pointer ${
        pool.status === 'cancelled' ? 'border-red-500/20 opacity-60' :
        pool.has_joined ? 'border-accent-primary/30 shadow-sm shadow-accent-primary/10' :
        'border-surface-border hover:border-surface-border/60'
      }`}
      onClick={() => onOpenDetail(pool)}
    >
      {hasUnreadChat && <UnreadChatDot className="-top-1 -right-1" />}
      {pool.cover_image_url && (
        <div className="mb-3 aspect-[16/9] overflow-hidden rounded-xl border border-surface-border bg-surface-bg">
          <img src={pool.cover_image_url} alt="" className="h-full w-full object-cover" />
        </div>
      )}
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="text-3xl flex-shrink-0 mt-0.5">{emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-bold text-surface-text text-base leading-tight truncate">
              {pool.activity}
            </h3>
            <StatusBadge status={pool.status} />
            {pool.is_public ? (
              <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded-full font-mono">
                🌐 Amigos
              </span>
            ) : (
              <span className="text-xs bg-accent-primary/20 text-accent-glow border border-accent-primary/30 px-1.5 py-0.5 rounded-full font-mono">
                🔒 Privado
              </span>
            )}
            {pool.has_joined && !pool.is_creator && (
              <span className="text-xs bg-accent-primary/20 text-accent-glow border border-accent-primary/30 px-1.5 py-0.5 rounded-full font-mono">
                ✓ Unido
              </span>
            )}
          </div>

          {pool.description && (
            <p className="text-xs text-surface-muted mt-1 line-clamp-2">{pool.description}</p>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-2 text-xs text-surface-muted">
          <span>🕐</span>
          <span className="font-mono">{formatPoolDateRange(pool)}</span>
        </div>
        {pool.location_hint && (
          <div className="flex items-center gap-2 text-xs text-surface-muted">
            <span>📍</span>
            <span className="truncate">{pool.location_hint}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-surface-muted">
          <span>👤</span>
          <span>
            {pool.creator?.username}
            {pool.is_creator ? ' (tú)' : ''}
          </span>
        </div>
      </div>

      {/* Capacity */}
      <CapacityBar current={pool.participant_count} max={pool.max_people} />

      {/* Participantes — mascotas con nombre debajo. Sustituye al contador
          de texto ("X personas apuntadas") y al botón "Ver": todo el panel
          ya es pulsable, así que basta con tocarlo para ver el detalle. */}
      <div
        className="mt-3 flex items-start gap-2 flex-wrap"
        onClick={e => { e.stopPropagation(); onOpenDetail(pool); }}
      >
        {pool.participant_count === 0 ? (
          <span className="text-xs text-surface-muted">Sin participantes aún</span>
        ) : (
          <>
            {(pool.participants_preview || []).slice(0, PARTICIPANT_MASCOTS_VISIBLE).map(p => (
              <div key={p.id} className="flex flex-col items-center flex-shrink-0" style={{ width: 46 }} title={p.username}>
                <MiniMascot user={p} size={39} />
                <span className="text-[9px] font-display font-semibold text-surface-muted mt-0.5 max-w-[46px] truncate">
                  {p.mascot_name || 'Volty'}
                </span>
              </div>
            ))}
            {pool.participant_count > PARTICIPANT_MASCOTS_VISIBLE && (
              <div className="flex flex-col items-center justify-center flex-shrink-0" style={{ width: 39, height: 39 }}>
                <div className="w-full h-full rounded-full bg-surface-bg border border-surface-border text-surface-muted flex items-center justify-center text-[11px] font-mono">
                  +{pool.participant_count - PARTICIPANT_MASCOTS_VISIBLE}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Actions — stop propagation so clicks don't open the sheet */}
      {!isPast && pool.status !== 'cancelled' && pool.status !== 'closed' && (
        <div className="mt-3 flex gap-2" onClick={e => e.stopPropagation()}>
          {canJoin ? (
            <button
              onClick={() => onJoin(pool.id)}
              disabled={joining === pool.id || pool.status === 'full'}
              className="flex-1 py-2 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-surface-text text-sm font-display font-semibold transition-all disabled:opacity-50"
            >
              {joining === pool.id ? 'Uniéndose...' :
               pool.status === 'full' ? 'Completo' : '🚀 Unirse'}
            </button>
          ) : pool.has_joined && !pool.is_creator ? (
            <button
              onClick={() => onLeave(pool.id)}
              disabled={leaving === pool.id}
              className="flex-1 py-2 rounded-xl bg-slate-700/50 hover:bg-red-500/20 text-slate-300 hover:text-red-400 text-sm font-display font-semibold border border-slate-600/30 hover:border-red-500/30 transition-all disabled:opacity-50"
            >
              {leaving === pool.id ? 'Saliendo...' : 'Salir del pool'}
            </button>
          ) : null}

          {pool.is_creator && (
            <button
              onClick={() => onCancel(pool.id)}
              className="py-2 px-3 rounded-xl bg-slate-700/50 hover:bg-red-500/20 text-surface-muted hover:text-red-400 text-sm border border-slate-600/30 hover:border-red-500/30 transition-all"
              title="Cancelar pool"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Friend / Group multi-picker ───────────────────────────────────────────────
function FriendPicker({ selected, onChange, label = 'Amigos' }) {
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/friends')
      .then(({ friends: data }) => setFriends(data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = friends.filter(f =>
    !search || f.username?.toLowerCase().includes(search.toLowerCase())
  );

  function toggle(id) {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  }

  if (loading) return <div className="h-10 bg-surface-bg rounded-xl animate-pulse" />;
  if (!friends.length) return (
    <p className="text-xs text-surface-muted bg-surface-bg border border-surface-border rounded-xl p-3 text-center">
      No tienes amigos aún
    </p>
  );

  return (
    <div>
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar amigo..."
        className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-2 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors mb-2"
      />
      <div className="space-y-1.5 max-h-44 overflow-y-auto">
        {filtered.map(f => {
          const isSelected = selected.includes(f.id);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => toggle(f.id)}
              className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all ${
                isSelected
                  ? 'border-accent-primary/50 bg-accent-primary/10'
                  : 'border-surface-border bg-surface-bg hover:border-surface-border/60'
              }`}
            >
              <div className="w-7 h-7 rounded-full bg-accent-primary/20 flex items-center justify-center text-xs font-display font-bold text-accent-glow flex-shrink-0">
                {f.avatar_url
                  ? <img src={f.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                  : (f.username?.[0] || '?').toUpperCase()
                }
              </div>
              <span className="flex-1 text-sm font-display font-semibold text-surface-text truncate">
                {f.username}
              </span>
              {isSelected && <span className="text-accent-glow text-sm flex-shrink-0">✓</span>}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-xs text-surface-muted text-center py-2">Sin resultados</p>
        )}
      </div>
    </div>
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => resolve(event.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function buildPoolFormData(form) {
  const formData = new FormData();
  Object.entries(form).forEach(([key, value]) => {
    if (key === 'cover_file') return;
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      if (value.length) formData.append(key, JSON.stringify(value));
      return;
    }
    formData.append(key, String(value));
  });
  if (form.cover_file) formData.append('cover', form.cover_file);
  return formData;
}

// ── Create Pool Modal ─────────────────────────────────────────────────────────
function CreatePoolModal({ onClose, onCreate }) {
  const minDate = formatInputDateTime(new Date(Date.now() + 30 * 60 * 1000));
  const coverInputRef = useRef(null);
  const [form, setForm] = useState({
    activity: '',
    description: '',
    location_hint: '',
    scheduled_at: minDate,
    ends_at: '',
    max_people: null,
    is_public: true,
    group_id: null,
    invited_user_ids: [],
  });
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [groups, setGroups] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const emoji = getActivityEmoji(form.activity);

  useEffect(() => {
    api.get('/groups').then(({ groups: data }) => setGroups(data || [])).catch(() => {});
  }, []);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function setVisibility(isPublic) {
    setForm(f => ({ ...f, is_public: isPublic, group_id: null, invited_user_ids: [] }));
  }

  function toggleGroup(id) {
    setForm(f => ({ ...f, group_id: f.group_id === id ? null : id }));
  }

  async function handleCoverChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setError('La foto no puede superar 3MB');
      e.target.value = '';
      return;
    }
    setCoverFile(file);
    setCoverPreview(await readFileAsDataUrl(file));
    setError('');
  }

  function clearCover() {
    setCoverFile(null);
    setCoverPreview('');
    if (coverInputRef.current) coverInputRef.current.value = '';
  }

  const hasPrivateTarget = !form.is_public && (form.group_id || form.invited_user_ids.length > 0);

  async function handleSubmit() {
    if (!form.activity.trim()) { setError('La actividad es obligatoria'); return; }
    if (!form.scheduled_at) { setError('La fecha es obligatoria'); return; }
    if (!form.location_hint.trim()) { setError('La ubicacion es obligatoria'); return; }
    if (form.ends_at && new Date(form.ends_at) <= new Date(form.scheduled_at)) {
      setError('La fecha fin debe ser posterior al inicio');
      return;
    }
    if (!form.is_public && !hasPrivateTarget) {
      setError('Elige al menos un grupo o un amigo para el plan privado');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onCreate({
        ...form,
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
        max_people: form.max_people !== null && form.max_people !== '' ? parseInt(form.max_people) : null,
        cover_file: coverFile,
      });
      onClose();
    } catch (e) {
      setError(e.message || 'Error al crear el plan');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-2xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-6 sm:hidden" />

        <div className="flex items-center gap-3 mb-6">
          <span className="text-3xl">{emoji}</span>
          <div>
            <h2 className="font-display font-bold text-surface-text text-lg">Crear plan</h2>
            <p className="text-xs text-surface-muted">Propón un plan, tus amigos se unirán</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Activity */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">Actividad *</label>
            <input type="text" value={form.activity} onChange={e => set('activity', e.target.value)}
              placeholder="Ej: Café en el centro, Fútbol 5, Cine..." maxLength={100}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors" />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">Descripción <span className="text-slate-600">(opcional)</span></label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              placeholder="Más detalles sobre el plan..." maxLength={300} rows={2}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors resize-none" />
          </div>

          {/* Date/time + max people */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono text-surface-muted mb-1.5">Cuándo *</label>
              <input type="datetime-local" value={form.scheduled_at} min={minDate} onChange={e => set('scheduled_at', e.target.value)}
                className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-3 text-surface-text text-sm focus:outline-none focus:border-accent-primary/50 transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-mono text-surface-muted mb-1.5">Fin <span className="text-slate-600">(opcional)</span></label>
              <input type="datetime-local" value={form.ends_at} min={form.scheduled_at || minDate} onChange={e => set('ends_at', e.target.value)}
                className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-3 text-surface-text text-sm focus:outline-none focus:border-accent-primary/50 transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-mono text-surface-muted mb-1.5">Límite de personas</label>
              <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
                <input
                  type="checkbox"
                  checked={form.max_people === null}
                  onChange={e => set('max_people', e.target.checked ? null : 4)}
                  className="w-4 h-4 rounded border-surface-border accent-accent-primary"
                />
                <span className="text-sm text-surface-muted">Sin límite</span>
              </label>
              {form.max_people !== null && (
                <input
                  type="number"
                  value={form.max_people}
                  min={2}
                  max={50}
                  onChange={e => set('max_people', parseInt(e.target.value) || 2)}
                  className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-3 text-surface-text text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
                />
              )}
            </div>
            <div>
              <label className="block text-xs font-mono text-surface-muted mb-1.5">
                Portada <span className="text-slate-600">(opcional)</span>
              </label>
              {coverPreview ? (
                <div className="relative w-full h-[77px] overflow-hidden rounded-xl border border-surface-border bg-surface-bg">
                  <img src={coverPreview} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={clearCover}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center hover:bg-black/80 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  className="w-full h-[77px] rounded-xl border border-dashed border-accent-primary/35 bg-accent-primary/5 flex flex-col items-center justify-center gap-1 text-accent-glow hover:bg-accent-primary/10 transition-all"
                >
                  <span className="text-lg">📷</span>
                  <span className="text-[11px] font-display font-semibold leading-tight">Añadir foto</span>
                </button>
              )}
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleCoverChange}
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">Ubicación *</label>
            <input type="text" value={form.location_hint} onChange={e => set('location_hint', e.target.value)}
              placeholder="Ej: Plaza Mayor, cerca de la estación..." maxLength={150}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors" />
          </div>

          {/* Visibility */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-2">Visibilidad</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setVisibility(true)}
                className={`p-3 rounded-xl border text-left transition-all ${form.is_public ? 'border-accent-primary bg-accent-primary/10' : 'border-surface-border bg-surface-bg hover:border-surface-border/60'}`}>
                <div className="text-lg mb-1">🌐</div>
                <div className="text-sm font-display font-semibold text-surface-text">Público</div>
                <div className="text-xs text-surface-muted mt-0.5">Todos tus amigos lo ven</div>
              </button>
              <button type="button" onClick={() => setVisibility(false)}
                className={`p-3 rounded-xl border text-left transition-all ${!form.is_public ? 'border-accent-primary/50 bg-accent-primary/10' : 'border-surface-border bg-surface-bg hover:border-surface-border/60'}`}>
                <div className="text-lg mb-1">🔒</div>
                <div className="text-sm font-display font-semibold text-surface-text">Privado</div>
                <div className="text-xs text-surface-muted mt-0.5">Solo quien tú elijas</div>
              </button>
            </div>
          </div>

          {/* Private: invite section */}
          {!form.is_public && (
            <div className="bg-surface-bg border border-accent-primary/20 rounded-2xl p-4 space-y-4">
              <p className="text-xs text-accent-glow font-mono">
                🔒 Elige quién puede ver y unirse a este plan
              </p>

              {/* Groups */}
              {groups.length > 0 && (
                <div>
                  <label className="block text-xs font-mono text-surface-muted mb-2">Por grupo</label>
                  <div className="space-y-2">
                    {groups.map(g => (
                      <button key={g.id} type="button" onClick={() => toggleGroup(g.id)}
                        className={`w-full p-2.5 rounded-xl border flex items-center gap-3 transition-all text-left ${
                          form.group_id === g.id
                            ? 'border-accent-primary/50 bg-accent-primary/10'
                            : 'border-surface-border bg-surface-card hover:border-surface-border/60'
                        }`}>
                        <span className="text-lg">👥</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-display font-semibold text-surface-text truncate">{g.name}</div>
                          <div className="text-xs text-surface-muted">{g.member_count} miembros</div>
                        </div>
                        {form.group_id === g.id && <span className="text-accent-glow">✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Divider */}
              {groups.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 border-t border-surface-border" />
                  <span className="text-xs text-slate-600 font-mono">y/o</span>
                  <div className="flex-1 border-t border-surface-border" />
                </div>
              )}

              {/* Individual friends */}
              <div>
                <label className="block text-xs font-mono text-surface-muted mb-2">
                  Amigos individuales
                  {form.invited_user_ids.length > 0 && (
                    <span className="ml-2 text-accent-glow">({form.invited_user_ids.length} seleccionados)</span>
                  )}
                </label>
                <FriendPicker
                  selected={form.invited_user_ids}
                  onChange={ids => set('invited_user_ids', ids)}
                />
              </div>
            </div>
          )}

          {error && <p className="text-red-400 text-sm font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">{error}</p>}

          <button onClick={handleSubmit} disabled={saving || !form.activity.trim() || !form.location_hint.trim()}
            className="w-full py-3.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-surface-text font-display font-bold text-sm transition-all disabled:opacity-50">
            {saving ? 'Creando...' : '🚀 Crear plan'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sortByDate(pools) {
  return [...pools].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
}

function isActive(p) {
  return p.status !== 'cancelled' && p.status !== 'closed' && new Date(p.scheduled_at) > new Date();
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PoolsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [pools, setPools] = useState([]);
  const [myCreated, setMyCreated] = useState([]);
  const [myJoined, setMyJoined] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('active');
  const [showCreate, setShowCreate] = useState(false);
  const [joining, setJoining] = useState(null);
  const [leaving, setLeaving] = useState(null);
  const [reminderSaving, setReminderSaving] = useState(null);
  const [toast, setToast] = useState(null);
  const [detailPool, setDetailPool] = useState(null); // pool for participants sheet
  const visiblePoolIdsRef = useRef(new Set());
  const poolsRefreshTimerRef = useRef(null);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const fetchPools = useCallback(async (currentTab = tab) => {
    setLoading(true);
    try {
      if (currentTab === 'active') {
        const { pools: data } = await api.get('/pools?filter=active&limit=30');
        setPools(data || []);
      } else {
        const [mineRes, joinedRes] = await Promise.all([
          api.get('/pools?filter=mine&limit=50'),
          api.get('/pools?filter=joined&limit=50'),
        ]);
        const created = (mineRes.pools || []).filter(isActive);
        const createdIds = new Set(created.map(p => p.id));
        const joined = (joinedRes.pools || []).filter(p => isActive(p) && !createdIds.has(p.id));
        setMyCreated(sortByDate(created));
        setMyJoined(sortByDate(joined));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  const scheduleFetchPools = useCallback((currentTab = tab) => {
    if (poolsRefreshTimerRef.current) {
      clearTimeout(poolsRefreshTimerRef.current);
    }
    poolsRefreshTimerRef.current = setTimeout(() => {
      poolsRefreshTimerRef.current = null;
      fetchPools(currentTab);
    }, 700);
  }, [fetchPools, tab]);

  useEffect(() => {
    visiblePoolIdsRef.current = new Set(
      [...pools, ...myCreated, ...myJoined].map(pool => pool.id)
    );
  }, [pools, myCreated, myJoined]);

  useEffect(() => () => {
    if (poolsRefreshTimerRef.current) clearTimeout(poolsRefreshTimerRef.current);
  }, []);

  useEffect(() => {
    fetchPools(tab);
  }, [tab, fetchPools]);

  useEffect(() => {
    if (!profile?.id) return;
    const shouldRefreshForPool = (payload) => {
      const row = payload.new || payload.old || {};
      const poolId = row.id || row.pool_id;
      if (payload.eventType === 'INSERT' && row.id) return true;
      if (!poolId) return false;
      return visiblePoolIdsRef.current.has(poolId) || row.creator_id === profile.id || row.user_id === profile.id;
    };
    const channel = supabase
      .channel('pools-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hangout_pools' },
        (payload) => {
          if (shouldRefreshForPool(payload)) scheduleFetchPools(tab);
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pool_participants' },
        (payload) => {
          if (shouldRefreshForPool(payload)) scheduleFetchPools(tab);
        })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile?.id, tab, scheduleFetchPools]);

  async function handleCreate(formValues) {
    await api.postForm('/pools', buildPoolFormData(formValues));
    showToast('¡Plan creado! 🎉');
    setTab('myplans');
    fetchPools('myplans');
  }

  async function handleJoin(poolId) {
    setJoining(poolId);
    try {
      await api.post(`/pools/${poolId}/join`, {});
      showToast('¡Te has unido! 🚀');
      fetchPools(tab);
    } catch (e) {
      showToast(e.message || 'No se pudo unir', 'error');
    } finally {
      setJoining(null);
    }
  }

  async function handleLeave(poolId) {
    setLeaving(poolId);
    try {
      const { cancelled } = await api.delete(`/pools/${poolId}/leave`);
      showToast(cancelled ? 'Plan cancelado' : 'Has salido del plan');
      fetchPools(tab);
    } catch (e) {
      showToast(e.message || 'Error al salir', 'error');
    } finally {
      setLeaving(null);
    }
  }

  async function handleCancel(poolId) {
    if (!confirm('¿Cancelar este plan? Los participantes serán notificados.')) return;
    try {
      await api.delete(`/pools/${poolId}`);
      showToast('Plan cancelado');
      fetchPools(tab);
    } catch (e) {
      showToast(e.message || 'Error al cancelar', 'error');
    }
  }

  function applyPoolReminder(poolId, minutes) {
    const updatePool = pool => pool.id === poolId
      ? { ...pool, current_user_reminder_minutes_before: minutes }
      : pool;

    setPools(prev => prev.map(updatePool));
    setMyCreated(prev => prev.map(updatePool));
    setMyJoined(prev => prev.map(updatePool));
    setDetailPool(prev => prev?.id === poolId ? updatePool(prev) : prev);
  }

  async function handlePoolReminderChange(poolId, minutes) {
    if (reminderSaving) return;
    setReminderSaving(poolId);
    try {
      const data = await api.patch(`/pools/${poolId}/reminder`, {
        reminder_minutes_before: minutes,
      });
      const nextMinutes = data.reminder_minutes_before || minutes;
      applyPoolReminder(poolId, nextMinutes);
      showToast('Aviso actualizado');
    } catch (e) {
      showToast(e.message || 'Error al cambiar el aviso', 'error');
    } finally {
      setReminderSaving(null);
    }
  }

  const poolCardProps = {
    onJoin: handleJoin,
    onLeave: handleLeave,
    onCancel: handleCancel,
    onOpenDetail: setDetailPool,
    joining,
    leaving,
  };

  const activePools = sortByDate(pools.filter(isActive));
  const pastPools   = pools.filter(p => !isActive(p));
  const myplansEmpty = myCreated.length === 0 && myJoined.length === 0;

  return (
    <div className="min-h-screen bg-surface-bg pb-24">
      <TutorialOverlay currentPage="/pools" />
      {/* Nav */}
      <div id="tutorial-pools-header">
      <nav className="border-b border-surface-border sticky top-0 bg-surface-bg/80 backdrop-blur-xl z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-surface-muted hover:text-surface-text transition-colors p-1 text-lg">
            ←
          </button>
          <h1 className="font-display font-bold text-surface-text flex-1">Pool de Quedadas</h1>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-accent-primary hover:bg-accent-primary/80 text-surface-text text-sm font-display font-semibold px-4 py-1.5 rounded-xl transition-all"
          >
            + Crear
          </button>
        </div>
      </nav>

      {/* Tabs */}
      <div className="max-w-lg mx-auto px-4 pt-4">
        <div className="flex gap-1 bg-surface-card border border-surface-border rounded-xl p-1 mb-5">
          {[
            { key: 'active',  label: '🌐 Activos' },
            { key: 'myplans', label: '✓ Mis planes' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 text-xs font-display font-semibold py-2 rounded-lg transition-all ${
                tab === key
                  ? 'bg-accent-primary text-surface-text shadow-sm'
                  : 'text-slate-400 hover:text-surface-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      </div>{/* end tutorial-pools-header */}

      {/* Content */}
      <main className="max-w-lg mx-auto px-4 pb-10">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-52 bg-surface-card rounded-2xl animate-pulse border border-surface-border" />
            ))}
          </div>

        ) : tab === 'active' ? (
          pools.length === 0 ? (
            <div className="bg-surface-card border border-surface-border rounded-2xl p-10 text-center">
              <div className="text-5xl mb-4">🤝</div>
              <p className="text-slate-300 font-display font-semibold mb-1">Sin planes activos</p>
              <p className="text-slate-500 text-sm mb-5">Crea un plan o espera a que tus amigos propongan algo</p>
              <button
                onClick={() => setShowCreate(true)}
                className="bg-accent-primary/20 text-accent-glow border border-accent-primary/30 px-5 py-2.5 rounded-xl text-sm font-display font-semibold"
              >
                + Crear plan
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {activePools.map(pool => (
                <PoolCard key={pool.id} pool={pool} {...poolCardProps} />
              ))}
              {pastPools.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-mono text-slate-600 mb-2 px-1">
                    Cancelados / cerrados ({pastPools.length})
                  </p>
                  <div className="space-y-2">
                    {pastPools.map(pool => (
                      <PoolCard key={pool.id} pool={pool} {...poolCardProps} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )

        ) : (
          myplansEmpty ? (
            <div className="bg-surface-card border border-surface-border rounded-2xl p-10 text-center">
              <div className="text-5xl mb-4">📅</div>
              <p className="text-slate-300 font-display font-semibold mb-1">Sin planes activos</p>
              <p className="text-slate-500 text-sm mb-5">Crea un plan o únete a los de tus amigos</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setShowCreate(true)}
                  className="bg-accent-primary/20 text-accent-glow border border-accent-primary/30 px-5 py-2.5 rounded-xl text-sm font-display font-semibold"
                >
                  + Crear plan
                </button>
                <button
                  onClick={() => setTab('active')}
                  className="bg-surface-bg border border-surface-border px-5 py-2.5 rounded-xl text-sm font-display font-semibold text-slate-400"
                >
                  🔍 Ver activos
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">🗓️</span>
                  <h2 className="text-sm font-display font-bold text-surface-text">Planes que has creado</h2>
                  <span className="ml-auto text-xs font-mono text-slate-500">{myCreated.length}</span>
                </div>
                {myCreated.length === 0 ? (
                  <div className="bg-surface-card border border-surface-border rounded-2xl p-6 text-center">
                    <p className="text-slate-500 text-sm">No has creado ningún plan activo</p>
                    <button onClick={() => setShowCreate(true)} className="mt-3 text-xs text-accent-glow font-display font-semibold">
                      + Crear plan
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {myCreated.map(pool => <PoolCard key={pool.id} pool={pool} {...poolCardProps} />)}
                  </div>
                )}
              </div>

              <div className="border-t border-surface-border" />

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">🚀</span>
                  <h2 className="text-sm font-display font-bold text-surface-text">Planes a los que te has unido</h2>
                  <span className="ml-auto text-xs font-mono text-slate-500">{myJoined.length}</span>
                </div>
                {myJoined.length === 0 ? (
                  <div className="bg-surface-card border border-surface-border rounded-2xl p-6 text-center">
                    <p className="text-slate-500 text-sm">Aún no te has unido a ningún plan</p>
                    <button onClick={() => setTab('active')} className="mt-3 text-xs text-accent-glow font-display font-semibold">
                      🔍 Ver planes activos
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {myJoined.map(pool => <PoolCard key={pool.id} pool={pool} {...poolCardProps} />)}
                  </div>
                )}
              </div>
            </div>
          )
        )}
      </main>

      {/* Participants sheet */}
      {detailPool && (
        <ParticipantsSheet
          pool={detailPool}
          onClose={() => setDetailPool(null)}
          onJoin={handleJoin}
          onLeave={handleLeave}
          onReminderChange={handlePoolReminderChange}
          joining={joining}
          leaving={leaving}
          reminderSaving={reminderSaving}
        />
      )}

      {/* Create Pool Modal */}
      {showCreate && (
        <CreatePoolModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl font-display font-semibold text-sm shadow-xl transition-all ${
          toast.type === 'error'
            ? 'bg-red-500/90 text-surface-text border border-red-400/30'
            : 'bg-green-500/90 text-surface-text border border-green-400/30'
        }`}>
          {toast.msg}
        </div>
      )}
      <BottomNav />
    </div>
  );
}
