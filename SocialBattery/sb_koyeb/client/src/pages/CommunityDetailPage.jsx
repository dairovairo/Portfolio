import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';

function normalizeText(value = '') {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getEventEmoji(category = '') {
  const c = normalizeText(category);
  if (/musica|concierto|concert/.test(c)) return '🎵';
  if (/deporte|sport|futbol|tenis|running/.test(c)) return '⚽';
  if (/arte|art|exposicion|museo/.test(c)) return '🎨';
  if (/tecnologia|tech|hacking|codigo/.test(c)) return '💻';
  if (/comida|food|gastro|cocina|cena/.test(c)) return '🍽️';
  if (/fiesta|party|celebracion/.test(c)) return '🎉';
  if (/naturaleza|nature|senderismo|hiking/.test(c)) return '🌿';
  if (/cine|film|pelicula|movie/.test(c)) return '🎬';
  if (/juego|gaming|videojuego/.test(c)) return '🎮';
  if (/yoga|meditacion|bienestar|wellness/.test(c)) return '🧘';
  if (/fotografia|photo/.test(c)) return '📷';
  if (/lectura|libro|book|literatura/.test(c)) return '📚';
  return '🌐';
}

function getCommunityEmoji(category = '') {
  const c = normalizeText(category);
  if (/musica/.test(c)) return '🎵';
  if (/deporte|sport/.test(c)) return '⚽';
  if (/tecnologia|tech|codigo/.test(c)) return '💻';
  if (/arte|art/.test(c)) return '🎨';
  if (/viajes|travel/.test(c)) return '✈️';
  if (/cocina|food/.test(c)) return '👨‍🍳';
  if (/juego|gaming/.test(c)) return '🎮';
  if (/bienestar|yoga/.test(c)) return '🧘';
  if (/fotografia|photo/.test(c)) return '📷';
  return '👥';
}

function formatEventDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = d - now;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs < 0) {
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 0) return `Hoy · ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  if (diffDays === 1) return `Mañana · ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  if (diffDays < 7) return d.toLocaleDateString('es-ES', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
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

const EVENT_CATEGORIES = ['Música', 'Deporte', 'Arte', 'Tecnología', 'Comida', 'Fiesta', 'Naturaleza', 'Cine', 'Juego', 'Yoga', 'Fotografía', 'Lectura', 'Otro'];

function EventCard({ event, currentUserId, onJoin, onLeave, onLike }) {
  const [busy, setBusy] = useState(false);
  const [liking, setLiking] = useState(false);
  const isJoined = event.attendee_ids?.includes(currentUserId);
  const isPast = new Date(event.event_date) < new Date();
  const isLiked = Boolean(event.liked_by_current_user);
  const emoji = getEventEmoji(event.category);
  const daysLabel = getDaysUntilLabel(event.event_date);

  async function run(action, e) {
    e?.stopPropagation();
    if (!action) return;
    setBusy(true);
    try {
      await action(event.id);
    } finally {
      setBusy(false);
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
    <div className="bg-surface-card border border-surface-border rounded-2xl p-4 transition-all hover:border-accent-primary/30">
      <div className="flex gap-3">
        <div className="w-11 h-11 rounded-2xl bg-surface-bg flex items-center justify-center text-2xl flex-shrink-0 border border-surface-border">
          {emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <h3 className="font-display font-bold text-surface-text text-sm leading-snug flex-1">
              {event.title}
            </h3>
            {event.category && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent-primary/10 text-accent-glow border border-accent-primary/20">
                {event.category}
              </span>
            )}
          </div>
          <p className="text-xs text-surface-muted mt-0.5">
            por <span className="text-accent-glow/80">{event.creator_name || 'Alguien'}</span>
            {event.organization && (
              <span> · org <span className="text-amber-300/90">{event.organization}</span></span>
            )}
          </p>
          {event.description && (
            <p className="text-xs text-surface-muted mt-1.5 leading-relaxed">{event.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-xs text-slate-500 font-mono">📅 {formatEventDate(event.event_date)}</span>
            {daysLabel && <span className="text-xs text-amber-300/90 font-mono">⏳ {daysLabel}</span>}
            {event.location && <span className="text-xs text-slate-500 font-mono">📍 {event.location}</span>}
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-xs text-slate-500 font-mono">👥 {event.attendee_count || 0} apuntados</span>
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
              {liking ? '...' : `${isLiked ? '♥' : '♡'} ${event.like_count || 0}`}
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {isJoined ? (
              <>
                <span className="text-xs font-mono text-green-400 px-3 py-1.5 rounded-xl bg-green-500/10 border border-green-500/20">
                  ✓ Apuntado
                </span>
                <button
                  onClick={e => run(onLeave, e)}
                  disabled={busy}
                  className="text-xs font-display font-semibold px-3 py-1.5 rounded-xl border border-red-500/25 text-red-300 hover:bg-red-500/10 transition-all disabled:opacity-50"
                >
                  {busy ? '...' : 'Salir'}
                </button>
              </>
            ) : isPast ? (
              <span className="text-xs font-mono text-slate-600 px-3 py-1.5 rounded-xl bg-surface-bg border border-surface-border">
                Evento pasado
              </span>
            ) : (
              <button
                onClick={e => run(onJoin, e)}
                disabled={busy}
                className="text-xs font-display font-semibold px-4 py-1.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white transition-all disabled:opacity-50"
              >
                {busy ? '...' : '+ Apuntarme'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateCommunityEventModal({ onClose, onCreate, communityName, communityOrganization }) {
  const minDate = new Date(Date.now() + 30 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const defaultDate = `${minDate.getFullYear()}-${pad(minDate.getMonth() + 1)}-${pad(minDate.getDate())}T${pad(minDate.getHours())}:${pad(minDate.getMinutes())}`;
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    organization: communityOrganization || '',
    event_date: defaultDate,
    location: '',
    max_attendees: 50,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSubmit() {
    if (!form.title.trim()) { setError('El título es obligatorio'); return; }
    setSaving(true);
    setError('');
    try {
      await onCreate({
        ...form,
        event_date: new Date(form.event_date).toISOString(),
        max_attendees: parseInt(form.max_attendees, 10) || 50,
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
        <div className="flex items-center gap-3 mb-6">
          <span className="text-3xl">{getEventEmoji(form.category)}</span>
          <div>
            <h2 className="font-display font-bold text-surface-text text-lg">Publicar evento</h2>
            <p className="text-xs text-surface-muted">{communityName}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">Título *</label>
            <input
              value={form.title}
              onChange={e => set('title', e.target.value)}
              maxLength={120}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
          </div>
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
          <textarea
            value={form.description}
            onChange={e => set('description', e.target.value)}
            placeholder="Descripción"
            rows={3}
            maxLength={500}
            className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors resize-none"
          />
          <input
            value={form.organization}
            onChange={e => set('organization', e.target.value)}
            placeholder="Organización que crea el evento (opcional)"
            maxLength={120}
            className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              type="datetime-local"
              value={form.event_date}
              min={defaultDate}
              onChange={e => set('event_date', e.target.value)}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-3 text-surface-text text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
            <input
              type="number"
              value={form.max_attendees}
              min={2}
              max={10000}
              onChange={e => set('max_attendees', e.target.value)}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
          </div>
          <input
            value={form.location}
            onChange={e => set('location', e.target.value)}
            placeholder="Ubicación"
            maxLength={200}
            className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
          />
          {error && <p className="text-red-400 text-sm font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">{error}</p>}
          <button
            onClick={handleSubmit}
            disabled={saving || !form.title.trim()}
            className="w-full py-3.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white font-display font-bold text-sm transition-all disabled:opacity-50"
          >
            {saving ? 'Creando...' : 'Publicar evento'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EventSection({ title, empty, events, currentUserId, onJoin, onLeave, onLike }) {
  const sortedEvents = sortEventsByProximity(events);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display font-bold text-surface-text text-base">{title}</h2>
        <p className="text-xs text-surface-muted">{sortedEvents.length} eventos</p>
      </div>
      {sortedEvents.length === 0 ? (
        <div className="text-center py-8 border border-surface-border rounded-2xl bg-surface-card">
          <p className="text-sm text-surface-muted">{empty}</p>
        </div>
      ) : (
        sortedEvents.map(event => (
          <EventCard
            key={event.id}
            event={event}
            currentUserId={currentUserId}
            onJoin={onJoin}
            onLeave={onLeave}
            onLike={onLike}
          />
        ))
      )}
    </section>
  );
}

export default function CommunityDetailPage() {
  const { communityId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [community, setCommunity] = useState(null);
  const [currentEvents, setCurrentEvents] = useState([]);
  const [pastEvents, setPastEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateEvent, setShowCreateEvent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/community/communities/${communityId}`);
      setCommunity(data.community);
      setCurrentEvents(data.current_events || []);
      setPastEvents(data.past_events || []);
    } catch (e) {
      showToast(e.message || 'Error cargando comunidad', 'error');
    } finally {
      setLoading(false);
    }
  }, [communityId, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreateEvent(form) {
    await api.post('/community/events', { ...form, community_id: communityId });
    showToast('Evento publicado', 'success');
    await load();
  }

  async function handleJoinCommunity() {
    try {
      await api.post(`/community/communities/${communityId}/join`, {});
      showToast('Te has unido a la comunidad', 'success');
      await load();
    } catch (e) {
      showToast(e.message || 'Error al unirse', 'error');
    }
  }

  async function handleLeaveCommunity() {
    try {
      await api.post(`/community/communities/${communityId}/leave`, {});
      showToast('Has salido de la comunidad', 'success');
      navigate('/community');
    } catch (e) {
      showToast(e.message || 'Error al salir de la comunidad', 'error');
    }
  }

  async function handleJoinEvent(eventId) {
    try {
      await api.post(`/community/events/${eventId}/join`, {});
      showToast('Te has apuntado al evento', 'success');
      await load();
    } catch (e) {
      showToast(e.message || 'Error al apuntarse', 'error');
    }
  }

  async function handleLeaveEvent(eventId) {
    try {
      await api.post(`/community/events/${eventId}/leave`, {});
      showToast('Has salido del evento', 'success');
      await load();
    } catch (e) {
      showToast(e.message || 'Error al salir del evento', 'error');
    }
  }

  async function handleLikeEvent(eventId) {
    try {
      await api.post(`/community/events/${eventId}/like`, {});
      await load();
    } catch (e) {
      showToast(e.message || 'Error al cambiar el like', 'error');
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-bg noise flex items-center justify-center">
        <p className="text-surface-muted font-mono text-sm">Cargando...</p>
        <BottomNav />
      </div>
    );
  }

  if (!community) {
    return (
      <div className="min-h-screen bg-surface-bg noise flex items-center justify-center px-4">
        <div className="text-center">
          <p className="font-display font-bold text-surface-text mb-3">Comunidad no encontrada</p>
          <button onClick={() => navigate('/community')} className="px-5 py-2 rounded-xl bg-accent-primary text-white text-sm font-display font-semibold">
            Volver
          </button>
        </div>
        <BottomNav />
      </div>
    );
  }

  const emoji = getCommunityEmoji(community.category);

  return (
    <div className="min-h-screen bg-surface-bg noise">
      <header className="sticky top-0 z-40 bg-surface-bg/90 backdrop-blur-xl border-b border-surface-border pt-safe">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate('/community')}
            className="w-9 h-9 rounded-xl border border-surface-border text-surface-text flex items-center justify-center"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-surface-text text-lg truncate">{community.name}</h1>
            <p className="text-xs text-surface-muted font-mono">
              {community.member_count || 0} miembros{community.is_admin ? ' · admin' : ''}
            </p>
          </div>
          {community.is_admin && (
            <button
              onClick={() => setShowCreateEvent(true)}
              className="px-3 py-2 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white text-xs font-display font-semibold transition-all"
            >
              + Evento
            </button>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 pb-28 pt-4 space-y-6">
        <section className="bg-surface-card border border-surface-border rounded-2xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-2xl bg-surface-bg border border-surface-border flex items-center justify-center text-3xl">
              {emoji}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {community.category && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-bg text-surface-muted border border-surface-border">
                    {community.category}
                  </span>
                )}
                {community.organization && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent-primary/10 text-accent-glow border border-accent-primary/20">
                    {community.organization}
                  </span>
                )}
              </div>
              {community.description && (
                <p className="text-sm text-surface-muted mt-2 leading-relaxed">{community.description}</p>
              )}
              <p className="text-xs text-surface-muted font-mono mt-2">
                Creada por {community.creator_name || 'Alguien'}
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            {community.is_member ? (
              <button
                onClick={handleLeaveCommunity}
                className="px-4 py-2 rounded-xl border border-red-500/25 text-red-300 hover:bg-red-500/10 text-xs font-display font-semibold transition-all"
              >
                Salir de la comunidad
              </button>
            ) : (
              <button
                onClick={handleJoinCommunity}
                className="px-4 py-2 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white text-xs font-display font-semibold transition-all"
              >
                Unirse
              </button>
            )}
          </div>
        </section>

        <EventSection
          title="Eventos actuales"
          empty="No hay eventos activos en esta comunidad."
          events={currentEvents}
          currentUserId={profile?.id}
          onJoin={handleJoinEvent}
          onLeave={handleLeaveEvent}
          onLike={handleLikeEvent}
        />
        <EventSection
          title="Eventos pasados"
          empty="Todavía no hay eventos pasados."
          events={pastEvents}
          currentUserId={profile?.id}
          onJoin={handleJoinEvent}
          onLeave={handleLeaveEvent}
          onLike={handleLikeEvent}
        />
      </main>

      {showCreateEvent && (
        <CreateCommunityEventModal
          communityName={community.name}
          communityOrganization={community.organization}
          onClose={() => setShowCreateEvent(false)}
          onCreate={handleCreateEvent}
        />
      )}

      <BottomNav />
    </div>
  );
}
