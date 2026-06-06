import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import TutorialOverlay from '../components/TutorialOverlay';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { api } from '../lib/api';
import { getBatteryColor, formatRelativeTime } from '../lib/battery';
import { supabase } from '../lib/supabase';
import { isOnline } from '../hooks/usePresence';

// ── localStorage helpers for group read tracking ─────────────────────────────
function getGroupLastRead(groupId) {
  return localStorage.getItem(`grp_read_${groupId}`) || null;
}

function buildReadsMap(groups) {
  const reads = {};
  groups.forEach(g => {
    const ts = getGroupLastRead(g.id);
    if (ts) reads[g.id] = ts;
  });
  return reads;
}

// ── Direct conversation row ───────────────────────────────────────────────────
function ConversationRow({ conv, onClick, showOnline }) {
  const { partner, lastMessage, unread } = conv;
  const color = getBatteryColor(partner.battery_level ?? 50);
  const online = showOnline && isOnline(partner.last_seen_at);
  const isHangout = lastMessage?.type === 'hangout_request';
  const isImage = lastMessage?.type === 'image';
  const isNew = !lastMessage;
  const isDeletedForEveryone = lastMessage?.deleted_for_everyone;
  const preview = isNew
    ? '¡Ahora sois amigos! Di hola 👋'
    : isDeletedForEveryone
      ? '🚫 Mensaje eliminado'
      : isImage
        ? '📷 Imagen'
        : isHangout
          ? `🤝 ${lastMessage.content}`
          : lastMessage.content;

  return (
    <button onClick={onClick} className="w-full bg-surface-card border border-surface-border rounded-2xl p-3 flex items-center gap-3 hover:bg-surface-hover active:scale-[0.99] transition-all text-left">
      <div className="relative flex-shrink-0">
        <div className="w-12 h-12 rounded-full flex items-center justify-center font-display font-bold border-2 text-lg" style={{ borderColor: color.hex, background: `${color.hex}15` }}>
          {partner.avatar_url ? <img src={partner.avatar_url} alt="" className="w-full h-full rounded-full object-cover" /> : partner.display_name?.[0]?.toUpperCase()}
        </div>
        <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-surface-card ${online ? 'bg-green-400' : 'bg-slate-600'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="font-display font-semibold text-surface-text text-sm truncate">{partner.display_name}</span>
          <div className="flex items-center gap-2 flex-shrink-0">
            {lastMessage && <span className="text-xs text-slate-600 font-mono">{formatRelativeTime(lastMessage.created_at)}</span>}
            {unread > 0 && <span className="bg-accent-primary text-surface-text text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">{unread > 9 ? '9+' : unread}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <p className={`text-xs truncate flex-1 ${unread > 0 ? 'text-surface-text font-medium' : isNew ? 'text-accent-glow italic' : 'text-slate-500'}`}>{preview}</p>
          <span className="text-xs flex-shrink-0 font-mono" style={{ color: color.hex }}>🔋 {partner.battery_level}%</span>
        </div>
      </div>
    </button>
  );
}

// ── Create Group helpers ──────────────────────────────────────────────────────
function FriendPickerRow({ user, isSelected, onToggle }) {
  const color = getBatteryColor(user.battery_level ?? 50);
  return (
    <button
      onClick={() => onToggle(user.id)}
      className={`w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all text-left ${isSelected ? 'border-accent-primary/50 bg-accent-primary/5' : 'border-surface-border bg-surface-card'}`}
    >
      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[10px] flex-shrink-0 transition-all ${isSelected ? 'border-accent-primary bg-accent-primary text-white' : 'border-slate-600'}`}>
        {isSelected ? '✓' : ''}
      </div>
      <div className="w-8 h-8 rounded-full flex items-center justify-center font-display font-bold text-sm border-2 flex-shrink-0" style={{ borderColor: color.hex, background: `${color.hex}15` }}>
        {user.avatar_url ? <img src={user.avatar_url} alt="" className="w-full h-full rounded-full object-cover" /> : user.display_name?.[0]?.toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-display font-semibold text-surface-text text-sm truncate">{user.display_name || user.username}</div>
        <div className="text-xs text-surface-muted font-mono">@{user.username}</div>
      </div>
      <span className="text-xs font-mono flex-shrink-0" style={{ color: color.hex }}>🔋 {user.battery_level ?? '?'}%</span>
    </button>
  );
}

function CreateGroupModal({ onClose, onCreated }) {
  const [friends, setFriends] = useState([]);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/friends')
      .then(({ friends: data }) => setFriends(data || []))
      .catch(() => {})
      .finally(() => setLoadingFriends(false));
  }, []);

  function toggleFriend(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleCreate() {
    if (!name.trim()) { setError('El nombre del grupo es obligatorio'); return; }
    setError('');
    setSaving(true);
    try {
      const { group } = await api.post('/groups', { name: name.trim(), member_ids: [...selected] });
      onCreated(group);
      onClose();
    } catch (e) {
      setError(e.message || 'Error al crear el grupo');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-2xl p-6 max-h-[85vh] flex flex-col">
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-5 sm:hidden" />
        <div className="flex items-center gap-3 mb-5">
          <span className="text-2xl">👥</span>
          <div>
            <h2 className="font-display font-bold text-surface-text">Nuevo grupo</h2>
            <p className="text-xs text-surface-muted">Grupo privado de mensajes</p>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-mono text-surface-muted mb-1.5">Nombre del grupo *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ej: Los de siempre, Equipo fútbol..."
            maxLength={60}
            autoFocus
            className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
          />
        </div>

        <div className="mb-4 flex-1 overflow-y-auto">
          <label className="block text-xs font-mono text-surface-muted mb-2">
            Añadir amigos {selected.size > 0 && <span className="text-accent-glow">({selected.size} seleccionados)</span>}
          </label>
          {loadingFriends ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-surface-bg rounded-xl animate-pulse" />)}</div>
          ) : friends.length === 0 ? (
            <p className="text-surface-muted text-sm text-center py-4">Aún no tienes amigos para añadir</p>
          ) : (
            <div className="space-y-2">
              {friends.map(f => (
                <FriendPickerRow key={f.id} user={f} isSelected={selected.has(f.id)} onToggle={toggleFriend} />
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-red-400 text-sm font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl mb-3">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-display font-semibold text-surface-muted hover:text-surface-text transition-colors border border-surface-border">
            Cancelar
          </button>
          <button onClick={handleCreate} disabled={saving || !name.trim()} className="flex-1 py-2.5 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-surface-text text-sm font-display font-semibold disabled:opacity-50 transition-all">
            {saving ? 'Creando...' : '✓ Crear grupo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Group conversation row ────────────────────────────────────────────────────
function GroupConversationRow({ group, unread, onClick }) {
  const lastMsg = group.last_message;
  return (
    <button onClick={onClick} className="w-full bg-surface-card border border-surface-border rounded-2xl p-3 flex items-center gap-3 hover:bg-surface-hover active:scale-[0.99] transition-all text-left">
      <div className="w-12 h-12 rounded-full bg-accent-primary/15 border-2 border-accent-primary/30 flex items-center justify-center text-xl flex-shrink-0">👥</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="font-display font-semibold text-surface-text text-sm truncate">{group.name}</span>
          <div className="flex items-center gap-2 flex-shrink-0">
            {lastMsg && <span className="text-xs text-slate-600 font-mono">{formatRelativeTime(lastMsg.created_at)}</span>}
            {unread > 0 && (
              <span className="bg-accent-primary text-surface-text text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <p className={`text-xs truncate flex-1 ${unread > 0 ? 'text-surface-text font-medium' : 'text-slate-500'}`}>
            {lastMsg
              ? (lastMsg.type === 'image' ? '📷 Imagen' : lastMsg.content)
              : `${group.member_count} miembros`}
          </p>
          <span className="text-xs bg-accent-primary/15 text-accent-glow border border-accent-primary/20 px-1.5 py-0.5 rounded-full font-mono flex-shrink-0">Grupo</span>
        </div>
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MessagesInboxPage() {
  const { profile } = useAuth();
  const { showOnline } = useSettings();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [groups, setGroups] = useState([]);
  const [groupUnreads, setGroupUnreads] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('direct');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const groupsRef = useRef([]);
  const conversationsRefreshTimerRef = useRef(null);

  const fetchUnreadCounts = useCallback(async (groupList) => {
    if (!groupList || groupList.length === 0) return;
    try {
      const reads = buildReadsMap(groupList);
      const { counts } = await api.get(`/groups/unread-counts?reads=${encodeURIComponent(JSON.stringify(reads))}`);
      setGroupUnreads(counts || {});
    } catch (e) { console.error(e); }
  }, []);

  const fetchConversations = useCallback(async () => {
    try {
      const { conversations: convs } = await api.get('/messages');
      const sorted = (convs || []).sort((a, b) =>
        new Date(b.lastMessage?.created_at ?? 0) - new Date(a.lastMessage?.created_at ?? 0)
      );
      setConversations(sorted);
    } catch (e) { console.error(e); }
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const { groups: data } = await api.get('/groups');
      const list = data || [];
      setGroups(list);
      groupsRef.current = list;
      await fetchUnreadCounts(list);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [fetchUnreadCounts]);

  const scheduleFetchConversations = useCallback(() => {
    if (conversationsRefreshTimerRef.current) {
      clearTimeout(conversationsRefreshTimerRef.current);
    }
    conversationsRefreshTimerRef.current = setTimeout(() => {
      conversationsRefreshTimerRef.current = null;
      fetchConversations();
    }, 500);
  }, [fetchConversations]);

  useEffect(() => () => {
    if (conversationsRefreshTimerRef.current) clearTimeout(conversationsRefreshTimerRef.current);
  }, []);

  useEffect(() => {
    fetchConversations();
    fetchGroups();
  }, [fetchConversations, fetchGroups]);

  // Realtime: direct messages + friendship changes
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`inbox-${profile.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${profile.id}` }, (payload) => {
        scheduleFetchConversations();
        // Mark as delivered so sender sees the double tick
        if (payload.new?.sender_id) {
          api.patch(`/messages/${payload.new.sender_id}/deliver`).catch(() => {});
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${profile.id}` }, () => scheduleFetchConversations())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `receiver_id=eq.${profile.id}` }, () => scheduleFetchConversations())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `sender_id=eq.${profile.id}` }, () => scheduleFetchConversations())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' }, (payload) => {
        const msg = payload.new;
        if (!msg?.group_id) return;
        if (!groupsRef.current.some(g => g.id === msg.group_id)) return;

        const lastMessage = {
          group_id: msg.group_id,
          sender_id: msg.sender_id,
          content: msg.content,
          type: msg.type,
          created_at: msg.created_at,
        };
        setGroups(prev => {
          const next = prev.map(group =>
            group.id === msg.group_id ? { ...group, last_message: lastMessage } : group
          );
          groupsRef.current = next;
          return next;
        });
        if (msg.sender_id !== profile.id) {
          setGroupUnreads(prev => ({ ...prev, [msg.group_id]: (prev[msg.group_id] || 0) + 1 }));
        }
      })
      // Refresh inbox when a friendship is accepted (UPDATE) or removed (DELETE)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'friendships',
        filter: `requester_id=eq.${profile.id}`,
      }, (payload) => {
        if (payload.new?.status === 'accepted') scheduleFetchConversations();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'friendships',
        filter: `addressee_id=eq.${profile.id}`,
      }, (payload) => {
        if (payload.new?.status === 'accepted') scheduleFetchConversations();
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'friendships' }, () => {
        scheduleFetchConversations();
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile?.id, scheduleFetchConversations]);

  const totalDirectUnread = conversations.reduce((acc, c) => acc + (c.unread || 0), 0);
  const totalGroupUnread = Object.values(groupUnreads).reduce((acc, n) => acc + n, 0);
  const totalUnread = totalDirectUnread + totalGroupUnread;

  const q = search.toLowerCase().trim();
  const filteredConversations = q
    ? conversations.filter(c =>
        c.partner.display_name?.toLowerCase().includes(q) ||
        c.partner.username?.toLowerCase().includes(q)
      )
    : conversations;
  const filteredGroups = q
    ? groups.filter(g => g.name?.toLowerCase().includes(q))
    : groups;

  const hasContent = conversations.length > 0 || groups.length > 0;

  return (
    <div className="min-h-screen bg-surface-bg pb-24">
      <TutorialOverlay currentPage="/messages/inbox" />
      {showCreateGroup && (
        <CreateGroupModal
          onClose={() => setShowCreateGroup(false)}
          onCreated={(group) => {
            fetchGroups();
            navigate(`/messages/group/${group.id}`);
          }}
        />
      )}
      <nav className="border-b border-surface-border sticky top-0 bg-surface-bg/80 backdrop-blur-xl z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-surface-muted hover:text-surface-text p-1 text-lg transition-colors">←</button>
          <h1 className="font-display font-bold text-surface-text flex-1">
            Mensajes
            {totalUnread > 0 && <span className="ml-2 bg-accent-primary text-surface-text text-xs px-2 py-0.5 rounded-full font-bold">{totalUnread}</span>}
          </h1>
          {tab === 'groups' && (
            <button
              onClick={() => setShowCreateGroup(true)}
              className="w-8 h-8 rounded-full bg-accent-primary/20 border border-accent-primary/30 text-accent-glow flex items-center justify-center text-lg font-bold hover:bg-accent-primary/30 transition-colors"
              title="Nuevo grupo"
            >
              +
            </button>
          )}
        </div>
        {/* Tabs — solo Directos y Grupos */}
        <div className="max-w-lg mx-auto px-4 pb-2 flex gap-1">
          {[
            {
              id: 'direct',
              label: `Directos${conversations.length ? ` (${conversations.length})` : ''}`,
              badge: totalDirectUnread,
            },
            {
              id: 'groups',
              label: `Grupos${groups.length ? ` (${groups.length})` : ''}`,
              badge: totalGroupUnread,
            },
          ].map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setSearch(''); }}
              className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-display font-semibold transition-all relative ${
                tab === t.id ? 'bg-accent-primary text-surface-text' : 'text-slate-400 hover:text-surface-text'
              }`}>
              {t.label}
              {t.badge > 0 && tab !== t.id && (
                <span className="absolute -top-1 -right-1 bg-accent-primary text-surface-text text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                  {t.badge > 9 ? '9+' : t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
        {/* Search bar */}
        <div className="max-w-lg mx-auto px-4 pb-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
            <input
              type="text"
              placeholder={tab === 'direct' ? 'Buscar conversación...' : 'Buscar grupo...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-surface-card border border-surface-border rounded-xl pl-9 pr-4 py-2 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-surface-text text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-2">
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-20 bg-surface-card rounded-2xl animate-pulse" />)}</div>
        ) : !hasContent ? (
          <div className="bg-surface-card border border-surface-border rounded-2xl p-10 text-center">
            <div className="text-5xl mb-4">💬</div>
            <p className="text-slate-300 font-display font-semibold mb-1">Sin conversaciones</p>
            <p className="text-slate-500 text-sm mb-5">Empieza a chatear con tus amigos o crea un grupo</p>
            <button onClick={() => navigate('/friends')} className="bg-accent-primary/20 text-accent-glow border border-accent-primary/30 px-5 py-2.5 rounded-xl text-sm font-display font-semibold">
              Ver amigos
            </button>
          </div>
        ) : (
          <>
            {tab === 'groups' && (
              <>
                {filteredGroups.length === 0 ? (
                  <div className="text-center text-surface-muted text-sm py-8">
                    <div className="text-3xl mb-3">👥</div>
                    {q ? (
                      <p>Sin resultados para <span className="text-surface-text">"{search}"</span></p>
                    ) : (
                      <>
                        <p>Sin grupos aún</p>
                        <button onClick={() => setShowCreateGroup(true)} className="mt-3 text-accent-glow text-sm hover:underline">Crear grupo →</button>
                      </>
                    )}
                  </div>
                ) : (
                  filteredGroups.map(g => (
                    <GroupConversationRow
                      key={g.id}
                      group={g}
                      unread={groupUnreads[g.id] || 0}
                      onClick={() => navigate(`/messages/group/${g.id}`)}
                    />
                  ))
                )}
              </>
            )}
            {tab === 'direct' && (
              <>
                {filteredConversations.length === 0 ? (
                  <div className="text-center text-surface-muted text-sm py-8">
                    {q ? (
                      <p>Sin resultados para <span className="text-surface-text">"{search}"</span></p>
                    ) : (
                      <p>Sin conversaciones directas</p>
                    )}
                  </div>
                ) : (
                  filteredConversations.map(conv => (
                    <ConversationRow key={conv.partner.id} conv={conv} onClick={() => navigate(`/messages/${conv.partner.id}`)} showOnline={showOnline} />
                  ))
                )}
              </>
            )}
          </>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
