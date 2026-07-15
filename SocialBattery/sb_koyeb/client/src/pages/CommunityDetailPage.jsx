import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import LocationPicker from '../components/LocationPicker';
import PhotoSourceMenu from '../components/PhotoSourceMenu';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useCommunityNotifications } from '../context/CommunityNotificationsContext';
import { useSettings } from '../context/SettingsContext';
import { api } from '../lib/api';
import { shareOrDownloadBlob } from '../lib/instagramStory';
import { CATEGORIES, OTHER_CATEGORY, getCategoryEmoji } from '../constants/categories';

function normalizeText(value = '') {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Mismo listado y mismos emojis que en CommunityPage (ver
// src/constants/categories.js), para que categorías e intereses coincidan
// en toda la app.
const getEventEmoji = getCategoryEmoji;
const getCommunityEmoji = getCategoryEmoji;

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

const MAX_CATEGORIES = 3;
// Mismo listado que en CommunityPage (ver src/constants/categories.js).
const EVENT_CATEGORIES = [...CATEGORIES.map(c => c.id), OTHER_CATEGORY];
const COMMUNITY_CATEGORIES = [...CATEGORIES.map(c => c.id), OTHER_CATEGORY];

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

function EventCard({ event, currentUserId, onJoin, onLeave, onLike }) {
  const [busy, setBusy] = useState(false);
  const [liking, setLiking] = useState(false);
  const isJoined = event.attendee_ids?.includes(currentUserId);
  const isPast = new Date(event.ends_at || event.event_date) < new Date();
  const isLiked = Boolean(event.liked_by_current_user);
  const eventCategories = getEntityCategories(event);
  const emoji = getEventEmoji(eventCategories[0]);
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
            {eventCategories.map(cat => (
              <span
                key={cat}
                className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent-primary/10 text-accent-glow border border-accent-primary/20"
              >
                {cat}
              </span>
            ))}
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

function CreateCommunityEventModal({ onClose, onCreate, communityName, communityOrganization, communityId }) {
  const navigate = useNavigate();
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
    categories: [],
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
  const resolvedCategories = form.categories
    .map(cat => (cat === OTHER_CATEGORY ? form.custom_category.trim() : cat))
    .filter(Boolean);

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
    setError('');

    const baseDraft = {
      ...form,
      categories: resolvedCategories,
      cover_file: coverFile,
      event_date: new Date(form.event_date).toISOString(),
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
    };

    // Premium / Ultra: se afinan plan y notificaciones en la pantalla
    // dedicada de publicidad (EventAdConfigPage). Al enviar el draft,
    // adjuntamos `communityId` + `communityName` para que la creación
    // final quede vinculada a esta comunidad y para poder volver aquí
    // al terminar.
    if (baseDraft.promotion_plan === 'premium' || baseDraft.promotion_plan === 'ultra') {
      onClose();
      navigate('/community/event-publicidad', {
        state: {
          draft: {
            ...baseDraft,
            communityId,
            communityName,
          },
        },
      });
      return;
    }

    setSaving(true);
    try {
      await onCreate(baseDraft);
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
          <span className="text-3xl">{getEventEmoji(resolvedCategories[0])}</span>
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
              <p className="mt-2 text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                🎯 El plan y el número de notificaciones a contratar se afinan en el siguiente paso, al pulsar "Configurar publicidad".
              </p>
            )}
          </div>

          {error && <p className="text-red-400 text-sm font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">{error}</p>}
          {!error && (!form.title.trim() || !form.event_date || !form.ends_at || !form.location.trim() || (form.categories.includes(OTHER_CATEGORY) && !form.custom_category.trim())) && (
            <p className="text-amber-400/80 text-xs font-mono text-center">Introduce todos los campos obligatorios primero</p>
          )}
          <button
            onClick={handleSubmit}
            disabled={saving || !form.title.trim() || !form.event_date || !form.ends_at || !form.location.trim() || (form.categories.includes(OTHER_CATEGORY) && !form.custom_category.trim())}
            className="w-full py-3.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98]"
          >
            {saving ? 'Creando...' : (form.promotion_plan === 'premium' || form.promotion_plan === 'ultra') ? 'Configurar publicidad' : 'Publicar evento'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatRaffleEndLabel(dateStr) {
  if (!dateStr) return '';
  const time = new Date(dateStr).getTime();
  if (Number.isNaN(time)) return '';
  const diffMs = time - Date.now();
  if (diffMs <= 0) return 'Terminado';
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'Termina hoy';
  if (days === 1) return 'Termina mañana';
  return `Termina en ${days} días`;
}

function RaffleAvatar({ user }) {
  if (user?.avatar_url) {
    return <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover border border-surface-border" />;
  }
  return (
    <div className="w-8 h-8 rounded-full bg-accent-primary/20 border border-accent-primary/30 flex items-center justify-center text-xs font-display font-bold text-accent-glow">
      {(user?.username || '?').charAt(0).toUpperCase()}
    </div>
  );
}

// Debe coincidir con RAFFLE_TIERS en server/routes/community.js
const RAFFLE_TIER_OPTIONS = [
  {
    key: 'volt',
    label: 'Sorteo Volt',
    priceLabel: 'Gratis',
    rules: 'Participan los miembros de la comunidad con suscripción Volt de la app.',
    includes: [
      'Notificaciones a toda la comunidad',
      'Apariciones de banner esporádico al número de usuarios disponibles',
      'Duración máxima 2 semanas',
    ],
    emoji: '⚡',
  },
  {
    key: 'community',
    label: 'Sorteo Community',
    priceLabel: '5 €',
    rules: 'Participan los miembros que han colaborado con la comunidad.',
    includes: [
      'Notificaciones a toda la comunidad',
      'Apariciones de banner esporádico a todos los miembros de la comunidad',
    ],
    emoji: '🤝',
  },
  {
    key: 'light',
    label: 'Sorteo Light',
    priceLabel: '20 €',
    rules: 'Participan todos los miembros de la comunidad.',
    includes: [
      'Notificaciones a toda la comunidad',
      'Apariciones de banner esporádico al número de usuarios contratado',
    ],
    emoji: '🎫',
  },
];

function raffleTierMeta(tierKey) {
  return RAFFLE_TIER_OPTIONS.find(t => t.key === tierKey) || RAFFLE_TIER_OPTIONS[0];
}

// Color del panel al seleccionar cada tipo de sorteo en el modal de creación
// (mismo azul clarito que usa el botón "Chat" de la comunidad).
const RAFFLE_TIER_SELECTED_STYLES = {
  volt: 'border-blue-400/60 bg-blue-400/10',
  community: 'border-red-400/60 bg-red-400/10',
  light: 'border-amber-400/60 bg-amber-400/10',
};

function RaffleCard({ raffle, isCreator, onDraw, onShare }) {
  const [drawing, setDrawing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const hasEnded = new Date(raffle.ends_at) <= new Date();
  const isDrawn = Boolean(raffle.winner);

  async function runDraw() {
    setDrawing(true);
    try { await onDraw(raffle.id); } finally { setDrawing(false); }
  }

  async function runShare() {
    setSharing(true);
    try { await onShare(raffle); } finally { setSharing(false); }
  }

  return (
    <div id={`raffle-${raffle.id}`} className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden transition-shadow">
      {raffle.image_url && (
        <div className="aspect-[16/9] bg-surface-bg">
          <img src={raffle.image_url} alt={raffle.title} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="p-4 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg flex-shrink-0">🎁</span>
            <h3 className="font-display font-bold text-surface-text text-sm truncate">{raffle.title}</h3>
          </div>
          <button
            onClick={runShare}
            disabled={sharing}
            title="Compartir sorteo"
            className="flex-shrink-0 w-8 h-8 rounded-lg border border-surface-border flex items-center justify-center text-surface-muted hover:text-surface-text hover:border-accent-primary/40 transition-colors disabled:opacity-50"
          >
            {sharing ? '⏳' : '📤'}
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent-primary/10 text-accent-glow border border-accent-primary/20">
            {raffleTierMeta(raffle.tier).emoji} {raffle.tier_label || raffleTierMeta(raffle.tier).label}
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-bg text-surface-muted border border-surface-border">
            {raffle.price_cents ? `${(raffle.price_cents / 100).toFixed(2)} €` : 'Gratis'}
          </span>
        </div>

        {raffle.tier_rules && (
          <p className="text-[11px] text-surface-muted/80 italic leading-relaxed">{raffle.tier_rules}</p>
        )}

        {isCreator && ['light', 'volt', 'community'].includes(raffle.tier) && raffle.banner_views_sent != null && (
          <p className="text-[11px] text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-1.5">
            📣 {Number(raffle.banner_views_sent).toLocaleString('es-ES')}
            {raffle.banner_views_contracted ? ` / ${Number(raffle.banner_views_contracted).toLocaleString('es-ES')}` : ''} usuarios notificados
          </p>
        )}

        {raffle.description && (
          <p className="text-xs text-surface-muted leading-relaxed">{raffle.description}</p>
        )}

        <div className="flex items-center gap-3 text-[11px] font-mono text-surface-muted">
          <span className={isDrawn ? 'text-surface-muted' : hasEnded ? 'text-amber-400' : 'text-accent-glow'}>
            {isDrawn ? `Terminó el ${new Date(raffle.ends_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}` : formatRaffleEndLabel(raffle.ends_at)}
          </span>
          <span>·</span>
          <span>{raffle.participant_count ?? 0} participantes</span>
        </div>

        {isDrawn ? (
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2 mt-1">
            <RaffleAvatar user={raffle.winner} />
            <div className="min-w-0">
              <p className="text-[10px] font-mono text-amber-400/80">Ganador</p>
              <p className="text-sm font-display font-bold text-surface-text truncate">{raffle.winner?.username}</p>
            </div>
          </div>
        ) : isCreator && hasEnded ? (
          <button
            onClick={runDraw}
            disabled={drawing}
            className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-surface-bg font-display font-bold text-xs transition-all disabled:opacity-50"
          >
            {drawing ? 'Sorteando...' : '🎉 Sortear ganador'}
          </button>
        ) : !hasEnded ? (
          <p className="text-[11px] text-surface-muted italic">
            {isCreator
              ? 'Podrás sortear al ganador cuando termine el plazo.'
              : raffle.can_participate === false
                ? 'No cumples los requisitos de participación de este sorteo.'
                : 'Participas automáticamente por cumplir los requisitos de este sorteo.'}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function CreateRaffleModal({ onClose, onCreate, communityName, communityId }) {
  const navigate = useNavigate();
  const minDate = new Date(Date.now() + 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const defaultDate = `${minDate.getFullYear()}-${pad(minDate.getMonth() + 1)}-${pad(minDate.getDate())}T${pad(minDate.getHours())}:${pad(minDate.getMinutes())}`;
  const imageInputRef = useRef(null);
  const imageCameraRef = useRef(null);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [endsAt, setEndsAt] = useState(defaultDate);
  const [tier, setTier] = useState(RAFFLE_TIER_OPTIONS[0].key);
  const [showTierDetails, setShowTierDetails] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleImageChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('La foto no puede superar 5MB');
      e.target.value = '';
      return;
    }
    setImageFile(file);
    setImagePreview(await readFileAsDataUrl(file));
    setError('');
  }

  function clearImage() {
    setImageFile(null);
    setImagePreview('');
    if (imageInputRef.current) imageInputRef.current.value = '';
    if (imageCameraRef.current) imageCameraRef.current.value = '';
  }

  async function handleSubmit() {
    if (!title.trim()) { setError('El título es obligatorio'); return; }
    if (!endsAt) { setError('La fecha de fin es obligatoria'); return; }
    if (new Date(endsAt) <= new Date()) { setError('La fecha de fin debe ser en el futuro'); return; }

    const draft = {
      title: title.trim(),
      description: description.trim(),
      ends_at: new Date(endsAt).toISOString(),
      tier,
      image_file: imageFile,
      image_preview: imagePreview,
    };

    // Los sorteos Light llevan publicidad de pago: antes de crearlo, se
    // configura la audiencia (usuarios notificables / interesados) en una
    // pantalla propia. El sorteo no se crea todavía aquí — se crea al
    // confirmar en RaffleAdAudiencePage con estos mismos datos.
    if (tier === 'light') {
      onClose();
      navigate(`/community/${communityId}/raffle-publicidad`, { state: { draft, communityName } });
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onCreate(draft);
      onClose();
    } catch (e) {
      setError(e.message || 'Error al crear el sorteo');
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
          <span className="text-3xl">🎁</span>
          <div>
            <h2 className="font-display font-bold text-surface-text text-lg">Crear sorteo</h2>
            <p className="text-xs text-surface-muted">{communityName}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-mono text-surface-muted">Tipo de sorteo *</label>
              <button
                type="button"
                onClick={() => setShowTierDetails(v => !v)}
                className="text-[11px] font-mono text-accent-glow hover:text-accent-primary transition-colors"
              >
                {showTierDetails ? '− ocultar qué incluye' : '+ ver qué incluye en cada una'}
              </button>
            </div>
            <div className="space-y-2">
              {RAFFLE_TIER_OPTIONS.map(opt => {
                const selected = tier === opt.key;
                const selectedStyle = RAFFLE_TIER_SELECTED_STYLES[opt.key] || 'border-accent-primary/60 bg-accent-primary/10';
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setTier(opt.key)}
                    className={`w-full text-left rounded-xl border px-3.5 py-3 transition-all ${
                      selected
                        ? selectedStyle
                        : 'border-surface-border bg-surface-bg hover:border-accent-primary/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-sm font-display font-bold text-surface-text">
                        <span>{opt.emoji}</span> {opt.label}
                      </span>
                      <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                        opt.priceLabel === 'Gratis'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-surface-card text-surface-muted border border-surface-border'
                      }`}>
                        {opt.priceLabel}
                      </span>
                    </div>
                    <p className="text-[11px] text-surface-muted leading-relaxed mt-1">{opt.rules}</p>
                    {showTierDetails && (
                      <ul className="mt-2 space-y-1 border-t border-surface-border/60 pt-2">
                        {opt.includes.map((item, i) => (
                          <li key={i} className="text-[11px] text-surface-muted/90 flex items-start gap-1.5">
                            <span className="text-accent-glow flex-shrink-0">✓</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </button>
                );
              })}
            </div>

            {tier === 'light' && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  🎯 El número de visualizaciones a contratar y el filtro de interesados se eligen en el siguiente paso, al pulsar "Configurar publicidad".
                </p>
                <p className="text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  💳 Se aplicará una retencion al comenzar el sorteo, el pago se efectuará al renovar o finalizar el contrato publicitario, o en su defecto al finalizar el sorteo.
                </p>
                <p className="text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  📶 Las apariciones de banners publicitarios tienen preferencia en sorteos Light frente a sorteos Volt.
                </p>
                <p className="text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  🔁 Se notificará como máximo una vez a cada usuario dentro de una misma promoción; para repetir notificaciones a usuarios se deberá crear otra promoción.
                </p>
                <p className="text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  📡 Los banners se enviarán conforme los usuarios estén disponibles.
                </p>
              </div>
            )}

            {tier === 'volt' && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  🎯 Cada persona recibirá como máximo 3 banners esporádicos del sorteo.
                </p>
                <p className="text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  📶 Las apariciones de banners publicitarios tienen preferencia en sorteos Light frente a sorteos Volt.
                </p>
              </div>
            )}

            {tier === 'community' && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  ℹ️ Este tipo de sorteos tiene como objetivo la afiliación a la comunidad, no incluye publicidad fuera de la comunidad.
                </p>
                <p className="text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  ✈️ Se mostrará una avioneta con el banner del sorteo a todos los miembros de la comunidad, como máximo una vez a cada uno.
                </p>
                <p className="text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                  📶 Las apariciones de banners publicitarios tienen preferencia en sorteos Light y Volt frente a sorteos Community.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">Título *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ej: Sorteamos una camiseta oficial"
              maxLength={120}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              Descripción <span className="text-slate-600">(opcional)</span>
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="¿En qué consiste el premio? ¿Alguna condición?"
              rows={3}
              maxLength={1000}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">Fecha de fin *</label>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={e => setEndsAt(e.target.value)}
              min={defaultDate}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              Foto <span className="text-slate-600">(opcional)</span>
            </label>
            {imagePreview ? (
              <div className="overflow-hidden rounded-xl border border-surface-border bg-surface-bg">
                <div className="aspect-[16/9]">
                  <img src={imagePreview} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="truncate text-xs text-surface-muted">{imageFile?.name}</span>
                  <button
                    type="button"
                    onClick={clearImage}
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
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageChange}
            />
            <input
              ref={imageCameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleImageChange}
            />
            <PhotoSourceMenu
              open={showPhotoMenu}
              onClose={() => setShowPhotoMenu(false)}
              onCamera={() => imageCameraRef.current?.click()}
              onGallery={() => imageInputRef.current?.click()}
            />
          </div>

          <p className="text-[11px] text-surface-muted italic">
            {raffleTierMeta(tier).rules} Los admins nunca participan.
          </p>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={saving || !title.trim() || !endsAt}
            className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-surface-bg font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98]"
          >
            {saving ? 'Creando...' : tier === 'light' ? 'Configurar publicidad' : 'Crear sorteo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Silencio del hilo de esta comunidad concreta (fase 97) ────────────────
// Independiente del silencio del chat: solo afecta al aviso de "nueva
// publicación en el hilo" (foreground vía CommunityNotificationsContext y
// segundo plano/cerrada vía web-push, server/routes/community.js).
function useThreadMuteToggle(communityId, threadMuted, setThreadMuted, setConversationMuted) {
  return useCallback(() => {
    const next = !threadMuted;
    setThreadMuted(next);
    setConversationMuted('community_thread', communityId, next);
  }, [communityId, threadMuted, setThreadMuted, setConversationMuted]);
}

// ── Hilo de comunidad ────────────────────────────────────────────────────

function formatThreadDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function CommunityPostCard({ post, isCreator, onOpen, onDelete }) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e) {
    e.stopPropagation();
    if (!window.confirm('¿Borrar esta publicación del hilo?')) return;
    setDeleting(true);
    try { await onDelete(post.id); } finally { setDeleting(false); }
  }

  return (
    <div
      onClick={() => onOpen(post)}
      className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
    >
      <div className="p-3.5 pb-2 flex items-center gap-2.5">
        <RaffleAvatar user={post.creator} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-display font-bold text-surface-text truncate">{post.creator?.username || 'Alguien'}</p>
          <p className="text-[10px] text-surface-muted font-mono">{formatThreadDate(post.created_at)}</p>
        </div>
        {isCreator && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            title="Borrar publicación"
            className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-surface-muted hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            {deleting ? '⏳' : '🗑️'}
          </button>
        )}
      </div>

      {post.content && (
        <p className="px-3.5 pb-2.5 text-sm text-surface-text leading-relaxed whitespace-pre-wrap">{post.content}</p>
      )}

      {post.type === 'photo' && post.media_url && (
        <div className="bg-surface-bg">
          <img src={post.media_url} alt="" className="w-full max-h-96 object-cover" />
        </div>
      )}
      {post.type === 'video' && post.media_url && (
        <div className="bg-black">
          <video src={post.media_url} controls className="w-full max-h-96" />
        </div>
      )}

      <div className="px-3.5 py-2.5 flex items-center gap-1.5 text-xs font-mono text-surface-muted border-t border-surface-border/60">
        <span>💬</span>
        <span>{post.comment_count > 0 ? `${post.comment_count} comentario${post.comment_count === 1 ? '' : 's'}` : 'Comentar'}</span>
      </div>
    </div>
  );
}

function CreatePostModal({ onClose, onCreate }) {
  const fileInputRef = useRef(null);
  const [content, setContent] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [previewKind, setPreviewKind] = useState(null); // 'photo' | 'video'
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 30 * 1024 * 1024) {
      setError('El archivo no puede superar 30MB');
      e.target.value = '';
      return;
    }
    setFile(f);
    setPreviewKind(f.type.startsWith('video/') ? 'video' : 'photo');
    setPreview(URL.createObjectURL(f));
    setError('');
  }

  function clearFile() {
    setFile(null);
    setPreview('');
    setPreviewKind(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSubmit() {
    if (!content.trim() && !file) {
      setError('Escribe un mensaje o adjunta una foto o vídeo');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onCreate({ content: content.trim(), file });
      onClose();
    } catch (e) {
      setError(e.message || 'Error al publicar');
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
          <span className="text-3xl">📸</span>
          <h2 className="font-display font-bold text-surface-text text-lg">Publicar en el hilo</h2>
        </div>

        <div className="space-y-4">
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Escribe algo para la comunidad..."
            rows={4}
            maxLength={2000}
            className="w-full bg-surface-bg border border-surface-border rounded-xl px-3.5 py-3 text-sm text-surface-text placeholder:text-surface-muted focus:outline-none focus:border-accent-primary/50 resize-none"
          />

          {preview ? (
            <div className="relative rounded-xl overflow-hidden bg-black">
              {previewKind === 'video' ? (
                <video src={preview} controls className="w-full max-h-72" />
              ) : (
                <img src={preview} alt="" className="w-full max-h-72 object-cover" />
              )}
              <button
                onClick={clearFile}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3.5 rounded-xl border border-dashed border-surface-border text-surface-muted text-xs font-mono hover:border-accent-primary/40 hover:text-surface-text transition-colors"
            >
              📎 Adjuntar foto o vídeo (opcional)
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={handleFileChange}
            className="hidden"
          />

          {error && (
            <p className="text-red-400 text-sm font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">
              {error}
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={saving || (!content.trim() && !file)}
            className="w-full py-3.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98]"
          >
            {saving ? 'Publicando...' : 'Publicar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Mantiene el modal (y por tanto el input de comentario) anclado a la parte
// visible de la pantalla cuando el teclado móvil está abierto. Sin esto, en
// iOS/Android el contenedor `fixed inset-0` se calcula sobre la altura de
// layout (no la visual), por lo que el teclado lo "hunde" y el campo de
// texto queda oculto debajo de él.
function useKeyboardSafeViewport(containerRef) {
  useEffect(() => {
    const vv = window.visualViewport;
    const el = containerRef.current;
    if (!vv || !el) return;

    function handleResize() {
      el.style.height = `${vv.height}px`;
      el.style.top = `${vv.offsetTop}px`;
    }

    handleResize();
    vv.addEventListener('resize', handleResize);
    vv.addEventListener('scroll', handleResize);
    return () => {
      vv.removeEventListener('resize', handleResize);
      vv.removeEventListener('scroll', handleResize);
    };
  }, [containerRef]);
}

function PostCommentsModal({ post, communityId, currentUserId, isCommunityCreator, onClose, onCountChange }) {
  const { showToast } = useToast();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const containerRef = useRef(null);
  useKeyboardSafeViewport(containerRef);

  const loadComments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/community/communities/${communityId}/posts/${post.id}/comments`);
      setComments(data.comments || []);
    } catch (e) {
      showToast(e.message || 'Error cargando comentarios', 'error');
    } finally {
      setLoading(false);
    }
  }, [communityId, post.id, showToast]);

  useEffect(() => { loadComments(); }, [loadComments]);

  async function handleSend() {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.post(`/community/communities/${communityId}/posts/${post.id}/comments`, { content: text.trim() });
      setText('');
      await loadComments();
      onCountChange?.(post.id, 1);
    } catch (e) {
      showToast(e.message || 'Error al comentar', 'error');
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteComment(commentId) {
    try {
      await api.delete(`/community/communities/${communityId}/posts/${post.id}/comments/${commentId}`);
      setComments(cs => cs.filter(c => c.id !== commentId));
      onCountChange?.(post.id, -1);
    } catch (e) {
      showToast(e.message || 'Error al borrar comentario', 'error');
    }
  }

  return (
    <div ref={containerRef} className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-2xl max-h-[92vh] flex flex-col">
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mt-3 mb-2 sm:hidden flex-shrink-0" />

        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border flex-shrink-0">
          <h2 className="font-display font-bold text-surface-text text-sm">Publicación</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-surface-muted hover:text-surface-text">✕</button>
        </div>

        <div className="overflow-y-auto flex-1">
          <div className="p-4 border-b border-surface-border/60">
            <div className="flex items-center gap-2.5 mb-2">
              <RaffleAvatar user={post.creator} />
              <div className="min-w-0">
                <p className="text-xs font-display font-bold text-surface-text truncate">{post.creator?.username || 'Alguien'}</p>
                <p className="text-[10px] text-surface-muted font-mono">{formatThreadDate(post.created_at)}</p>
              </div>
            </div>
            {post.content && <p className="text-sm text-surface-text leading-relaxed whitespace-pre-wrap">{post.content}</p>}
            {post.type === 'photo' && post.media_url && (
              <img src={post.media_url} alt="" className="w-full max-h-80 object-cover rounded-xl mt-2" />
            )}
            {post.type === 'video' && post.media_url && (
              <video src={post.media_url} controls className="w-full max-h-80 rounded-xl mt-2 bg-black" />
            )}
          </div>

          <div className="p-4 space-y-3">
            {loading ? (
              <p className="text-xs text-surface-muted text-center py-4">Cargando comentarios...</p>
            ) : comments.length === 0 ? (
              <p className="text-xs text-surface-muted text-center py-4">Sé el primero en comentar</p>
            ) : (
              comments.map(c => (
                <div key={c.id} className="flex items-start gap-2.5">
                  <RaffleAvatar user={c.user} />
                  <div className="flex-1 min-w-0 bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-display font-bold text-surface-text truncate">{c.user?.username || 'Alguien'}</p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] text-surface-muted font-mono">{formatThreadDate(c.created_at)}</span>
                        {(c.user?.id === currentUserId || isCommunityCreator) && (
                          <button
                            onClick={() => handleDeleteComment(c.id)}
                            className="text-[10px] text-surface-muted hover:text-red-400"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-surface-text leading-relaxed whitespace-pre-wrap mt-0.5">{c.content}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="p-3 border-t border-surface-border flex items-center gap-2 flex-shrink-0 pb-safe">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
            placeholder="Escribe un comentario..."
            maxLength={1000}
            className="flex-1 bg-surface-bg border border-surface-border rounded-xl px-3.5 py-2.5 text-sm text-surface-text placeholder:text-surface-muted focus:outline-none focus:border-accent-primary/50"
          />
          <button
            onClick={handleSend}
            disabled={sending || !text.trim()}
            className="flex-shrink-0 w-10 h-10 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white flex items-center justify-center disabled:opacity-50"
          >
            {sending ? '⏳' : '➤'}
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

function CollaborateModal({ communityName, amountCents, alreadyCollaborator, onClose, onConfirm, confirming }) {
  const amountLabel = (amountCents / 100).toFixed(2);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-2xl p-6">
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-6 sm:hidden" />

        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">🤝</span>
          <div>
            <h2 className="font-display font-bold text-surface-text text-lg">Colaborar</h2>
            <p className="text-xs text-surface-muted">con {communityName}</p>
          </div>
        </div>

        {alreadyCollaborator && (
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3 py-2 mb-4">
            <span className="text-emerald-400">✓</span>
            <p className="text-xs text-emerald-400 font-mono">Ya eres colaborador de esta comunidad. Puedes volver a colaborar si quieres.</p>
          </div>
        )}

        <div className="bg-surface-bg border border-surface-border rounded-xl p-4 text-center mb-4">
          <p className="text-xs text-surface-muted font-mono mb-1">Importe de colaboración</p>
          <p className="text-3xl font-display font-bold text-surface-text">{amountLabel} €</p>
        </div>

        <p className="text-xs text-surface-muted leading-relaxed mb-5">
          Este importe va destinado a la comunidad. <strong className="text-surface-text">SocialBattery no obtiene nada por este pago.</strong> Puedes colaborar tantas veces como quieras.
        </p>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-surface-border text-surface-muted text-sm font-display font-semibold transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={confirming}
            className="flex-1 py-3 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white text-sm font-display font-bold transition-all disabled:opacity-50 active:scale-[0.98]"
          >
            {confirming ? 'Confirmando...' : `Colaborar ${amountLabel} €`}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditCommunityModal({ community, onClose, onSave }) {
  const initialCategories = getEntityCategories(community).filter(c => COMMUNITY_CATEGORIES.includes(c));
  const initialCustom = getEntityCategories(community).find(c => !COMMUNITY_CATEGORIES.includes(c)) || '';
  const [form, setForm] = useState({
    name: community.name || '',
    description: community.description || '',
    categories: initialCustom ? [...initialCategories, OTHER_CATEGORY] : initialCategories,
    custom_category: initialCustom,
    organization: community.organization || '',
    url: community.url || '',
  });
  const [collabEnabled, setCollabEnabled] = useState(Boolean(community.collab_amount_cents));
  const [collabAmount, setCollabAmount] = useState(
    community.collab_amount_cents ? (community.collab_amount_cents / 100).toFixed(2) : '0.99'
  );
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState(community.cover_image_url || '');
  const [removeCover, setRemoveCover] = useState(false);
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
    setRemoveCover(false);
    setCoverPreview(await readFileAsDataUrl(file));
    setError('');
  }

  function clearCover() {
    setCoverFile(null);
    setCoverPreview('');
    setRemoveCover(true);
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
      formData.append('description', form.description.trim());
      formData.append('categories', JSON.stringify(resolvedCategories));
      formData.append('organization', form.organization.trim());
      formData.append('url', form.url.trim());
      if (coverFile) {
        formData.append('cover', coverFile);
      } else if (removeCover) {
        formData.append('remove_cover', 'true');
      }
      if (collabEnabled) {
        formData.append('collab_amount_cents', String(collabAmountCents));
      } else {
        formData.append('remove_collab', 'true');
      }
      await onSave(formData);
      onClose();
    } catch (e) {
      setError(e.message || 'Error al guardar los cambios');
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
            <h2 className="font-display font-bold text-surface-text text-lg">Editar comunidad</h2>
            <p className="text-xs text-surface-muted">Cambia los datos de tu comunidad cuando quieras</p>
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
                  <span className="truncate text-xs text-surface-muted">{coverFile?.name || 'Foto actual'}</span>
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
            disabled={saving || !form.name.trim() || (form.categories.includes(OTHER_CATEGORY) && !form.custom_category.trim())}
            className="w-full py-3.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98]"
          >
            {saving ? 'Guardando...' : '💾 Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CommunityDetailPage() {
  const { communityId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const { clearCommunityBadge, communitiesWithEvents } = useCommunityNotifications();
  const { isConversationMuted, setConversationMuted } = useSettings();
  const [threadMuted, setThreadMuted] = useState(() => isConversationMuted('community_thread', communityId));
  useEffect(() => {
    setThreadMuted(isConversationMuted('community_thread', communityId));
  }, [communityId, isConversationMuted]);
  const toggleThreadMuted = useThreadMuteToggle(communityId, threadMuted, setThreadMuted, setConversationMuted);
  const [community, setCommunity] = useState(null);
  const [currentEvents, setCurrentEvents] = useState([]);
  const [pastEvents, setPastEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [raffles, setRaffles] = useState([]);
  const [showCreateRaffle, setShowCreateRaffle] = useState(false);
  const [posts, setPosts] = useState([]);
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [openPost, setOpenPost] = useState(null);
  const [showCollabModal, setShowCollabModal] = useState(false);
  const [collaborating, setCollaborating] = useState(false);
  const [collabStats, setCollabStats] = useState(null);
  const [showCollabList, setShowCollabList] = useState(false);
  const [showEditCommunity, setShowEditCommunity] = useState(false);

  const loadRaffles = useCallback(async () => {
    try {
      const data = await api.get(`/community/communities/${communityId}/raffles`);
      setRaffles(data.raffles || []);
    } catch (e) {
      // No bloqueamos la carga de la comunidad si fallan los sorteos.
    }
  }, [communityId]);

  // Deep-link desde el banner volador (#raffle-<id>): hace scroll hasta la
  // tarjeta del sorteo en cuestión y la resalta brevemente.
  useEffect(() => {
    if (!raffles.length) return;
    const hash = location.hash;
    if (!hash?.startsWith('#raffle-')) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-amber-400/70');
    const t = setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400/70'), 2200);
    return () => clearTimeout(t);
  }, [raffles, location.hash]);

  const loadPosts = useCallback(async () => {
    try {
      const data = await api.get(`/community/communities/${communityId}/posts`);
      setPosts(data.posts || []);
    } catch (e) {
      // No bloqueamos la carga de la comunidad si falla el hilo.
    }
  }, [communityId]);

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

  useEffect(() => {
    loadRaffles();
  }, [loadRaffles]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

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

  async function handleEditCommunity(formData) {
    await api.patchForm(`/community/communities/${communityId}`, formData);
    showToast('Comunidad actualizada', 'success');
    await load();
  }

  async function handleCreateRaffle(form) {
    const formData = new FormData();
    formData.append('title', form.title);
    if (form.description?.trim()) formData.append('description', form.description.trim());
    formData.append('ends_at', form.ends_at);
    formData.append('tier', form.tier || 'light');
    if (form.banner_views_contracted != null) formData.append('banner_views_contracted', form.banner_views_contracted);
    if (form.image_file) formData.append('image', form.image_file);
    await api.postForm(`/community/communities/${communityId}/raffles`, formData);
    showToast('¡Sorteo creado! 🎁', 'success');
    await loadRaffles();
  }

  async function handleCreatePost({ content, file }) {
    const formData = new FormData();
    if (content) formData.append('content', content);
    if (file) formData.append('media', file);
    await api.postForm(`/community/communities/${communityId}/posts`, formData);
    showToast('¡Publicado en el hilo! 📸', 'success');
    await loadPosts();
  }

  async function handleDeletePost(postId) {
    try {
      await api.delete(`/community/communities/${communityId}/posts/${postId}`);
      setPosts(ps => ps.filter(p => p.id !== postId));
      if (openPost?.id === postId) setOpenPost(null);
      showToast('Publicación borrada', 'success');
    } catch (e) {
      showToast(e.message || 'Error al borrar', 'error');
    }
  }

  async function handleDrawRaffle(raffleId) {
    try {
      await api.post(`/community/communities/${communityId}/raffles/${raffleId}/draw`, {});
      showToast('¡Ganador sorteado! 🎉', 'success');
      await loadRaffles();
    } catch (e) {
      showToast(e.message || 'Error al sortear', 'error');
    }
  }

  async function handleShareRaffle(raffle) {
    try {
      if (raffle.image_url) {
        const res = await fetch(raffle.image_url);
        const blob = await res.blob();
        const result = await shareOrDownloadBlob(blob, 'sorteo-sb.png', `${raffle.title} · SocialBattery`);
        if (result.method === 'download') showToast('Imagen descargada. ¡Compártela! 📸', 'success');
      } else if (navigator.share) {
        await navigator.share({ title: raffle.title, text: `${raffle.title} · SocialBattery` });
      } else {
        showToast('Este sorteo no tiene foto para compartir', 'error');
      }
    } catch (e) {
      if (e.name !== 'AbortError') showToast('Error al compartir', 'error');
    }
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

  async function handleConfirmCollaborate() {
    setCollaborating(true);
    try {
      await api.post(`/community/communities/${communityId}/collaborate`, {});
      showToast('¡Gracias por colaborar! 🤝', 'success');
      setShowCollabModal(false);
      await load();
    } catch (e) {
      showToast(e.message || 'Error al colaborar', 'error');
    } finally {
      setCollaborating(false);
    }
  }

  const loadCollabStats = useCallback(async () => {
    try {
      const data = await api.get(`/community/communities/${communityId}/collaborations`);
      setCollabStats(data);
    } catch (e) {
      // Solo aplica para admins; si falla, simplemente no mostramos el panel.
    }
  }, [communityId]);

  useEffect(() => {
    if (community?.is_admin && community?.collab_amount_cents) {
      loadCollabStats();
    }
  }, [community?.is_admin, community?.collab_amount_cents, loadCollabStats]);

  async function handleLeaveCommunity() {
    try {
      await api.post(`/community/communities/${communityId}/leave`, {});
      showToast('Has salido de la comunidad', 'success');
      navigate('/community', { state: { tab: 'communities' } });
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
          <button onClick={() => navigate('/community', { state: { tab: 'communities' } })} className="px-5 py-2 rounded-xl bg-accent-primary text-white text-sm font-display font-semibold">
            Volver
          </button>
        </div>
        <BottomNav />
      </div>
    );
  }

  const communityCategories = getEntityCategories(community);
  const emoji = getCommunityEmoji(communityCategories[0]);

  return (
    <div className="min-h-screen bg-surface-bg noise">
      <header className="sticky top-0 z-40 bg-surface-bg/90 backdrop-blur-xl border-b border-surface-border pt-safe">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate('/community', { state: { tab: 'communities' } })}
            className="w-9 h-9 rounded-xl border border-surface-border text-surface-text flex items-center justify-center"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs text-surface-muted font-mono">
                {community.member_count || 0} miembros{community.is_admin ? ' · admin' : ''}
              </p>
              {communitiesWithEvents.has(communityId) && (
                <span className="flex-shrink-0 w-2.5 h-2.5 bg-red-500 rounded-full" />
              )}
            </div>
          </div>
          <button
            onClick={() => navigate(`/messages/community/${communityId}`)}
            title="Chat de la comunidad"
            className="relative flex-shrink-0 flex items-center gap-1 text-xs font-display font-semibold px-2.5 py-1.5 rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/25 hover:bg-blue-500/25 hover:border-blue-500/40 hover:text-blue-300 transition-colors"
          >
            <span>💬</span> Chat
          </button>

          {community.is_member && !community.is_admin && community.collab_amount_cents && (
            <button
              onClick={() => setShowCollabModal(true)}
              title={community.has_collaborated ? 'Ya eres colaborador · colaborar de nuevo' : 'Colaborar con la comunidad'}
              className={`relative flex-shrink-0 flex items-center gap-1 text-xs font-display font-semibold px-2.5 py-1.5 rounded-xl border transition-colors ${
                community.has_collaborated
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/20 hover:border-emerald-500/40'
                  : 'bg-amber-500/15 text-amber-400 border-amber-500/25 hover:bg-amber-500/25 hover:border-amber-500/40 hover:text-amber-300'
              }`}
            >
              <span>{community.has_collaborated ? '✓' : '🤝'}</span>
              {community.has_collaborated ? 'Colaborador' : 'Colaborar'}
            </button>
          )}

          {community.creator_id === profile?.id && (
            <button
              onClick={() => setShowCreateRaffle(true)}
              title="Crear sorteo"
              className="relative flex-shrink-0 flex items-center gap-1 text-xs font-display font-semibold px-2.5 py-1.5 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/25 hover:bg-amber-500/25 hover:border-amber-500/40 hover:text-amber-300 transition-colors"
            >
              <span>🎁</span> Sorteo
            </button>
          )}

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
              <h1 className="font-display font-bold text-surface-text text-lg truncate">{community.name}</h1>
              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                {communityCategories.map(cat => (
                  <span
                    key={cat}
                    className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-bg text-surface-muted border border-surface-border"
                  >
                    {cat}
                  </span>
                ))}
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
          <div className="mt-4 flex items-center justify-between gap-2">
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

            {community.creator_id === profile?.id && (
              <button
                onClick={() => setShowEditCommunity(true)}
                title="Editar comunidad"
                className="flex-shrink-0 flex items-center gap-1 text-xs font-display font-semibold px-2.5 py-1.5 rounded-xl bg-surface-bg text-surface-muted border border-surface-border hover:border-accent-primary/40 hover:text-accent-glow transition-colors"
              >
                <span>⚙️</span> Editar
              </button>
            )}
          </div>
        </section>

        {community.is_admin && community.collab_amount_cents && (
          <section className="bg-surface-card border border-surface-border rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display font-bold text-surface-text text-sm">🤝 Colaboraciones</h2>
                <p className="text-xs text-surface-muted font-mono mt-1">
                  {collabStats ? `${collabStats.count} colaboración${collabStats.count === 1 ? '' : 'es'} · ${(collabStats.total_cents / 100).toFixed(2)} €` : 'Cargando...'}
                </p>
              </div>
              {collabStats?.count > 0 && (
                <button
                  onClick={() => setShowCollabList(v => !v)}
                  className="text-xs font-display font-semibold text-accent-glow px-3 py-1.5 rounded-xl border border-accent-primary/25 hover:bg-accent-primary/10 transition-colors"
                >
                  {showCollabList ? 'Ocultar' : 'Ver'}
                </button>
              )}
            </div>
            <p className="text-[11px] text-surface-muted leading-relaxed mt-2">
              Colaboración fijada: {(community.collab_amount_cents / 100).toFixed(2)} €. SocialBattery no obtiene nada por estos pagos.
            </p>
            {showCollabList && collabStats?.collaborations?.length > 0 && (
              <div className="mt-3 space-y-1.5 max-h-56 overflow-y-auto">
                {collabStats.collaborations.map(c => (
                  <div key={c.id} className="flex items-center justify-between text-xs bg-surface-bg border border-surface-border rounded-lg px-3 py-2">
                    <span className="text-surface-text font-mono truncate">{c.user?.username || 'Usuario'}</span>
                    <span className="text-surface-muted font-mono flex-shrink-0 ml-2">
                      {(c.amount_cents / 100).toFixed(2)} € · {new Date(c.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="font-display font-bold text-surface-text text-sm">Hilo de la comunidad</h2>
            <div className="flex-shrink-0 flex items-center gap-1.5">
              <button
                onClick={toggleThreadMuted}
                title={threadMuted ? 'Activar notificaciones del hilo' : 'Silenciar notificaciones del hilo'}
                className={`w-8 h-8 rounded-xl flex items-center justify-center border transition-colors ${
                  threadMuted
                    ? 'bg-surface-bg text-surface-muted border-surface-border'
                    : 'bg-accent-primary/10 text-accent-glow border-accent-primary/25 hover:bg-accent-primary/20'
                }`}
              >
                {threadMuted ? '🔕' : '🔔'}
              </button>
              {community.creator_id === profile?.id && (
                <button
                  onClick={() => setShowCreatePost(true)}
                  className="flex items-center gap-1 text-xs font-display font-semibold px-2.5 py-1.5 rounded-xl bg-accent-primary/15 text-accent-glow border border-accent-primary/25 hover:bg-accent-primary/25 transition-colors"
                >
                  <span>+</span> Publicar
                </button>
              )}
            </div>
          </div>
          {posts.length === 0 ? (
            <div className="text-center py-8 border border-surface-border rounded-2xl bg-surface-card">
              <p className="text-sm text-surface-muted">
                {community.creator_id === profile?.id
                  ? 'Publica una foto, vídeo o mensaje para empezar el hilo.'
                  : 'Todavía no hay publicaciones en el hilo de esta comunidad.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
              {posts.map(post => (
                <CommunityPostCard
                  key={post.id}
                  post={post}
                  isCreator={community.creator_id === profile?.id}
                  onOpen={setOpenPost}
                  onDelete={handleDeletePost}
                />
              ))}
            </div>
          )}
        </section>

        {raffles.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-display font-bold text-surface-text text-sm px-1">Sorteos</h2>
            <div className="space-y-3">
              {raffles.map(raffle => (
                <RaffleCard
                  key={raffle.id}
                  raffle={raffle}
                  isCreator={community.creator_id === profile?.id}
                  onDraw={handleDrawRaffle}
                  onShare={handleShareRaffle}
                />
              ))}
            </div>
          </section>
        )}

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
          communityId={communityId}
          communityName={community.name}
          communityOrganization={community.organization}
          onClose={() => setShowCreateEvent(false)}
          onCreate={handleCreateEvent}
        />
      )}

      {showEditCommunity && (
        <EditCommunityModal
          community={community}
          onClose={() => setShowEditCommunity(false)}
          onSave={handleEditCommunity}
        />
      )}

      {showCreatePost && (
        <CreatePostModal
          onClose={() => setShowCreatePost(false)}
          onCreate={handleCreatePost}
        />
      )}

      {openPost && (
        <PostCommentsModal
          post={openPost}
          communityId={communityId}
          currentUserId={profile?.id}
          isCommunityCreator={community.creator_id === profile?.id}
          onClose={() => setOpenPost(null)}
          onCountChange={(postId, delta) => {
            setPosts(ps => ps.map(p => p.id === postId ? { ...p, comment_count: Math.max(0, (p.comment_count || 0) + delta) } : p));
          }}
        />
      )}

      {showCreateRaffle && (
        <CreateRaffleModal
          communityName={community.name}
          communityId={communityId}
          onClose={() => setShowCreateRaffle(false)}
          onCreate={handleCreateRaffle}
        />
      )}

      {showCollabModal && (
        <CollaborateModal
          communityName={community.name}
          amountCents={community.collab_amount_cents}
          alreadyCollaborator={community.has_collaborated}
          onClose={() => setShowCollabModal(false)}
          onConfirm={handleConfirmCollaborate}
          confirming={collaborating}
        />
      )}

      <BottomNav />
    </div>
  );
}
