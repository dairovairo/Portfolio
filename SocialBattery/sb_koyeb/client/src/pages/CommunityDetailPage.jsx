import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import LocationPicker from '../components/LocationPicker';
import PhotoSourceMenu from '../components/PhotoSourceMenu';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useCommunityNotifications } from '../context/CommunityNotificationsContext';
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
  // Se añade el selector de variación U+FE0F a cada emoji para forzar su
  // presentación a color (el CSS global usa font-variant-emoji: text para
  // dar un estilo mono a los iconos por defecto; sin este selector solo los
  // emojis que ya lo llevaban incorporado, como el de Comida, salían a color).
  if (/musica|concierto|concert/.test(c)) return '🎵️';
  if (/deporte|sport|futbol|tenis|running/.test(c)) return '⚽️';
  if (/arte|art|exposicion|museo/.test(c)) return '🎨️';
  if (/tecnologia|tech|hacking|codigo/.test(c)) return '💻️';
  if (/comida|food|gastro|cocina|cena/.test(c)) return '🍽️';
  if (/fiesta|party|celebracion/.test(c)) return '🎉️';
  if (/naturaleza|nature|senderismo|hiking/.test(c)) return '🌿️';
  if (/cine|film|pelicula|movie/.test(c)) return '🎬️';
  if (/juego|gaming|videojuego/.test(c)) return '🎮️';
  if (/yoga|meditacion|bienestar|wellness/.test(c)) return '🧘️';
  if (/fotografia|photo/.test(c)) return '📷️';
  if (/lectura|libro|book|literatura/.test(c)) return '📚️';
  return '🌐️';
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

const OTHER_CATEGORY = 'Otro';
const EVENT_CATEGORIES = ['Música', 'Deporte', 'Arte', 'Tecnología', 'Comida', 'Fiesta', 'Naturaleza', 'Cine', 'Juego', 'Yoga', 'Fotografía', 'Lectura', OTHER_CATEGORY];

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

function EventCard({ event, currentUserId, onJoin, onLeave, onLike }) {
  const [busy, setBusy] = useState(false);
  const [liking, setLiking] = useState(false);
  const isJoined = event.attendee_ids?.includes(currentUserId);
  const isPast = new Date(event.ends_at || event.event_date) < new Date();
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
      {event.cover_image_url && (
        <div className="mb-3 aspect-[16/9] overflow-hidden rounded-xl border border-surface-border bg-surface-bg">
          <img
            src={event.cover_image_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>
      )}

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
            <span className="text-xs text-slate-500 font-mono">📅 {formatEventDateRange(event)}</span>
            {daysLabel && <span className="text-xs text-amber-300/90 font-mono">⏳ {daysLabel}</span>}
            {event.location && <span className="text-xs text-slate-500 font-mono">📍 {event.location}</span>}
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
              {liking ? '...' : `${isLiked ? '♥' : '♡'} ${event.like_count || 0}`}
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {isJoined ? (
              <>
                <span className="text-xs font-mono text-green-400 px-3 py-1.5 rounded-xl bg-green-500/10 border border-green-500/20">
                  📅 En tu planificación
                </span>
                <button
                  onClick={e => run(onLeave, e)}
                  disabled={busy}
                  className="text-xs font-display font-semibold px-3 py-1.5 rounded-xl border border-red-500/25 text-red-300 hover:bg-red-500/10 transition-all disabled:opacity-50"
                >
                  {busy ? '...' : 'Quitar'}
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
                {busy ? '...' : '📅 Añadir a planificación'}
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
  const coverInputRef = useRef(null);
  const coverCameraRef = useRef(null);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [expandedPlan, setExpandedPlan] = useState(null); // 'basic' | 'premium' | 'ultra' | null
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    custom_category: '',
    organization: communityOrganization || '',
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
  const resolvedCategory = form.category === OTHER_CATEGORY ? form.custom_category.trim() : form.category;

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
    if (coverCameraRef.current) coverCameraRef.current.value = '';
  }

  async function handleSubmit() {
    if (!form.title.trim()) { setError('El título es obligatorio'); return; }
    if (!form.event_date) { setError('La fecha es obligatoria'); return; }
    if (!form.ends_at) { setError('La fecha fin es obligatoria'); return; }
    if (!form.location.trim()) { setError('La ubicacion es obligatoria'); return; }
    if (form.category === OTHER_CATEGORY && !form.custom_category.trim()) {
      setError('Especifica la categoria');
      return;
    }
    if (new Date(form.ends_at) <= new Date(form.event_date)) {
      setError('La fecha fin debe ser posterior al inicio');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onCreate({
        ...form,
        category: resolvedCategory,
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
          <span className="text-3xl">{getEventEmoji(resolvedCategory || form.category)}</span>
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
              placeholder="Ej: Concierto en el parque, Hackathon de verano..."
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
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              Descripción <span className="text-slate-600">(opcional)</span>
            </label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="¿De qué va el evento? ¿Qué pueden esperar los asistentes?"
              rows={3}
              maxLength={500}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              Organización <span className="text-slate-600">(opcional)</span>
            </label>
            <input
              value={form.organization}
              onChange={e => set('organization', e.target.value)}
              placeholder="Ej: Universidad, asociación, club..."
              maxLength={120}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
          </div>
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
              <label className="block text-xs font-mono text-surface-muted mb-1.5">Fin *</label>
              <input
                type="datetime-local"
                value={form.ends_at}
                min={form.event_date || defaultDate}
                onChange={e => set('ends_at', e.target.value)}
                className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-3 text-surface-text text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
              />
            </div>
          </div>
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
                  <p className="text-xs text-surface-muted mt-0.5">Listado estándar en la sección de eventos de la comunidad.</p>
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
                  <p className="text-xs text-surface-muted mt-0.5">Etiqueta ⚡ Premium · Notificación push a usuarios seleccionados de la app al publicar.</p>
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
                  <p className="text-xs text-surface-muted mt-0.5">Todo lo de Premium · Notificación push prominente a más usuarios (requiere interacción) · Insignia 🚀 Ultra.</p>
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
                      <li>· Apariciones en banner menú principal</li>
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
                  💳 El pago se efectuará tras el inicio del evento, en base a las notificaciones enviadas hasta su comienzo.
                </p>
                <p className="mt-2 text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  📶 Las notificaciones se enviarán conforme los usuarios estén disponibles para notificar.
                </p>
                <p className="mt-2 text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  🎯 Todas las promociones se realizan en base a algoritmos de cercanía e intereses.
                </p>
                <p className="mt-2 text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  🔁 En cada promoción cada usuario se notifica una vez, para que usuarios ya notificados vuelvan a serlo, se debe renovar la promoción desde el evento creado.
                </p>
                <p className="mt-2 text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  💶 La promoción se cobrará al empezar el evento automáticamente o al renovar la promoción.
                </p>
              </>
            )}
          </div>

          {error && <p className="text-red-400 text-sm font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">{error}</p>}
          {!error && (!form.title.trim() || !form.event_date || !form.ends_at || !form.location.trim() || (form.category === OTHER_CATEGORY && !form.custom_category.trim())) && (
            <p className="text-amber-400/80 text-xs font-mono text-center">Introduce todos los campos obligatorios primero</p>
          )}
          <button
            onClick={handleSubmit}
            disabled={saving || !form.title.trim() || !form.event_date || !form.ends_at || !form.location.trim() || (form.category === OTHER_CATEGORY && !form.custom_category.trim())}
            className="w-full py-3.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98]"
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
  const { clearCommunityBadge, communitiesWithEvents } = useCommunityNotifications();
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

  // Limpiar el badge SOLO después de que la página haya cargado y se muestre al usuario
  useEffect(() => {
    if (!loading && community) {
      clearCommunityBadge(communityId);
    }
  }, [loading, community, communityId, clearCommunityBadge]);

  async function handleCreateEvent(form) {
    await api.postForm('/community/events', buildEventFormData(form, { community_id: communityId }));
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
            <div className="flex items-center gap-2">
              <h1 className="font-display font-bold text-surface-text text-lg truncate">{community.name}</h1>
              {communitiesWithEvents.has(communityId) && (
                <span className="flex-shrink-0 w-2.5 h-2.5 bg-red-500 rounded-full" />
              )}
            </div>
            <p className="text-xs text-surface-muted font-mono">
              {community.member_count || 0} miembros{community.is_admin ? ' · admin' : ''}
            </p>
          </div>
          <button
            onClick={() => navigate(`/messages/community/${communityId}`)}
            className="w-9 h-9 flex-shrink-0 rounded-xl border border-surface-border text-surface-text flex items-center justify-center hover:bg-surface-card transition-colors"
            title="Chat de la comunidad"
          >
            💬
          </button>

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
