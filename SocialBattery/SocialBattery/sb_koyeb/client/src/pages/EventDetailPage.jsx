import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useCommunityNotifications } from '../context/CommunityNotificationsContext';
import { api } from '../lib/api';
import ReminderBellButton, { DEFAULT_EVENT_REMINDER_MINUTES } from '../components/ReminderBellButton';
import LocationMapView from '../components/LocationMapView';
import { generateEventStoryBlob, shareOrDownloadBlob } from '../lib/instagramStory';

// ── Helpers ───────────────────────────────────────────────────────────────────
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

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'ahora mismo';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `hace ${diffD}d`;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function getDaysLabel(dateStr) {
  if (!dateStr) return null;
  const diffMs = new Date(dateStr).getTime() - Date.now();
  if (diffMs < 0) return null;
  const days = Math.ceil(diffMs / 86400000);
  if (days === 0) return 'Empieza hoy';
  if (days === 1) return 'Mañana';
  return `En ${days} días`;
}

function getEventEmoji(category = '') {
  const c = (category ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
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

// ── Info Row ──────────────────────────────────────────────────────────────────
function InfoRow({ icon, label, children }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-surface-border last:border-0">
      <span className="text-lg flex-shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-mono text-surface-muted uppercase tracking-wider mb-0.5">{label}</p>
        <div className="text-sm text-surface-text">{children}</div>
      </div>
    </div>
  );
}

// ── Update bubble ─────────────────────────────────────────────────────────────
function UpdateBubble({ update, isOwn, onDelete }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="bg-surface-card border border-surface-border rounded-2xl rounded-tl-sm overflow-hidden">
        {update.image_url && (
          <div className="w-full">
            <img
              src={update.image_url}
              alt="Foto del evento"
              className="w-full max-h-72 object-cover"
            />
          </div>
        )}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-xs font-display font-semibold text-accent-glow">
              📣 {update.creator?.display_name || update.creator?.username || 'Organizador'}
            </span>
            <span className="text-[10px] font-mono text-surface-muted flex-shrink-0">
              {formatRelative(update.created_at)}
            </span>
          </div>
          {update.content && (
            <p className="text-sm text-surface-text leading-relaxed whitespace-pre-wrap">{update.content}</p>
          )}
        </div>
      </div>
      {isOwn && (
        <button
          onClick={() => onDelete(update.id)}
          className="self-end text-[10px] font-mono text-slate-600 hover:text-red-400 transition-colors px-2"
        >
          Eliminar
        </button>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function EventDetailPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const { eventsWithUpdates, clearEventUpdateBadge, refreshJoinedCommunities } = useCommunityNotifications();

  const [event, setEvent] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [liking, setLiking] = useState(false);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [sharingStory, setSharingStory] = useState(false);

  // update thread composer
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);   // File object
  const [imagePreview, setImagePreview] = useState(null);     // Data URL for preview
  const textareaRef = useRef(null);
  const updatesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchEvent = useCallback(async () => {
    try {
      const data = await api.get(`/community/events/${eventId}`);
      setEvent(data.event);
    } catch {
      showToast('Evento no encontrado', 'error');
      navigate('/community');
    }
  }, [eventId, showToast, navigate]);

  const fetchUpdates = useCallback(async () => {
    try {
      const data = await api.get(`/community/events/${eventId}/updates`);
      setUpdates(data.updates || []);
    } catch {
      // non-critical
    }
  }, [eventId]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      await Promise.all([fetchEvent(), fetchUpdates()]);
      setLoading(false);
      // Al abrir el detalle del evento se marca como leído
      clearEventUpdateBadge(eventId);
    }
    load();
  }, [fetchEvent, fetchUpdates, eventId, clearEventUpdateBadge]);

  useEffect(() => {
    updatesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [updates.length]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const isCreator = event?.creator_id === profile?.id;
  const isJoined  = event?.attendee_ids?.includes(profile?.id);
  const isLiked   = Boolean(event?.liked_by_current_user);
  const isPast    = event ? new Date(event.ends_at || event.event_date) < new Date() : false;
  const isFree    = !event?.price || parseFloat(event?.price) === 0;
  const daysLabel = event ? getDaysLabel(event.event_date) : null;

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleShareStory() {
    if (sharingStory || !event) return;
    setSharingStory(true);
    try {
      const blob = await generateEventStoryBlob({
        event,
        attendeeCount: event.attendee_count || 0,
        likeCount: event.like_count || 0,
      });
      const result = await shareOrDownloadBlob(blob, 'evento-sb.png', `${event.title} · SocialBattery`);
      if (result.method === 'download') {
        showToast('Imagen descargada. ¡Súbela a tu historia! 📸', 'success');
      } else if (result.method === 'share') {
        showToast('¡Historia lista para compartir! 🚀', 'success');
      }
    } catch (e) {
      showToast('Error al generar la historia', 'error');
    } finally {
      setSharingStory(false);
    }
  }

  async function handleJoin() {
    if (joining || isJoined || isPast) return;
    setJoining(true);
    try {
      await api.post(`/community/events/${eventId}/join`, {});
      showToast('¡Apuntado al evento! 📅', 'success');
      await fetchEvent();
      refreshJoinedCommunities(); // actualiza attendingEventIdsRef para recibir badges
    } catch (e) {
      showToast(e.message || 'Error al apuntarse', 'error');
    } finally { setJoining(false); }
  }

  async function handleLeave() {
    if (leaving || !isJoined) return;
    setLeaving(true);
    try {
      await api.post(`/community/events/${eventId}/leave`, {});
      showToast('Has salido del evento', 'success');
      await fetchEvent();
      refreshJoinedCommunities(); // actualiza attendingEventIdsRef
    } catch (e) {
      showToast(e.message || 'Error al salir', 'error');
    } finally { setLeaving(false); }
  }

  async function handleLike() {
    if (liking) return;
    setLiking(true);
    try {
      await api.post(`/community/events/${eventId}/like`, {});
      await fetchEvent();
    } catch (e) {
      showToast(e.message || 'Error', 'error');
    } finally { setLiking(false); }
  }

  async function handleReminderChange(minutes) {
    if (reminderSaving || !isJoined || isPast) return;
    setReminderSaving(true);
    try {
      const data = await api.patch(`/community/events/${eventId}/reminder`, {
        reminder_minutes_before: minutes,
      });
      const nextMinutes = data.reminder_minutes_before || minutes;
      setEvent(prev => prev ? {
        ...prev,
        current_user_reminder_minutes_before: nextMinutes,
      } : prev);
      showToast('Aviso actualizado', 'success');
    } catch (e) {
      showToast(e.message || 'Error al cambiar el aviso', 'error');
    } finally { setReminderSaving(false); }
  }

  function handleImageSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedImage(file);
    const reader = new FileReader();
    reader.onload = ev => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
    // reset input so the same file can be re-selected
    e.target.value = '';
  }

  function handleRemoveImage() {
    setSelectedImage(null);
    setImagePreview(null);
  }

  async function handlePostUpdate() {
    const hasText = draft.trim();
    const hasImage = !!selectedImage;
    if ((!hasText && !hasImage) || posting) return;
    setPosting(true);
    try {
      if (hasImage) {
        const formData = new FormData();
        if (hasText) formData.append('content', hasText);
        formData.append('image', selectedImage);
        await api.postForm(`/community/events/${eventId}/updates`, formData);
      } else {
        await api.post(`/community/events/${eventId}/updates`, { content: hasText });
      }
      setDraft('');
      setSelectedImage(null);
      setImagePreview(null);
      await fetchUpdates();
    } catch (e) {
      showToast(e.message || 'Error al publicar', 'error');
    } finally { setPosting(false); }
  }

  async function handleDeleteUpdate(updateId) {
    try {
      await api.delete(`/community/events/${eventId}/updates/${updateId}`);
      setUpdates(prev => prev.filter(u => u.id !== updateId));
    } catch (e) {
      showToast(e.message || 'Error al eliminar', 'error');
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-surface-bg noise flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-pulse">🌐</div>
          <p className="text-surface-muted font-mono text-sm">Cargando evento...</p>
        </div>
      </div>
    );
  }

  if (!event) return null;

  const emoji = getEventEmoji(event.category);

  return (
    <div className="min-h-screen bg-surface-bg noise">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-surface-bg/90 backdrop-blur-xl border-b border-surface-border pt-safe">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-surface-border text-surface-muted hover:text-surface-text hover:border-accent-primary/40 transition-all flex-shrink-0"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-surface-text text-base truncate">{event.title}</h1>
            <p className="text-xs font-mono text-surface-muted truncate">
              {event.category ? `${emoji} ${event.category}` : emoji}
              {daysLabel && <span className="text-amber-300/80"> · {daysLabel}</span>}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 pb-28 pt-4 space-y-4">

        {/* Cover */}
        {event.cover_image_url && (
          <div className="relative aspect-[16/9] overflow-hidden rounded-2xl border border-surface-border bg-surface-bg">
            <img src={event.cover_image_url} alt="" className="h-full w-full object-cover" />
            {eventsWithUpdates.has(eventId) && (
              <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm text-white text-xs font-display font-semibold px-2.5 py-1 rounded-full shadow-lg">
                <span>📣</span>
                <span>Nuevo aviso</span>
              </div>
            )}
          </div>
        )}

        {/* Title + status badges */}
        <div className="relative bg-surface-card border border-surface-border rounded-2xl p-4">
          {/* Badge de actualización no leída */}
          {eventsWithUpdates.has(eventId) && (
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none shadow-lg z-10">
              📣
            </span>
          )}
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-surface-bg border border-surface-border flex items-center justify-center text-2xl flex-shrink-0">
              {emoji}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-display font-bold text-surface-text text-lg leading-snug">{event.title}</h2>
              <p className="text-xs text-surface-muted mt-0.5">
                por <span className="text-accent-glow/80">{event.creator_name || 'Alguien'}</span>
                {event.community_name && (
                  <span> · <span className="text-accent-glow">{event.community_name}</span></span>
                )}
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {event.category && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent-primary/10 text-accent-glow border border-accent-primary/20">
                    {event.category}
                  </span>
                )}
                {isFree ? (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                    ✓ Gratis
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                    💳 {parseFloat(event.price).toFixed(2)}€
                  </span>
                )}
                {isPast && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-bg text-slate-500 border border-surface-border">
                    Pasado
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-surface-border">
            <div className="text-center">
              <p className="text-base font-display font-bold text-surface-text">{event.attendee_count || 0}</p>
              <p className="text-[10px] font-mono text-surface-muted">planificaciones</p>
            </div>
            <div className="text-center">
              <p className="text-base font-display font-bold text-surface-text">{event.like_count || 0}</p>
              <p className="text-[10px] font-mono text-surface-muted">likes</p>
            </div>
            <div className="text-center">
              <p className="text-base font-display font-bold text-surface-text">{updates.length}</p>
              <p className="text-[10px] font-mono text-surface-muted">actualizaciones</p>
            </div>
            <div className="ml-auto">
              <button
                onClick={handleShareStory}
                disabled={sharingStory}
                title="Compartir evento"
                className="flex items-center justify-center w-9 h-9 rounded-xl border border-surface-border text-surface-muted hover:border-pink-500/40 hover:text-pink-300 hover:bg-pink-500/5 transition-all disabled:opacity-50"
              >
                {sharingStory
                  ? <span className="animate-spin text-xs">⏳</span>
                  : <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                    </svg>
                }
              </button>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleLike}
            disabled={liking}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl border text-sm font-display font-semibold transition-all disabled:opacity-50 ${
              isLiked
                ? 'border-pink-500/40 bg-pink-500/15 text-pink-300'
                : 'border-surface-border bg-surface-card text-slate-400 hover:border-pink-500/30 hover:text-pink-300'
            }`}
          >
            {isLiked ? '♥' : '♡'} {event.like_count || 0}
          </button>

          <div className="flex-1">
            {isPast ? (
              <div className="w-full py-2.5 rounded-xl bg-surface-card border border-surface-border text-center text-sm font-mono text-slate-500">
                Evento finalizado
              </div>
            ) : isJoined ? (
              <div className="flex gap-2">
                <div className="flex-1 py-2.5 rounded-xl bg-green-500/10 border border-green-500/20 text-center text-sm font-display font-semibold text-green-400">
                  📅 Apuntado
                </div>
                <ReminderBellButton
                  value={event.current_user_reminder_minutes_before}
                  defaultMinutes={DEFAULT_EVENT_REMINDER_MINUTES}
                  saving={reminderSaving}
                  onChange={handleReminderChange}
                />
                <button
                  onClick={handleLeave}
                  disabled={leaving}
                  className="px-4 py-2.5 rounded-xl border border-red-500/25 text-red-300 text-sm font-display font-semibold hover:bg-red-500/10 transition-all disabled:opacity-50"
                >
                  {leaving ? '...' : 'Salir'}
                </button>
              </div>
            ) : (
              <button
                onClick={handleJoin}
                disabled={joining || (event.attendee_count >= event.max_attendees)}
                className="w-full py-2.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white text-sm font-display font-bold transition-all disabled:opacity-50 active:scale-[0.98]"
              >
                {joining ? '...' : event.attendee_count >= event.max_attendees ? 'Completo' : '📅 Apuntarme'}
              </button>
            )}
          </div>
        </div>

        {/* Event details */}
        <div className="bg-surface-card border border-surface-border rounded-2xl px-4">

          {event.description && (
            <InfoRow icon="📝" label="Descripción">
              <p className="leading-relaxed text-surface-text/90 whitespace-pre-wrap">{event.description}</p>
            </InfoRow>
          )}

          <InfoRow icon="📅" label="Fecha de inicio">
            <span>{formatDateTime(event.event_date)}</span>
          </InfoRow>

          {event.ends_at && (
            <InfoRow icon="🏁" label="Fecha de fin">
              <span>{formatDateTime(event.ends_at)}</span>
            </InfoRow>
          )}

          <InfoRow icon="📍" label="Ubicación">
            <span>{event.location || '—'}</span>
          </InfoRow>

          {event.lat != null && event.lng != null && (
            <div className="mt-1 mb-1">
              <LocationMapView lat={event.lat} lng={event.lng} label={event.location} />
            </div>
          )}

          {event.organization && (
            <InfoRow icon="🏢" label="Organización">
              <span className="text-amber-300/90">{event.organization}</span>
            </InfoRow>
          )}

          <InfoRow icon={isFree ? '✓' : '💳'} label="Precio">
            {isFree
              ? <span className="text-green-400 font-semibold">Gratis</span>
              : <span className="text-amber-300 font-semibold">{parseFloat(event.price).toFixed(2)} €</span>
            }
          </InfoRow>

          {event.url && ensureAbsoluteUrl(event.url) && (
            <InfoRow icon="🔗" label="Enlace">
              <a
                href={ensureAbsoluteUrl(event.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-glow hover:underline break-all"
              >
                {event.url}
              </a>
            </InfoRow>
          )}

          {event.additional_info && (
            <InfoRow icon="ℹ️" label="Información adicional">
              <p className="leading-relaxed text-surface-text/90 whitespace-pre-wrap">{event.additional_info}</p>
            </InfoRow>
          )}
        </div>

        {/* Thread / Updates ─────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-display font-bold text-surface-text">Actualizaciones del evento</h3>
              <p className="text-xs text-surface-muted">El organizador puede publicar novedades aquí</p>
            </div>
            {updates.length > 0 && (
              <span className="text-xs font-mono text-surface-muted bg-surface-card border border-surface-border px-2 py-1 rounded-lg">
                {updates.length}
              </span>
            )}
          </div>

          {/* Updates list */}
          {updates.length === 0 ? (
            <div className="text-center py-8 bg-surface-card border border-surface-border rounded-2xl">
              <p className="text-2xl mb-2">📢</p>
              <p className="text-sm text-surface-muted">Sin actualizaciones todavía</p>
              {isCreator && (
                <p className="text-xs text-surface-muted mt-1">Usa el formulario de abajo para informar a los asistentes</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {updates.map(update => (
                <UpdateBubble
                  key={update.id}
                  update={update}
                  isOwn={update.creator_id === profile?.id}
                  onDelete={handleDeleteUpdate}
                />
              ))}
              <div ref={updatesEndRef} />
            </div>
          )}

          {/* Composer — only visible to event creator */}
          {isCreator && (
            <div className="mt-4 bg-surface-card border border-accent-primary/25 rounded-2xl p-4">
              <p className="text-xs font-mono text-accent-glow mb-2">
                📣 Publicar actualización como organizador
              </p>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageSelect}
              />

              {/* Image preview */}
              {imagePreview && (
                <div className="relative mb-3 rounded-xl overflow-hidden border border-surface-border">
                  <img
                    src={imagePreview}
                    alt="Vista previa"
                    className="w-full max-h-48 object-cover"
                  />
                  <button
                    onClick={handleRemoveImage}
                    className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full bg-black/60 text-white text-xs hover:bg-black/80 transition-colors"
                    title="Eliminar imagen"
                  >
                    ✕
                  </button>
                </div>
              )}

              <textarea
                ref={textareaRef}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder="Escribe una novedad, cambio de hora, instrucciones de acceso..."
                maxLength={2000}
                rows={3}
                className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors resize-none"
              />

              <div className="flex items-center justify-between mt-2 gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-600">{draft.length}/2000</span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    title="Adjuntar foto de la galería"
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-mono transition-all ${
                      selectedImage
                        ? 'border-accent-primary/40 bg-accent-primary/10 text-accent-glow'
                        : 'border-surface-border text-slate-500 hover:border-accent-primary/30 hover:text-accent-glow'
                    }`}
                  >
                    📷 {selectedImage ? '1 foto' : 'Foto'}
                  </button>
                </div>
                <button
                  onClick={handlePostUpdate}
                  disabled={posting || (!draft.trim() && !selectedImage)}
                  className="px-5 py-2 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white text-xs font-display font-bold transition-all disabled:opacity-50 active:scale-95"
                >
                  {posting ? 'Publicando...' : '📣 Publicar'}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
