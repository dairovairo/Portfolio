import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
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

function isUpcomingEvent(event) {
  return getEventTime(event) >= Date.now();
}

function sortEventsByProximity(eventList = []) {
  const now = Date.now();
  return [...eventList].sort((a, b) => {
    const aTime = getEventTime(a);
    const bTime = getEventTime(b);
    const aPast = aTime < now;
    const bPast = bTime < now;
    if (aPast !== bPast) return aPast ? 1 : -1;
    return aPast ? bTime - aTime : aTime - bTime;
  });
}

// ── Event Card ────────────────────────────────────────────────────────────────
function EventCard({ event, rank, onJoin, onLeave, onLike, currentUserId }) {
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [liking, setLiking] = useState(false);
  const isJoined = event.attendees?.includes(currentUserId);
  const isPast = new Date(event.event_date) < new Date();
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
              📅 {formatEventDate(event.event_date)}
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
          </div>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-xs font-mono text-slate-500 px-2 py-1 rounded-lg bg-surface-bg border border-surface-border">
              👥 {attendeeCount} apuntados
            </span>
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

          {/* Join button */}
          <div className="mt-3">
            {isPast && !isJoined ? (
              <span className="text-xs font-mono text-slate-600 px-3 py-1.5 rounded-xl bg-surface-bg border border-surface-border">
                Evento pasado
              </span>
            ) : isJoined ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-green-400 px-3 py-1.5 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center gap-1 w-fit">
                  ✓ Apuntado
                </span>
                <button
                  onClick={handleLeave}
                  disabled={leaving}
                  className="text-xs font-display font-semibold px-3 py-1.5 rounded-xl border border-red-500/25 text-red-300 hover:bg-red-500/10 transition-all disabled:opacity-50"
                >
                  {leaving ? '...' : 'Salir'}
                </button>
              </div>
            ) : (
              <button
                onClick={handleJoin}
                disabled={joining}
                className="text-xs font-display font-semibold px-4 py-1.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white transition-all disabled:opacity-50 active:scale-95"
              >
                {joining ? '...' : '+ Apuntarme'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Community Card ────────────────────────────────────────────────────────────
function CommunityCard({ community, onJoin, onLeave, onOpen, currentUserId }) {
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
      <div className="w-12 h-12 rounded-2xl bg-surface-bg flex items-center justify-center text-2xl flex-shrink-0 border border-surface-border">
        {emoji}
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
const EVENT_CATEGORIES = ['Música', 'Deporte', 'Arte', 'Tecnología', 'Comida', 'Fiesta', 'Naturaleza', 'Cine', 'Juego', 'Yoga', 'Fotografía', 'Lectura', 'Otro'];

function CreateEventModal({ onClose, onCreate }) {
  const now = new Date();
  const minDate = new Date(now.getTime() + 30 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const defaultDate = `${minDate.getFullYear()}-${pad(minDate.getMonth() + 1)}-${pad(minDate.getDate())}T${pad(minDate.getHours())}:${pad(minDate.getMinutes())}`;

  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    organization: '',
    event_date: defaultDate,
    location: '',
    max_attendees: 50,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const emoji = getEventEmoji(form.category);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSubmit() {
    if (!form.title.trim()) { setError('El título es obligatorio'); return; }
    if (!form.event_date) { setError('La fecha es obligatoria'); return; }
    setError('');
    setSaving(true);
    try {
      await onCreate({
        ...form,
        event_date: new Date(form.event_date).toISOString(),
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
                  onClick={() => set('category', form.category === cat ? '' : cat)}
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
              Ubicación <span className="text-slate-600">(opcional)</span>
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

          {error && (
            <p className="text-red-400 text-sm font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">
              {error}
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={saving || !form.title.trim()}
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
const COMMUNITY_CATEGORIES = ['Música', 'Deporte', 'Tecnología', 'Arte', 'Viajes', 'Cocina', 'Juego', 'Bienestar', 'Fotografía', 'Otro'];
const ALL_COMMUNITY_CATEGORIES = 'Todo';
const COMMUNITY_CATEGORY_FILTERS = [ALL_COMMUNITY_CATEGORIES, ...COMMUNITY_CATEGORIES];
const KNOWN_COMMUNITY_CATEGORIES = COMMUNITY_CATEGORIES.filter(cat => cat !== 'Otro');

function matchesCommunityCategory(community, selectedCategory) {
  if (selectedCategory === ALL_COMMUNITY_CATEGORIES) return true;

  const category = (community.category || '').trim();
  if (selectedCategory === 'Otro') {
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
    organization: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const emoji = getCommunityEmoji(form.category);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSubmit() {
    if (!form.name.trim()) { setError('El nombre es obligatorio'); return; }
    setError('');
    setSaving(true);
    try {
      await onCreate(form);
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
                  onClick={() => set('category', form.category === cat ? '' : cat)}
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
            disabled={saving || !form.name.trim()}
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

  const [tab, setTab] = useState('events'); // 'events' | 'communities'
  const [events, setEvents] = useState([]);
  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [showCreateCommunity, setShowCreateCommunity] = useState(false);
  const [communitySearch, setCommunitySearch] = useState('');
  const [communityCategoryFilter, setCommunityCategoryFilter] = useState(ALL_COMMUNITY_CATEGORIES);

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

  // ── Actions ─────────────────────────────────────────────────────────────────
  async function handleCreateEvent(form) {
    const data = await api.post('/community/events', form);
    showToast('¡Evento creado! 🌐', 'success');
    await fetchEvents();
    return data;
  }

  async function handleCreateCommunity(form) {
    const data = await api.post('/community/communities', form);
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
    } catch (e) {
      showToast(e.message || 'Error al unirse', 'error');
    }
  }

  async function handleLeaveCommunity(communityId) {
    try {
      await api.post(`/community/communities/${communityId}/leave`, {});
      showToast('Has salido de la comunidad', 'success');
      await fetchCommunities();
    } catch (e) {
      showToast(e.message || 'Error al salir de la comunidad', 'error');
    }
  }

  const sortedEvents = sortEventsByProximity(events);
  const planningEvents = sortEventsByProximity(events.filter(event => (
    isUpcomingEvent(event) && event.attendee_ids?.includes(profile?.id)
  )));
  const headerSubtitle = tab === 'events'
    ? `${events.length} eventos`
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
              className={`flex-1 py-2 rounded-lg text-xs font-display font-semibold transition-all ${
                tab === 'communities'
                  ? 'bg-accent-primary text-white shadow-sm'
                  : 'text-surface-muted hover:text-surface-text'
              }`}
            >
              👥 Comunidades
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
              <h2 className="font-display font-bold text-surface-text text-lg">Eventos por proximidad</h2>
              <p className="text-xs text-surface-muted">Los eventos más cercanos aparecen primero</p>
            </div>

            {sortedEvents.length === 0 ? (
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
            ) : (
              <div className="space-y-3">
                {sortedEvents.map(event => (
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
