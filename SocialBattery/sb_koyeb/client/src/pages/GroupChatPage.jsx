import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { getBatteryColor, formatRelativeTime } from '../lib/battery';
import { supabase } from '../lib/supabase';

// ── Wallpaper helpers ───────────────────────────────────────────────────────

function getWallpaperKey(groupId) {
  return `wallpaper_group_${groupId}`;
}

function loadWallpaper(groupId) {
  try {
    return localStorage.getItem(getWallpaperKey(groupId)) || null;
  } catch {
    return null;
  }
}

function saveWallpaper(groupId, dataUrl) {
  try {
    if (dataUrl) localStorage.setItem(getWallpaperKey(groupId), dataUrl);
    else localStorage.removeItem(getWallpaperKey(groupId));
  } catch {
    // localStorage full or unavailable
  }
}

// ── WallpaperButton ─────────────────────────────────────────────────────────

function WallpaperButton({ wallpaper, onSet, onRemove }) {
  const [showMenu, setShowMenu] = useState(false);
  const fileInputRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!showMenu) return;
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      onSet(ev.target.result);
      setShowMenu(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  return (
    <div className="relative flex-shrink-0" ref={menuRef}>
      <button
        onClick={() => setShowMenu(v => !v)}
        title="Fondo de pantalla"
        className={`w-9 h-9 rounded-xl flex items-center justify-center text-base transition-all border ${
          wallpaper
            ? 'bg-accent-primary/20 border-accent-primary/50 text-accent-glow'
            : 'bg-surface-card border-surface-border text-surface-muted hover:border-accent-primary/40 hover:text-surface-text'
        }`}
      >
        🖼️
      </button>

      {showMenu && (
        <div className="absolute right-0 top-11 z-50 w-52 bg-surface-card border border-surface-border rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-border">
            <p className="text-xs font-display font-bold text-surface-text">Fondo del grupo</p>
            <p className="text-[11px] text-surface-muted mt-0.5">Solo visible para ti</p>
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-surface-text hover:bg-surface-border/30 transition-colors text-left"
          >
            <span className="text-base">📷</span>
            <span className="font-display font-medium">
              {wallpaper ? 'Cambiar foto' : 'Elegir foto'}
            </span>
          </button>

          {wallpaper && (
            <button
              onClick={() => { onRemove(); setShowMenu(false); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors text-left border-t border-surface-border"
            >
              <span className="text-base">🗑️</span>
              <span className="font-display font-medium">Quitar fondo</span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      )}
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

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
        : (user?.display_name || user?.username)?.[0]?.toUpperCase() || '?'
      }
    </div>
  );
}

function IdentityPill({ badge }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-accent-primary/20 bg-accent-primary/10 px-2 py-1 text-xs font-display font-semibold text-accent-glow"
      title={badge.description}
    >
      <span className="flex-shrink-0">{badge.emoji}</span>
      <span className="truncate">{badge.name}</span>
    </span>
  );
}

function GroupInfoPanel({ group, assignments, loading, currentUserId, onOpenUser }) {
  const identitiesByUser = assignments.reduce((acc, assignment) => {
    if (!acc[assignment.userId]) acc[assignment.userId] = [];
    acc[assignment.userId].push(assignment);
    return acc;
  }, {});

  const members = group?.members || [];

  return (
    <div className="border-b border-surface-border bg-surface-bg/95 backdrop-blur-xl flex-shrink-0">
      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-display font-bold text-surface-text text-sm">Integrantes</div>
            <div className="text-xs text-surface-muted font-mono">
              {members.length} miembros · {assignments.length} identidades activas
            </div>
          </div>
          {loading && <span className="text-xs text-surface-muted font-mono animate-pulse">Calculando...</span>}
        </div>

        <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
          {members.map(member => {
            const memberIdentities = identitiesByUser[member.id] || [];
            const isOwner = group?.owner?.id === member.id;
            const isMe = currentUserId === member.id;
            const color = getBatteryColor(member.battery_level ?? 50);

            return (
              <div key={member.id} className="bg-surface-card border border-surface-border rounded-2xl p-3">
                <div className="flex items-start gap-3">
                  <button onClick={() => onOpenUser(member.id)} className="flex-shrink-0">
                    <Avatar user={member} size="md" />
                  </button>

                  <div className="flex-1 min-w-0">
                    <button onClick={() => onOpenUser(member.id)} className="text-left w-full">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-display font-semibold text-surface-text text-sm truncate">
                          {member.display_name || member.username}
                        </span>
                        {isMe && (
                          <span className="text-[11px] text-accent-glow bg-accent-primary/10 border border-accent-primary/20 px-1.5 py-0.5 rounded-md flex-shrink-0">
                            Tu
                          </span>
                        )}
                        {isOwner && (
                          <span className="text-[11px] text-surface-muted bg-surface-bg border border-surface-border px-1.5 py-0.5 rounded-md flex-shrink-0">
                            Owner
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-surface-muted font-mono truncate">@{member.username}</div>
                    </button>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {memberIdentities.length > 0 ? (
                        memberIdentities.map(identity => (
                          <IdentityPill key={identity.badgeId} badge={identity.badge} />
                        ))
                      ) : (
                        <span className="text-xs text-slate-600 font-mono">Sin identidad activa</span>
                      )}
                    </div>

                    {member.last_seen_at && (
                      <div className="text-[11px] text-surface-muted/70 font-mono mt-2">
                        {formatRelativeTime(member.last_seen_at)}
                      </div>
                    )}
                  </div>

                  <div className="flex-shrink-0 text-right">
                    <div className="font-display font-bold tabular-nums text-sm" style={{ color: color.hex }}>
                      {member.battery_level ?? '—'}%
                    </div>
                    {member.battery_is_estimated && (
                      <div className="text-[11px] text-yellow-400 font-mono">estimada</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {!loading && assignments.length === 0 && (
          <div className="bg-surface-card/50 border border-surface-border rounded-2xl p-3 text-xs text-surface-muted leading-relaxed">
            Aun no hay identidades activas. Se calculan con la actividad del grupo y, al conseguir una, la insignia queda desbloqueada en el perfil para siempre.
          </div>
        )}
      </div>
    </div>
  );
}

function TextBubble({ msg, isMe, hasWallpaper }) {
  return (
    <div className={`flex gap-2 items-end ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isMe && <Avatar user={msg.sender} />}
      <div className="max-w-[75%]">
        {!isMe && (
          <div className="text-xs text-surface-muted font-mono mb-1 ml-1">
            {msg.sender?.display_name || msg.sender?.username}
          </div>
        )}
        <div className={`rounded-2xl px-4 py-2.5 shadow-sm ${
          isMe
            ? 'bg-accent-primary text-surface-text'
            : hasWallpaper
              ? 'bg-surface-bg/90 backdrop-blur-sm border border-surface-border text-surface-text'
              : 'bg-surface-card border border-surface-border text-surface-text'
        }`}>
          <p className="text-sm leading-relaxed break-words">{msg.content}</p>
          <div className={`text-xs mt-1 ${isMe ? 'text-surface-text/50' : 'text-slate-600'}`}>
            {new Date(msg.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
    </div>
  );
}

function DateDivider({ date, hasWallpaper }) {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const label = date === today ? 'Hoy'
    : date === yesterday ? 'Ayer'
    : new Date(date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
  return (
    <div className="text-center py-3">
      <span className={`text-xs font-mono px-3 py-1 rounded-full ${
        hasWallpaper
          ? 'bg-surface-bg/80 backdrop-blur-sm text-surface-muted border border-surface-border/50'
          : 'text-slate-600'
      }`}>
        {label}
      </span>
    </div>
  );
}

export default function GroupChatPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [group, setGroup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [badgeData, setBadgeData] = useState({ badges: [], assignments: [] });
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [loadingIdentities, setLoadingIdentities] = useState(true);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState(null);
  const [wallpaper, setWallpaper] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Load wallpaper for this group
  useEffect(() => {
    setWallpaper(loadWallpaper(groupId));
  }, [groupId]);

  function handleSetWallpaper(dataUrl) {
    setWallpaper(dataUrl);
    saveWallpaper(groupId, dataUrl);
    showToast('¡Fondo actualizado! 🖼️');
  }

  function handleRemoveWallpaper() {
    setWallpaper(null);
    saveWallpaper(groupId, null);
    showToast('Fondo eliminado');
  }

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
  }, []);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setShowGroupInfo(false);
        setLoadingIdentities(true);
        const [groupResult, messagesResult, badgesResult] = await Promise.all([
          api.get(`/groups/${groupId}`),
          api.get(`/groups/${groupId}/messages`),
          api.get(`/badges/group/${groupId}`).catch(error => {
            console.error(error);
            return { badges: [], assignments: [] };
          }),
        ]);
        setGroup(groupResult.group);
        setMessages(messagesResult.messages || []);
        setBadgeData({
          badges: badgesResult.badges || [],
          assignments: badgesResult.assignments || [],
        });
      } catch (e) {
        console.error(e);
        showToast('Error al cargar el chat', 'error');
      } finally {
        setLoading(false);
        setLoadingIdentities(false);
      }
    }
    load();
  }, [groupId]);

  useEffect(() => {
    if (!loading) setTimeout(() => scrollToBottom(false), 50);
  }, [loading, scrollToBottom]);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages.length, scrollToBottom]);

  // Realtime subscription
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`group-chat-${groupId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'group_messages',
        filter: `group_id=eq.${groupId}`,
      }, async (payload) => {
        // Fetch the full message with sender info
        const { data } = await supabase
          .from('group_messages')
          .select(`id, content, type, created_at, sender:sender_id(id, username, display_name, avatar_url, battery_level)`)
          .eq('id', payload.new.id)
          .single();
        if (data && data.sender_id !== profile.id) {
          setMessages(m => [...m, data]);
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [groupId, profile?.id]);

  async function sendText() {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setInput('');
    setSending(true);

    const optimistic = {
      id: `opt-${Date.now()}`,
      sender_id: profile.id,
      sender: { id: profile.id, display_name: profile.display_name, avatar_url: profile.avatar_url },
      content,
      type: 'text',
      created_at: new Date().toISOString(),
    };
    setMessages(m => [...m, optimistic]);

    try {
      const { message } = await api.post(`/groups/${groupId}/messages`, { content, type: 'text' });
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

  // Group messages by date
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
          {group ? (
            <button
              onClick={() => setShowGroupInfo(open => !open)}
              className="flex-1 min-w-0 text-left group"
              title="Ver integrantes e identidades"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg flex-shrink-0">👥</span>
                <span className="font-display font-bold text-surface-text truncate group-hover:text-accent-glow transition-colors">
                  {group.name}
                </span>
                <span className="text-xs text-surface-muted flex-shrink-0">
                  {showGroupInfo ? '^' : 'v'}
                </span>
              </div>
              <div className="text-xs text-surface-muted font-mono">
                {group.member_count} miembros · {badgeData.assignments.length} identidades
              </div>
            </button>
          ) : loading ? (
            <div className="flex-1 h-8 bg-surface-card rounded-xl animate-pulse" />
          ) : null}

          {group && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Wallpaper button */}
              <WallpaperButton
                wallpaper={wallpaper}
                onSet={handleSetWallpaper}
                onRemove={handleRemoveWallpaper}
              />
              <button
                onClick={() => setShowGroupInfo(open => !open)}
                className="text-surface-muted hover:text-surface-text text-lg p-1 transition-colors"
                title="Info del grupo"
              >
                ℹ️
              </button>
            </div>
          )}
        </div>
      </nav>

      {group && showGroupInfo && (
        <GroupInfoPanel
          group={group}
          assignments={badgeData.assignments}
          loading={loadingIdentities}
          currentUserId={profile?.id}
          onOpenUser={(userId) => navigate(`/user/${userId}`)}
        />
      )}

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto max-w-lg w-full mx-auto px-4 py-4 relative"
        style={wallpaper ? {
          backgroundImage: `url(${wallpaper})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'local',
        } : {}}
      >
        {/* Overlay for readability when wallpaper is set */}
        {wallpaper && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'rgba(10,10,15,0.45)' }}
          />
        )}

        {/* Content (above overlay) */}
        <div className="relative z-10 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-surface-muted text-sm animate-pulse">
              Cargando mensajes...
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2">
              <div className="text-4xl">👥</div>
              <p className="text-slate-500 text-sm">¡El chat está vacío! Sé el primero en escribir.</p>
            </div>
          ) : (
            grouped.map(item => {
              if (item.type === 'date') return <DateDivider key={item.key} date={item.date} hasWallpaper={!!wallpaper} />;
              const msg = item.msg;
              const isMe = msg.sender_id === profile?.id || msg.sender?.id === profile?.id;
              return <TextBubble key={item.key} msg={msg} isMe={isMe} hasWallpaper={!!wallpaper} />;
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-surface-border bg-surface-bg/95 backdrop-blur-xl">
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }}
              placeholder="Escribe al grupo..."
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
    </div>
  );
}
