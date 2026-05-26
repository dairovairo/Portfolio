import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useCommunityNotifications } from '../context/CommunityNotificationsContext';
import { api } from '../lib/api';

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeText(value = '') {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getEventEmoji(category = '') {
  const c = normalizeText(category);
  if (/música|musica|concierto|concert/.test(c)) return '🎵';
  if (/deporte|sport|fútbol|futbol|tenis|running/.test(c)) return '⚽';
  if (/arte|art|exposición|exposicion|museo/.test(c)) return '🎨';
  if (/tecnología|tecnologia|tech|hacking|código/.test(c)) return '💻';
  if (/comida|food|gastro|cocina|cena/.test(c)) return '🍽️';
  if (/fiesta|party|celebración/.test(c)) return '🎉';
  if (/naturaleza|nature|senderismo|hiking/.test(c)) return '🌿';
  if (/cine|film|película|movie/.test(c)) return '🎬';
  if (/juego|gaming|videojuego/.test(c)) return '🎮';
  if (/yoga|meditación|bienestar|wellness/.test(c)) return '🧘';
  if (/fotografía|fotografia|photo/.test(c)) return '📷';
  if (/lectura|libro|book|literatura/.test(c)) return '📚';
  return '🌐';
}

function getCommunityEmoji(category = '') {
  const c = normalizeText(category);
  if (/música|musica/.test(c)) return '🎵';
  if (/deporte|sport/.test(c)) return '⚽';
  if (/tecnología|tech|código/.test(c)) return '💻';
  if (/arte|art/.test(c)) return '🎨';
  if (/viajes|travel/.test(c)) return '✈️';
  if (/cocina|food/.test(c)) return '👨‍🍳';
  if (/juego|gaming/.test(c)) return '🎮';
  if (/bienestar|yoga/.test(c)) return '🧘';
  if (/fotografía|photo/.test(c)) return '📷';
  return '👥';
}

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

// ── Event Card ────────────────────────────────────────────────────────────────
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
    if (value !== undefined && value !== null && value !== '') {
      formData.append(key, String(value));
    }
  });

  if (form.cover_file) formData.append('cover', form.cover_file);
  return formData;
}

function EventCard({ event, rank, onJoin, onLeave, onLike, currentUserId }) {
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [liking, setLiking] = useState(false);
  const isJoined = event.attendees?.includes(currentUserId);
  const isPast = new Date(event.ends_at || event.event_date) < new Date();
  const isLiked = Boolean(event.liked_by_current_user);
  const emoji = getEventEmoji(event.category);
  const daysLabel = getDaysUntilLabel(event.event_date);
  const attendeeCount = event.attendee_count || 0;
  const likeCount = event.like_count || 0;

  const rankColors = {
    1: { ring: 'border-yellow-400/60', glow: '#facc1520', label: '🥇' },
    2: { ring: 'border-slate-400/60', glow: '#94a3b820', label: '🥈' },
    3: { ring: 'border-amber-600/60', glow: '#d97706/20', label: '🥉' },
  };
  const rankStyle = rankColors[rank] || { ring: 'border-surface-border', glow: 'transparent', label: null };

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
      className={`relative bg-surface-card border ${rankStyle.ring} rounded-2xl p-4 transition-all duration-200 hover:border-accent-primary/30`}
      style={{ boxShadow: rank <= 3 ? `0 0 20px ${rankStyle.glow}` : undefined }}
    >
      {/* Rank badge */}
      {rank <= 3 && (
        <span className="absolute -top-2.5 -right-1 text-xl">{rankStyle.label}</span>
      )}
      {rank > 3 && (
        <span className="absolute top-3 right-3 text-xs font-mono text-slate-600">#{rank}</span>
      )}

      {event.cover_image_url && (
        <div className="relative z-10 mb-3 aspect-[16/9] overflow-hidden rounded-xl border border-surface-border bg-surface-bg">
          <img
            src={event.cover_image_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>
      )}

      <div className="flex gap-3">
        {/* Emoji */}
        <div className="w-11 h-11 rounded-2xl bg-surface-bg flex items-center justify-center text-2xl flex-shrink-0 border border-surface-border">
          {emoji}
        </div>

        <div className="flex-1 min-w-0">
          {/* Title + category */}
          <div className="flex items-start gap-2 flex-wrap">
            <h3 className="font-display font-bold text-surface-text text-sm leading-snug line-clamp-1 flex-1">
              {event.title}
            </h3>
            {event.category && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent-primary/10 text-accent-glow border border-accent-primary/20 flex-shrink-0">
                {event.category}
              </span>
            )}
          </div>

          {/* Creator */}
          <p className="text-xs text-surface-muted mt-0.5">
            por <span className="text-accent-glow/80">{event.creator_name || 'Alguien'}</span>
            {event.community_name && (
              <span> · en <span className="text-accent-glow">{event.community_name}</span></span>
            )}
            {event.organization && (
              <span> · org <span className="text-amber-300/90">{event.organization}</span></span>
            )}
          </p>

          {/* Description */}
          {event.description && (
            <p className="text-xs text-surface-muted mt-1.5 line-clamp-2 leading-relaxed">
              {event.description}
            </p>
          )}

          {/* Date + location */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-xs text-slate-500 font-mono flex items-center gap-1">
              📅 {formatEventDateRange(event)}
            </span>
            {daysLabel && (
              <span className="text-xs text-amber-300/90 font-mono flex items-center gap-1">
                ⏳ {daysLabel}
              </span>
            )}
            {event.location && (
              <span className="text-xs text-slate-500 font-mono flex items-center gap-1 truncate">
                📍 {event.location}
              </span>
            )}
            {event.url && (
              <a
                href={event.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-xs text-accent-glow/80 font-mono flex items-center gap-1 hover:text-accent-glow truncate"
              >
                🔗 Ver más
              </a>
            )}
          </div>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
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
          </div>

          {/* Planning button */}
          <div className="mt-3">
            {isPast && !isJoined ? (
              <span className="text-xs font-mono text-slate-600 px-3 py-1.5 rounded-xl bg-surface-bg border border-surface-border">
                Evento pasado
              </span>
            ) : isJoined ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-green-400 px-3 py-1.5 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center gap-1 w-fit">
                  📅 En tu planificación
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
                {joining ? '...' : '📅 Añadir a planificación'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Community Card ────────────────────────────────────────────────────────────
function CommunityCard({ community, onJoin, onLeave, onOpen, currentUserId, hasNewEvents }) {
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const isMember = community.members?.includes(currentUserId);
  const emoji = getCommunityEmoji(community.category);

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
          {community.category && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-bg text-surface-muted border border-surface-border flex-shrink-0">
              {community.category}
            </span>
          )}
        </div>
        {community.description && (
          <p className="text-xs text-surface-muted mt-0.5 line-clamp-1">{community.description}</p>
        )}
        {community.organization && (
          <p className="text-xs text-accent-glow/80 font-mono mt-1">{community.organization}</p>
        )}
        {community.url && (
          <a
            href={community.url}
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
            <span className="text-xs font-mono text-green-400 px-2.5 py-1 rounded-xl bg-green-500/10 border border-green-500/20">
              ✓
            </span>
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
const OTHER_CATEGORY = 'Otro';
const EVENT_CATEGORIES = ['Música', 'Deporte', 'Arte', 'Tecnología', 'Comida', 'Fiesta', 'Naturaleza', 'Cine', 'Juego', 'Yoga', 'Fotografía', 'Lectura', OTHER_CATEGORY];

function CreateEventModal({ onClose, onCreate }) {
  const now = new Date();
  const minDate = new Date(now.getTime() + 30 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const defaultDate = `${minDate.getFullYear()}-${pad(minDate.getMonth() + 1)}-${pad(minDate.getDate())}T${pad(minDate.getHours())}:${pad(minDate.getMinutes())}`;
  const coverInputRef = useRef(null);

  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    custom_category: '',
    organization: '',
    event_date: defaultDate,
    ends_at: '',
    location: '',
    url: '',
    max_attendees: 50,
  });
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const resolvedCategory = form.category === OTHER_CATEGORY ? form.custom_category.trim() : form.category;
  const emoji = getEventEmoji(resolvedCategory || form.category);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function selectCategory(cat) {
    setForm(f => ({
      ...f,
      category: f.category === cat ? '' : cat,
      custom_category: cat === OTHER_CATEGORY && f.category !== cat ? f.custom_category : '',
    }));
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
  }

  async function handleSubmit() {
    if (!form.title.trim()) { setError('El título es obligatorio'); return; }
    if (!form.event_date) { setError('La fecha es obligatoria'); return; }
    if (!form.location.trim()) { setError('La ubicacion es obligatoria'); return; }
    if (form.category === OTHER_CATEGORY && !form.custom_category.trim()) {
      setError('Especifica la categoria');
      return;
    }
    if (form.ends_at && new Date(form.ends_at) <= new Date(form.event_date)) {
      setError('La fecha fin debe ser posterior al inicio');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onCreate({
        ...form,
        category: resolvedCategory,
        cover_file: coverFile,
        event_date: new Date(form.event_date).toISOString(),
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
        max_attendees: parseInt(form.max_attendees) || 50,
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
            <label className="block text-xs font-mono text-surface-muted mb-1.5">Categoría</label>
            <div className="flex flex-wrap gap-2">
              {EVENT_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => selectCategory(cat)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                    form.category === cat
                      ? 'border-accent-primary bg-accent-primary/20 text-accent-glow'
                      : 'border-surface-border text-surface-muted hover:border-accent-primary/30'
                  }`}
                >
                  {getEventEmoji(cat)} {cat}
                </button>
              ))}
            </div>
            {form.category === OTHER_CATEGORY && (
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

          {/* Date + max attendees */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono text-surface-muted mb-1.5">Fecha y hora *</label>
              <input
                type="datetime-local"
                value={form.event_date}
                min={defaultDate}
                onChange={e => set('event_date', e.target.value)}
                className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-3 text-surface-text text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-surface-muted mb-1.5">Fin <span className="text-slate-600">(opcional)</span></label>
              <input
                type="datetime-local"
                value={form.ends_at}
                min={form.event_date || defaultDate}
                onChange={e => set('ends_at', e.target.value)}
                className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-3 text-surface-text text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-mono text-surface-muted mb-1.5">Máx. asistentes</label>
              <input
                type="number"
                value={form.max_attendees}
                min={2}
                max={10000}
                onChange={e => set('max_attendees', e.target.value)}
                className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              Ubicación *
            </label>
            <input
              type="text"
              value={form.location}
              onChange={e => set('location', e.target.value)}
              placeholder="Ej: Parque del Retiro, Madrid / Online"
              maxLength={200}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
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

          {error && (
            <p className="text-red-400 text-sm font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">
              {error}
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={saving || !form.title.trim() || !form.location.trim() || (form.category === OTHER_CATEGORY && !form.custom_category.trim())}
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
const COMMUNITY_CATEGORIES = ['Música', 'Deporte', 'Tecnología', 'Arte', 'Viajes', 'Cocina', 'Juego', 'Bienestar', 'Fotografía', OTHER_CATEGORY];
const ALL_COMMUNITY_CATEGORIES = 'Todo';
const COMMUNITY_CATEGORY_FILTERS = [ALL_COMMUNITY_CATEGORIES, ...COMMUNITY_CATEGORIES];
const KNOWN_COMMUNITY_CATEGORIES = COMMUNITY_CATEGORIES.filter(cat => cat !== OTHER_CATEGORY);

const ALL_EVENT_CATEGORIES = 'Todo';
const EVENT_CATEGORY_FILTERS = [ALL_EVENT_CATEGORIES, ...EVENT_CATEGORIES];
const KNOWN_EVENT_CATEGORIES = EVENT_CATEGORIES.filter(cat => cat !== OTHER_CATEGORY);

function matchesEventCategory(event, selectedCategory) {
  if (selectedCategory === ALL_EVENT_CATEGORIES) return true;
  const category = (event.category || '').trim();
  if (selectedCategory === OTHER_CATEGORY) {
    if (!category) return true;
    return !KNOWN_EVENT_CATEGORIES.some(cat => normalizeText(cat) === normalizeText(category));
  }
  return normalizeText(category) === normalizeText(selectedCategory);
}

function matchesCommunityCategory(community, selectedCategory) {
  if (selectedCategory === ALL_COMMUNITY_CATEGORIES) return true;

  const category = (community.category || '').trim();
  if (selectedCategory === OTHER_CATEGORY) {
    if (!category) return true;
    return !KNOWN_COMMUNITY_CATEGORIES.some(cat => normalizeText(cat) === normalizeText(category));
  }

  return normalizeText(category) === normalizeText(selectedCategory);
}

function CreateCommunityModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    category: '',
    custom_category: '',
    organization: '',
    url: '',
  });
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const coverInputRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const resolvedCategory = form.category === OTHER_CATEGORY ? form.custom_category.trim() : form.category;
  const emoji = getCommunityEmoji(resolvedCategory || form.category);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function selectCategory(cat) {
    setForm(f => ({
      ...f,
      category: f.category === cat ? '' : cat,
      custom_category: cat === OTHER_CATEGORY && f.category !== cat ? f.custom_category : '',
    }));
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
    if (form.category === OTHER_CATEGORY && !form.custom_category.trim()) {
      setError('Especifica la categoria');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('name', form.name.trim());
      if (form.description.trim()) formData.append('description', form.description.trim());
      if (resolvedCategory) formData.append('category', resolvedCategory);
      if (form.organization.trim()) formData.append('organization', form.organization.trim());
      if (form.url.trim()) formData.append('url', form.url.trim());
      if (coverFile) formData.append('cover', coverFile);
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
            <label className="block text-xs font-mono text-surface-muted mb-1.5">Categoría</label>
            <div className="flex flex-wrap gap-2">
              {COMMUNITY_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => selectCategory(cat)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                    form.category === cat
                      ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-glow'
                      : 'border-surface-border text-surface-muted hover:border-accent-primary/30'
                  }`}
                >
                  {getCommunityEmoji(cat)} {cat}
                </button>
              ))}
            </div>
            {form.category === OTHER_CATEGORY && (
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
            disabled={saving || !form.name.trim() || (form.category === OTHER_CATEGORY && !form.custom_category.trim())}
            className="w-full py-3.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98]"
          >
            {saving ? 'Creando...' : '👥 Crear comunidad'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CommunityPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const { clearEventBadge, communitiesWithEvents, refreshJoinedCommunities } = useCommunityNotifications();

  const [tab, setTab] = useState('events'); // 'events' | 'communities'
  const [events, setEvents] = useState([]);
  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [showCreateCommunity, setShowCreateCommunity] = useState(false);
  const [communitySearch, setCommunitySearch] = useState('');
  const [communityCategoryFilter, setCommunityCategoryFilter] = useState(ALL_COMMUNITY_CATEGORIES);
  const [eventSearch, setEventSearch] = useState('');
  const [eventCategoryFilter, setEventCategoryFilter] = useState(ALL_EVENT_CATEGORIES);

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

  useEffect(() => {
    async function load() {
      setLoading(true);
      await Promise.all([fetchEvents(), fetchCommunities()]);
      setLoading(false);
    }
    load();
  }, [fetchEvents, fetchCommunities]);

  // Clear community event badge when the events tab is visible
  useEffect(() => {
    if (tab === 'events' && !loading) {
      clearEventBadge();
    }
  }, [tab, loading, clearEventBadge]);

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
    } catch (e) {
      showToast(e.message || 'Error al apuntarse', 'error');
    }
  }

  async function handleLeaveEvent(eventId) {
    try {
      await api.post(`/community/events/${eventId}/leave`, {});
      showToast('Has salido del evento', 'success');
      await fetchEvents();
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
  const sortedEventsByLikes = [...events].sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
  const planningEvents = sortEventsByProximity(events.filter(event => (
    isUpcomingEvent(event) && event.attendee_ids?.includes(profile?.id)
  )));

  // ── Event search + filter ──────────────────────────────────────────────────
  const normalizedEventSearch = normalizeText(eventSearch);
  const filteredSortedEvents = sortedEventsByLikes.filter(event => {
    const matchesSearch = !normalizedEventSearch || normalizeText([
      event.title,
      event.description,
      event.category,
      event.location,
      event.organization,
      event.creator_name,
      event.community_name,
    ].filter(Boolean).join(' ')).includes(normalizedEventSearch);
    return matchesSearch && matchesEventCategory(event, eventCategoryFilter);
  });
  const isEventFiltered = normalizedEventSearch || eventCategoryFilter !== ALL_EVENT_CATEGORIES;
  const eventCountLabel = isEventFiltered
    ? `${filteredSortedEvents.length}/${events.length} eventos`
    : `${events.length} eventos`;
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
        community.category,
        community.organization,
        community.creator_name,
      ].filter(Boolean).join(' ')).includes(normalizedCommunitySearch);

      return matchesSearch && matchesCommunityCategory(community, communityCategoryFilter);
    })
    .sort((a, b) => (b.member_count || 0) - (a.member_count || 0));
  const isCommunityFiltered = normalizedCommunitySearch || communityCategoryFilter !== ALL_COMMUNITY_CATEGORIES;
  const communityCountLabel = isCommunityFiltered
    ? `${filteredCommunities.length}/${communities.length} comunidades`
    : `${communities.length} comunidades`;

  return (
    <div className="min-h-screen bg-surface-bg noise">
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
              onClick={() => setTab('planning')}
              className={`flex-1 py-2 rounded-lg text-xs font-display font-semibold transition-all ${
                tab === 'planning'
                  ? 'bg-accent-primary text-white shadow-sm'
                  : 'text-surface-muted hover:text-surface-text'
              }`}
            >
              📅 Plan
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
          <>
            {/* Events title */}
            <div className="mb-4">
              <h2 className="font-display font-bold text-surface-text text-lg">Eventos</h2>
              <p className="text-xs text-surface-muted">Los eventos más cercanos aparecen primero</p>
            </div>

            {/* Search + category filter */}
            <div className="space-y-3 mb-4">
              <input
                type="search"
                value={eventSearch}
                onChange={e => setEventSearch(e.target.value)}
                placeholder="Buscar eventos..."
                className="w-full bg-surface-card border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
              />
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                {EVENT_CATEGORY_FILTERS.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setEventCategoryFilter(cat)}
                    className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-all ${
                      eventCategoryFilter === cat
                        ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-glow'
                        : 'border-surface-border text-surface-muted hover:border-accent-primary/30'
                    }`}
                  >
                    {cat === ALL_EVENT_CATEGORIES ? '🌐' : getEventEmoji(cat)} {cat}
                  </button>
                ))}
              </div>
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
                    rank={!isEventFiltered ? i + 1 : undefined}
                    onJoin={handleJoinEvent}
                    onLeave={handleLeaveEvent}
                    onLike={handleLikeEvent}
                    currentUserId={profile?.id}
                  />
                ))}
              </div>
            )}
          </>
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
                    currentUserId={profile?.id}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Communities title */}
            <div className="mb-4">
              <h2 className="font-display font-bold text-surface-text text-lg">Comunidades</h2>
              <p className="text-xs text-surface-muted">Grupos de interés abiertos a todos</p>
            </div>

            <div className="space-y-3 mb-4">
              <input
                type="search"
                value={communitySearch}
                onChange={e => setCommunitySearch(e.target.value)}
                placeholder="Buscar comunidades..."
                className="w-full bg-surface-card border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
              />

              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                {COMMUNITY_CATEGORY_FILTERS.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCommunityCategoryFilter(cat)}
                    className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-all ${
                      communityCategoryFilter === cat
                        ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-glow'
                        : 'border-surface-border text-surface-muted hover:border-accent-primary/30'
                    }`}
                  >
                    {cat === ALL_COMMUNITY_CATEGORIES ? '🌐' : getCommunityEmoji(cat)} {cat}
                  </button>
                ))}
              </div>
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
                      onOpen={(id) => navigate(`/community/${id}`)}
                      currentUserId={profile?.id}
                      hasNewEvents={communitiesWithEvents.has(community.id)}
                    />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      {/* Modals */}
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
