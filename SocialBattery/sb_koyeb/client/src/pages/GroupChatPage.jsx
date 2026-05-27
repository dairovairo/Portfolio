import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { api } from '../lib/api';
import { getBatteryColor, formatRelativeTime } from '../lib/battery';
import { supabase } from '../lib/supabase';

// ── Mark group as read in localStorage ───────────────────────────────────────
function markGroupRead(groupId) {
  localStorage.setItem(`grp_read_${groupId}`, new Date().toISOString());
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

// ── Add Member Modal ──────────────────────────────────────────────────────────

function AddMemberModal({ group, onClose, onAdded }) {
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(null);
  const [search, setSearch] = useState('');

  const memberIds = new Set((group?.members || []).map(m => m.id));

  useEffect(() => {
    async function load() {
      try {
        const { friends: data } = await api.get('/friends');
        setFriends(data || []);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const eligible = friends.filter(f =>
    !memberIds.has(f.id) &&
    (f.display_name?.toLowerCase().includes(search.toLowerCase()) ||
     f.username?.toLowerCase().includes(search.toLowerCase()))
  );

  async function handleAdd(friend) {
    setAdding(friend.id);
    try {
      await api.post(`/groups/${group.id}/members`, { user_id: friend.id });
      onAdded(friend);
    } catch (e) {
      console.error(e);
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-card border border-surface-border rounded-t-3xl p-5 w-full max-w-lg space-y-4 animate-slide-up max-h-[75vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between flex-shrink-0">
          <div>
            <div className="font-display font-bold text-surface-text">Añadir miembro</div>
            <div className="text-xs text-surface-muted font-mono">{group.name}</div>
          </div>
          <button onClick={onClose} className="text-surface-muted hover:text-surface-text text-xl leading-none">×</button>
        </div>

        <input
          type="text"
          placeholder="Buscar amigos..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-shrink-0 w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-2.5 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary transition-colors"
        />

        <div className="overflow-y-auto flex-1 space-y-2 pr-1">
          {loading ? (
            [1, 2, 3].map(i => <div key={i} className="h-14 bg-surface-bg rounded-2xl animate-pulse" />)
          ) : eligible.length === 0 ? (
            <div className="text-center text-slate-500 text-sm py-8">
              {friends.filter(f => !memberIds.has(f.id)).length === 0
                ? 'Todos tus amigos ya están en el grupo'
                : 'No se encontraron amigos'}
            </div>
          ) : (
            eligible.map(friend => {
              const color = getBatteryColor(friend.battery_level ?? 50);
              const isAdding = adding === friend.id;
              return (
                <div key={friend.id} className="bg-surface-bg border border-surface-border rounded-2xl p-3 flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center font-display font-bold border-2 flex-shrink-0 text-sm"
                    style={{ borderColor: color.hex, background: `${color.hex}15` }}
                  >
                    {friend.avatar_url
                      ? <img src={friend.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                      : (friend.display_name || friend.username)?.[0]?.toUpperCase()
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-semibold text-surface-text text-sm truncate">{friend.display_name || friend.username}</div>
                    <div className="text-xs text-surface-muted font-mono">@{friend.username} · 🔋 {friend.battery_level ?? '—'}%</div>
                  </div>
                  <button
                    onClick={() => handleAdd(friend)}
                    disabled={isAdding}
                    className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-accent-primary/20 text-accent-glow border border-accent-primary/30 text-xs font-display font-semibold hover:bg-accent-primary/30 transition-colors disabled:opacity-50"
                  >
                    {isAdding ? '...' : '+ Añadir'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── Confirm modal ─────────────────────────────────────────────────────────────

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

// ── Group info panel ──────────────────────────────────────────────────────────

function GroupInfoPanel({ group, assignments, loading, currentUserId, onOpenUser, onAddMember, onLeaveGroup, onDeleteGroup, onRemoveMember }) {
  const [confirmAction, setConfirmAction] = useState(null);

  const identitiesByUser = assignments.reduce((acc, assignment) => {
    if (!acc[assignment.userId]) acc[assignment.userId] = [];
    acc[assignment.userId].push(assignment);
    return acc;
  }, {});

  const members = group?.members || [];
  const isOwner = group?.owner?.id === currentUserId;

  function handleConfirm() {
    if (!confirmAction) return;
    if (confirmAction.type === 'leave') onLeaveGroup();
    else if (confirmAction.type === 'delete') onDeleteGroup();
    else if (confirmAction.type === 'remove') onRemoveMember(confirmAction.memberId);
    setConfirmAction(null);
  }

  return (
    <>
      <div className="border-b border-surface-border bg-surface-bg/95 backdrop-blur-xl flex-shrink-0">
        <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-display font-bold text-surface-text text-sm">Integrantes</div>
              <div className="text-xs text-surface-muted font-mono">
                {members.length} miembros · {assignments.length} identidades activas
              </div>
            </div>
            <div className="flex items-center gap-2">
              {loading && <span className="text-xs text-surface-muted font-mono animate-pulse">Calculando...</span>}
              {isOwner && (
                <button
                  onClick={onAddMember}
                  className="text-xs bg-accent-primary/15 text-accent-glow border border-accent-primary/25 px-3 py-1.5 rounded-xl font-display font-semibold hover:bg-accent-primary/25 transition-colors flex items-center gap-1"
                >
                  <span>+</span> Añadir
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
            {members.map(member => {
              const memberIdentities = identitiesByUser[member.id] || [];
              const isOwnerMember = group?.owner?.id === member.id;
              const isMe = currentUserId === member.id;
              const color = getBatteryColor(member.battery_level ?? 50);
              const canRemove = isOwner && !isOwnerMember;

              return (
                <div key={member.id} className="bg-surface-card border border-surface-border rounded-2xl p-3">
                  <div className="flex items-start gap-3">
                    <button onClick={() => onOpenUser(member.id)} className="flex-shrink-0">
                      <Avatar user={member} size="md" />
                    </button>

                    <div className="flex-1 min-w-0">
                      <button onClick={() => onOpenUser(member.id)} className="text-left w-full">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <span className="font-display font-semibold text-surface-text text-sm truncate">
                            {member.display_name || member.username}
                          </span>
                          {isMe && (
                            <span className="text-[11px] text-accent-glow bg-accent-primary/10 border border-accent-primary/20 px-1.5 py-0.5 rounded-md flex-shrink-0">
                              Tú
                            </span>
                          )}
                          {isOwnerMember && (
                            <span className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/25 px-1.5 py-0.5 rounded-md flex-shrink-0">
                              Administrador
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

                    <div className="flex-shrink-0 flex flex-col items-end gap-2">
                      <div className="font-display font-bold tabular-nums text-sm" style={{ color: color.hex }}>
                        {member.battery_level ?? '—'}%
                      </div>
                      {member.battery_is_estimated && (
                        <div className="text-[11px] text-yellow-400 font-mono">estimada</div>
                      )}
                      {canRemove && (
                        <button
                          onClick={() => setConfirmAction({ type: 'remove', memberId: member.id, memberName: member.display_name || member.username })}
                          className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-1 rounded-lg font-display font-semibold hover:bg-red-500/20 transition-colors"
                        >
                          Expulsar
                        </button>
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

          {/* Danger zone */}
          <div className="pt-1 border-t border-surface-border/50">
            {isOwner ? (
              <button
                onClick={() => setConfirmAction({ type: 'delete' })}
                className="w-full py-2.5 rounded-xl text-sm font-display font-semibold text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"
              >
                🗑️ Eliminar grupo
              </button>
            ) : (
              <button
                onClick={() => setConfirmAction({ type: 'leave' })}
                className="w-full py-2.5 rounded-xl text-sm font-display font-semibold text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"
              >
                🚪 Salir del grupo
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmAction && (
        <ConfirmModal
          title={
            confirmAction.type === 'delete' ? 'Eliminar grupo' :
            confirmAction.type === 'leave'  ? 'Salir del grupo' :
            `Expulsar a ${confirmAction.memberName}`
          }
          message={
            confirmAction.type === 'delete'
              ? 'Se eliminará el grupo y todos sus mensajes permanentemente. Esta acción no se puede deshacer.'
              : confirmAction.type === 'leave'
              ? 'Dejarás de ser miembro de este grupo y perderás el acceso al chat.'
              : `${confirmAction.memberName} será expulsado del grupo y perderá el acceso al chat.`
          }
          confirmLabel={
            confirmAction.type === 'delete' ? 'Eliminar' :
            confirmAction.type === 'leave'  ? 'Salir' :
            'Expulsar'
          }
          onConfirm={handleConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </>
  );
}

function TextBubble({ msg, isMe, myBubbleStyle, otherBubbleStyle }) {
  const bubbleStyle = isMe ? myBubbleStyle : otherBubbleStyle;
  return (
    <div className={`flex gap-2 items-end ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isMe && <Avatar user={msg.sender} />}
      <div className="max-w-[75%]">
        {!isMe && (
          <div className="text-xs text-surface-muted font-mono mb-1 ml-1">
            {msg.sender?.display_name || msg.sender?.username}
          </div>
        )}
        <div
          className={`rounded-2xl px-4 py-2.5 ${!isMe ? 'border border-surface-border' : ''}`}
          style={bubbleStyle}
        >
          <p className="text-sm leading-relaxed break-words" style={{ color: 'inherit' }}>{msg.content}</p>
          <div className="text-xs mt-1 opacity-60">
            {new Date(msg.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </div>
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

// ── Wallpaper modal ───────────────────────────────────────────────────────────

function WallpaperModal({ current, onSet, onClear, onClose }) {
  const fileRef = useRef(null);
  const [loading, setLoading] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = ev => res(ev.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      onSet(dataUrl);
      onClose();
    } catch {}
    finally { setLoading(false); e.target.value = ''; }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-card border border-surface-border rounded-t-3xl p-5 w-full max-w-lg space-y-4 animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="font-display font-bold text-surface-text">Fondo del grupo</div>
          <button onClick={onClose} className="text-surface-muted hover:text-surface-text text-xl leading-none">×</button>
        </div>

        {current && (
          <div
            className="w-full h-24 rounded-2xl bg-cover bg-center border border-surface-border"
            style={{ backgroundImage: `url(${current})` }}
          />
        )}

        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-surface-border hover:border-accent-primary/50 hover:bg-accent-primary/5 transition-all text-sm text-surface-muted font-display font-semibold"
        >
          <span className="text-lg">🖼️</span>
          {loading ? 'Cargando...' : 'Elegir imagen de la galería'}
        </button>

        {current && (
          <button
            onClick={() => { onClear(); onClose(); }}
            className="w-full py-2.5 rounded-xl text-sm font-display font-semibold text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Quitar fondo del grupo
          </button>
        )}

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function GroupChatPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { getGroupWallpaper, setGroupWallpaper, myBubbleStyle, otherBubbleStyle } = useSettings();

  const [group, setGroup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [badgeData, setBadgeData] = useState({ badges: [], assignments: [] });
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showWallpaperModal, setShowWallpaperModal] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [loadingIdentities, setLoadingIdentities] = useState(true);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState(null);
  const [groupWallpaper, setGroupWallpaperState] = useState(() => getGroupWallpaper(groupId));
  const [grpImageFile, setGrpImageFile] = useState(null);
  const [grpImagePreview, setGrpImagePreview] = useState(null);
  const [sendingImage, setSendingImage] = useState(false);
  const grpFileRef = useRef(null);
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
        // Mark as read when entering the chat
        markGroupRead(groupId);
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

  // Mark as read whenever new messages arrive while viewing the chat
  useEffect(() => {
    if (messages.length > 0) markGroupRead(groupId);
  }, [messages.length, groupId]);

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

  function handleSetGroupWallpaper(dataUrl) {
    setGroupWallpaper(groupId, dataUrl);
    setGroupWallpaperState(dataUrl);
  }

  function handleClearGroupWallpaper() {
    setGroupWallpaper(groupId, null);
    setGroupWallpaperState(null);
  }

  function handleMemberAdded(friend) {
    setGroup(prev => {
      if (!prev) return prev;
      const alreadyThere = prev.members.some(m => m.id === friend.id);
      if (alreadyThere) return prev;
      const newMembers = [...prev.members, friend];
      return { ...prev, members: newMembers, member_count: newMembers.length };
    });
    showToast(`${friend.display_name || friend.username} añadido al grupo`);
  }

  async function handleLeaveGroup() {
    try {
      await api.delete(`/groups/${groupId}/members/${profile.id}`);
      navigate('/messages', { replace: true });
    } catch (e) {
      console.error(e);
      showToast('Error al salir del grupo', 'error');
    }
  }

  async function handleDeleteGroup() {
    try {
      await api.delete(`/groups/${groupId}`);
      navigate('/messages', { replace: true });
    } catch (e) {
      console.error(e);
      showToast('Error al eliminar el grupo', 'error');
    }
  }

  async function handleRemoveMember(memberId) {
    try {
      await api.delete(`/groups/${groupId}/members/${memberId}`);
      setGroup(prev => {
        if (!prev) return prev;
        const newMembers = prev.members.filter(m => m.id !== memberId);
        return { ...prev, members: newMembers, member_count: newMembers.length };
      });
      showToast('Miembro expulsado del grupo');
    } catch (e) {
      console.error(e);
      showToast('Error al expulsar al miembro', 'error');
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

  async function handleGrpImagePick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Imagen máximo 5MB', 'warning'); return; }
    const preview = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = ev => res(ev.target.result); r.onerror = rej; r.readAsDataURL(file);
    });
    setGrpImageFile(file);
    setGrpImagePreview(preview);
    e.target.value = '';
  }

  async function sendGroupImage() {
    if (!grpImageFile || sendingImage) return;
    setSendingImage(true);
    try {
      const fd = new FormData();
      fd.append('image', grpImageFile);
      const { url } = await api.postForm('/groups/upload-image', fd);
      const { message } = await api.post(`/groups/${groupId}/messages`, { content: url, type: 'image' });
      setMessages(m => [...m, message]);
      setGrpImageFile(null);
      setGrpImagePreview(null);
    } catch (e) {
      showToast('Error al enviar imagen', 'error');
    } finally { setSendingImage(false); }
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

          {/* Wallpaper button */}
          {group && (
            <button
              onClick={() => setShowWallpaperModal(true)}
              className={`text-surface-muted hover:text-surface-text text-base p-1.5 transition-colors rounded-lg ${groupWallpaper ? 'text-accent-glow' : ''}`}
              title="Fondo del grupo"
            >
              🖼️
            </button>
          )}

          {group && (
            <button
              onClick={() => setShowGroupInfo(open => !open)}
              className="text-surface-muted hover:text-surface-text text-lg p-1 transition-colors"
              title="Info del grupo"
            >
              ℹ️
            </button>
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
          onAddMember={() => setShowAddMember(true)}
          onLeaveGroup={handleLeaveGroup}
          onDeleteGroup={handleDeleteGroup}
          onRemoveMember={handleRemoveMember}
        />
      )}

      {/* Messages — group wallpaper */}
      <div
        className="flex-1 overflow-y-auto max-w-lg w-full mx-auto px-4 py-4 space-y-3"
        style={groupWallpaper ? {
          backgroundImage: `url(${groupWallpaper})`,
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
            <div className="text-4xl">👥</div>
            <p className="text-slate-500 text-sm">¡El chat está vacío! Sé el primero en escribir.</p>
          </div>
        ) : (
          grouped.map(item => {
            if (item.type === 'date') return <DateDivider key={item.key} date={item.date} />;
            const msg = item.msg;
            const isMe = msg.sender_id === profile?.id || msg.sender?.id === profile?.id;
            if (msg.type === 'image') {
              return (
                <div key={item.key} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                  {!isMe && (
                    <div className="w-8 h-8 rounded-full bg-surface-card border border-surface-border flex items-center justify-center text-sm overflow-hidden flex-shrink-0 self-end">
                      {msg.sender?.avatar_url ? <img src={msg.sender.avatar_url} alt="" className="w-full h-full object-cover" /> : (msg.sender?.display_name?.[0] || '?')}
                    </div>
                  )}
                  <div className={`max-w-[70%] rounded-2xl overflow-hidden border border-surface-border ${isMe ? 'rounded-tr-sm' : 'rounded-tl-sm'} bg-surface-card`}>
                    {!isMe && (
                      <p className="text-xs font-display font-semibold text-accent-glow px-3 pt-2">{msg.sender?.display_name || msg.sender?.username}</p>
                    )}
                    <img src={msg.content} alt="Imagen" className="block max-h-64 w-auto object-cover" />
                    <p className="text-[10px] font-mono text-surface-muted text-right px-2 pb-1.5 pt-0.5">
                      {new Date(msg.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
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

      {/* Input */}
      <div className="flex-shrink-0 border-t border-surface-border bg-surface-bg/95 backdrop-blur-xl">
        <div className="max-w-lg mx-auto px-4 py-3">
          {grpImagePreview && (
            <div className="relative mb-2">
              <img src={grpImagePreview} alt="" className="max-h-40 rounded-xl object-cover border border-surface-border" />
              <button
                onClick={() => { setGrpImageFile(null); setGrpImagePreview(null); }}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white text-xs flex items-center justify-center"
              >×</button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => grpFileRef.current?.click()}
              title="Enviar foto"
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-surface-card border border-surface-border flex items-center justify-center text-lg hover:border-accent-primary/50 hover:bg-accent-primary/10 transition-all"
            >
              🖼️
            </button>
            <input ref={grpFileRef} type="file" accept="image/*" className="hidden" onChange={handleGrpImagePick} />
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); grpImageFile ? sendGroupImage() : sendText(); } }}
              placeholder="Escribe al grupo..."
              maxLength={1000}
              className="flex-1 bg-surface-card border border-surface-border rounded-xl px-4 py-2.5 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary transition-colors"
            />
            <button
              onClick={grpImageFile ? sendGroupImage : sendText}
              disabled={(!input.trim() && !grpImageFile) || sending || sendingImage}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-accent-primary disabled:opacity-40 text-surface-text flex items-center justify-center font-bold transition-all hover:bg-accent-primary/80 active:scale-95"
            >
              {(sending || sendingImage) ? '…' : '→'}
            </button>
          </div>
        </div>
      </div>

      {/* Wallpaper modal */}
      {showWallpaperModal && (
        <WallpaperModal
          current={groupWallpaper}
          onSet={handleSetGroupWallpaper}
          onClear={handleClearGroupWallpaper}
          onClose={() => setShowWallpaperModal(false)}
        />
      )}

      {/* Add member modal */}
      {showAddMember && group && (
        <AddMemberModal
          group={group}
          onClose={() => setShowAddMember(false)}
          onAdded={(friend) => {
            handleMemberAdded(friend);
            setShowAddMember(false);
          }}
        />
      )}
    </div>
  );
}
