import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useCommunityNotifications } from '../context/CommunityNotificationsContext';
import { api } from '../lib/api';
import ReminderBellButton, { DEFAULT_EVENT_REMINDER_MINUTES } from '../components/ReminderBellButton';
import LocationMapView from '../components/LocationMapView';
import { generateEventStoryBlob, shareOrDownloadBlob } from '../lib/instagramStory';
import { useMascot } from '../context/MascotContext';
import { resolveMascotLayers } from '../lib/mascotRenderer';
import { getBatteryColor, getEffectiveBatteryLevel } from '../lib/battery';
import PhotoSourceMenu from '../components/PhotoSourceMenu';
import { supabase } from '../lib/supabase';

function getMascotTier(level) {
  if (level <= 33) return 'low';
  if (level <= 66) return 'mid';
  return 'high';
}

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

// Mínimo de notificaciones enviadas para que una promoción premium/ultra
// pueda cobrarse (y, por tanto, para poder renovarla) — debe coincidir con
// FREE_THRESHOLD en server/jobs/eventPromoPacing.js.
const PROMO_FREE_THRESHOLD = 200;

function getEventEmoji(category = '') {
  const c = (category ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  // Se añade el selector de variación U+FE0F a cada emoji para forzar su
  // presentación a color (el CSS global usa font-variant-emoji: text para
  // dar un estilo mono a los iconos por defecto; sin este selector solo los
  // emojis que ya lo llevaban incorporado, como el de Comida, salían a color).
  if (/música|musica|concierto|concert/.test(c)) return '🎵️';
  if (/deporte|sport|fútbol|futbol|tenis|running/.test(c)) return '⚽️';
  if (/arte|art|exposición|exposicion|museo/.test(c)) return '🎨️';
  if (/tecnología|tecnologia|tech|hacking|código/.test(c)) return '💻️';
  if (/comida|food|gastro|cocina|cena/.test(c)) return '🍽️';
  if (/fiesta|party|celebración/.test(c)) return '🎉️';
  if (/naturaleza|nature|senderismo|hiking/.test(c)) return '🌿️';
  if (/cine|film|película|movie/.test(c)) return '🎬️';
  if (/juego|gaming|videojuego/.test(c)) return '🎮️';
  if (/yoga|meditación|bienestar|wellness/.test(c)) return '🧘️';
  if (/fotografía|fotografia|photo/.test(c)) return '📷️';
  if (/lectura|libro|book|literatura/.test(c)) return '📚️';
  return '🌐️';
}

function getEntityCategories(entity) {
  if (Array.isArray(entity?.categories) && entity.categories.length) return entity.categories;
  return entity?.category ? [entity.category] : [];
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

// ── Poll options bar ─────────────────────────────────────────────────────────
function PollOptions({ update, onVote, voting }) {
  const poll = update.poll || {
    options: update.poll_options || [],
    votes: (update.poll_options || []).map(() => 0),
    totalVotes: 0,
    myVote: null,
  };
  const isVoting = voting === update.id;

  return (
    <div className="mt-2">
      <p className="text-sm font-display font-semibold text-surface-text mb-2 flex items-center gap-1.5">
        📊 {update.poll_question}
      </p>
      <div className="space-y-1.5">
        {poll.options.map((opt, i) => {
          const count = poll.votes[i] || 0;
          const pct = poll.totalVotes ? Math.round((count / poll.totalVotes) * 100) : 0;
          const mine = poll.myVote === i;
          return (
            <button
              key={i}
              type="button"
              disabled={isVoting}
              onClick={() => onVote(update.id, i, mine)}
              className={`relative w-full text-left rounded-xl border overflow-hidden transition-all disabled:opacity-70 ${
                mine ? 'border-accent-primary' : 'border-surface-border hover:border-accent-primary/40'
              }`}
            >
              <div
                className="absolute inset-y-0 left-0 bg-accent-primary/15 transition-all"
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center justify-between gap-2 px-3 py-2">
                <span className={`text-xs font-mono ${mine ? 'text-accent-glow font-semibold' : 'text-surface-text'}`}>
                  {mine ? '✓ ' : ''}{opt}
                </span>
                <span className="text-[10px] font-mono text-surface-muted flex-shrink-0">{pct}% · {count}</span>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] font-mono text-surface-muted mt-1.5">
        🔴 En vivo · {poll.totalVotes} voto{poll.totalVotes === 1 ? '' : 's'}
        {poll.myVote != null ? ' · toca tu opción otra vez para quitar el voto' : ''}
      </p>
    </div>
  );
}

// ── Update bubble ─────────────────────────────────────────────────────────────
function UpdateBubble({ update, isOwn, onDelete, onVote, voting }) {
  const isPoll = !!update.poll_question;
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
              📣 {update.creator?.username || 'Organizador'}
            </span>
            <span className="text-[10px] font-mono text-surface-muted flex-shrink-0">
              {formatRelative(update.created_at)}
            </span>
          </div>
          {update.content && (
            <p className="text-sm text-surface-text leading-relaxed whitespace-pre-wrap">{update.content}</p>
          )}
          {isPoll && <PollOptions update={update} onVote={onVote} voting={voting} />}
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

// ── Create poll modal ────────────────────────────────────────────────────────
function CreatePollModal({ onClose, onCreate }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function updateOption(i, value) {
    setOptions(prev => prev.map((o, idx) => (idx === i ? value : o)));
  }

  function addOption() {
    if (options.length >= 4) return;
    setOptions(prev => [...prev, '']);
  }

  function removeOption(i) {
    if (options.length <= 2) return;
    setOptions(prev => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit() {
    if (saving) return;
    setError('');
    const cleanQuestion = question.trim();
    const cleanOptions = options.map(o => o.trim()).filter(Boolean);
    if (!cleanQuestion) return setError('Escribe una pregunta');
    if (cleanOptions.length < 2) return setError('Añade al menos 2 opciones');
    if (new Set(cleanOptions.map(o => o.toLowerCase())).size !== cleanOptions.length) {
      return setError('Las opciones no pueden repetirse');
    }
    setSaving(true);
    try {
      await onCreate(cleanQuestion, cleanOptions);
      onClose();
    } catch (e) {
      setError(e.message || 'Error al crear la encuesta');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-2xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-4 sm:hidden" />
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xl">📊</span>
          <div className="flex-1">
            <h2 className="font-display font-bold text-surface-text">Nueva encuesta</h2>
            <p className="text-xs text-surface-muted">Los asistentes votarán en tiempo real</p>
          </div>
          <button onClick={onClose} className="text-surface-muted hover:text-surface-text text-xl leading-none">×</button>
        </div>

        <label className="block text-[10px] font-mono text-surface-muted uppercase tracking-wider mb-1">Pregunta</label>
        <input
          type="text"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="¿A qué hora quedamos?"
          maxLength={200}
          autoFocus
          className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-2.5 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors mb-3"
        />

        <label className="block text-[10px] font-mono text-surface-muted uppercase tracking-wider mb-1">Opciones</label>
        <div className="space-y-2">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={opt}
                onChange={e => updateOption(i, e.target.value)}
                placeholder={`Opción ${i + 1}`}
                maxLength={60}
                className="flex-1 bg-surface-bg border border-surface-border rounded-xl px-4 py-2.5 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-400 transition-colors"
                  title="Quitar opción"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        {options.length < 4 && (
          <button
            type="button"
            onClick={addOption}
            className="mt-2 text-xs font-mono text-accent-glow hover:text-accent-primary transition-colors"
          >
            + Añadir opción
          </button>
        )}

        {error && <p className="mt-3 text-red-400 text-sm font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-display font-semibold text-surface-muted hover:text-surface-text transition-colors border border-surface-border">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white text-sm font-display font-semibold disabled:opacity-50 transition-all"
          >
            {saving ? 'Creando...' : '📊 Crear encuesta'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Renew promotion modal ───────────────────────────────────────────────────
// Mismo selector de planes (Basic/Premium/Ultra) y misma especificación que
// en la creación de evento (CommunityDetailPage.jsx → CreateCommunityEventModal),
// pero apuntando al endpoint de renovación en vez de al de creación.
function RenewPromotionModal({ event, onClose, onRenewed }) {
  const { showToast } = useToast();
  const [expandedPlan, setExpandedPlan] = useState(null); // 'basic' | 'premium' | 'ultra' | null
  const [plan, setPlan] = useState(event?.promotion_plan || 'basic');
  const [notificationCount, setNotificationCount] = useState(event?.notification_count || 500);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleRenew() {
    if (saving) return;
    setError('');
    setSaving(true);
    try {
      const body = { promotion_plan: plan };
      if (plan === 'premium' || plan === 'ultra') body.notification_count = notificationCount;
      const data = await api.post(`/community/events/${event.id}/renew-promotion`, body);
      showToast('¡Promoción renovada! 🔁', 'success');
      onRenewed?.(data.event);
      onClose();
    } catch (e) {
      setError(e.message || 'Error al renovar la promoción');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-2xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-4 sm:hidden" />
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xl">🔁</span>
          <div className="flex-1">
            <h2 className="font-display font-bold text-surface-text">Renovar promoción</h2>
            <p className="text-xs text-surface-muted">Elige el plan para el nuevo ciclo de notificaciones</p>
          </div>
          <button onClick={onClose} className="text-surface-muted hover:text-surface-text text-xl leading-none">×</button>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {/* Basic */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setPlan('basic')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPlan('basic'); } }}
            className={`relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
              plan === 'basic'
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
            {plan === 'basic' && (
              <span className="absolute top-3 right-3 text-accent-glow text-base">✓</span>
            )}
          </div>

          {/* Premium */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setPlan('premium')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPlan('premium'); } }}
            className={`relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
              plan === 'premium'
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
            {plan === 'premium' && (
              <span className="absolute top-3 right-3 text-purple-300 text-base">✓</span>
            )}
          </div>

          {/* Ultra */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setPlan('ultra')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPlan('ultra'); } }}
            className={`relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
              plan === 'ultra'
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
            {plan === 'ultra' && (
              <span className="absolute top-3 right-3 text-yellow-300 text-base">✓</span>
            )}
          </div>
        </div>

        {(plan === 'premium' || plan === 'ultra') && (
          <>
            <div className="mt-2 p-3 rounded-xl border border-surface-border bg-surface-bg space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-mono text-surface-muted">
                  📨 Notificaciones a contratar (on-demand)
                </label>
                <span className="text-xs font-mono font-semibold text-surface-text">
                  {Number(notificationCount).toLocaleString('es-ES')}
                </span>
              </div>
              <input
                type="range"
                min={500}
                max={50000}
                step={500}
                value={notificationCount}
                onChange={e => setNotificationCount(Number(e.target.value))}
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

        {error && <p className="mt-3 text-red-400 text-sm font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-display font-semibold text-surface-muted hover:text-surface-text transition-colors border border-surface-border">
            Cancelar
          </button>
          <button
            onClick={handleRenew}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white text-sm font-display font-semibold disabled:opacity-50 transition-all"
          >
            {saving ? 'Renovando...' : '🔁 Renovar promoción'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── End promotion modal ──────────────────────────────────────────────────────
// Confirmación para finalizar antes de tiempo una promoción premium/ultra:
// el evento vuelve a listado Basic y deja de recibir envíos nuevos del job
// de pacing. El contador de notificaciones enviadas no se toca (sigue
// siendo la base del cobro, igual que si el evento hubiera empezado).
function EndPromotionModal({ event, onClose, onEnded }) {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleEnd() {
    if (saving) return;
    setError('');
    setSaving(true);
    try {
      const data = await api.post(`/community/events/${event.id}/end-promotion`, {});
      showToast('Promoción finalizada 🏁', 'success');
      onEnded?.(data.event);
      onClose();
    } catch (e) {
      setError(e.message || 'Error al finalizar la promoción');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-2xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-4 sm:hidden" />
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xl">🏁</span>
          <div className="flex-1">
            <h2 className="font-display font-bold text-surface-text">Finalizar promoción</h2>
            <p className="text-xs text-surface-muted">El evento pasará a listado Basic (gratis)</p>
          </div>
          <button onClick={onClose} className="text-surface-muted hover:text-surface-text text-xl leading-none">×</button>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-surface-text/90 leading-relaxed">
            Se dejarán de enviar notificaciones promocionales nuevas de este evento. El evento sigue publicado, solo cambia de plan.
          </p>
          <p className="text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
            💳 El pago se efectuará al empezar el evento, en base a las {event?.notification_sent_count || 0} notificaciones ya enviadas.
          </p>
          <p className="text-xs text-surface-muted font-mono bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
            🔁 Si más adelante quieres volver a promocionarlo, puedes renovar la promoción de nuevo.
          </p>
        </div>

        {error && <p className="mt-3 text-red-400 text-sm font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-display font-semibold text-surface-muted hover:text-surface-text transition-colors border border-surface-border">
            Cancelar
          </button>
          <button
            onClick={handleEnd}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-red-500/90 hover:bg-red-500 text-white text-sm font-display font-semibold disabled:opacity-50 transition-all"
          >
            {saving ? 'Finalizando...' : '🏁 Finalizar promoción'}
          </button>
        </div>
      </div>
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
  const { getMascotLayers, getFeetZones, getHeadZones, getOutfitZones, getAccessoryZones } = useMascot();

  const [event, setEvent] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [liking, setLiking] = useState(false);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [sharingStory, setSharingStory] = useState(false);
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [showEndPromoModal, setShowEndPromoModal] = useState(false);

  // update thread composer
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);   // File object
  const [imagePreview, setImagePreview] = useState(null);     // Data URL for preview
  const textareaRef = useRef(null);
  const updatesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [votingUpdateId, setVotingUpdateId] = useState(null);

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

  // Realtime: nuevas actualizaciones/encuestas publicadas por el organizador
  // (las que publica el propio usuario ya se añaden localmente al instante).
  useEffect(() => {
    if (!eventId) return;
    const channel = supabase
      .channel(`event-updates-${eventId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'event_updates',
        filter: `event_id=eq.${eventId}`,
      }, async (payload) => {
        if (payload.new?.creator_id === profile?.id) return;
        const { data } = await supabase
          .from('event_updates')
          .select(`id, content, image_url, poll_question, poll_options, created_at, creator_id, creator:users!event_updates_creator_id_fkey(username, avatar_url)`)
          .eq('id', payload.new.id)
          .single();
        if (!data) return;
        if (data.poll_question) {
          data.poll = { options: data.poll_options || [], votes: (data.poll_options || []).map(() => 0), totalVotes: 0, myVote: null };
        }
        setUpdates(prev => (prev.some(u => u.id === data.id) ? prev : [...prev, data]));
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [eventId, profile?.id]);

  // Realtime: recuentos de votos en vivo para las encuestas de este evento
  useEffect(() => {
    if (!eventId) return;
    const channel = supabase
      .channel(`event-poll-votes-${eventId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'event_poll_votes',
        filter: `event_id=eq.${eventId}`,
      }, async (payload) => {
        const updateId = payload.new?.update_id || payload.old?.update_id;
        if (!updateId) return;
        try {
          const data = await api.get(`/community/events/${eventId}/updates/${updateId}/poll`);
          setUpdates(prev => prev.map(u => (u.id === updateId ? { ...u, poll: data.poll } : u)));
        } catch {
          // non-critical
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [eventId]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const isCreator = event?.creator_id === profile?.id;
  const isJoined  = event?.attendee_ids?.includes(profile?.id);
  const isLiked   = Boolean(event?.liked_by_current_user);
  const isPast    = event ? new Date(event.ends_at || event.event_date) < new Date() : false;
  const isFree    = !event?.price || parseFloat(event?.price) === 0;
  const daysLabel = event ? getDaysLabel(event.event_date) : null;
  const promoSentCount = event?.notification_sent_count || 0;
  const isPaidPromotion = event?.promotion_plan === 'premium' || event?.promotion_plan === 'ultra';
  const belowRenewThreshold = isPaidPromotion && promoSentCount < PROMO_FREE_THRESHOLD;

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleShareStory() {
    if (sharingStory || !event) return;
    setSharingStory(true);
    try {
      // Resolvemos la mascota del usuario que comparte (con su ropa, calzado,
      // gorro, accesorios y actividad actuales) para incluirla como "firma"
      // personal en la imagen del evento.
      const level = profile ? getEffectiveBatteryLevel(profile) : 50;
      const color = getBatteryColor(level);
      let mascot = null;
      try {
        mascot = await resolveMascotLayers(getMascotTier(level), {
          getMascotLayers, getFeetZones, getHeadZones, getOutfitZones, getAccessoryZones,
        });
      } catch (_) {
        mascot = null; // si falla, se genera la historia sin la mascota
      }
      const blob = await generateEventStoryBlob({
        event,
        attendeeCount: event.attendee_count || 0,
        likeCount: event.like_count || 0,
        sharedBy: {
          mascot,
          username: profile?.username || '',
          hex: color.hex,
        },
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

  async function handleCreatePoll(question, options) {
    const data = await api.post(`/community/events/${eventId}/polls`, { question, options });
    setUpdates(prev => [...prev, data.update]);
    showToast('Encuesta publicada 📊', 'success');
  }

  async function handleVote(updateId, optionIndex, isMine) {
    if (votingUpdateId) return;
    setVotingUpdateId(updateId);
    try {
      const data = isMine
        ? await api.delete(`/community/events/${eventId}/updates/${updateId}/vote`)
        : await api.post(`/community/events/${eventId}/updates/${updateId}/vote`, { optionIndex });
      setUpdates(prev => prev.map(u => (u.id === updateId ? { ...u, poll: data.poll } : u)));
    } catch (e) {
      showToast(e.message || 'Error al votar', 'error');
    } finally {
      setVotingUpdateId(null);
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

  const eventCategories = getEntityCategories(event);
  const emoji = getEventEmoji(eventCategories[0]);

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
              {eventCategories.length ? `${emoji} ${eventCategories.join(' · ')}` : emoji}
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
                {eventCategories.map(cat => (
                  <span
                    key={cat}
                    className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent-primary/10 text-accent-glow border border-accent-primary/20"
                  >
                    {cat}
                  </span>
                ))}
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
            {isCreator && !isPast && (
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                <button
                  onClick={() => { if (!belowRenewThreshold) setShowRenewModal(true); }}
                  disabled={belowRenewThreshold}
                  title={belowRenewThreshold
                    ? `Necesitas alcanzar ${PROMO_FREE_THRESHOLD} notificaciones enviadas para renovar (${promoSentCount}/${PROMO_FREE_THRESHOLD})`
                    : 'Renovar promoción del evento'}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-[11px] font-display font-semibold transition-all ${
                    belowRenewThreshold
                      ? 'border-surface-border bg-surface-bg text-slate-500 cursor-not-allowed opacity-60'
                      : 'border-accent-primary/30 bg-accent-primary/10 text-accent-glow hover:bg-accent-primary/20'
                  }`}
                >
                  🔁 Renovar
                </button>
                {isPaidPromotion && (
                  <button
                    onClick={() => { if (!belowRenewThreshold) setShowEndPromoModal(true); }}
                    disabled={belowRenewThreshold}
                    title={belowRenewThreshold
                      ? `Necesitas alcanzar ${PROMO_FREE_THRESHOLD} notificaciones enviadas para finalizar (${promoSentCount}/${PROMO_FREE_THRESHOLD})`
                      : 'Finalizar promoción del evento'}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-[11px] font-display font-semibold transition-all ${
                      belowRenewThreshold
                        ? 'border-surface-border bg-surface-bg text-slate-500 cursor-not-allowed opacity-60'
                        : 'border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20'
                    }`}
                  >
                    🏁 Finalizar
                  </button>
                )}
              </div>
            )}
          </div>

          {isCreator && !isPast && belowRenewThreshold && (
            <p className="mt-3 text-[11px] font-mono text-amber-300/80 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              🔒 Aún no puedes renovar/finalizar la promoción: hace falta alcanzar el mínimo de {PROMO_FREE_THRESHOLD} notificaciones enviadas para que se pueda cobrar ({promoSentCount}/{PROMO_FREE_THRESHOLD} enviadas).
            </p>
          )}

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
                className="flex items-center justify-center w-9 h-9 rounded-xl border border-pink-500/40 text-pink-300 bg-pink-500/5 transition-all disabled:opacity-50"
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
                  onVote={handleVote}
                  voting={votingUpdateId}
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

              {/* Hidden file inputs */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageSelect}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleImageSelect}
              />
              <PhotoSourceMenu
                open={showPhotoMenu}
                onClose={() => setShowPhotoMenu(false)}
                onCamera={() => cameraInputRef.current?.click()}
                onGallery={() => fileInputRef.current?.click()}
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
                    onClick={() => setShowPhotoMenu(true)}
                    title="Adjuntar foto"
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-mono transition-all ${
                      selectedImage
                        ? 'border-accent-primary/40 bg-accent-primary/10 text-accent-glow'
                        : 'border-surface-border text-slate-500 hover:border-accent-primary/30 hover:text-accent-glow'
                    }`}
                  >
                    📷 {selectedImage ? '1 foto' : 'Foto'}
                  </button>
                  <button
                    onClick={() => setShowPollModal(true)}
                    title="Crear encuesta"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-mono border-surface-border text-slate-500 hover:border-accent-primary/30 hover:text-accent-glow transition-all"
                  >
                    📊
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

      {showRenewModal && event && (
        <RenewPromotionModal
          event={event}
          onClose={() => setShowRenewModal(false)}
          onRenewed={() => fetchEvent()}
        />
      )}

      {showEndPromoModal && event && (
        <EndPromotionModal
          event={event}
          onClose={() => setShowEndPromoModal(false)}
          onEnded={() => fetchEvent()}
        />
      )}

      {showPollModal && (
        <CreatePollModal
          onClose={() => setShowPollModal(false)}
          onCreate={handleCreatePoll}
        />
      )}
    </div>
  );
}
