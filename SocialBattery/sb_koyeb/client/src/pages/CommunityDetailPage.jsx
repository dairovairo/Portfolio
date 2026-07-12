import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import LocationPicker from '../components/LocationPicker';
import PhotoSourceMenu from '../components/PhotoSourceMenu';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useCommunityNotifications } from '../context/CommunityNotificationsContext';
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
    setSaving(true);
    setError('');
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
          {!error && (!form.title.trim() || !form.event_date || !form.ends_at || !form.location.trim() || (form.categories.includes(OTHER_CATEGORY) && !form.custom_category.trim())) && (
            <p className="text-amber-400/80 text-xs font-mono text-center">Introduce todos los campos obligatorios primero</p>
          )}
          <button
            onClick={handleSubmit}
            disabled={saving || !form.title.trim() || !form.event_date || !form.ends_at || !form.location.trim() || (form.categories.includes(OTHER_CATEGORY) && !form.custom_category.trim())}
            className="w-full py-3.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98]"
          >
            {saving ? 'Creando...' : 'Publicar evento'}
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
    key: 'comunity',
    label: 'Sorteo Comunity',
    priceLabel: '5 €',
    rules: 'Participan los miembros que han colaborado con la comunidad.',
    includes: [
      'Notificaciones a toda la comunidad',
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
    <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
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

function CreateRaffleModal({ onClose, onCreate, communityName }) {
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
    setSaving(true);
    setError('');
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        ends_at: new Date(endsAt).toISOString(),
        tier,
        image_file: imageFile,
      });
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
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setTier(opt.key)}
                    className={`w-full text-left rounded-xl border px-3.5 py-3 transition-all ${
                      selected
                        ? 'border-accent-primary/60 bg-accent-primary/10'
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
            {saving ? 'Creando...' : 'Crear sorteo'}
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
  const [raffles, setRaffles] = useState([]);
  const [showCreateRaffle, setShowCreateRaffle] = useState(false);
  const [showCollabModal, setShowCollabModal] = useState(false);
  const [collaborating, setCollaborating] = useState(false);
  const [collabStats, setCollabStats] = useState(null);
  const [showCollabList, setShowCollabList] = useState(false);

  const loadRaffles = useCallback(async () => {
    try {
      const data = await api.get(`/community/communities/${communityId}/raffles`);
      setRaffles(data.raffles || []);
    } catch (e) {
      // No bloqueamos la carga de la comunidad si fallan los sorteos.
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

  async function handleCreateRaffle(form) {
    const formData = new FormData();
    formData.append('title', form.title);
    if (form.description?.trim()) formData.append('description', form.description.trim());
    formData.append('ends_at', form.ends_at);
    formData.append('tier', form.tier || 'light');
    if (form.image_file) formData.append('image', form.image_file);
    await api.postForm(`/community/communities/${communityId}/raffles`, formData);
    showToast('¡Sorteo creado! 🎁', 'success');
    await loadRaffles();
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

  const communityCategories = getEntityCategories(community);
  const emoji = getCommunityEmoji(communityCategories[0]);

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
              <div className="flex items-center gap-2 flex-wrap">
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
          communityName={community.name}
          communityOrganization={community.organization}
          onClose={() => setShowCreateEvent(false)}
          onCreate={handleCreateEvent}
        />
      )}

      {showCreateRaffle && (
        <CreateRaffleModal
          communityName={community.name}
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
