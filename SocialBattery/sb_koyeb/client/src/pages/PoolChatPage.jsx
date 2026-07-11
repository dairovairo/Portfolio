import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { usePoolChatNotifications } from '../context/PoolChatNotificationsContext';
import { api } from '../lib/api';
import { getBatteryColor } from '../lib/battery';
import { supabase } from '../lib/supabase';
import PhotoSourceMenu from '../components/PhotoSourceMenu';

// ── Activity emoji mapping — mismo criterio que PoolsPage.jsx ────────────────
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

// ── Subcomponents ─────────────────────────────────────────────────────────────

function Avatar({ user, size = 'sm' }) {
  const color = getBatteryColor(user?.battery_level ?? 50);
  const sz = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-10 h-10 text-sm';
  return (
    <div
      className={`${sz} rounded-full flex items-center justify-center font-display font-bold border-2 flex-shrink-0`}
      style={{ borderColor: color.hex, background: `${color.hex}15` }}
    >
      {user?.avatar_url
        ? <img src={user.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
        : user?.username?.[0]?.toUpperCase() || '?'
      }
    </div>
  );
}

// Cuadrito de texto con nombre + descripción de la insignia (mismo
// componente que en GroupChatPage.jsx). `align` controla si se pega al
// borde izquierdo o derecho del icono para no salirse de la pantalla.
function BadgeDescriptionPopover({ badge, align = 'left' }) {
  return (
    <div
      className={`absolute z-50 bottom-full mb-2 ${align === 'right' ? 'right-0' : 'left-0'} w-52 max-w-[70vw] bg-surface-card border border-surface-border rounded-xl p-3 shadow-2xl text-left animate-fade-in`}
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

// Insignia pulsable junto a los mensajes (mismo componente y criterio que
// en GroupChatPage.jsx, size="inline"): al tocarla muestra su descripción.
function IdentityBadge({ identity, align = 'left' }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex-shrink-0 inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className="block leading-none text-lg mb-1.5 bg-transparent border-0 p-0"
      >
        {identity.badge.emoji}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <BadgeDescriptionPopover badge={identity.badge} align={align} />
        </>
      )}
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="bg-surface-card border border-surface-border rounded-t-3xl p-5 w-full max-w-lg space-y-4 animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="font-display font-bold text-surface-text">{title}</div>
        <p className="text-sm text-surface-muted leading-relaxed">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-surface-bg border border-surface-border text-surface-muted text-sm font-display font-semibold hover:text-surface-text transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl text-sm font-display font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function TextBubble({ msg, isMe, myBubbleStyle, otherBubbleStyle, identity, onLongPress }) {
  const bubbleStyle = isMe ? myBubbleStyle : otherBubbleStyle;
  const longPressTimer = useRef(null);

  function handleTouchStart() {
    longPressTimer.current = setTimeout(() => onLongPress(msg), 500);
  }
  function handleTouchEnd() {
    clearTimeout(longPressTimer.current);
  }

  return (
    <div
      id={`msg-${msg.id}`}
      className={`flex gap-2 items-end ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      onContextMenu={e => { e.preventDefault(); onLongPress(msg); }}
    >
      {!isMe && <Avatar user={msg.sender} />}
      <div className="flex items-end gap-1.5 max-w-[75%]">
        <div className="min-w-0">
          {!isMe && (
            <div className="text-xs text-surface-muted font-mono mb-1 ml-1">
              {msg.sender?.username}
            </div>
          )}
          <div
            className={`rounded-2xl px-4 py-2.5 select-none ${!isMe ? 'border border-surface-border' : ''}`}
            style={bubbleStyle}
          >
            <p className="text-sm leading-relaxed break-words" style={{ color: 'inherit' }}>{msg.content}</p>
            <div className="text-xs mt-1 opacity-60">
              <span>{new Date(msg.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        </div>
        {identity && (
          <IdentityBadge identity={identity} align={isMe ? 'right' : 'left'} />
        )}
      </div>
    </div>
  );
}

function ImageBubble({ msg, isMe, myBubbleStyle, otherBubbleStyle, identity, onLongPress }) {
  const [lightbox, setLightbox] = useState(false);
  const bubbleStyle = isMe ? myBubbleStyle : otherBubbleStyle;
  const isOptimistic = typeof msg.id === 'string' && msg.id.startsWith('opt-');
  const longPressTimer = useRef(null);

  function handleTouchStart() {
    longPressTimer.current = setTimeout(() => { if (!isOptimistic) onLongPress(msg); }, 500);
  }
  function handleTouchEnd() {
    clearTimeout(longPressTimer.current);
  }

  return (
    <>
      <div
        id={`msg-${msg.id}`}
        className={`flex gap-2 items-end ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
        onContextMenu={e => { e.preventDefault(); if (!isOptimistic) onLongPress(msg); }}
      >
        {!isMe && <Avatar user={msg.sender} />}
        <div className="flex items-end gap-1.5 max-w-[75%]">
          <div className="min-w-0">
            {!isMe && (
              <div className="text-xs text-surface-muted font-mono mb-1 ml-1">
                {msg.sender?.username}
              </div>
            )}
            <div
              className={`rounded-2xl overflow-hidden select-none ${!isMe ? 'border border-surface-border' : ''}`}
              style={bubbleStyle}
            >
              <div className="relative">
                <img
                  src={msg.content}
                  alt="Imagen"
                  className="block w-full max-w-[260px] max-h-[340px] object-cover cursor-pointer"
                  onClick={() => { if (!isOptimistic) setLightbox(true); }}
                />
                {isOptimistic && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
              <div className="text-xs px-3 pb-2 pt-1 opacity-60">
                <span>{new Date(msg.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          </div>
          {identity && (
            <IdentityBadge identity={identity} align={isMe ? 'right' : 'left'} />
          )}
        </div>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
          onClick={() => setLightbox(false)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white text-3xl font-bold z-10 w-10 h-10 flex items-center justify-center"
            onClick={() => setLightbox(false)}
          >
            ×
          </button>
          <img
            src={msg.content}
            alt="Imagen"
            className="max-w-[95vw] max-h-[90vh] object-contain rounded-xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

// ── Poll bubble — mensaje de encuesta con votación en vivo ───────────────────
function PollBubble({ msg, isMe, identity, onVote, voting, onLongPress }) {
  const poll = msg.poll || {
    options: msg.poll_options || [],
    votes: (msg.poll_options || []).map(() => 0),
    totalVotes: 0,
    myVote: null,
  };
  const isVoting = voting === msg.id;
  const longPressTimer = useRef(null);

  function handleTouchStart() {
    longPressTimer.current = setTimeout(() => onLongPress(msg), 500);
  }
  function handleTouchEnd() {
    clearTimeout(longPressTimer.current);
  }

  return (
    <div
      id={`msg-${msg.id}`}
      className={`flex gap-2 items-end ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      onContextMenu={e => { e.preventDefault(); onLongPress(msg); }}
    >
      {!isMe && <Avatar user={msg.sender} />}
      <div className="flex items-end gap-1.5 max-w-[85%]">
        <div className="min-w-0 w-full">
          {!isMe && (
            <div className="text-xs text-surface-muted font-mono mb-1 ml-1">
              {msg.sender?.username}
            </div>
          )}
          <div className="w-full min-w-[220px] bg-surface-card border border-surface-border rounded-2xl px-4 py-3">
            <p className="text-sm font-display font-semibold text-surface-text mb-2 flex items-center gap-1.5">
              📊 {msg.content}
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
                    onClick={() => onVote(msg.id, i, mine)}
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
            <div className="text-[10px] font-mono text-surface-muted mt-2">
              <span>
                {poll.totalVotes} voto{poll.totalVotes === 1 ? '' : 's'} · {new Date(msg.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                {poll.myVote != null ? ' · toca tu opción para quitar el voto' : ''}
              </span>
            </div>
          </div>
        </div>
        {identity && (
          <IdentityBadge identity={identity} align={isMe ? 'right' : 'left'} />
        )}
      </div>
    </div>
  );
}

// ── Create poll modal ─────────────────────────────────────────────────────────
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-card border border-surface-border rounded-t-3xl p-5 w-full max-w-lg space-y-3 max-h-[85vh] overflow-y-auto animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">📊</span>
          <div className="flex-1">
            <h2 className="font-display font-bold text-surface-text">Nueva encuesta</h2>
            <p className="text-xs text-surface-muted">Los apuntados votarán en tiempo real</p>
          </div>
          <button onClick={onClose} className="text-surface-muted hover:text-surface-text text-xl leading-none">×</button>
        </div>

        <div>
          <label className="block text-[10px] font-mono text-surface-muted uppercase tracking-wider mb-1">Pregunta</label>
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="¿A qué hora quedamos?"
            maxLength={200}
            autoFocus
            className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-2.5 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
          />
        </div>

        <div>
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
        </div>

        {error && <p className="text-red-400 text-sm font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">{error}</p>}

        <div className="flex gap-2 pt-1">
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

function DateDivider({ date }) {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const label = date === today ? 'Hoy'
    : date === yesterday ? 'Ayer'
    : new Date(date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
  return (
    <div className="text-center text-xs text-slate-600 font-mono py-3">
      <span className="bg-black/20 backdrop-blur-sm px-3 py-1 rounded-full">{label}</span>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

// ── Pinned message banner ────────────────────────────────────────────────────
function PinnedBanner({ pinned, canUnpin, onUnpin, onJumpTo }) {
  if (!pinned) return null;
  const preview = pinned.type === 'image' ? '📷 Foto' : pinned.type === 'poll' ? `📊 ${pinned.content}` : pinned.content;
  return (
    <div
      className="sticky top-0 z-10 -mx-4 mb-2 px-4 py-2 bg-surface-card/95 backdrop-blur-xl border-b border-surface-border flex items-center gap-2 cursor-pointer"
      onClick={onJumpTo}
    >
      <span className="text-base flex-shrink-0">📌</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-mono text-surface-muted">
          Fijado por {pinned.pinned_by?.username || pinned.sender?.username || 'alguien'}
        </div>
        <div className="text-sm text-surface-text truncate">{preview}</div>
      </div>
      {canUnpin && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onUnpin(); }}
          className="flex-shrink-0 text-surface-muted hover:text-surface-text text-lg leading-none px-1"
          title="Desfijar mensaje"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ── MessageContextMenu — menú al mantener pulsado ─────────────────────────────
function MessageContextMenu({ msg, isPinned, canPin, onClose, onTogglePin }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-surface-card border border-surface-border rounded-t-3xl w-full max-w-lg pb-safe"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-surface-border rounded-full mx-auto mt-3 mb-3" />

        {/* Preview */}
        <p className="text-xs text-surface-muted font-mono text-center truncate px-8 mb-3 opacity-60">
          {msg.type === 'image' ? '📷 Imagen' : msg.type === 'poll' ? `📊 ${msg.content}` : (msg.content?.slice(0, 80) + (msg.content?.length > 80 ? '…' : ''))}
        </p>

        <div className="px-4 pb-4 space-y-1.5">
          {canPin && (
            <button
              onClick={onTogglePin}
              className="w-full text-left px-4 py-3.5 rounded-2xl bg-surface-bg hover:bg-surface-hover text-surface-text text-sm font-display font-semibold transition-colors flex items-center gap-3"
            >
              <span className="text-xl">{isPinned ? '📌' : '📍'}</span>
              <div>
                <div>{isPinned ? 'Desfijar mensaje' : 'Fijar mensaje'}</div>
                <div className="text-xs text-surface-muted font-normal">
                  {isPinned ? 'Deja de destacarlo arriba del chat' : 'Lo destaca arriba del chat'}
                </div>
              </div>
            </button>
          )}

          <button
            onClick={onClose}
            className="w-full text-center py-3.5 text-surface-muted text-sm font-display font-semibold hover:text-surface-text transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PoolChatPage() {
  const { poolId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { myBubbleStyle, otherBubbleStyle } = useSettings();
  const { clearPoolChatBadge } = usePoolChatNotifications();

  const [pool, setPool] = useState(null);
  const [messages, setMessages] = useState([]);
  const [clearedAt, setClearedAt] = useState(null);
  const [pinnedMessage, setPinnedMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [badgeData, setBadgeData] = useState({ assignments: [] });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendingImage, setSendingImage] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearingChat, setClearingChat] = useState(false);
  const [toast, setToast] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const photoInputRef = useRef(null);
  const photoCameraRef = useRef(null);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [votingMessageId, setVotingMessageId] = useState(null);
  const headerMenuRef = useRef(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
  }, []);

  // Cierra el menú de opciones (⋯) al hacer click fuera — mismo patrón que en GroupChatPage.jsx
  useEffect(() => {
    function handleClick(e) {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target)) {
        setShowHeaderMenu(false);
      }
    }
    if (showHeaderMenu) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showHeaderMenu]);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [poolResult, messagesResult, badgesResult] = await Promise.all([
          api.get(`/pools/${poolId}`),
          api.get(`/pools/${poolId}/messages`),
          api.get(`/badges/pool/${poolId}`).catch(error => {
            console.error('[POOL BADGES]', error);
            return { assignments: [] };
          }),
        ]);
        setPool(poolResult.pool);
        setMessages(messagesResult.messages || []);
        setClearedAt(messagesResult.cleared_at || null);
        setPinnedMessage(messagesResult.pinned_message || null);
        setBadgeData({ assignments: badgesResult.assignments || [] });
      } catch (e) {
        console.error(e);
        showToast('Error al cargar el chat', 'error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [poolId]);

  // Al entrar en el chat de esta quedada, se considera leída: se limpia su badge
  // en el botón "Chat", en la tarjeta de la quedada y en el dock "Quedadas".
  useEffect(() => {
    clearPoolChatBadge(poolId);
  }, [poolId, clearPoolChatBadge]);

  useEffect(() => {
    if (!loading) setTimeout(() => scrollToBottom(false), 50);
  }, [loading, scrollToBottom]);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`pool-chat-${poolId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'pool_messages',
        filter: `pool_id=eq.${poolId}`,
      }, async (payload) => {
        if (payload.new?.sender_id === profile.id) return;
        const { data } = await supabase
          .from('pool_messages')
          .select(`id, pool_id, sender_id, content, type, poll_options, created_at, sender:sender_id(id, username, avatar_url, battery_level)`)
          .eq('id', payload.new.id)
          .single();
        if (data) {
          if (data.type === 'poll') {
            data.poll = { options: data.poll_options || [], votes: (data.poll_options || []).map(() => 0), totalVotes: 0, myVote: null };
          }
          setMessages(m => [...m, data]);
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [poolId, profile?.id]);

  // Realtime: recuentos de votos en vivo para las encuestas de esta quedada
  useEffect(() => {
    if (!poolId) return;
    const channel = supabase
      .channel(`pool-poll-votes-${poolId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pool_message_poll_votes',
        filter: `pool_id=eq.${poolId}`,
      }, async (payload) => {
        const messageId = payload.new?.message_id || payload.old?.message_id;
        if (!messageId) return;
        try {
          const data = await api.get(`/pools/${poolId}/messages/${messageId}/poll`);
          setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, poll: data.poll } : m)));
        } catch {
          // non-critical
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [poolId]);

  // Realtime: mensaje fijado/desfijado por el creador de la quedada
  useEffect(() => {
    if (!poolId) return;
    const channel = supabase
      .channel(`pool-pin-${poolId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'hangout_pools',
        filter: `id=eq.${poolId}`,
      }, async () => {
        try {
          const data = await api.get(`/pools/${poolId}/messages`);
          setPinnedMessage(data.pinned_message || null);
        } catch {
          // non-critical
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [poolId]);

  const isCreator = Boolean(pool?.is_creator);
  // Cualquier apuntado a la quedada puede fijar/desfijar mensajes, no solo el creador.
  const canPinMessages = true;
  const isPinnedMessage = (messageId) => pinnedMessage?.id === messageId;
  const [contextMenu, setContextMenu] = useState(null); // { msg }

  async function handleTogglePin(messageId, isPinned) {
    try {
      if (isPinned) {
        await api.delete(`/pools/${poolId}/pin`);
        setPinnedMessage(null);
        showToast('Mensaje desfijado');
      } else {
        const target = messages.find(m => m.id === messageId);
        const result = await api.post(`/pools/${poolId}/messages/${messageId}/pin`);
        setPinnedMessage(target ? {
          ...target,
          pinned_at: result.pinned_at,
          pinned_by: { id: profile?.id, username: profile?.username },
        } : null);
        showToast('Mensaje fijado');
      }
    } catch (e) {
      showToast('Error al fijar el mensaje', 'error');
    }
  }

  function jumpToPinnedMessage() {
    if (!pinnedMessage) return;
    document.getElementById(`msg-${pinnedMessage.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function clearChat() {
    setClearingChat(true);
    try {
      await api.post(`/pools/${poolId}/clear`);
      setClearedAt(new Date().toISOString());
      setShowClearConfirm(false);
      showToast('Chat vaciado');
    } catch (e) {
      showToast('Error al vaciar el chat', 'error');
    } finally {
      setClearingChat(false);
    }
  }

  async function sendText() {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setInput('');
    setSending(true);

    const optimistic = {
      id: `opt-${Date.now()}`,
      sender_id: profile.id,
      sender: { id: profile.id, username: profile.username, avatar_url: profile.avatar_url },
      content,
      type: 'text',
      created_at: new Date().toISOString(),
    };
    setMessages(m => [...m, optimistic]);

    try {
      const { message } = await api.post(`/pools/${poolId}/messages`, { content, type: 'text' });
      setMessages(m => m.map(msg => msg.id === optimistic.id ? message : msg));
    } catch (e) {
      setMessages(m => m.filter(msg => msg.id !== optimistic.id));
      setInput(content);
      showToast('Error al enviar', 'error');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function handlePhotoSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setSendingImage(true);

    const localUrl = URL.createObjectURL(file);
    const optimisticId = `opt-img-${Date.now()}`;
    const optimistic = {
      id: optimisticId,
      sender_id: profile.id,
      sender: { id: profile.id, username: profile.username, avatar_url: profile.avatar_url },
      content: localUrl,
      type: 'image',
      created_at: new Date().toISOString(),
    };
    setMessages(m => [...m, optimistic]);

    try {
      const formData = new FormData();
      formData.append('image', file);
      const { message } = await api.postForm(`/pools/${poolId}/messages/image`, formData);
      URL.revokeObjectURL(localUrl);
      setMessages(m => m.map(msg => msg.id === optimisticId ? message : msg));
    } catch (e) {
      URL.revokeObjectURL(localUrl);
      setMessages(m => m.filter(msg => msg.id !== optimisticId));
      showToast(e.message || 'Error al enviar la imagen', 'error');
    } finally {
      setSendingImage(false);
    }
  }

  async function handleCreatePoll(question, options) {
    const { message } = await api.post(`/pools/${poolId}/polls`, { question, options });
    setMessages(m => [...m, message]);
    showToast('Encuesta enviada 📊');
  }

  async function handleVote(messageId, optionIndex, isMine) {
    if (votingMessageId) return;
    setVotingMessageId(messageId);
    try {
      const data = isMine
        ? await api.delete(`/pools/${poolId}/messages/${messageId}/vote`)
        : await api.post(`/pools/${poolId}/messages/${messageId}/vote`, { optionIndex });
      setMessages(m => m.map(msg => (msg.id === messageId ? { ...msg, poll: data.poll } : msg)));
    } catch (e) {
      showToast(e.message || 'Error al votar', 'error');
    } finally {
      setVotingMessageId(null);
    }
  }

  const visibleMessages = messages.filter(msg => {
    if (clearedAt && new Date(msg.created_at) <= new Date(clearedAt)) return false;
    return true;
  });

  const grouped = [];
  let lastDate = null;
  visibleMessages.forEach(msg => {
    const d = new Date(msg.created_at).toDateString();
    if (d !== lastDate) {
      grouped.push({ type: 'date', date: d, key: `date-${d}` });
      lastDate = d;
    }
    grouped.push({ type: 'msg', msg, key: msg.id });
  });

  const identityByUserId = badgeData.assignments.reduce((acc, assignment) => {
    if (!acc[assignment.userId]) acc[assignment.userId] = assignment;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-surface-bg flex flex-col">
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl font-display text-sm font-semibold shadow-2xl animate-slide-up ${
          toast.type === 'error'
            ? 'bg-red-500/20 text-red-300 border border-red-500/30'
            : 'bg-green-500/20 text-green-300 border border-green-500/30'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Nav */}
      <nav className="border-b border-surface-border bg-surface-bg/90 backdrop-blur-xl z-10 flex-shrink-0">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-surface-muted hover:text-surface-text transition-colors p-1 text-lg">←</button>
          {pool ? (
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg flex-shrink-0">{getActivityEmoji(pool.activity)}</span>
                <span className="font-display font-bold text-surface-text truncate">
                  {pool.activity}
                </span>
              </div>
              <div className="text-xs text-surface-muted font-mono">
                💬 Chat de la quedada · {pool.participant_count} apuntados
                {badgeData.assignments.length > 0 && ` · ${badgeData.assignments.length} identidades`}
              </div>
            </div>
          ) : loading ? (
            <div className="flex-1 h-8 bg-surface-card rounded-xl animate-pulse" />
          ) : null}

          {/* Menú de opciones (⋯) — mismo patrón que GroupChatPage.jsx */}
          {pool && (
            <div className="relative flex-shrink-0" ref={headerMenuRef}>
              <button
                onClick={() => setShowHeaderMenu(v => !v)}
                className="w-9 h-9 rounded-xl text-surface-muted hover:text-surface-text hover:bg-surface-card border border-transparent hover:border-surface-border transition-all flex items-center justify-center text-xl font-bold"
                title="Opciones"
              >
                ⋯
              </button>
              {showHeaderMenu && (
                <div className="absolute right-0 top-11 bg-surface-card border border-surface-border rounded-2xl shadow-2xl z-30 min-w-[180px] py-1.5 overflow-hidden">
                  <button
                    onClick={() => { setShowHeaderMenu(false); setShowClearConfirm(true); }}
                    className="w-full text-left px-4 py-3 text-sm font-display font-semibold text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2.5"
                  >
                    <span>🧹</span> Vaciar chat
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </nav>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto max-w-lg w-full mx-auto px-4 py-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-surface-muted text-sm animate-pulse">
            Cargando mensajes...
          </div>
        ) : (
          <>
            <PinnedBanner
              pinned={pinnedMessage}
              canUnpin={canPinMessages}
              onUnpin={() => handleTogglePin(pinnedMessage.id, true)}
              onJumpTo={jumpToPinnedMessage}
            />
            {visibleMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <div className="text-4xl">🤝</div>
            <p className="text-slate-500 text-sm text-center">
              {clearedAt
                ? 'Chat vaciado. ¡Sé el primero en escribir!'
                : '¡El chat está vacío! Habla con los apuntados antes de la quedada.'}
            </p>
          </div>
        ) : (
          grouped.map(item => {
            if (item.type === 'date') return <DateDivider key={item.key} date={item.date} />;
            const msg = item.msg;
            const isMe = msg.sender_id === profile?.id || msg.sender?.id === profile?.id;
            const identity = identityByUserId[msg.sender_id || msg.sender?.id] || null;

            if (msg.type === 'image') {
              return (
                <ImageBubble
                  key={item.key}
                  msg={msg}
                  isMe={isMe}
                  myBubbleStyle={myBubbleStyle}
                  otherBubbleStyle={otherBubbleStyle}
                  identity={identity}
                  onLongPress={setContextMenu}
                />
              );
            }

            if (msg.type === 'poll') {
              return (
                <PollBubble
                  key={item.key}
                  msg={msg}
                  isMe={isMe}
                  identity={identity}
                  onVote={handleVote}
                  voting={votingMessageId}
                  onLongPress={setContextMenu}
                />
              );
            }

            return (
              <TextBubble
                key={item.key}
                msg={msg}
                isMe={isMe}
                myBubbleStyle={myBubbleStyle}
                otherBubbleStyle={otherBubbleStyle}
                identity={identity}
                onLongPress={setContextMenu}
              />
            );
          })
        )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {contextMenu && (
        <MessageContextMenu
          msg={contextMenu}
          isPinned={isPinnedMessage(contextMenu.id)}
          canPin={canPinMessages}
          onClose={() => setContextMenu(null)}
          onTogglePin={() => {
            handleTogglePin(contextMenu.id, isPinnedMessage(contextMenu.id));
            setContextMenu(null);
          }}
        />
      )}

      {/* Input */}
      <div className="flex-shrink-0 border-t border-surface-border bg-surface-bg/95 backdrop-blur-xl">
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPhotoMenu(true)}
              title="Enviar foto"
              disabled={sendingImage}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center text-lg hover:border-accent-primary/50 hover:bg-accent-primary/10 transition-all disabled:opacity-40"
            >
              {sendingImage ? (
                <span className="w-4 h-4 border-2 border-surface-muted border-t-transparent rounded-full animate-spin" />
              ) : '📷'}
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoSelect}
            />
            <input
              ref={photoCameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoSelect}
            />
            <PhotoSourceMenu
              open={showPhotoMenu}
              onClose={() => setShowPhotoMenu(false)}
              onCamera={() => photoCameraRef.current?.click()}
              onGallery={() => photoInputRef.current?.click()}
            />
            <button
              onClick={() => setShowPollModal(true)}
              title="Crear encuesta"
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center text-lg hover:border-accent-primary/50 hover:bg-accent-primary/10 transition-all"
            >
              📊
            </button>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }}
              placeholder="Escribe a los apuntados..."
              maxLength={1000}
              className="flex-1 bg-surface-card border border-surface-border rounded-xl px-4 py-2.5 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary transition-colors"
            />
            <button
              onClick={sendText}
              disabled={!input.trim() || sending}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-accent-primary disabled:opacity-40 text-surface-text flex items-center justify-center font-bold transition-all hover:bg-accent-primary/80 active:scale-95"
            >
              {sending ? '…' : '→'}
            </button>
          </div>
        </div>
      </div>

      {/* Clear chat confirm */}
      {showClearConfirm && (
        <ConfirmModal
          title="Vaciar chat"
          message="Los mensajes desaparecerán solo para ti. El resto de apuntados seguirá viendo el historial completo."
          confirmLabel={clearingChat ? 'Vaciando…' : 'Vaciar'}
          onConfirm={clearChat}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}

      {/* Create poll modal */}
      {showPollModal && (
        <CreatePollModal
          onClose={() => setShowPollModal(false)}
          onCreate={handleCreatePoll}
        />
      )}
    </div>
  );
}
