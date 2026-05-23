import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { api } from '../lib/api';
import { getBatteryColor, formatRelativeTime } from '../lib/battery';
import { supabase } from '../lib/supabase';
import { isOnline } from '../hooks/usePresence';

// ── helpers ──────────────────────────────────────────────────────────────────

function hexToRgba(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
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

function HangoutRequestBubble({ msg, isMe, onRespond, responding, myBubbleStyle, otherBubbleStyle }) {
  const isPending = msg.hangout_status === 'pending';
  const isAccepted = msg.hangout_status === 'accepted';
  const isRejected = msg.hangout_status === 'rejected';

  const bubbleStyle = isMe ? myBubbleStyle : otherBubbleStyle;

  return (
    <div className={`flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        className={`max-w-[82%] rounded-2xl px-4 py-3 border ${
          isAccepted
            ? 'border-green-500/30'
            : isRejected
            ? 'border-slate-600/30'
            : 'border-accent-primary/30'
        }`}
        style={bubbleStyle}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">🤝</span>
          <span className="text-xs font-display font-bold text-accent-glow uppercase tracking-wide">
            Propuesta de quedada
          </span>
        </div>

        <p className="text-sm leading-relaxed" style={{ color: 'inherit' }}>{msg.content}</p>

        {msg.hangout_time && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-surface-muted">
            <span>🕐</span>
            <span>{msg.hangout_time}</span>
          </div>
        )}

        <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
          {isAccepted && (
            <span className="text-xs font-display font-semibold text-green-400 flex items-center gap-1">
              ✅ ¡Quedada confirmada!
            </span>
          )}
          {isRejected && (
            <span className="text-xs font-display font-semibold text-surface-muted flex items-center gap-1">
              ❌ {isMe ? 'Rechazaste' : 'Rechazada'}
            </span>
          )}
          {isPending && isMe && (
            <span className="text-xs text-surface-muted italic">Esperando respuesta...</span>
          )}

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

        <div className="text-xs mt-2 opacity-60">
          {new Date(msg.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          {isMe && msg.read_at && <span className="ml-1 text-accent-glow/60">✓✓</span>}
        </div>
      </div>
    </div>
  );
}

function TextBubble({ msg, isMe, myBubbleStyle, otherBubbleStyle }) {
  const bubbleStyle = isMe ? myBubbleStyle : otherBubbleStyle;
  return (
    <div className={`flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-2.5 ${!isMe ? 'border border-surface-border' : ''}`}
        style={bubbleStyle}
      >
        <p className="text-sm leading-relaxed break-words" style={{ color: 'inherit' }}>{msg.content}</p>
        <div className="text-xs mt-1 opacity-60">
          {new Date(msg.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          {isMe && msg.read_at && <span className="ml-1">✓✓</span>}
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

// ── HangoutForm ────────────────────────────────────────────────────────────

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
          type="text"
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Ej: ¿Unas cañas en el centro?"
          autoFocus
          maxLength={200}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
          className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-2.5 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary transition-colors"
        />
      </div>
      <div>
        <label className="text-xs text-surface-muted font-mono mb-1 block">¿Cuándo? (opcional)</label>
        <input
          type="text"
          value={time}
          onChange={e => setTime(e.target.value)}
          placeholder="Ej: Hoy a las 19h, Este finde..."
          maxLength={80}
          className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-2.5 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary transition-colors"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2 rounded-xl text-sm font-display font-semibold text-surface-muted hover:text-surface-text transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={handleSubmit}
          disabled={!content.trim() || sending}
          className="flex-1 bg-accent-primary text-surface-text rounded-xl py-2 text-sm font-display font-semibold disabled:opacity-40 hover:bg-accent-primary/80 active:scale-95 transition-all"
        >
          {sending ? 'Enviando...' : 'Proponer 🤝'}
        </button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function MessagesPage() {
  const { friendId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { chatWallpaper, myBubbleStyle, otherBubbleStyle } = useSettings();

  const [friend, setFriend] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showHangoutForm, setShowHangoutForm] = useState(false);
  const [respondingId, setRespondingId] = useState(null);
  const [toast, setToast] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const [{ user }, { messages: msgs }] = await Promise.all([
          api.get(`/users/${friendId}`),
          api.get(`/messages/${friendId}`),
        ]);
        setFriend(user);
        setMessages(msgs || []);
        api.patch(`/messages/${friendId}/read`).catch(() => {});
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

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`chat-${profile.id}-${friendId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `sender_id=eq.${friendId}`,
      }, (payload) => {
        if (payload.new.receiver_id === profile.id) {
          setMessages(m => [...m, payload.new]);
          api.patch(`/messages/${friendId}/read`).catch(() => {});
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
      }, (payload) => {
        const updated = payload.new;
        if (
          updated.type === 'hangout_request' &&
          (updated.sender_id === profile.id || updated.receiver_id === profile.id)
        ) {
          setMessages(m => m.map(msg => msg.id === updated.id ? { ...msg, ...updated } : msg));
        }
      })
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

  async function sendText() {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setInput('');
    setSending(true);

    const optimistic = {
      id: `opt-${Date.now()}`,
      sender_id: profile.id,
      receiver_id: friendId,
      content,
      type: 'text',
      created_at: new Date().toISOString(),
      read_at: null,
    };
    setMessages(m => [...m, optimistic]);

    try {
      const { message } = await api.post('/messages', { receiver_id: friendId, content, type: 'text' });
      setMessages(m => m.map(msg => msg.id === optimistic.id ? message : msg));
    } catch (e) {
      setMessages(m => m.filter(msg => msg.id !== optimistic.id));
      setInput(content);
      showToast('Error al enviar el mensaje', 'error');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function sendHangout(content, hangoutTime) {
    setSending(true);
    try {
      const { message } = await api.post('/messages', {
        receiver_id: friendId,
        content,
        type: 'hangout_request',
        hangout_time: hangoutTime,
      });
      setMessages(m => [...m, message]);
      setShowHangoutForm(false);
      showToast('¡Propuesta enviada! 🤝');
    } catch (e) {
      showToast('Error al enviar la propuesta', 'error');
    } finally {
      setSending(false);
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

  const grouped = [];
  let lastDate = null;
  messages.forEach(msg => {
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
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface-bg ${friendOnline ? 'bg-green-400' : 'bg-slate-600'}`}
                  />
                </div>
              </button>
              <button onClick={() => navigate(`/user/${friend.id}`)} className="flex-1 text-left">
                <div className="font-display font-semibold text-surface-text text-sm">{friend.display_name}</div>
                <div className="text-xs flex items-center gap-1.5">
                  <span className="font-mono" style={{ color: friendColor?.hex }}>
                    🔋 {friend.battery_level}%{friend.battery_is_estimated ? ' ⚡' : ''}
                  </span>
                  <span className={`text-xs ${friendOnline ? 'text-green-400' : 'text-slate-600'}`}>
                    · {friendOnline ? 'En línea' : formatRelativeTime(friend.last_seen_at)}
                  </span>
                </div>
              </button>
            </>
          ) : loading ? (
            <div className="flex-1 h-8 bg-surface-card rounded-xl animate-pulse" />
          ) : null}
        </div>
      </nav>

      {/* Messages area — wallpaper here */}
      <div
        className="flex-1 overflow-y-auto max-w-lg w-full mx-auto px-4 py-4 space-y-3 relative"
        style={chatWallpaper ? {
          backgroundImage: `url(${chatWallpaper})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'local',
        } : {}}
      >
        {loading ? (
          <div className="flex items-center justify-center h-32 text-surface-muted text-sm animate-pulse">
            Cargando mensajes...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <div className="text-4xl">💬</div>
            <p className="text-slate-500 text-sm">Sin mensajes aún. ¡Di hola!</p>
            {friend && (
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
              />
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-surface-border bg-surface-bg/95 backdrop-blur-xl">
        <div className="max-w-lg mx-auto px-4 py-3 space-y-2">
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
