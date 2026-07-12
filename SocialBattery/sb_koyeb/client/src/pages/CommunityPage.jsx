import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import LocationPicker from '../components/LocationPicker';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useCommunityNotifications } from '../context/CommunityNotificationsContext';
import { useUserLocation } from '../context/UserLocationContext';
import { api } from '../lib/api';
import TutorialOverlay from '../components/TutorialOverlay';
import PhotoSourceMenu from '../components/PhotoSourceMenu';
import { CATEGORIES, OTHER_CATEGORY, getCategoryEmoji } from '../constants/categories';


// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeText(value = '') {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Eventos y comunidades comparten el mismo listado de categorías (ver
// src/constants/categories.js), así que también comparten el mismo emoji
// por categoría.
const getEventEmoji = getCategoryEmoji;
const getCommunityEmoji = getCategoryEmoji;

function formatEventDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = d - now;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs < 0) return 'Ya pasó';
  if (diffDays === 0) {
    return `Hoy · ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (diffDays === 1) {
    return `Mañana · ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (diffDays < 7) {
    return d.toLocaleDateString('es-ES', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatEventDateRange(event) {
  const start = formatEventDate(event.event_date);
  if (!event.ends_at) return start;
  const end = new Date(event.ends_at);
  if (Number.isNaN(end.getTime())) return start;
  const endLabel = end.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${start} - fin ${endLabel}`;
}

function getDaysUntilLabel(dateStr) {
  if (!dateStr) return '';
  const time = new Date(dateStr).getTime();
  if (Number.isNaN(time)) return '';
  const diffMs = time - Date.now();
  if (diffMs < 0) return 'Ya empezó';
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'Empieza hoy';
  if (days === 1) return 'Falta 1 día';
  return `Faltan ${days} días`;
}

function ensureAbsoluteUrl(url) {
  if (!url) return null;
  const trimmed = url.trim().replace(/\s+/g, '');
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    new URL(withProtocol); // validate
    return withProtocol;
  } catch {
    return null;
  }
}

function getEventTime(event) {
  const time = new Date(event.event_date).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function getEventEndTime(event) {
  const endTime = event.ends_at ? new Date(event.ends_at).getTime() : NaN;
  if (!Number.isNaN(endTime)) return endTime;
  return getEventTime(event);
}

function isUpcomingEvent(event) {
  return getEventEndTime(event) >= Date.now();
}

function sortEventsByProximity(eventList = []) {
  const now = Date.now();
  return [...eventList].sort((a, b) => {
    const aTime = getEventTime(a);
    const bTime = getEventTime(b);
    const aPast = getEventEndTime(a) < now;
    const bPast = getEventEndTime(b) < now;
    if (aPast !== bPast) return aPast ? 1 : -1;
    return aPast ? bTime - aTime : aTime - bTime;
  });
}

// 'app'                → puntuación ponderada (likes + apuntados), sin distinción de plan
// 'planificaciones'    → más apuntados primero
// 'likes'              → más likes primero
// 'cercania'            → más cerca del usuario primero (por lat/lng del evento)
// 'cercania_intereses'  → igual que cercania, pero solo eventos con alguna
//                         categoría que coincida con los intereses del usuario
function promotionScore(event) {
  return (event.attendee_count || 0) * 1.5 + (event.like_count || 0);
}

// Distancia entre dos coordenadas (fórmula de Haversine), en kilómetros.
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// null → no se puede calcular (falta la ubicación del usuario o el evento no
// tiene coordenadas, ya que son opcionales — se pusieron en la fase 27).
function getEventDistanceKm(event, userCoords) {
  if (!userCoords || typeof event.lat !== 'number' || typeof event.lng !== 'number') return null;
  return distanceKm(userCoords.lat, userCoords.lng, event.lat, event.lng);
}

// Los eventos sin distancia calculable van al final, pero mantienen su orden
// relativo (el array ya viene ordenado por fecha desde el backend), para que
// mientras no haya permiso de ubicación la lista no quede "revuelta".
function sortEventsByDistance(eventList = [], userCoords) {
  return [...eventList].sort((a, b) => {
    const da = getEventDistanceKm(a, userCoords);
    const db = getEventDistanceKm(b, userCoords);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

// Si el usuario no tiene intereses configurados no hay nada que comparar, así
// que no se filtra nada (mejor mostrar todo que dejar la lista vacía).
function matchesUserInterests(event, userInterests = []) {
  if (!userInterests.length) return true;
  const eventCats = getEntityCategories(event).map(normalizeText);
  const normalizedInterests = userInterests.map(normalizeText);
  return eventCats.some(cat => normalizedInterests.includes(cat));
}

function rankScoreOf(event, rankKey) {
  if (rankKey === 'likes') return event.like_count || 0;
  if (rankKey === 'planificaciones') return event.attendee_count || 0;
  // 'app': todos los eventos compiten por igual, por puntuación ponderada
  return promotionScore(event);
}

// Las dos secciones del selector (cercanía / cercanía e intereses) y (app /
// planificaciones / likes) son compatibles entre sí: se puede tener una
// opción activa en cada una a la vez. Sin criterio de cercanía se ordena solo
// por el criterio elegido; sin criterio de "otros" se ordena solo por
// cercanía; con ambos activos se combina un 50/50 (normalizado) de cercanía
// y puntuación del criterio elegido.
function sortEventsBy(eventList = [], { proximityKey = null, rankKey = 'app', userCoords, userInterests = [] } = {}) {
  let list = eventList;
  if (proximityKey === 'cercania_intereses') {
    list = list.filter(event => matchesUserInterests(event, userInterests));
  }

  if (!proximityKey) {
    return [...list].sort((a, b) => rankScoreOf(b, rankKey) - rankScoreOf(a, rankKey));
  }

  if (!rankKey) {
    return sortEventsByDistance(list, userCoords);
  }

  // Eventos sin distancia calculable (sin ubicación de usuario o del evento)
  // van siempre al final, igual que en el ordenamiento por cercanía puro.
  const withDistance = [];
  const withoutDistance = [];
  for (const event of list) {
    const distance = getEventDistanceKm(event, userCoords);
    if (distance === null) withoutDistance.push(event);
    else withDistance.push({ event, distance });
  }

  const maxDistance = Math.max(0, ...withDistance.map(e => e.distance));
  const maxRankScore = Math.max(0, ...withDistance.map(e => rankScoreOf(e.event, rankKey)));

  const combined = withDistance
    .map(({ event, distance }) => {
      const proximityScore = maxDistance > 0 ? 1 - distance / maxDistance : 1;
      const normalizedRankScore = maxRankScore > 0 ? rankScoreOf(event, rankKey) / maxRankScore : 0;
      return { event, score: proximityScore * 0.5 + normalizedRankScore * 0.5 };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ event }) => event);

  return [...combined, ...withoutDistance];
}

// Filtro de fecha de inicio: 'week' (esta semana), 'month' (este mes) o
// 'all' (todo el tiempo, sin filtrar). Ventanas móviles desde ahora, no por
// mes/semana natural, para mantenerlo simple y consistente con el resto de
// la app (p.ej. el límite diario de push pasó a ventana móvil de 24h).
function matchesEventDateFilter(event, dateFilter) {
  if (dateFilter === 'all') return true;
  const startTime = new Date(event.event_date).getTime();
  if (Number.isNaN(startTime)) return true;
  const now = Date.now();
  if (dateFilter === 'week') return startTime <= now + 7 * 24 * 60 * 60 * 1000;
  if (dateFilter === 'month') return startTime <= now + 30 * 24 * 60 * 60 * 1000;
  return true;
}

// ── Event sort dropdown ──────────────────────────────────────────────────────
// Un <select> nativo delega su menú al sistema operativo, así que en móvil
// (picker nativo de iOS/Android) queda con un aspecto muy distinto al de
// escritorio. Se sustituye por un menú propio (mismo patrón que el menú ⋯ de
// GroupChatPage: botón + panel absoluto + cierre al hacer click fuera) para
// que se vea exactamente igual en cualquier dispositivo.
// Las dos secciones son compatibles entre sí: se puede tener una opción
// activa en "Cercanía" y otra en "Otros" a la vez (ver sortEventsBy). Por
// eso cada grupo lleva su propio value/onChange, en vez de un único value
// plano como antes.
const EVENT_PROXIMITY_OPTIONS = [
  { key: 'cercania', label: '📍 Cercanía' },
  { key: 'cercania_intereses', label: '📍✨ Cercanía e intereses' },
];
const EVENT_RANK_OPTIONS = [
  { key: 'app', label: '✨ Selección' },
  { key: 'planificaciones', label: '📅 Planificaciones' },
  { key: 'likes', label: '♥ Likes' },
];

function EventSortDropdown({ proximityValue, onProximityChange, rankValue, onRankChange }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const proximityLabel = EVENT_PROXIMITY_OPTIONS.find(opt => opt.key === proximityValue)?.label;
  const rankLabel = EVENT_RANK_OPTIONS.find(opt => opt.key === rankValue)?.label;
  const currentLabel = [proximityLabel, rankLabel].filter(Boolean).join(' + ') || 'Ordenar';

  return (
    <div className="relative flex-shrink-0" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs bg-surface-card border border-surface-border rounded-lg pl-2.5 pr-2 py-1.5 text-surface-muted hover:border-accent-primary/50 transition-colors cursor-pointer"
      >
        <span className="truncate max-w-[130px]">{currentLabel}</span>
        <span className={`text-[9px] leading-none transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] bg-surface-card border border-surface-border rounded-2xl shadow-2xl z-30 min-w-[230px] py-1.5 overflow-hidden animate-fade-in">
          <div>
            <p className="px-4 pt-2 pb-1 text-[10px] font-display font-bold uppercase tracking-wide text-surface-muted/70">
              Cercanía
            </p>
            {EVENT_PROXIMITY_OPTIONS.map(opt => (
              <button
                key={opt.key}
                type="button"
                onClick={() => onProximityChange(proximityValue === opt.key ? null : opt.key)}
                className={`w-full text-left px-4 py-2.5 text-sm font-display font-semibold transition-colors ${
                  proximityValue === opt.key
                    ? 'text-accent-glow bg-accent-primary/10'
                    : 'text-surface-text hover:bg-surface-hover'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div>
            <p className="px-4 pt-2 pb-1 text-[10px] font-display font-bold uppercase tracking-wide text-surface-muted/70">
              Otros
            </p>
            {EVENT_RANK_OPTIONS.map(opt => (
              <button
                key={opt.key}
                type="button"
                onClick={() => onRankChange(rankValue === opt.key ? null : opt.key)}
                className={`w-full text-left px-4 py-2.5 text-sm font-display font-semibold transition-colors ${
                  rankValue === opt.key
                    ? 'text-accent-glow bg-accent-primary/10'
                    : 'text-surface-text hover:bg-surface-hover'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Generic filter dropdown ──────────────────────────────────────────────────
// Mismo patrón que EventSortDropdown (botón + panel absoluto + cierre al
// hacer click fuera), pero de propósito genérico: agrupa dentro los filtros
// que antes iban sueltos en la pantalla (precio/tiempo/categoría en Eventos,
// y todos los de Comunidades), para no saturar la vista con filas de chips.
function FilterDropdown({ label = 'Filtrar', active = false, children }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative flex-shrink-0" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="relative flex items-center gap-1.5 text-xs bg-surface-card border border-surface-border rounded-lg pl-2.5 pr-2 py-1.5 text-surface-muted hover:border-accent-primary/50 transition-colors cursor-pointer"
      >
        <span>🔎 {label}</span>
        <span className={`text-[9px] leading-none transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
        {active && (
          <span className="absolute -top-1 -right-1 w-2 h-2 bg-accent-primary rounded-full ring-2 ring-surface-card" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] bg-surface-card border border-surface-border rounded-2xl shadow-2xl z-30 w-80 max-w-[85vw] max-h-[70vh] overflow-y-auto py-3 px-3 space-y-3 animate-fade-in">
          {children}
        </div>
      )}
    </div>
  );
}

function FilterDropdownSection({ title, children }) {
  return (
    <div>
      <p className="px-1 pb-1.5 text-[10px] font-display font-bold uppercase tracking-wide text-surface-muted/70">
        {title}
      </p>
      {children}
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

function buildEventFormData(form, extra = {}) {
  const formData = new FormData();
  const payload = { ...form, ...extra };

  Object.entries(payload).forEach(([key, value]) => {
    if (key === 'cover_file' || key === 'custom_category') return;
    if (value === undefined || value === null || value === '') return;
    // Los arrays (p.ej. categories) van como JSON, ya que FormData solo
    // admite valores string; el servidor los parsea con JSON.parse.
    if (Array.isArray(value)) {
      if (value.length) formData.append(key, JSON.stringify(value));
      return;
    }
    formData.append(key, String(value));
  });

  if (form.cover_file) formData.append('cover', form.cover_file);
  return formData;
}

function getEntityCategories(entity) {
  if (Array.isArray(entity?.categories) && entity.categories.length) return entity.categories;
  return entity?.category ? [entity.category] : [];
}

function EventCard({ event, rank, onJoin, onLeave, onLike, onOpen, currentUserId, hasUnreadUpdate }) {
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [liking, setLiking] = useState(false);
  const isJoined = event.attendees?.includes(currentUserId);
  const isPast = new Date(event.ends_at || event.event_date) < new Date();
  const isLiked = Boolean(event.liked_by_current_user);
  const eventCategories = getEntityCategories(event);
  const emoji = getEventEmoji(eventCategories[0]);
  const daysLabel = getDaysUntilLabel(event.event_date);
  const attendeeCount = event.attendee_count || 0;
  const likeCount = event.like_count || 0;

  const rankColors = {
    1: { ring: 'border-yellow-400/60', glow: '#facc1520', label: '🥇' },
    2: { ring: 'border-slate-400/60', glow: '#94a3b820', label: '🥈' },
    3: { ring: 'border-amber-600/60', glow: '#d97706/20', label: '🥉' },
  };
  const rankStyle = rankColors[rank] || { ring: 'border-surface-border', glow: 'transparent', label: null };

  // Ring de borde por plan de pago (se mantiene: distingue visualmente sin afectar orden)
  const RING_META = {
    ultra:   { ring: 'border-sky-400/55' },
    premium: { ring: 'border-purple-400/50' },
  };
  const ringOverride = RING_META[event.promotion_plan];
  const activeRing = ringOverride?.ring ?? rankStyle.ring;
  // El glow queda reservado al podio real (rank 1-3); premium/ultra ya no fuerzan
  // su propio glow para no chocar con los colores oro/plata/bronce del podio.
  const activeGlow = rank <= 3 ? rankStyle.glow : null;

  // Pill de plan: visible para los 3 planes (basic incluido)
  const PILL_META = {
    ultra:   { pill: '🚀 Ultra',   pillClass: 'text-sky-300 bg-sky-500/10 border border-sky-500/25' },
    premium: { pill: '⚡ Premium', pillClass: 'text-purple-300 bg-purple-500/10 border border-purple-500/25' },
    basic:   { pill: '📋 Basic',   pillClass: 'text-slate-300 bg-slate-500/10 border border-slate-500/25' },
  };
  const promo = PILL_META[event.promotion_plan] ?? PILL_META.basic;

  async function handleJoin(e) {
    e?.stopPropagation();
    if (isJoined || isPast || joining) return;
    setJoining(true);
    try {
      await onJoin(event.id);
    } finally {
      setJoining(false);
    }
  }

  async function handleLeave(e) {
    e?.stopPropagation();
    if (!isJoined || leaving) return;
    setLeaving(true);
    try {
      await onLeave(event.id);
    } finally {
      setLeaving(false);
    }
  }

  async function handleLike(e) {
    e.stopPropagation();
    if (liking || !onLike) return;
    setLiking(true);
    try {
      await onLike(event.id);
    } finally {
      setLiking(false);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(event.id)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onOpen?.(event.id); }}
      className={`relative bg-surface-card border ${activeRing} rounded-2xl p-4 transition-all duration-200 hover:border-accent-primary/30 cursor-pointer`}
      style={{ boxShadow: activeGlow ? `0 0 20px ${activeGlow}` : undefined }}
    >
      {/* Rank medal / number */}
      {rank <= 3 && (
        <span className="absolute -top-2.5 -right-1 text-xl">{rankStyle.label}</span>
      )}
      {rank > 3 && !ringOverride && (
        <span className="absolute top-3 right-3 text-xs font-mono text-slate-600">#{rank}</span>
      )}
      {/* Badge actualización no leída */}
      {hasUnreadUpdate && (
        <span className="absolute -top-1.5 left-3 bg-red-500 text-white text-[9px] font-bold rounded-full px-1.5 h-[15px] flex items-center justify-center leading-none shadow-md">
          📣 Actualización
        </span>
      )}

      {/* Cover image */}
      {event.cover_image_url && (
        <div className="relative z-10 mb-3 aspect-[16/9] overflow-hidden rounded-xl border border-surface-border bg-surface-bg">
          <img src={event.cover_image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
        </div>
      )}

      {/* ── Header row: emoji + título + pills ── */}
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-2xl bg-surface-bg flex items-center justify-center text-2xl flex-shrink-0 border border-surface-border">
          {emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5 flex-wrap">
            <h3 className="font-display font-bold text-surface-text text-base leading-snug line-clamp-2 flex-1">
              {event.title}
            </h3>
            {promo && (
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${promo.pillClass}`}>
                {promo.pill}
              </span>
            )}
          </div>
          {/* Creator + comunidad */}
          <p className="text-xs text-surface-muted mt-0.5 leading-snug">
            <span className="text-accent-glow/80">{event.creator_name || 'Alguien'}</span>
            {event.community_name && (
              <span className="text-surface-muted"> · <span className="text-accent-glow">{event.community_name}</span></span>
            )}
            {event.organization && (
              <span className="text-surface-muted"> · <span className="text-amber-300/90">{event.organization}</span></span>
            )}
          </p>
        </div>
      </div>

      {/* ── Meta row: fecha · ubicación · categoría · precio ── */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2.5 items-center">
        {daysLabel && (
          <span className="text-xs text-amber-300/90 font-mono flex items-center gap-1">
            ⏳ {daysLabel}
          </span>
        )}
        {isPast && !daysLabel && (
          <span className="text-xs text-slate-500 font-mono">Ya pasó</span>
        )}
        {event.location && (
          <span className="text-xs text-slate-400 font-mono flex items-center gap-1 truncate max-w-[160px]">
            📍 {event.location}
          </span>
        )}
        {eventCategories.map(cat => (
          <span
            key={cat}
            className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent-primary/10 text-accent-glow border border-accent-primary/20"
          >
            {cat}
          </span>
        ))}
        {event.price != null && parseFloat(event.price) > 0 ? (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">
            💳 {parseFloat(event.price).toFixed(2)}€
          </span>
        ) : (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-green-500/25 bg-green-500/10 text-green-400">
            ✓ Gratis
          </span>
        )}
        {event.url && ensureAbsoluteUrl(event.url) && (
          <a
            href={ensureAbsoluteUrl(event.url)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-accent-primary/20 bg-accent-primary/10 text-accent-glow/80 hover:text-accent-glow"
          >
            🔗 Ver más
          </a>
        )}
      </div>

      {/* ── Descripción ── */}
      {event.description && (
        <p className="text-xs text-surface-muted mt-2 line-clamp-2 leading-relaxed">
          {event.description}
        </p>
      )}

      {/* ── Footer: like · apuntados · acción ── */}
      <div className="flex items-center gap-2 mt-3 flex-wrap" onClick={e => e.stopPropagation()}>
        <button
          type="button"
          onClick={handleLike}
          disabled={liking}
          aria-pressed={isLiked}
          className={`text-xs font-mono px-2.5 py-1 rounded-lg border transition-all disabled:opacity-50 ${
            isLiked
              ? 'border-pink-500/40 bg-pink-500/15 text-pink-300'
              : 'border-surface-border bg-surface-bg text-slate-500 hover:border-pink-500/30 hover:text-pink-300'
          }`}
        >
          {liking ? '...' : `${isLiked ? '♥' : '♡'} ${likeCount}`}
        </button>
        <span className="text-xs font-mono px-2.5 py-1 rounded-lg border border-accent-primary/20 bg-accent-primary/10 text-accent-glow flex items-center gap-1">
          📅 {attendeeCount}
        </span>

        {/* Spacer */}
        <span className="flex-1" />

        {/* Acción principal */}
        {isPast && !isJoined ? (
          <span className="text-xs font-mono text-slate-600 px-3 py-1.5 rounded-xl bg-surface-bg border border-surface-border">
            Pasado
          </span>
        ) : isJoined ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-green-400 px-3 py-1.5 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center gap-1">
              ✓ Planificado
            </span>
            <button
              onClick={handleLeave}
              disabled={leaving}
              className="text-xs font-display font-semibold px-3 py-1.5 rounded-xl border border-red-500/25 text-red-300 hover:bg-red-500/10 transition-all disabled:opacity-50"
            >
              {leaving ? '...' : 'Quitar'}
            </button>
          </div>
        ) : (
          <button
            onClick={handleJoin}
            disabled={joining}
            className="text-xs font-display font-semibold px-4 py-1.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white transition-all disabled:opacity-50 active:scale-95"
          >
            {joining ? '...' : '+ Planificar'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Community Card ────────────────────────────────────────────────────────────
function CommunityCard({ community, onJoin, onLeave, onOpen, currentUserId, hasNewEvents }) {
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const isMember = community.members?.includes(currentUserId);
  const communityCategories = getEntityCategories(community);
  const emoji = getCommunityEmoji(communityCategories[0]);

  async function handleJoin() {
    if (isMember || joining) return;
    setJoining(true);
    try {
      await onJoin(community.id);
    } finally {
      setJoining(false);
    }
  }

  async function handleLeave(e) {
    e.stopPropagation();
    if (!isMember || leaving) return;
    setLeaving(true);
    try {
      await onLeave(community.id);
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(community.id)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') onOpen(community.id);
      }}
      className="bg-surface-card border border-surface-border rounded-2xl p-4 flex items-center gap-3 transition-all hover:border-accent-primary/30 cursor-pointer"
    >
      <div className="relative w-12 h-12 flex-shrink-0">
        <div className="w-12 h-12 rounded-2xl bg-surface-bg flex items-center justify-center text-2xl border border-surface-border overflow-hidden">
          {community.cover_image_url ? (
            <img src={community.cover_image_url} alt="" className="h-full w-full object-cover" />
          ) : emoji}
        </div>
        {hasNewEvents && (
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-surface-card" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-display font-bold text-surface-text text-sm truncate flex-1">
            {community.name}
          </h3>
          {community.has_active_raffle && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 flex-shrink-0">
              🎟️ Sorteo activo
            </span>
          )}
          {community.has_upcoming_event && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 border border-pink-500/40 flex-shrink-0">
              📅 Evento próximo
            </span>
          )}
          {communityCategories.map(cat => (
            <span
              key={cat}
              className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-bg text-surface-muted border border-surface-border flex-shrink-0"
            >
              {cat}
            </span>
          ))}
        </div>
        {community.description && (
          <p className="text-xs text-surface-muted mt-0.5 line-clamp-1">{community.description}</p>
        )}
        {community.organization && (
          <p className="text-xs text-accent-glow/80 font-mono mt-1">{community.organization}</p>
        )}
        {community.url && ensureAbsoluteUrl(community.url) && (
          <a
            href={ensureAbsoluteUrl(community.url)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-xs text-accent-glow/80 font-mono mt-0.5 hover:text-accent-glow flex items-center gap-1 w-fit"
          >
            🔗 Ver más
          </a>
        )}
        <p className="text-xs text-surface-muted font-mono mt-1">
          👥 {community.member_count || 0} miembros · por {community.creator_name || 'Alguien'}
          {community.is_admin && <span className="text-yellow-300"> · admin</span>}
        </p>
      </div>

      <div className="flex-shrink-0 flex items-center gap-2">
        {isMember ? (
          <>
            <button
              onClick={handleLeave}
              disabled={leaving}
              className="text-xs font-display font-semibold px-3 py-1.5 rounded-xl border border-red-500/25 text-red-300 hover:bg-red-500/10 transition-all disabled:opacity-50"
            >
              {leaving ? '...' : 'Salir'}
            </button>
          </>
        ) : (
          <button
            onClick={e => {
              e.stopPropagation();
              handleJoin();
            }}
            disabled={joining}
            className="text-xs font-display font-semibold px-3 py-1.5 rounded-xl bg-accent-primary/20 hover:bg-accent-primary/30 text-accent-glow border border-accent-primary/30 transition-all disabled:opacity-50"
          >
            {joining ? '...' : 'Unirse'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Create Event Modal ────────────────────────────────────────────────────────
const MAX_CATEGORIES = 3;
// Mismo listado que las comunidades y que los intereses del onboarding
// (ver src/constants/categories.js), para que los filtros "afines a mis
// intereses" comparen siempre contra el mismo universo de categorías.
const EVENT_CATEGORIES = [...CATEGORIES.map(c => c.id), OTHER_CATEGORY];

function CreateEventModal({ onClose, onCreate }) {
  const now = new Date();
  const minDate = new Date(now.getTime() + 30 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const toLocalInputValue = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const defaultDate = toLocalInputValue(minDate);
  // La fecha de inicio no puede ser más de un año después de la creación del evento.
  const maxStartDate = new Date(now);
  maxStartDate.setFullYear(maxStartDate.getFullYear() + 1);
  const maxStartDateValue = toLocalInputValue(maxStartDate);
  const coverInputRef = useRef(null);
  const coverCameraRef = useRef(null);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [expandedPlan, setExpandedPlan] = useState(null); // 'basic' | 'premium' | 'ultra' | null

  const [form, setForm] = useState({
    title: '',
    description: '',
    categories: [],
    custom_category: '',
    organization: '',
    event_date: defaultDate,
    ends_at: '',
    location: '',
    lat: null,
    lng: null,
    url: '',
    price: '',
    additional_info: '',
    promotion_plan: 'basic',
    notification_count: 500,
  });
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const resolvedCategories = form.categories
    .map(cat => (cat === OTHER_CATEGORY ? form.custom_category.trim() : cat))
    .filter(Boolean);
  const emoji = getEventEmoji(resolvedCategories[0]);
  // La fecha de fin no puede ser más de un mes después de la fecha de inicio elegida.
  const eventStartForEnd = form.event_date ? new Date(form.event_date) : minDate;
  const maxEndDate = new Date(eventStartForEnd);
  maxEndDate.setMonth(maxEndDate.getMonth() + 1);
  const maxEndDateValue = toLocalInputValue(maxEndDate);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function selectCategory(cat) {
    setForm(f => {
      const isSelected = f.categories.includes(cat);
      if (isSelected) {
        return {
          ...f,
          categories: f.categories.filter(c => c !== cat),
          custom_category: cat === OTHER_CATEGORY ? '' : f.custom_category,
        };
      }
      if (f.categories.length >= MAX_CATEGORIES) return f;
      return { ...f, categories: [...f.categories, cat] };
    });
  }

  async function handleCoverChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setError('La portada no puede superar 3MB');
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
    if (coverCameraRef.current) coverCameraRef.current.value = '';
  }

  async function handleSubmit() {
    if (!form.title.trim()) { setError('El título es obligatorio'); return; }
    if (!form.event_date) { setError('La fecha es obligatoria'); return; }
    if (!form.ends_at) { setError('La fecha fin es obligatoria'); return; }
    if (!form.location.trim()) { setError('La ubicacion es obligatoria'); return; }
    if (form.categories.includes(OTHER_CATEGORY) && !form.custom_category.trim()) {
      setError('Especifica la categoria');
      return;
    }
    if (new Date(form.ends_at) <= new Date(form.event_date)) {
      setError('La fecha fin debe ser posterior al inicio');
      return;
    }
    if (new Date(form.event_date) > maxStartDate) {
      setError('La fecha de inicio no puede ser más de un año después de la creación del evento');
      return;
    }
    if (new Date(form.ends_at) > maxEndDate) {
      setError('La fecha fin no puede ser más de un mes después del inicio');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onCreate({
        ...form,
        categories: resolvedCategories,
        cover_file: coverFile,
        event_date: new Date(form.event_date).toISOString(),
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      });
      onClose();
    } catch (e) {
      setError(e.message || 'Error al crear el evento');
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
          <span className="text-3xl">{emoji || '🌐'}</span>
          <div>
            <h2 className="font-display font-bold text-surface-text text-lg">Crear evento</h2>
            <p className="text-xs text-surface-muted">Organiza algo para toda la comunidad</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">Título *</label>
            <input
              type="text"
              value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder="Ej: Concierto en el parque, Hackathon de verano..."
              maxLength={120}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              Categoría <span className="text-slate-600">({form.categories.length}/{MAX_CATEGORIES})</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {EVENT_CATEGORIES.map(cat => {
                const selected = form.categories.includes(cat);
                const disabled = !selected && form.categories.length >= MAX_CATEGORIES;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => selectCategory(cat)}
                    disabled={disabled}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                      selected
                        ? 'border-accent-primary bg-accent-primary/20 text-accent-glow'
                        : disabled
                          ? 'border-surface-border text-slate-700 opacity-40 cursor-not-allowed'
                          : 'border-surface-border text-surface-muted hover:border-accent-primary/30'
                    }`}
                  >
                    {getEventEmoji(cat)} {cat}
                  </button>
                );
              })}
            </div>
            {form.categories.includes(OTHER_CATEGORY) && (
              <input
                type="text"
                value={form.custom_category}
                onChange={e => set('custom_category', e.target.value)}
                placeholder="Escribe la categoría"
                maxLength={60}
                className="mt-3 w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
              />
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              Descripción <span className="text-slate-600">(opcional)</span>
            </label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="¿De qué va el evento? ¿Qué pueden esperar los asistentes?"
              maxLength={500}
              rows={3}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors resize-none"
            />
          </div>

          {/* Organization */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              Organización <span className="text-slate-600">(opcional)</span>
            </label>
            <input
              type="text"
              value={form.organization}
              onChange={e => set('organization', e.target.value)}
              placeholder="Ej: Universidad, asociación, club..."
              maxLength={120}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
          </div>

          {/* Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono text-surface-muted mb-1.5">Fecha y hora *</label>
              <input
                type="datetime-local"
                value={form.event_date}
                min={defaultDate}
                max={maxStartDateValue}
                onChange={e => set('event_date', e.target.value)}
                className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-3 text-surface-text text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-surface-muted mb-1.5">Fin *</label>
              <input
                type="datetime-local"
                value={form.ends_at}
                min={form.event_date || defaultDate}
                max={maxEndDateValue}
                onChange={e => set('ends_at', e.target.value)}
                className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-3 text-surface-text text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              Ubicación *
            </label>
            <LocationPicker
              value={form.location}
              lat={form.lat}
              lng={form.lng}
              onChange={(location, lat, lng) => setForm(f => ({ ...f, location, lat, lng }))}
            />
          </div>

          {/* URL */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              URL <span className="text-slate-600">(opcional)</span>
            </label>
            <input
              type="url"
              value={form.url}
              onChange={e => set('url', e.target.value)}
              placeholder="Ej: https://eventbrite.com/mi-evento"
              maxLength={500}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
          </div>

          {/* Price */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              Precio <span className="text-slate-600">(€ · vacío o 0 = gratis)</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={e => set('price', e.target.value)}
              placeholder="Ej: 5.00"
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
          </div>

          {/* Additional info */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              Información adicional <span className="text-slate-600">(opcional)</span>
            </label>
            <textarea
              value={form.additional_info}
              onChange={e => set('additional_info', e.target.value)}
              placeholder="Dress code, qué traer, instrucciones de acceso, requisitos..."
              maxLength={1000}
              rows={3}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors resize-none"
            />
          </div>

          {/* Cover */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              Portada <span className="text-slate-600">(opcional)</span>
            </label>
            {coverPreview ? (
              <div className="overflow-hidden rounded-xl border border-surface-border bg-surface-bg">
                <div className="aspect-[16/9]">
                  <img src={coverPreview} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="truncate text-xs text-surface-muted">{coverFile?.name}</span>
                  <button
                    type="button"
                    onClick={clearCover}
                    className="text-xs font-display font-semibold text-red-300 hover:text-red-200"
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowPhotoMenu(true)}
                className="w-full rounded-xl border border-dashed border-accent-primary/35 bg-accent-primary/5 px-4 py-4 text-sm font-display font-semibold text-accent-glow hover:bg-accent-primary/10 transition-all"
              >
                Elegir foto
              </button>
            )}
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleCoverChange}
            />
            <input
              ref={coverCameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleCoverChange}
            />
            <PhotoSourceMenu
              open={showPhotoMenu}
              onClose={() => setShowPhotoMenu(false)}
              onCamera={() => coverCameraRef.current?.click()}
              onGallery={() => coverInputRef.current?.click()}
            />
          </div>

          {/* Promotion Plan */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-2">
              Promoción del evento
            </label>
            <div className="grid grid-cols-1 gap-2">
              {/* Basic */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => set('promotion_plan', 'basic')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set('promotion_plan', 'basic'); } }}
                className={`relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                  form.promotion_plan === 'basic'
                    ? 'border-accent-primary bg-accent-primary/10'
                    : 'border-surface-border bg-surface-bg hover:border-accent-primary/30'
                }`}
              >
                <span className="text-xl mt-0.5">📋</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-display font-bold text-surface-text">Basic Promotion</span>
                    <span className="text-xs font-mono font-semibold text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full flex-shrink-0">Gratis</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setExpandedPlan(p => p === 'basic' ? null : 'basic'); }}
                    className="mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-mono text-surface-muted hover:text-surface-text transition-colors"
                  >
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-surface-border leading-none">
                      {expandedPlan === 'basic' ? '−' : '+'}
                    </span>
                    {expandedPlan === 'basic' ? 'Ocultar detalles' : 'Ver qué incluye'}
                  </button>
                  {expandedPlan === 'basic' && (
                    <ul className="mt-1.5 space-y-1 text-[11px] font-mono text-surface-muted">
                      <li>· Aparición en lista de eventos</li>
                      <li>· Notificaciones a usuarios de la comunidad (si existe)</li>
                    </ul>
                  )}
                </div>
                {form.promotion_plan === 'basic' && (
                  <span className="absolute top-3 right-3 text-accent-glow text-base">✓</span>
                )}
              </div>

              {/* Premium */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => set('promotion_plan', 'premium')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set('promotion_plan', 'premium'); } }}
                className={`relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                  form.promotion_plan === 'premium'
                    ? 'border-purple-400 bg-purple-500/10'
                    : 'border-surface-border bg-surface-bg hover:border-purple-400/30'
                }`}
              >
                <span className="text-xl mt-0.5">⚡</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-display font-bold text-surface-text">Premium Promotion</span>
                    <span className="text-xs font-mono font-semibold text-purple-300 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full flex-shrink-0">10 €</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setExpandedPlan(p => p === 'premium' ? null : 'premium'); }}
                    className="mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-mono text-surface-muted hover:text-surface-text transition-colors"
                  >
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-surface-border leading-none">
                      {expandedPlan === 'premium' ? '−' : '+'}
                    </span>
                    {expandedPlan === 'premium' ? 'Ocultar detalles' : 'Ver qué incluye'}
                  </button>
                  {expandedPlan === 'premium' && (
                    <ul className="mt-1.5 space-y-1 text-[11px] font-mono text-surface-muted">
                      <li>· Aparición en lista de eventos</li>
                      <li>· Notificaciones a usuarios de la comunidad (si existe)</li>
                      <li>· Notificaciones a número de usuarios contratado</li>
                      <li>· Insignia premium</li>
                    </ul>
                  )}
                </div>
                {form.promotion_plan === 'premium' && (
                  <span className="absolute top-3 right-3 text-purple-300 text-base">✓</span>
                )}
              </div>

              {/* Ultra */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => set('promotion_plan', 'ultra')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set('promotion_plan', 'ultra'); } }}
                className={`relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                  form.promotion_plan === 'ultra'
                    ? 'border-yellow-400 bg-yellow-500/10'
                    : 'border-surface-border bg-surface-bg hover:border-yellow-400/30'
                }`}
              >
                <span className="text-xl mt-0.5">🚀</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-display font-bold text-surface-text">Ultra Promotion</span>
                    <span className="text-xs font-mono font-semibold text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-full flex-shrink-0">20 €</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setExpandedPlan(p => p === 'ultra' ? null : 'ultra'); }}
                    className="mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-mono text-surface-muted hover:text-surface-text transition-colors"
                  >
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-surface-border leading-none">
                      {expandedPlan === 'ultra' ? '−' : '+'}
                    </span>
                    {expandedPlan === 'ultra' ? 'Ocultar detalles' : 'Ver qué incluye'}
                  </button>
                  {expandedPlan === 'ultra' && (
                    <ul className="mt-1.5 space-y-1 text-[11px] font-mono text-surface-muted">
                      <li>· Aparición en lista de eventos</li>
                      <li>· Notificaciones a usuarios de la comunidad (si existe)</li>
                      <li>· Notificaciones a número de usuarios contratado</li>
                      <li>· Apariciones en banner menú principal a número de usuarios contratado</li>
                      <li>· Insignia ultra</li>
                    </ul>
                  )}
                </div>
                {form.promotion_plan === 'ultra' && (
                  <span className="absolute top-3 right-3 text-yellow-300 text-base">✓</span>
                )}
              </div>
            </div>

            {(form.promotion_plan === 'premium' || form.promotion_plan === 'ultra') && (
              <>
                <div className="mt-2 p-3 rounded-xl border border-surface-border bg-surface-bg space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-mono text-surface-muted">
                      📨 Notificaciones a contratar (on-demand)
                    </label>
                    <span className="text-xs font-mono font-semibold text-surface-text">
                      {Number(form.notification_count).toLocaleString('es-ES')}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={500}
                    max={50000}
                    step={500}
                    value={form.notification_count}
                    onChange={e => set('notification_count', Number(e.target.value))}
                    className="w-full accent-accent-primary cursor-pointer"
                  />
                  <div className="flex items-center justify-between text-[10px] font-mono text-surface-muted">
                    <span>Mín. 500</span>
                    <span>Máx. 50.000</span>
                  </div>
                  <p className="text-[10px] font-mono text-surface-muted">
                    ℹ️ Si no se alcanzan 200 notificaciones enviadas, no se cobrará nada.
                  </p>
                </div>
                <p className="mt-2 text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  💳 Se aplicará una retención al comenzar la promoción; el pago se efectuará al finalizar la promoción, al renovarla o en su defecto, al empezar el evento, en base a las notificaciones enviadas hasta ese momento.
                </p>
                <p className="mt-2 text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  📶 Las notificaciones se enviarán conforme los usuarios estén disponibles para notificar.
                </p>
                <p className="mt-2 text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  🎯 Todas las promociones se realizan en base a algoritmos de cercanía e intereses.
                </p>
                <p className="mt-2 text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  🔁 Se notificará como máximo una vez a cada usuario dentro de una misma promoción; para repetir notificaciones a usuarios se deberá crear otra promoción.
                </p>
                <p className="mt-2 text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  📍 Todas las notificaciones se reparten mediante algoritmos basados en intereses y ubicación.
                </p>
              </>
            )}
          </div>

          {error && (
            <p className="text-red-400 text-sm font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">
              {error}
            </p>
          )}

          {!error && (!form.title.trim() || !form.event_date || !form.ends_at || !form.location.trim() || (form.categories.includes(OTHER_CATEGORY) && !form.custom_category.trim())) && (
            <p className="text-amber-400/80 text-xs font-mono text-center">Introduce todos los campos obligatorios primero</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={saving || !form.title.trim() || !form.event_date || !form.ends_at || !form.location.trim() || (form.categories.includes(OTHER_CATEGORY) && !form.custom_category.trim())}
            className="w-full py-3.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98]"
          >
            {saving ? 'Creando...' : '🌐 Publicar evento'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create Community Modal ────────────────────────────────────────────────────
// Mismo listado que los eventos (ver src/constants/categories.js).
const COMMUNITY_CATEGORIES = [...CATEGORIES.map(c => c.id), OTHER_CATEGORY];
const ALL_COMMUNITY_CATEGORIES = 'Todo';
const COMMUNITY_CATEGORY_FILTERS = [ALL_COMMUNITY_CATEGORIES, ...COMMUNITY_CATEGORIES];
const KNOWN_COMMUNITY_CATEGORIES = COMMUNITY_CATEGORIES.filter(cat => cat !== OTHER_CATEGORY);

const ALL_EVENT_CATEGORIES = 'Todo';
const EVENT_CATEGORY_FILTERS = [ALL_EVENT_CATEGORIES, ...EVENT_CATEGORIES];
const KNOWN_EVENT_CATEGORIES = EVENT_CATEGORIES.filter(cat => cat !== OTHER_CATEGORY);

function matchesEventCategory(event, selectedCategory) {
  if (selectedCategory === ALL_EVENT_CATEGORIES) return true;
  const categories = getEntityCategories(event).map(c => c.trim()).filter(Boolean);
  if (selectedCategory === OTHER_CATEGORY) {
    if (!categories.length) return true;
    return categories.some(category => !KNOWN_EVENT_CATEGORIES.some(cat => normalizeText(cat) === normalizeText(category)));
  }
  return categories.some(category => normalizeText(category) === normalizeText(selectedCategory));
}

function matchesCommunityCategory(community, selectedCategory) {
  if (selectedCategory === ALL_COMMUNITY_CATEGORIES) return true;

  const categories = getEntityCategories(community).map(c => c.trim()).filter(Boolean);
  if (selectedCategory === OTHER_CATEGORY) {
    if (!categories.length) return true;
    return categories.some(category => !KNOWN_COMMUNITY_CATEGORIES.some(cat => normalizeText(cat) === normalizeText(category)));
  }

  return categories.some(category => normalizeText(category) === normalizeText(selectedCategory));
}

function CreateCommunityModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    categories: [],
    custom_category: '',
    organization: '',
    url: '',
  });
  const [collabEnabled, setCollabEnabled] = useState(false);
  const [collabAmount, setCollabAmount] = useState('0.99');
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const coverInputRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const resolvedCategories = form.categories
    .map(cat => (cat === OTHER_CATEGORY ? form.custom_category.trim() : cat))
    .filter(Boolean);
  const emoji = getCommunityEmoji(resolvedCategories[0]);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function selectCategory(cat) {
    setForm(f => {
      const isSelected = f.categories.includes(cat);
      if (isSelected) {
        return {
          ...f,
          categories: f.categories.filter(c => c !== cat),
          custom_category: cat === OTHER_CATEGORY ? '' : f.custom_category,
        };
      }
      if (f.categories.length >= MAX_CATEGORIES) return f;
      return { ...f, categories: [...f.categories, cat] };
    });
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

  async function handleSubmit() {
    if (!form.name.trim()) { setError('El nombre es obligatorio'); return; }
    if (form.categories.includes(OTHER_CATEGORY) && !form.custom_category.trim()) {
      setError('Especifica la categoria');
      return;
    }
    let collabAmountCents = null;
    if (collabEnabled) {
      const parsed = Number(String(collabAmount).replace(',', '.'));
      if (!Number.isFinite(parsed) || parsed < 0.99) {
        setError('El importe de colaboración debe ser de al menos 0,99 €');
        return;
      }
      collabAmountCents = Math.round(parsed * 100);
    }
    setError('');
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('name', form.name.trim());
      if (form.description.trim()) formData.append('description', form.description.trim());
      if (resolvedCategories.length) formData.append('categories', JSON.stringify(resolvedCategories));
      if (form.organization.trim()) formData.append('organization', form.organization.trim());
      if (form.url.trim()) formData.append('url', form.url.trim());
      if (coverFile) formData.append('cover', coverFile);
      if (collabAmountCents) formData.append('collab_amount_cents', String(collabAmountCents));
      await onCreate(formData);
      onClose();
    } catch (e) {
      setError(e.message || 'Error al crear la comunidad');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-6 sm:hidden" />

        <div className="flex items-center gap-3 mb-6">
          <span className="text-3xl">{emoji || '👥'}</span>
          <div>
            <h2 className="font-display font-bold text-surface-text text-lg">Crear comunidad</h2>
            <p className="text-xs text-surface-muted">Un espacio para conectar con personas afines</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">Nombre *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Ej: Runners de Madrid, Amantes del Café..."
              maxLength={80}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              Categoría <span className="text-slate-600">({form.categories.length}/{MAX_CATEGORIES})</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {COMMUNITY_CATEGORIES.map(cat => {
                const selected = form.categories.includes(cat);
                const disabled = !selected && form.categories.length >= MAX_CATEGORIES;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => selectCategory(cat)}
                    disabled={disabled}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                      selected
                        ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-glow'
                        : disabled
                          ? 'border-surface-border text-slate-700 opacity-40 cursor-not-allowed'
                          : 'border-surface-border text-surface-muted hover:border-accent-primary/30'
                    }`}
                  >
                    {getCommunityEmoji(cat)} {cat}
                  </button>
                );
              })}
            </div>
            {form.categories.includes(OTHER_CATEGORY) && (
              <input
                type="text"
                value={form.custom_category}
                onChange={e => set('custom_category', e.target.value)}
                placeholder="Escribe la categoría"
                maxLength={60}
                className="mt-3 w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
              />
            )}
          </div>

          {/* Organization */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              Organización <span className="text-slate-600">(opcional)</span>
            </label>
            <input
              type="text"
              value={form.organization}
              onChange={e => set('organization', e.target.value)}
              placeholder="Ej: Universidad, asociación, club..."
              maxLength={120}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              Descripción <span className="text-slate-600">(opcional)</span>
            </label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="¿De qué trata tu comunidad? ¿A quién está dirigida?"
              maxLength={400}
              rows={3}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors resize-none"
            />
          </div>

          {/* URL */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              URL <span className="text-slate-600">(opcional)</span>
            </label>
            <input
              type="url"
              value={form.url}
              onChange={e => set('url', e.target.value)}
              placeholder="Ej: https://discord.gg/mi-comunidad"
              maxLength={500}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
          </div>

          {/* Colaboración económica */}
          <div className="rounded-xl border border-surface-border bg-surface-bg p-3.5">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-xs font-mono text-surface-muted">
                🤝 Permitir colaboraciones económicas <span className="text-slate-600">(opcional)</span>
              </span>
              <input
                type="checkbox"
                checked={collabEnabled}
                onChange={e => setCollabEnabled(e.target.checked)}
                className="w-4 h-4 accent-accent-primary flex-shrink-0"
              />
            </label>
            {collabEnabled && (
              <div className="mt-3 space-y-2">
                <label className="block text-xs font-mono text-surface-muted">Importe por colaboración</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0.99"
                    step="0.01"
                    value={collabAmount}
                    onChange={e => setCollabAmount(e.target.value)}
                    className="w-28 bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-surface-text text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
                  />
                  <span className="text-sm text-surface-muted font-mono">€ (mínimo 0,99 €)</span>
                </div>
                <p className="text-[11px] text-surface-muted leading-relaxed">
                  Los miembros de la comunidad (no admins) verán un botón "Colaborar" con este importe.
                  SocialBattery no obtiene nada por este pago.
                </p>
              </div>
            )}
          </div>

          {/* Photo */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              Foto de la comunidad <span className="text-slate-600">(opcional)</span>
            </label>
            {coverPreview ? (
              <div className="overflow-hidden rounded-xl border border-surface-border bg-surface-bg">
                <div className="aspect-[16/9]">
                  <img src={coverPreview} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="truncate text-xs text-surface-muted">{coverFile?.name}</span>
                  <button
                    type="button"
                    onClick={clearCover}
                    className="text-xs font-display font-semibold text-red-300 hover:text-red-200"
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                className="w-full rounded-xl border border-dashed border-accent-primary/35 bg-accent-primary/5 px-4 py-4 text-sm font-display font-semibold text-accent-glow hover:bg-accent-primary/10 transition-all"
              >
                Elegir foto de la galería
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

          {/* Info card */}
          <div className="bg-accent-primary/5 border border-accent-primary/20 rounded-xl p-3">
            <p className="text-xs text-accent-glow/80 font-mono leading-relaxed">
              💡 Tu comunidad será visible para todos los usuarios de SocialBattery. Cualquiera podrá unirse y participar.
            </p>
          </div>

          {error && (
            <p className="text-red-400 text-sm font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">
              {error}
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={saving || !form.name.trim() || (form.categories.includes(OTHER_CATEGORY) && !form.custom_category.trim())}
            className="w-full py-3.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98]"
          >
            {saving ? 'Creando...' : '👥 Crear comunidad'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Ranking Modal ─────────────────────────────────────────────────────────────
const RANK_METRICS = [
  { key: 'combined',        label: '🔥 Likes + Planes' },
  { key: 'likes',           label: '♥ Likes' },
  { key: 'planificaciones', label: '📅 Planificaciones' },
];

const RANK_VIEWS = [
  { key: 'current',  label: '⚡ Ahora',    sub: 'Top 20 eventos activos' },
  { key: 'alltime',  label: '📜 Histórico', sub: 'Top 100 de todos los tiempos' },
];

// Colores de fondo por posición (inline styles para evitar purge de Tailwind)
const PODIUM_STYLES = [
  // 🥇 oro
  { bg: 'rgba(234,179,8,0.13)', border: 'rgba(234,179,8,0.35)', numberColor: '#eab308' },
  // 🥈 plata
  { bg: 'rgba(148,163,184,0.13)', border: 'rgba(148,163,184,0.35)', numberColor: '#94a3b8' },
  // 🥉 bronce
  { bg: 'rgba(180,115,60,0.13)', border: 'rgba(180,115,60,0.35)', numberColor: '#b4733c' },
  // 4-10: tenue acento
  { bg: 'rgba(99,102,241,0.07)', border: 'rgba(99,102,241,0.18)', numberColor: '#818cf8' },
];

function podiumStyle(rank) {
  if (rank < 3) return PODIUM_STYLES[rank];
  if (rank < 10) return PODIUM_STYLES[3];
  return null; // sin fondo especial para el resto
}

function rankScore(event, metric) {
  const likes = event.like_count || 0;
  const plans = event.attendee_count || 0;
  if (metric === 'likes') return likes;
  if (metric === 'planificaciones') return plans;
  return likes + plans;
}

function medalEmoji(i) {
  if (i === 0) return '🥇';
  if (i === 1) return '🥈';
  if (i === 2) return '🥉';
  return null;
}

function RankingModal({ events, loading, onClose, onOpen }) {
  const [metric, setMetric]   = useState('combined');
  const [view,   setView]     = useState('current');

  const nowMs = Date.now();

  const currentSorted = [...events]
    .filter(e => {
      const endMs = e.ends_at
        ? new Date(e.ends_at).getTime()
        : new Date(e.event_date).getTime() + 86400000;
      return endMs >= nowMs;
    })
    .sort((a, b) => rankScore(b, metric) - rankScore(a, metric))
    .slice(0, 20);

  const allTimeSorted = [...events]
    .sort((a, b) => rankScore(b, metric) - rankScore(a, metric))
    .slice(0, 100);

  const list        = view === 'current' ? currentSorted : allTimeSorted;
  const emptyLabel  = view === 'current' ? 'Sin eventos activos aún.' : 'Sin eventos aún.';

  function ScoreChip({ event }) {
    const likes = event.like_count || 0;
    const plans = event.attendee_count || 0;
    if (metric === 'likes')
      return <span className="font-mono text-xs font-semibold" style={{ color: '#f472b6' }}>♥ {likes}</span>;
    if (metric === 'planificaciones')
      return <span className="font-mono text-xs font-semibold text-accent-glow">📅 {plans}</span>;
    return (
      <span className="font-mono text-xs flex items-center gap-0.5">
        <span style={{ color: '#f472b6' }}>♥{likes}</span>
        <span className="text-slate-600 mx-0.5">+</span>
        <span className="text-accent-glow">📅{plans}</span>
      </span>
    );
  }

  function RankRow({ event, rank }) {
    const medal  = medalEmoji(rank);
    const pStyle = podiumStyle(rank);

    return (
      <button
        onClick={() => onOpen(event.id)}
        style={pStyle
          ? { background: pStyle.bg, borderColor: pStyle.border }
          : {}
        }
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left group transition-all
          ${pStyle
            ? 'border hover:brightness-125'
            : 'hover:bg-surface-bg border border-transparent'
          }`}
      >
        {/* Rank badge */}
        <div className="w-8 flex-shrink-0 flex items-center justify-center">
          {medal
            ? <span className="text-xl leading-none">{medal}</span>
            : <span
                className="text-xs font-mono font-bold"
                style={{ color: pStyle?.numberColor ?? '#64748b' }}
              >
                #{rank + 1}
              </span>
          }
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-surface-text truncate group-hover:text-accent-glow transition-colors">
            {getEventEmoji(getEntityCategories(event)[0])} {event.title}
          </p>
          {event.location && (
            <p className="text-xs text-slate-500 font-mono truncate">📍 {event.location}</p>
          )}
        </div>

        {/* Score */}
        <ScoreChip event={event} />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-2xl max-h-[88vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🏆</span>
            <div>
              <h2 className="font-display font-bold text-surface-text text-lg leading-tight">Rankings</h2>
              <p className="text-xs text-surface-muted font-mono">{RANK_VIEWS.find(v => v.key === view)?.sub}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-bg border border-surface-border text-slate-400 hover:text-surface-text transition-colors text-sm"
          >✕</button>
        </div>

        {/* View toggle: Ahora / Histórico */}
        <div className="flex gap-1.5 px-5 pb-2 flex-shrink-0">
          {RANK_VIEWS.map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`flex-1 py-2 rounded-xl text-sm font-display font-semibold transition-all ${
                view === v.key
                  ? 'bg-surface-text text-surface-card'
                  : 'bg-surface-bg border border-surface-border text-surface-muted hover:border-accent-primary/40 hover:text-surface-text'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* Metric filter */}
        <div className="flex gap-1.5 px-5 pb-3 flex-shrink-0">
          {RANK_METRICS.map(m => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all ${
                metric === m.key
                  ? 'bg-accent-primary text-white shadow-sm'
                  : 'bg-surface-bg border border-surface-border text-surface-muted hover:border-accent-primary/40'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1 px-3 pb-4">
          {loading ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3 animate-pulse">🏆</div>
              <p className="text-sm text-surface-muted font-mono">Cargando ranking...</p>
            </div>
          ) : list.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">🏆</div>
              <p className="text-sm text-surface-muted font-mono">{emptyLabel}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {list.map((event, i) => (
                <RankRow key={event.id} event={event} rank={i} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CommunityPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const { clearEventBadge, clearCommunityBadge, communitiesWithEvents, refreshJoinedCommunities, planningUpdateCount, clearAllEventUpdateBadges, clearEventUpdateBadge, eventsWithUpdates } = useCommunityNotifications();

  const [tab, setTab] = useState(location.state?.tab || 'events'); // 'events' | 'communities'
  const [events, setEvents] = useState([]);
  const [communities, setCommunities] = useState([]);
  const [showRanking, setShowRanking] = useState(false);
  const [rankingEvents, setRankingEvents] = useState([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [showCreateCommunity, setShowCreateCommunity] = useState(false);
  const [communitySearch, setCommunitySearch] = useState('');
  const [communityCategoryFilter, setCommunityCategoryFilter] = useState(ALL_COMMUNITY_CATEGORIES);
  const [communityMembershipFilter, setCommunityMembershipFilter] = useState('all'); // 'all' | 'mine'
  const [communityInterestsOnly, setCommunityInterestsOnly] = useState(false);
  const [communityRaffleOnly, setCommunityRaffleOnly] = useState(false);
  const [communityUpcomingEventOnly, setCommunityUpcomingEventOnly] = useState(false);
  const [eventSearch, setEventSearch] = useState('');
  const [eventCategoryFilter, setEventCategoryFilter] = useState(ALL_EVENT_CATEGORIES);
  const [eventPriceFilter, setEventPriceFilter] = useState('all'); // 'all' | 'free' | 'paid'
  const [eventDateFilter, setEventDateFilter] = useState('all'); // 'week' | 'month' | 'all'
  // Dos secciones compatibles entre sí (ver sortEventsBy): se puede tener una
  // opción activa en cada una a la vez, o solo en una, o en ninguna.
  const [eventProximitySort, setEventProximitySort] = useState('cercania'); // null | 'cercania' | 'cercania_intereses'
  const [eventRankSort, setEventRankSort] = useState(null); // null | 'app' | 'planificaciones' | 'likes'
  const { coords: userCoords, status: locationStatus, requestLocation } = useUserLocation();

  // ── Fetch data ──────────────────────────────────────────────────────────────
  const fetchEvents = useCallback(async () => {
    try {
      const data = await api.get('/community/events');
      setEvents(data.events || []);
    } catch (e) {
      showToast('Error cargando eventos', 'error');
    }
  }, [showToast]);

  const fetchCommunities = useCallback(async () => {
    try {
      const data = await api.get('/community/communities');
      setCommunities(data.communities || []);
    } catch (e) {
      showToast('Error cargando comunidades', 'error');
    }
  }, [showToast]);

  // El endpoint /community/events solo trae eventos activos/futuros, así
  // que el ranking (que necesita también el histórico) usa su propio
  // endpoint y se carga solo cuando se abre el modal.
  const fetchRankingEvents = useCallback(async () => {
    setRankingLoading(true);
    try {
      const data = await api.get('/community/events/ranking');
      setRankingEvents(data.events || []);
    } catch (e) {
      showToast('Error cargando el ranking', 'error');
    } finally {
      setRankingLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      await Promise.all([fetchEvents(), fetchCommunities()]);
      setLoading(false);
    }
    load();
  }, [fetchEvents, fetchCommunities]);

  // Al entrar a la sección de comunidad se marcan como vistos los badges de
  // nuevos eventos (BottomNav + por-comunidad). El badge de "Plan" se limpia
  // al hacer click en ese tab, y el de evento individual en EventDetailPage.
  useEffect(() => {
    clearEventBadge();
  }, [clearEventBadge]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  async function handleCreateEvent(form) {
    const data = await api.postForm('/community/events', buildEventFormData(form));
    showToast('¡Evento creado! 🌐', 'success');
    await fetchEvents();
    return data;
  }

  async function handleCreateCommunity(formData) {
    const data = await api.postForm('/community/communities', formData);
    showToast('¡Comunidad creada! 👥', 'success');
    await fetchCommunities();
    return data;
  }

  async function handleJoinEvent(eventId) {
    try {
      await api.post(`/community/events/${eventId}/join`, {});
      showToast('¡Te has apuntado al evento! ✓', 'success');
      await fetchEvents();
      refreshJoinedCommunities(); // actualiza attendingEventIdsRef para recibir badges
    } catch (e) {
      showToast(e.message || 'Error al apuntarse', 'error');
    }
  }

  async function handleLeaveEvent(eventId) {
    try {
      await api.post(`/community/events/${eventId}/leave`, {});
      showToast('Has salido del evento', 'success');
      await fetchEvents();
      refreshJoinedCommunities(); // actualiza attendingEventIdsRef
    } catch (e) {
      showToast(e.message || 'Error al salir del evento', 'error');
    }
  }

  async function handleLikeEvent(eventId) {
    try {
      await api.post(`/community/events/${eventId}/like`, {});
      await fetchEvents();
    } catch (e) {
      showToast(e.message || 'Error al cambiar el like', 'error');
    }
  }

  async function handleJoinCommunity(communityId) {
    try {
      await api.post(`/community/communities/${communityId}/join`, {});
      showToast('¡Te has unido a la comunidad! ✓', 'success');
      await fetchCommunities();
      refreshJoinedCommunities(); // update badge subscription set
    } catch (e) {
      showToast(e.message || 'Error al unirse', 'error');
    }
  }

  async function handleLeaveCommunity(communityId) {
    try {
      await api.post(`/community/communities/${communityId}/leave`, {});
      showToast('Has salido de la comunidad', 'success');
      await fetchCommunities();
      refreshJoinedCommunities(); // update badge subscription set
    } catch (e) {
      showToast(e.message || 'Error al salir de la comunidad', 'error');
    }
  }

  const sortedEvents = sortEventsByProximity(events);
  const planningEvents = sortEventsByProximity(events.filter(event => (
    isUpcomingEvent(event) && event.attendee_ids?.includes(profile?.id)
  )));

  // ── Event search + filter ──────────────────────────────────────────────────
  const normalizedEventSearch = normalizeText(eventSearch);
  const filteredSortedEvents = sortEventsBy(events, {
    proximityKey: eventProximitySort,
    rankKey: eventRankSort,
    userCoords,
    userInterests: profile?.interests,
  })
    .filter(event => {
      if (!isUpcomingEvent(event)) return false;
      const matchesSearch = !normalizedEventSearch || normalizeText([
        event.title,
        event.description,
        ...getEntityCategories(event),
        event.location,
        event.organization,
        event.creator_name,
        event.community_name,
      ].filter(Boolean).join(' ')).includes(normalizedEventSearch);
      const matchesPrice = eventPriceFilter === 'all'
        ? true
        : eventPriceFilter === 'free'
          ? (!event.price || parseFloat(event.price) === 0)
          : (event.price && parseFloat(event.price) > 0);
      return matchesSearch && matchesEventCategory(event, eventCategoryFilter) && matchesPrice && matchesEventDateFilter(event, eventDateFilter);
    });
  const isEventFiltered = normalizedEventSearch || eventCategoryFilter !== ALL_EVENT_CATEGORIES || eventPriceFilter !== 'all' || eventDateFilter !== 'all';
  const isEventFilterActive = eventCategoryFilter !== ALL_EVENT_CATEGORIES || eventPriceFilter !== 'all' || eventDateFilter !== 'all';
  const upcomingEventsTotal = events.filter(isUpcomingEvent).length;
  const eventCountLabel = isEventFiltered
    ? `${filteredSortedEvents.length}/${upcomingEventsTotal} eventos`
    : `${upcomingEventsTotal} eventos`;
  const headerSubtitle = tab === 'events'
    ? eventCountLabel
    : tab === 'planning'
      ? `${planningEvents.length} planificados`
      : null;
  const normalizedCommunitySearch = normalizeText(communitySearch);
  const filteredCommunities = communities
    .filter(community => {
      const matchesSearch = !normalizedCommunitySearch || normalizeText([
        community.name,
        community.description,
        ...getEntityCategories(community),
        community.organization,
        community.creator_name,
      ].filter(Boolean).join(' ')).includes(normalizedCommunitySearch);
      const matchesMembership = communityMembershipFilter === 'mine'
        ? Boolean(community.member_ids?.includes(profile?.id))
        : true;
      const matchesInterests = communityInterestsOnly
        ? matchesUserInterests(community, profile?.interests)
        : true;
      const matchesRaffle = communityRaffleOnly ? Boolean(community.has_active_raffle) : true;
      const matchesUpcomingEvent = communityUpcomingEventOnly ? Boolean(community.has_upcoming_event) : true;

      return matchesSearch && matchesCommunityCategory(community, communityCategoryFilter) && matchesMembership && matchesInterests && matchesRaffle && matchesUpcomingEvent;
    })
    // Todas las vistas se ordenan igual, por número de participantes.
    .sort((a, b) => (b.member_count || 0) - (a.member_count || 0));
  const isCommunityFiltered = normalizedCommunitySearch || communityCategoryFilter !== ALL_COMMUNITY_CATEGORIES || communityMembershipFilter !== 'all' || communityInterestsOnly || communityRaffleOnly || communityUpcomingEventOnly;
  const isCommunityFilterActive = communityCategoryFilter !== ALL_COMMUNITY_CATEGORIES || communityMembershipFilter !== 'all' || communityInterestsOnly || communityRaffleOnly || communityUpcomingEventOnly;
  const communityCountLabel = isCommunityFiltered
    ? `${filteredCommunities.length}/${communities.length} comunidades`
    : `${communities.length} comunidades`;

  return (
    <div className="min-h-screen bg-surface-bg noise">
      <TutorialOverlay currentPage="/community" onSwitchTab={setTab} />
      {/* Header */}
      <header className="sticky top-0 z-40 bg-surface-bg/90 backdrop-blur-xl border-b border-surface-border pt-safe">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="font-display font-bold text-surface-text text-xl">Comunidad</h1>
            <p className="text-xs text-surface-muted font-mono">
              {headerSubtitle || communityCountLabel}
            </p>
          </div>
          <div className="flex gap-2">
            {tab !== 'planning' && (
              <button
                onClick={() => tab === 'events' ? setShowCreateEvent(true) : setShowCreateCommunity(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white text-xs font-display font-semibold transition-all active:scale-95"
              >
                <span className="text-base leading-none">+</span>
                {tab === 'events' ? 'Evento' : 'Comunidad'}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-lg mx-auto px-4 pb-3">
          <div className="flex bg-surface-card border border-surface-border rounded-xl p-1 gap-1">
            <button
              onClick={() => setTab('events')}
              className={`flex-1 py-2 rounded-lg text-xs font-display font-semibold transition-all ${
                tab === 'events'
                  ? 'bg-accent-primary text-white shadow-sm'
                  : 'text-surface-muted hover:text-surface-text'
              }`}
            >
              🌐 Eventos
            </button>
            <button
              onClick={() => { setTab('planning'); clearAllEventUpdateBadges(); }}
              className={`relative flex-1 py-2 rounded-lg text-xs font-display font-semibold transition-all ${
                tab === 'planning'
                  ? 'bg-accent-primary text-white shadow-sm'
                  : 'text-surface-muted hover:text-surface-text'
              }`}
            >
              📅 Plan
              {planningUpdateCount > 0 && tab !== 'planning' && (
                <span className="absolute -top-1 right-2 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-1 leading-none">
                  {planningUpdateCount > 9 ? '9+' : planningUpdateCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab('communities')}
              className={`relative flex-1 py-2 rounded-lg text-xs font-display font-semibold transition-all ${
                tab === 'communities'
                  ? 'bg-accent-primary text-white shadow-sm'
                  : 'text-surface-muted hover:text-surface-text'
              }`}
            >
              👥 Comunidades
              {communitiesWithEvents.size > 0 && (
                <span className="absolute -top-1 right-2 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-1 leading-none">
                  {communitiesWithEvents.size > 9 ? '9+' : communitiesWithEvents.size}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-lg mx-auto px-4 pb-28 pt-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="text-3xl animate-pulse">
              {tab === 'events' ? '🌐' : tab === 'planning' ? '📅' : '👥'}
            </div>
            <p className="text-surface-muted font-mono text-sm">Cargando...</p>
          </div>
        ) : tab === 'events' ? (
          <div id="tutorial-events-section" className="rounded-2xl transition-all duration-300">
            {/* Events title + filter/sort selectors */}
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-display font-bold text-surface-text text-lg">Eventos</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setShowRanking(true); fetchRankingEvents(); }}
                  title="Rankings históricos"
                  className="text-lg leading-none px-2 py-1.5 rounded-lg border border-surface-border bg-surface-card hover:border-accent-primary/50 hover:bg-surface-bg transition-colors"
                >
                  🏆
                </button>
                <FilterDropdown label="Filtrar" active={isEventFilterActive}>
                  <FilterDropdownSection title="Precio">
                    <div className="flex gap-2">
                      {[
                        { key: 'all', label: '🌐 Todos' },
                        { key: 'free', label: '✓ Gratis' },
                        { key: 'paid', label: '💳 De pago' },
                      ].map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setEventPriceFilter(key)}
                          className={`flex-1 py-2 rounded-xl text-xs font-display font-semibold border transition-all ${
                            eventPriceFilter === key
                              ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-glow'
                              : 'border-surface-border text-surface-muted hover:border-accent-primary/30'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </FilterDropdownSection>

                  <FilterDropdownSection title="Tiempo">
                    <div className="flex flex-col gap-2">
                      {[
                        { key: 'week', label: '🗓️ Esta semana' },
                        { key: 'month', label: '📆 Este mes' },
                        { key: 'all', label: '♾️ Todo el tiempo' },
                      ].map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setEventDateFilter(key)}
                          className={`w-full text-left py-2 px-3 rounded-xl text-xs font-display font-semibold border transition-all ${
                            eventDateFilter === key
                              ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-glow'
                              : 'border-surface-border text-surface-muted hover:border-accent-primary/30'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </FilterDropdownSection>

                  <FilterDropdownSection title="Categoría">
                    <div className="flex flex-wrap gap-2">
                      {EVENT_CATEGORY_FILTERS.map(cat => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setEventCategoryFilter(cat)}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                            eventCategoryFilter === cat
                              ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-glow'
                              : 'border-surface-border text-surface-muted hover:border-accent-primary/30'
                          }`}
                        >
                          {cat === ALL_EVENT_CATEGORIES ? '🌐' : getEventEmoji(cat)} {cat}
                        </button>
                      ))}
                    </div>
                  </FilterDropdownSection>
                </FilterDropdown>
                <EventSortDropdown
                  proximityValue={eventProximitySort}
                  onProximityChange={setEventProximitySort}
                  rankValue={eventRankSort}
                  onRankChange={setEventRankSort}
                />
              </div>
            </div>

            {/* Aviso de ubicación: solo si el orden activo la necesita y aún
                no tenemos coordenadas (permiso pendiente, denegado o no
                soportado). Se comprueba también locationStatus === 'denied'
                explícitamente (no solo !userCoords) por si quedaran coords
                cacheadas de una concesión de permiso anterior a que el
                usuario desactivase la ubicación. requestLocation reintenta
                la petición nativa. */}
            {(eventProximitySort === 'cercania' || eventProximitySort === 'cercania_intereses') && (!userCoords || locationStatus === 'denied') && (
              <div className="mb-4 flex items-center justify-between gap-3 text-xs bg-amber-500/10 border border-amber-500/25 text-amber-300 rounded-xl px-3 py-2.5">
                <span>
                  📍 {locationStatus === 'denied'
                    ? 'Has denegado la ubicación: activa el permiso para ordenar por cercanía.'
                    : locationStatus === 'unsupported'
                      ? 'Tu navegador no permite compartir ubicación.'
                      : 'Activa tu ubicación para ordenar los eventos por cercanía.'}
                </span>
                {locationStatus !== 'unsupported' && (
                  <button
                    type="button"
                    onClick={requestLocation}
                    className="flex-shrink-0 underline font-display font-semibold whitespace-nowrap hover:text-amber-200 transition-colors"
                  >
                    Activar
                  </button>
                )}
              </div>
            )}

            {/* Aviso de intereses: "cercanía e intereses" sin intereses
                configurados en el perfil no tiene nada que comparar. */}
            {eventProximitySort === 'cercania_intereses' && !(profile?.interests?.length > 0) && (
              <div className="mb-4 flex items-center justify-between gap-3 text-xs bg-accent-primary/10 border border-accent-primary/25 text-accent-glow rounded-xl px-3 py-2.5">
                <span>✨ Añade tus intereses en el perfil para afinar este filtro.</span>
                <button
                  type="button"
                  onClick={() => navigate('/profile')}
                  className="flex-shrink-0 underline font-display font-semibold whitespace-nowrap hover:brightness-125 transition-colors"
                >
                  Ir al perfil
                </button>
              </div>
            )}

            {/* Search */}
            <div className="space-y-3 mb-4">
              <input
                type="search"
                value={eventSearch}
                onChange={e => setEventSearch(e.target.value)}
                placeholder="Buscar eventos..."
                className="w-full bg-surface-card border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
              />
            </div>

            {events.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-5xl mb-4">🌐</div>
                <p className="font-display font-bold text-surface-text mb-1">Sin eventos todavía</p>
                <p className="text-sm text-surface-muted mb-6">¡Sé el primero en organizar algo!</p>
                <button
                  onClick={() => setShowCreateEvent(true)}
                  className="px-6 py-2.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white font-display font-semibold text-sm transition-all"
                >
                  + Crear evento
                </button>
              </div>
            ) : filteredSortedEvents.length === 0 ? (
              <div className="text-center py-14">
                <div className="text-4xl mb-3">🌐</div>
                <p className="font-display font-bold text-surface-text mb-1">Sin resultados</p>
                <p className="text-sm text-surface-muted mb-5">Prueba con otra búsqueda o categoría.</p>
                <button
                  onClick={() => {
                    setEventSearch('');
                    setEventCategoryFilter(ALL_EVENT_CATEGORIES);
                    setEventPriceFilter('all');
                    setEventDateFilter('all');
                    setEventProximitySort('cercania');
                    setEventRankSort(null);
                  }}
                  className="px-5 py-2.5 rounded-xl border border-surface-border text-surface-text hover:border-accent-primary/40 font-display font-semibold text-sm transition-all"
                >
                  Limpiar filtros
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredSortedEvents.map((event, i) => (
                  <EventCard
                    key={event.id}
                    event={{ ...event, attendees: event.attendee_ids || [] }}
                    rank={!isEventFiltered && eventRankSort === 'app' && !eventProximitySort ? i + 1 : undefined}
                    onJoin={handleJoinEvent}
                    onLeave={handleLeaveEvent}
                    onLike={handleLikeEvent}
                    onOpen={(id) => navigate(`/community/event/${id}`)}
                    currentUserId={profile?.id}
                  />
                ))}
              </div>
            )}
          </div>
        ) : tab === 'planning' ? (
          <>
            <div className="mb-4">
              <h2 className="font-display font-bold text-surface-text text-lg">Planificación</h2>
              <p className="text-xs text-surface-muted">Eventos futuros en los que estás apuntado</p>
            </div>

            {planningEvents.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-5xl mb-4">📅</div>
                <p className="font-display font-bold text-surface-text mb-1">Sin planes pendientes</p>
                <p className="text-sm text-surface-muted mb-6">Apúntate a un evento para verlo aquí.</p>
                <button
                  onClick={() => setTab('events')}
                  className="px-6 py-2.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white font-display font-semibold text-sm transition-all"
                >
                  Ver eventos
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {planningEvents.map(event => (
                  <EventCard
                    key={event.id}
                    event={{ ...event, attendees: event.attendee_ids || [] }}
                    onJoin={handleJoinEvent}
                    onLeave={handleLeaveEvent}
                    onLike={handleLikeEvent}
                    onOpen={(id) => { clearEventUpdateBadge(id); navigate(`/community/event/${id}`); }}
                    currentUserId={profile?.id}
                    hasUnreadUpdate={eventsWithUpdates.has(event.id)}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div id="tutorial-communities-section" className="rounded-2xl transition-all duration-300">
            {/* Communities title + filter selector */}
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display font-bold text-surface-text text-lg">Comunidades</h2>
                <p className="text-xs text-surface-muted">Grupos de interés abiertos a todos</p>
              </div>
              <FilterDropdown label="Filtrar" active={isCommunityFilterActive}>
                <FilterDropdownSection title="Membresía">
                  <div className="flex gap-2">
                    {[
                      { key: 'all', label: '🌐 Todas' },
                      { key: 'mine', label: '👤 Tus comunidades' },
                    ].map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setCommunityMembershipFilter(key)}
                        className={`flex-1 py-2 rounded-xl text-xs font-display font-semibold border transition-all ${
                          communityMembershipFilter === key
                            ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-glow'
                            : 'border-surface-border text-surface-muted hover:border-accent-primary/30'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </FilterDropdownSection>

                <FilterDropdownSection title="Otros">
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => setCommunityInterestsOnly(v => !v)}
                      aria-pressed={communityInterestsOnly}
                      className={`w-full flex items-center gap-2 py-2 px-3 rounded-xl text-xs font-display font-semibold border transition-all ${
                        communityInterestsOnly
                          ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-glow'
                          : 'border-surface-border text-surface-muted hover:border-accent-primary/30'
                      }`}
                    >
                      <span className={`flex-shrink-0 w-4 h-4 rounded flex items-center justify-center border text-[10px] leading-none ${
                        communityInterestsOnly
                          ? 'border-accent-primary bg-accent-primary text-white'
                          : 'border-surface-border'
                      }`}>
                        {communityInterestsOnly ? '✓' : ''}
                      </span>
                      ✨ Solo con intereses en común
                    </button>

                    {communityInterestsOnly && !(profile?.interests?.length > 0) && (
                      <div className="flex items-center justify-between gap-3 text-xs bg-accent-primary/10 border border-accent-primary/25 text-accent-glow rounded-xl px-3 py-2.5">
                        <span>✨ Añade tus intereses en el perfil para usar este filtro.</span>
                        <button
                          type="button"
                          onClick={() => navigate('/profile')}
                          className="flex-shrink-0 underline font-display font-semibold whitespace-nowrap hover:brightness-125 transition-colors"
                        >
                          Ir al perfil
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setCommunityRaffleOnly(v => !v)}
                      aria-pressed={communityRaffleOnly}
                      className={`w-full flex items-center gap-2 py-2 px-3 rounded-xl text-xs font-display font-semibold border transition-all ${
                        communityRaffleOnly
                          ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-glow'
                          : 'border-surface-border text-surface-muted hover:border-accent-primary/30'
                      }`}
                    >
                      <span className={`flex-shrink-0 w-4 h-4 rounded flex items-center justify-center border text-[10px] leading-none ${
                        communityRaffleOnly
                          ? 'border-accent-primary bg-accent-primary text-white'
                          : 'border-surface-border'
                      }`}>
                        {communityRaffleOnly ? '✓' : ''}
                      </span>
                      🎟️ Sorteo en marcha
                    </button>

                    <button
                      type="button"
                      onClick={() => setCommunityUpcomingEventOnly(v => !v)}
                      aria-pressed={communityUpcomingEventOnly}
                      className={`w-full flex items-center gap-2 py-2 px-3 rounded-xl text-xs font-display font-semibold border transition-all ${
                        communityUpcomingEventOnly
                          ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-glow'
                          : 'border-surface-border text-surface-muted hover:border-accent-primary/30'
                      }`}
                    >
                      <span className={`flex-shrink-0 w-4 h-4 rounded flex items-center justify-center border text-[10px] leading-none ${
                        communityUpcomingEventOnly
                          ? 'border-accent-primary bg-accent-primary text-white'
                          : 'border-surface-border'
                      }`}>
                        {communityUpcomingEventOnly ? '✓' : ''}
                      </span>
                      📅 Evento próximo
                    </button>
                  </div>
                </FilterDropdownSection>

                <FilterDropdownSection title="Categoría">
                  <div className="flex flex-wrap gap-2">
                    {COMMUNITY_CATEGORY_FILTERS.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCommunityCategoryFilter(cat)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                          communityCategoryFilter === cat
                            ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-glow'
                            : 'border-surface-border text-surface-muted hover:border-accent-primary/30'
                        }`}
                      >
                        {cat === ALL_COMMUNITY_CATEGORIES ? '🌐' : getCommunityEmoji(cat)} {cat}
                      </button>
                    ))}
                  </div>
                </FilterDropdownSection>
              </FilterDropdown>
            </div>

            <div className="space-y-3 mb-4">
              <input
                type="search"
                value={communitySearch}
                onChange={e => setCommunitySearch(e.target.value)}
                placeholder="Buscar comunidades..."
                className="w-full bg-surface-card border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
              />
            </div>

            {communities.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-5xl mb-4">👥</div>
                <p className="font-display font-bold text-surface-text mb-1">Sin comunidades todavía</p>
                <p className="text-sm text-surface-muted mb-6">¡Crea la primera comunidad!</p>
                <button
                  onClick={() => setShowCreateCommunity(true)}
                  className="px-6 py-2.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white font-display font-semibold text-sm transition-all"
                >
                  + Crear comunidad
                </button>
              </div>
            ) : (
              <>
                {filteredCommunities.length === 0 ? (
                  <div className="text-center py-14">
                    <div className="text-4xl mb-3">👥</div>
                    <p className="font-display font-bold text-surface-text mb-1">Sin resultados</p>
                    <p className="text-sm text-surface-muted mb-5">Prueba con otra búsqueda o categoría.</p>
                    <button
                      onClick={() => {
                        setCommunitySearch('');
                        setCommunityCategoryFilter(ALL_COMMUNITY_CATEGORIES);
                        setCommunityMembershipFilter('all');
                        setCommunityInterestsOnly(false);
                        setCommunityRaffleOnly(false);
                        setCommunityUpcomingEventOnly(false);
                      }}
                      className="px-5 py-2.5 rounded-xl border border-surface-border text-surface-text hover:border-accent-primary/40 font-display font-semibold text-sm transition-all"
                    >
                      Limpiar filtros
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredCommunities.map(community => (
                    <CommunityCard
                      key={community.id}
                      community={{ ...community, members: community.member_ids || [] }}
                      onJoin={handleJoinCommunity}
                      onLeave={handleLeaveCommunity}
                      onOpen={(id) => { clearCommunityBadge(id); navigate(`/community/${id}`); }}
                      currentUserId={profile?.id}
                      hasNewEvents={communitiesWithEvents.has(community.id)}
                    />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {/* Modals */}
      {showRanking && (
        <RankingModal
          events={rankingEvents}
          loading={rankingLoading}
          onClose={() => setShowRanking(false)}
          onOpen={(id) => { setShowRanking(false); navigate(`/community/event/${id}`); }}
        />
      )}
      {showCreateEvent && (
        <CreateEventModal
          onClose={() => setShowCreateEvent(false)}
          onCreate={handleCreateEvent}
        />
      )}
      {showCreateCommunity && (
        <CreateCommunityModal
          onClose={() => setShowCreateCommunity(false)}
          onCreate={handleCreateCommunity}
        />
      )}

      <BottomNav />
    </div>
  );
}
