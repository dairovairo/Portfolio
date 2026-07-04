import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { api } from '../lib/api';
import { getBatteryColor, formatRelativeTime } from '../lib/battery';
import { supabase } from '../lib/supabase';
import { isOnline } from '../hooks/usePresence';

// ── helpers ───────────────────────────────────────────────────────────────────

function hexToRgba(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

// ── MessageTick — enviado / recibido / leído ──────────────────────────────────
// Estado   → visual
// optimist → ✓  gris (enviando)
// sent     → ✓  gris
// delivered→ ✓✓ gris
// read     → ✓✓ color acento

function MessageTick({ msg, hideReadTick = false, tickColorRead = '#1d9bf0', tickColorUnread = '#ffffff', tickColorSent = '#ffffff' }) {
  const colorRead   = msg._tickColorRead   ?? tickColorRead;
  const colorUnread = msg._tickColorUnread ?? tickColorUnread;
  const colorSent   = msg._tickColorSent   ?? tickColorSent;
  const isOptimistic = typeof msg.id === 'string' && msg.id.startsWith('opt-');

  if (isOptimistic) {
    return null;
  }

  // When read receipts are off, treat read_at as delivered (grey double tick)
  if (msg.read_at && !hideReadTick) {
    return (
      <span className="ml-1 inline-flex items-center" title="Leído" style={{ color: colorRead }}>
        <svg width="16" height="9" viewBox="0 0 16 9" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 4.5L3.8 7.5L9.5 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M6 4.5L8.8 7.5L14.5 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    );
  }

  if (msg.delivered_at || msg.read_at) {
    return (
      <span className="ml-1 inline-flex items-center" title="Recibido" style={{ color: colorUnread }}>
        <svg width="16" height="9" viewBox="0 0 16 9" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 4.5L3.8 7.5L9.5 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M6 4.5L8.8 7.5L14.5 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    );
  }

  // Sent — single check
  return (
    <span className="ml-1 inline-flex items-center" title="Enviado" style={{ color: colorSent }}>
      <svg width="11" height="9" viewBox="0 0 11 9" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 4.5L3.8 7.5L9.5 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  );
}

// ── DeletedBubble — rastro de mensaje eliminado para todos ────────────────────
function DeletedBubble({ isMe, msgId }) {
  return (
    <div id={msgId ? `msg-${msgId}` : undefined} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className="max-w-[78%] rounded-2xl px-4 py-2.5 border border-surface-border bg-surface-card/50">
        <p className="text-sm italic text-surface-muted flex items-center gap-1.5">
          <span className="text-base">🚫</span>
          {isMe ? 'Eliminaste este mensaje' : 'Mensaje eliminado'}
        </p>
      </div>
    </div>
  );
}

// ── MessageContextMenu — menú al mantener pulsado ─────────────────────────────
function MessageContextMenu({ msg, isMe, onClose, onReply, onDeleteForMe, onDeleteForEveryone }) {
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
        {!msg.deleted_for_everyone && (
          <p className="text-xs text-surface-muted font-mono text-center truncate px-8 mb-3 opacity-60">
            {msg.type === 'image' ? '📷 Imagen' : (msg.content?.slice(0, 80) + (msg.content?.length > 80 ? '…' : ''))}
          </p>
        )}

        <div className="px-4 pb-4 space-y-1.5">
          {!msg.deleted_for_everyone && (
            <button
              onClick={onReply}
              className="w-full text-left px-4 py-3.5 rounded-2xl bg-surface-bg hover:bg-surface-hover text-surface-text text-sm font-display font-semibold transition-colors flex items-center gap-3"
            >
              <span className="text-xl">↩️</span>
              <div>
                <div>Responder</div>
                <div className="text-xs text-surface-muted font-normal">Cita este mensaje en tu respuesta</div>
              </div>
            </button>
          )}

          <button
            onClick={onDeleteForMe}
            className="w-full text-left px-4 py-3.5 rounded-2xl bg-surface-bg hover:bg-surface-hover text-surface-text text-sm font-display font-semibold transition-colors flex items-center gap-3"
          >
            <span className="text-xl">🗑️</span>
            <div>
              <div>Eliminar para mí</div>
              <div className="text-xs text-surface-muted font-normal">Solo desaparece de tu vista</div>
            </div>
          </button>

          {isMe && !msg.deleted_for_everyone && (
            <button
              onClick={onDeleteForEveryone}
              className="w-full text-left px-4 py-3.5 rounded-2xl bg-red-500/10 hover:bg-red-500/15 text-red-400 text-sm font-display font-semibold transition-colors flex items-center gap-3"
            >
              <span className="text-xl">❌</span>
              <div>
                <div>Eliminar para todos</div>
                <div className="text-xs text-red-400/60 font-normal">Queda rastro en la conversación</div>
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

// ── ClearChatModal ────────────────────────────────────────────────────────────
function ClearChatModal({ friendName, onConfirm, onCancel, loading }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-surface-card border border-surface-border rounded-3xl p-6 w-full max-w-sm shadow-2xl">
        <div className="text-center mb-5">
          <div className="text-4xl mb-3">🧹</div>
          <h3 className="font-display font-bold text-surface-text text-lg mb-2">Vaciar conversación</h3>
          <p className="text-surface-muted text-sm leading-relaxed">
            Los mensajes desaparecerán solo para ti.{' '}
            <span className="text-surface-text font-medium">{friendName}</span> seguirá viendo el historial completo.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-3 rounded-2xl text-sm font-display font-semibold text-surface-muted hover:text-surface-text border border-surface-border hover:bg-surface-hover transition-all disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-3 rounded-2xl text-sm font-display font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all disabled:opacity-40"
          >
            {loading ? 'Vaciando…' : 'Vaciar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reply preview helpers ──────────────────────────────────────────────────────

function replyPreviewText(replyTo) {
  if (!replyTo) return '';
  if (replyTo.deleted_for_everyone) return '🚫 Mensaje eliminado';
  if (replyTo.type === 'image') return '📷 Imagen';
  if (replyTo.type === 'hangout_request') return `🤝 ${replyTo.content}`;
  return replyTo.content;
}

// Aplica una actualización realtime a un mensaje y, además, refresca la cita
// (reply_to) de cualquier otro mensaje ya cargado que estuviera respondiendo a ese
// mismo mensaje — así, si se elimina el original, la cita pasa a decir
// "Mensaje eliminado" también en las respuestas que ya estaban en pantalla.
function applyMessageUpdate(list, updated) {
  return list.map(msg => {
    if (msg.id === updated.id) return { ...msg, ...updated };
    if (msg.reply_to?.id === updated.id) {
      return {
        ...msg,
        reply_to: {
          ...msg.reply_to,
          content: updated.content,
          type: updated.type,
          deleted_for_everyone: updated.deleted_for_everyone,
        },
      };
    }
    return msg;
  });
}

// ── ReplyQuote — cita renderizada dentro de una burbuja de mensaje ────────────
function ReplyQuote({ replyTo, onClick }) {
  if (!replyTo) return null;
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick?.(replyTo.id); }}
      className="w-full text-left flex flex-col gap-0.5 mb-1.5 px-2.5 py-1.5 rounded-lg bg-black/20 border-l-2 border-accent-primary/70 hover:bg-black/30 transition-colors active:scale-[0.99]"
    >
      <span className="text-[11px] font-display font-bold text-accent-glow leading-tight truncate">
        {replyTo._quoteLabel}
      </span>
      <span className="text-xs opacity-80 leading-tight truncate">
        {replyPreviewText(replyTo)}
      </span>
    </button>
  );
}

// ── ReplyComposerPreview — barra sobre el input mientras se redacta la respuesta
function ReplyComposerPreview({ replyingTo, label, onCancel }) {
  return (
    <div className="flex items-center gap-2 bg-surface-card border border-surface-border rounded-xl px-3 py-2 mb-2 animate-slide-up">
      <div className="w-1 self-stretch rounded-full bg-accent-primary flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-display font-bold text-accent-glow truncate">
          Respondiendo a {label}
        </div>
        <div className="text-xs text-surface-muted truncate">
          {replyPreviewText(replyingTo)}
        </div>
      </div>
      <button
        onClick={onCancel}
        className="flex-shrink-0 w-7 h-7 rounded-full text-surface-muted hover:text-surface-text hover:bg-surface-hover flex items-center justify-center text-lg leading-none transition-colors"
        title="Cancelar respuesta"
      >
        ×
      </button>
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function OnlineDot({ lastSeenAt, className = '' }) {
  const online = isOnline(lastSeenAt);
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${online ? 'bg-green-400' : 'bg-slate-600'} ${className}`}
      title={online ? 'En línea' : `Visto ${formatRelativeTime(lastSeenAt)}`}
    />
  );
}

function HangoutRequestBubble({ msg, isMe, onRespond, responding, myBubbleStyle, otherBubbleStyle, onLongPress, onQuoteClick }) {
  const isPending = msg.hangout_status === 'pending';
  const isAccepted = msg.hangout_status === 'accepted';
  const isRejected = msg.hangout_status === 'rejected';
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
      className={`flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      onContextMenu={e => { e.preventDefault(); onLongPress(msg); }}
    >
      <div
        className={`max-w-[82%] rounded-2xl px-4 py-3 border ${
          isAccepted ? 'border-green-500/30' : isRejected ? 'border-slate-600/30' : 'border-accent-primary/30'
        }`}
        style={bubbleStyle}
      >
        <ReplyQuote replyTo={msg.reply_to} onClick={onQuoteClick} />
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">🤝</span>
          <span className="text-xs font-display font-bold text-accent-glow uppercase tracking-wide">Propuesta de quedada</span>
        </div>
        <p className="text-sm leading-relaxed">{msg.content}</p>
        {msg.hangout_time && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-surface-muted">
            <span>🕐</span><span>{msg.hangout_time}</span>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
          {isAccepted && <span className="text-xs font-display font-semibold text-green-400 flex items-center gap-1">✅ ¡Quedada confirmada!</span>}
          {isRejected && <span className="text-xs font-display font-semibold text-surface-muted flex items-center gap-1">❌ {isMe ? 'Rechazaste' : 'Rechazada'}</span>}
          {isPending && isMe && <span className="text-xs text-surface-muted italic">Esperando respuesta...</span>}
          {isPending && !isMe && (
            <div className="flex gap-2 mt-1 w-full">
              <button
                onClick={() => onRespond(msg.id, 'accepted')}
                disabled={responding}
                className="flex-1 bg-green-500/20 text-green-400 border border-green-500/30 text-xs font-display font-bold py-2 rounded-xl hover:bg-green-500/30 active:scale-95 transition-all disabled:opacity-50"
              >
                {responding ? '...' : '✓ Me apunto'}
              </button>
              <button
                onClick={() => onRespond(msg.id, 'rejected')}
                disabled={responding}
                className="flex-1 bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-display font-bold py-2 rounded-xl hover:bg-red-500/20 active:scale-95 transition-all disabled:opacity-50"
              >
                {responding ? '...' : '✕ Paso'}
              </button>
            </div>
          )}
        </div>
        <div className="text-xs mt-2 opacity-60 flex items-center justify-end gap-1">
          {new Date(msg.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          {isMe && <MessageTick msg={msg} hideReadTick={!msg._readReceipts} />}
        </div>
      </div>
    </div>
  );
}

function TextBubble({ msg, isMe, myBubbleStyle, otherBubbleStyle, onLongPress, onQuoteClick }) {
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
      className={`flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      onContextMenu={e => { e.preventDefault(); onLongPress(msg); }}
    >
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-2.5 ${!isMe ? 'border border-surface-border' : ''} select-none`}
        style={bubbleStyle}
      >
        <ReplyQuote replyTo={msg.reply_to} onClick={onQuoteClick} />
        <p className="text-sm leading-relaxed break-words">{msg.content}</p>
        <div className="text-xs mt-1 opacity-60 flex items-center justify-end gap-1">
          {new Date(msg.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          {isMe && <MessageTick msg={msg} hideReadTick={!msg._readReceipts} />}
        </div>
      </div>
    </div>
  );
}

function ImageBubble({ msg, isMe, myBubbleStyle, otherBubbleStyle, onLongPress, onQuoteClick }) {
  const [lightbox, setLightbox] = useState(false);
  const bubbleStyle = isMe ? myBubbleStyle : otherBubbleStyle;
  const longPressTimer = useRef(null);
  const isOptimistic = typeof msg.id === 'string' && msg.id.startsWith('opt-');

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
        className={`flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
        onContextMenu={e => { e.preventDefault(); if (!isOptimistic) onLongPress(msg); }}
      >
        <div
          className={`max-w-[78%] rounded-2xl overflow-hidden ${!isMe ? 'border border-surface-border' : ''}`}
          style={bubbleStyle}
        >
          {msg.reply_to && (
            <div className="px-2 pt-2">
              <ReplyQuote replyTo={msg.reply_to} onClick={onQuoteClick} />
            </div>
          )}
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
          <div className="text-xs px-3 pb-2 pt-1 opacity-60 flex items-center justify-end gap-1">
            {new Date(msg.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            {isMe && !isOptimistic && <MessageTick msg={msg} hideReadTick={!msg._readReceipts} />}
          </div>
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

function HangoutForm({ onSend, onCancel, sending }) {
  const [content, setContent] = useState('');
  const [time, setTime] = useState('');

  function handleSubmit() {
    if (!content.trim()) return;
    onSend(content.trim(), time.trim() || null);
  }

  return (
    <div className="bg-surface-card border border-accent-primary/30 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xl">🤝</span>
        <span className="font-display font-bold text-accent-glow text-sm">Nueva propuesta de quedada</span>
        <button onClick={onCancel} className="ml-auto text-surface-muted hover:text-surface-text text-lg leading-none">×</button>
      </div>
      <div>
        <label className="text-xs text-surface-muted font-mono mb-1 block">¿Qué os apetece hacer? *</label>
        <input
          type="text" value={content} onChange={e => setContent(e.target.value)}
          placeholder="Ej: ¿Unas cañas en el centro?" autoFocus maxLength={200}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
          className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-2.5 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary transition-colors"
        />
      </div>
      <div>
        <label className="text-xs text-surface-muted font-mono mb-1 block">¿Cuándo? (opcional)</label>
        <input
          type="text" value={time} onChange={e => setTime(e.target.value)}
          placeholder="Ej: Hoy a las 19h, Este finde..." maxLength={80}
          className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-2.5 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary transition-colors"
        />
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2 rounded-xl text-sm font-display font-semibold text-surface-muted hover:text-surface-text transition-colors">
          Cancelar
        </button>
        <button
          onClick={handleSubmit} disabled={!content.trim() || sending}
          className="flex-1 bg-accent-primary text-surface-text rounded-xl py-2 text-sm font-display font-semibold disabled:opacity-40 hover:bg-accent-primary/80 active:scale-95 transition-all"
        >
          {sending ? 'Enviando...' : 'Proponer 🤝'}
        </button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function MessagesPage() {
  const { friendId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { chatWallpaper, myBubbleStyle, otherBubbleStyle, readReceipts, tickColorRead, tickColorUnread, tickColorSent, showOnline, showLastSeen } = useSettings();

  const [friend, setFriend] = useState(null);
  const [messages, setMessages] = useState([]);
  const [clearedAt, setClearedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendingImage, setSendingImage] = useState(false);
  const [showHangoutForm, setShowHangoutForm] = useState(false);
  const [respondingId, setRespondingId] = useState(null);
  const [toast, setToast] = useState(null);

  // Context menu (responder / eliminar mensaje)
  const [contextMenu, setContextMenu] = useState(null); // { msg }

  // Mensaje al que se está respondiendo (preview sobre el input)
  const [replyingTo, setReplyingTo] = useState(null); // msg | null

  // Header menu (clear chat)
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearingChat, setClearingChat] = useState(false);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const headerMenuRef = useRef(null);
  const photoInputRef = useRef(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
  }, []);

  // Salta al mensaje original al tocar una cita (como en WhatsApp).
  // Si el mensaje ya no está cargado en pantalla, no hace nada.
  const scrollToMessage = useCallback((messageId) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-accent-primary/70', 'rounded-2xl');
    setTimeout(() => el.classList.remove('ring-2', 'ring-accent-primary/70', 'rounded-2xl'), 1000);
  }, []);

  // Close header menu on outside click
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
        const [{ user }, { messages: msgs, cleared_at }] = await Promise.all([
          api.get(`/users/${friendId}`),
          api.get(`/messages/${friendId}`),
        ]);
        setFriend(user);
        setMessages(msgs || []);
        setClearedAt(cleared_at || null);
        if (readReceipts) api.patch(`/messages/${friendId}/read`).catch(() => {});
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [friendId]);

  useEffect(() => {
    if (!loading) setTimeout(() => scrollToBottom(false), 50);
  }, [loading, scrollToBottom]);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages.length, scrollToBottom]);

  // Realtime
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`chat-${profile.id}-${friendId}`)
      // New message from friend
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `sender_id=eq.${friendId}`,
      }, (payload) => {
        if (payload.new.receiver_id === profile.id) {
          // Mark as delivered immediately in local state so the sender sees 2 ticks right away
          const now = new Date().toISOString();
          setMessages(m => [...m, { ...payload.new, delivered_at: payload.new.delivered_at ?? now }]);
          if (readReceipts) {
            // read also sets delivered_at server-side
            api.patch(`/messages/${friendId}/read`).catch(() => {});
          } else {
            // Always mark delivered even when read receipts are off
            api.patch(`/messages/${friendId}/deliver`).catch(() => {});
          }
        }
      })
      // My message sent from another device
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `sender_id=eq.${profile.id}`,
      }, (payload) => {
        if (payload.new.receiver_id === friendId) {
          // The optimistic was already replaced with the real message (real ID),
          // so checking for 'opt-' prefix no longer works. Just check by real ID.
          setMessages(m => {
            if (m.some(msg => msg.id === payload.new.id)) return m;
            return [...m, payload.new];
          });
        }
      })
      // Any message update: ticks (delivered/read), deletions, hangout status
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `receiver_id=eq.${profile.id}`,
      }, (payload) => {
        const updated = payload.new;
        const involved =
          (updated.sender_id === profile.id && updated.receiver_id === friendId) ||
          (updated.sender_id === friendId && updated.receiver_id === profile.id);
        if (involved) {
          setMessages(m => applyMessageUpdate(m, updated));
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `sender_id=eq.${profile.id}`,
      }, (payload) => {
        const updated = payload.new;
        const involved =
          (updated.sender_id === profile.id && updated.receiver_id === friendId) ||
          (updated.sender_id === friendId && updated.receiver_id === profile.id);
        if (involved) {
          setMessages(m => applyMessageUpdate(m, updated));
        }
      })
      // Friend profile changes (battery, online)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
        filter: `id=eq.${friendId}`,
      }, (payload) => {
        setFriend(prev => prev ? { ...prev, ...payload.new } : prev);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [friendId, profile?.id]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function sendText() {
    if (!input.trim() || sending) return;
    const content = input.trim();
    const replyTarget = replyingTo;
    setInput('');
    setReplyingTo(null);
    setSending(true);

    const optimistic = {
      id: `opt-${Date.now()}`,
      sender_id: profile.id,
      receiver_id: friendId,
      content,
      type: 'text',
      created_at: new Date().toISOString(),
      read_at: null,
      delivered_at: null,
      reply_to_id: replyTarget?.id || null,
      reply_to: replyTarget ? {
        id: replyTarget.id,
        sender_id: replyTarget.sender_id,
        content: replyTarget.content,
        type: replyTarget.type,
        deleted_for_everyone: replyTarget.deleted_for_everyone,
      } : null,
    };
    setMessages(m => [...m, optimistic]);

    try {
      const { message } = await api.post('/messages', {
        receiver_id: friendId, content, type: 'text',
        ...(replyTarget?.id ? { reply_to_id: replyTarget.id } : {}),
      });
      setMessages(m => m.map(msg => msg.id === optimistic.id ? message : msg));
    } catch (e) {
      setMessages(m => m.filter(msg => msg.id !== optimistic.id));
      setInput(content);
      setReplyingTo(replyTarget);
      showToast('Error al enviar el mensaje', 'error');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function sendHangout(content, hangoutTime) {
    const replyTarget = replyingTo;
    setSending(true);
    try {
      const { message } = await api.post('/messages', {
        receiver_id: friendId, content, type: 'hangout_request', hangout_time: hangoutTime,
        ...(replyTarget?.id ? { reply_to_id: replyTarget.id } : {}),
      });
      setMessages(m => [...m, message]);
      setShowHangoutForm(false);
      setReplyingTo(null);
      showToast('¡Propuesta enviada! 🤝');
    } catch (e) {
      showToast('Error al enviar la propuesta', 'error');
    } finally {
      setSending(false);
    }
  }

  async function handlePhotoSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const replyTarget = replyingTo;
    setSendingImage(true);
    setReplyingTo(null);

    const localUrl = URL.createObjectURL(file);
    const optimisticId = `opt-img-${Date.now()}`;
    const optimistic = {
      id: optimisticId,
      sender_id: profile.id,
      receiver_id: friendId,
      content: localUrl,
      type: 'image',
      created_at: new Date().toISOString(),
      read_at: null,
      delivered_at: null,
      reply_to_id: replyTarget?.id || null,
      reply_to: replyTarget ? {
        id: replyTarget.id,
        sender_id: replyTarget.sender_id,
        content: replyTarget.content,
        type: replyTarget.type,
        deleted_for_everyone: replyTarget.deleted_for_everyone,
      } : null,
    };
    setMessages(m => [...m, optimistic]);

    try {
      const formData = new FormData();
      formData.append('image', file);
      if (replyTarget?.id) formData.append('reply_to_id', replyTarget.id);
      const { message } = await api.postForm(`/messages/${friendId}/image`, formData);
      URL.revokeObjectURL(localUrl);
      setMessages(m => m.map(msg => msg.id === optimisticId ? message : msg));
    } catch (e) {
      URL.revokeObjectURL(localUrl);
      setMessages(m => m.filter(msg => msg.id !== optimisticId));
      showToast('Error al enviar la imagen', 'error');
    } finally {
      setSendingImage(false);
    }
  }

  async function respondToHangout(messageId, status) {
    setRespondingId(messageId);
    try {
      const { message } = await api.patch(`/messages/${messageId}/hangout`, { status });
      setMessages(m => m.map(msg => msg.id === messageId ? { ...msg, ...message } : msg));
      if (status === 'accepted') showToast('¡Quedada confirmada! 🎉');
      else showToast('Has rechazado la propuesta');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setRespondingId(null);
    }
  }

  async function deleteMessage(msg, scope) {
    setContextMenu(null);
    try {
      const { message: updated } = await api.patch(`/messages/message/${msg.id}`, { scope });
      if (scope === 'me') {
        // Remove from local view immediately
        setMessages(m => m.filter(x => x.id !== msg.id));
      } else {
        // Show deleted placeholder
        setMessages(m => m.map(x => x.id === msg.id ? { ...x, ...updated } : x));
      }
      showToast(scope === 'me' ? 'Mensaje eliminado' : 'Mensaje eliminado para todos');
    } catch (e) {
      showToast(e.message || 'Error al eliminar', 'error');
    }
  }

  async function clearChat() {
    setClearingChat(true);
    try {
      await api.post(`/messages/chat/${friendId}/clear`);
      const now = new Date().toISOString();
      setClearedAt(now);
      setMessages([]);
      setShowClearConfirm(false);
      showToast('Conversación vaciada');
    } catch (e) {
      showToast('Error al vaciar la conversación', 'error');
    } finally {
      setClearingChat(false);
    }
  }

  // ── Filter & group messages ───────────────────────────────────────────────────

  const visibleMessages = messages.filter(msg => {
    // Hide messages before clearedAt
    if (clearedAt && new Date(msg.created_at) <= new Date(clearedAt)) return false;
    // Hide messages deleted for me (deleted_for_self)
    if (Array.isArray(msg.deleted_for_self) && msg.deleted_for_self.includes(profile?.id)) return false;
    return true;
  // Inject _readReceipts flag so bubbles can decide whether to show coloured tick,
  // and _quoteLabel on any quoted reply_to so ReplyQuote can show "Tú" or el nombre del amigo.
  }).map(msg => ({
    ...msg,
    _readReceipts: readReceipts,
    _tickColorRead: tickColorRead,
    _tickColorUnread: tickColorUnread,
    _tickColorSent: tickColorSent,
    reply_to: msg.reply_to
      ? { ...msg.reply_to, _quoteLabel: msg.reply_to.sender_id === profile?.id ? 'Tú' : (friend?.display_name || 'este usuario') }
      : msg.reply_to,
  }));

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

  const friendColor = friend ? getBatteryColor(friend.battery_level ?? 50) : null;
  const friendOnline = friend ? isOnline(friend.last_seen_at) : false;

  return (
    <div className="min-h-screen bg-surface-bg flex flex-col">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl font-display text-sm font-semibold shadow-2xl animate-slide-up ${
          toast.type === 'error'
            ? 'bg-red-500/20 text-red-300 border border-red-500/30'
            : 'bg-green-500/20 text-green-300 border border-green-500/30'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Context menu (responder / eliminar mensaje) */}
      {contextMenu && (
        <MessageContextMenu
          msg={contextMenu}
          isMe={contextMenu.sender_id === profile?.id}
          onClose={() => setContextMenu(null)}
          onReply={() => {
            setReplyingTo(contextMenu);
            setContextMenu(null);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          onDeleteForMe={() => deleteMessage(contextMenu, 'me')}
          onDeleteForEveryone={() => deleteMessage(contextMenu, 'everyone')}
        />
      )}

      {/* Clear chat confirm */}
      {showClearConfirm && (
        <ClearChatModal
          friendName={friend?.display_name || 'esta persona'}
          onConfirm={clearChat}
          onCancel={() => setShowClearConfirm(false)}
          loading={clearingChat}
        />
      )}

      {/* Nav */}
      <nav className="border-b border-surface-border bg-surface-bg/90 backdrop-blur-xl z-10 flex-shrink-0">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-surface-muted hover:text-surface-text transition-colors p-1 text-lg">
            ←
          </button>

          {friend ? (
            <>
              <button onClick={() => navigate(`/user/${friend.id}`)} className="flex-shrink-0">
                <div className="relative">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-display font-bold border-2"
                    style={{ borderColor: friendColor?.hex, background: `${friendColor?.hex}15` }}
                  >
                    {friend.avatar_url
                      ? <img src={friend.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                      : friend.display_name?.[0]?.toUpperCase()
                    }
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface-bg ${friendOnline ? 'bg-green-400' : 'bg-slate-600'}`} />
                </div>
              </button>
              <button onClick={() => navigate(`/user/${friend.id}`)} className="flex-1 text-left">
                <div className="font-display font-semibold text-surface-text text-sm">{friend.display_name}</div>
                <div className="text-xs flex items-center gap-1.5">
                  <span className="font-mono" style={{ color: friendColor?.hex }}>
                    🔋 {friend.battery_level}%{friend.battery_is_estimated ? ' ⚡' : ''}
                  </span>
                  <span className={`text-xs ${friendOnline && showOnline ? 'text-green-400' : 'text-slate-600'}`}>
                    {showOnline && friendOnline
                      ? '· En línea'
                      : showLastSeen && friend.battery_updated_at
                        ? `· Bat. ${formatRelativeTime(friend.battery_updated_at)}`
                        : null}
                  </span>
                </div>
              </button>
            </>
          ) : loading ? (
            <div className="flex-1 h-8 bg-surface-card rounded-xl animate-pulse" />
          ) : null}

          {/* Header menu */}
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
                  <span>🧹</span> Vaciar conversación
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Messages area */}
      <div
        className="flex-1 overflow-y-auto max-w-lg w-full mx-auto px-4 py-4 space-y-3 relative"
        style={chatWallpaper ? {
          backgroundImage: `url(${chatWallpaper})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'local',
        } : {}}
        onClick={() => setShowHeaderMenu(false)}
      >
        {loading ? (
          <div className="flex items-center justify-center h-32 text-surface-muted text-sm animate-pulse">
            Cargando mensajes...
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <div className="text-4xl">💬</div>
            <p className="text-slate-500 text-sm">
              {clearedAt ? 'Conversación vaciada. ¡Di algo nuevo!' : 'Sin mensajes aún. ¡Di hola!'}
            </p>
            {friend && !clearedAt && (
              <p className="text-xs text-slate-600">
                {friend.display_name} tiene la batería al {friend.battery_level}%
              </p>
            )}
          </div>
        ) : (
          grouped.map(item => {
            if (item.type === 'date') {
              return <DateDivider key={item.key} date={item.date} />;
            }
            const msg = item.msg;
            const isMe = msg.sender_id === profile?.id;

            // Deleted for everyone → placeholder visible para ambos
            if (msg.deleted_for_everyone) {
              return <DeletedBubble key={item.key} isMe={isMe} msgId={msg.id} />;
            }

            if (msg.type === 'hangout_request') {
              return (
                <HangoutRequestBubble
                  key={item.key}
                  msg={msg}
                  isMe={isMe}
                  onRespond={respondToHangout}
                  responding={respondingId === msg.id}
                  myBubbleStyle={myBubbleStyle}
                  otherBubbleStyle={otherBubbleStyle}
                  onLongPress={setContextMenu}
                  onQuoteClick={scrollToMessage}
                />
              );
            }

            if (msg.type === 'image') {
              return (
                <ImageBubble
                  key={item.key}
                  msg={msg}
                  isMe={isMe}
                  myBubbleStyle={myBubbleStyle}
                  otherBubbleStyle={otherBubbleStyle}
                  onLongPress={setContextMenu}
                  onQuoteClick={scrollToMessage}
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
                onLongPress={setContextMenu}
                onQuoteClick={scrollToMessage}
              />
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-surface-border bg-surface-bg/95 backdrop-blur-xl">
        <div className="max-w-lg mx-auto px-4 py-3 space-y-2">
          {replyingTo && (
            <ReplyComposerPreview
              replyingTo={replyingTo}
              label={replyingTo.sender_id === profile?.id ? 'ti mismo' : (friend?.display_name || 'este usuario')}
              onCancel={() => setReplyingTo(null)}
            />
          )}
          {showHangoutForm ? (
            <HangoutForm
              onSend={sendHangout}
              onCancel={() => setShowHangoutForm(false)}
              sending={sending}
            />
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowHangoutForm(true)}
                title="Proponer quedada"
                className="flex-shrink-0 w-10 h-10 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center text-lg hover:border-accent-primary/50 hover:bg-accent-primary/10 transition-all"
              >
                🤝
              </button>
              <button
                onClick={() => photoInputRef.current?.click()}
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
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }}
                placeholder="Escribe un mensaje..."
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
          )}
        </div>
      </div>
    </div>
  );
}
