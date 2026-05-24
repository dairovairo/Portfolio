import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
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
  const isNew = !lastMessage;
  const isDeletedForEveryone = lastMessage?.deleted_for_everyone;
  const preview = isNew
    ? '¡Ahora sois amigos! Di hola 👋'
    : isDeletedForEveryone
      ? '🚫 Mensaje eliminado'
      : isHangout
        ? `🤝 ${lastMessage.content}`
        : lastMessage.content;

  return (
    <button onClick={onClick} className="w-full bg-surface-card border border-surface-border rounded-2xl p-3 flex items-center gap-3 hover:bg-surface-hover active:scale-[0.99] transition-all text-left">
      <div className="relative flex-shrink-0">
        <div className="w-12 h-12 rounded-full flex items-center justify-center font-display font-bold border-2 text-lg" style={{ borderColor: color.hex, background: `${color.hex}15` }}>
          {partner.avatar_url ? <img src={partner.avatar_url} alt="" className="w-full h-full rounded-full object-cover" /> : partner.display_name?.[0]?.toUpperCase()}
        </div>
        {online && <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-surface-card bg-green-400" />}
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
            {lastMsg ? lastMsg.content : `${group.member_count} miembros`}
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
  const groupsRef = useRef([]);

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
        fetchConversations();
        // Mark as delivered so sender sees the double tick
        if (payload.new?.sender_id) {
          api.patch(`/messages/${payload.new.sender_id}/deliver`).catch(() => {});
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${profile.id}` }, () => fetchConversations())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, () => fetchConversations())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' }, () => {
        fetchGroups();
      })
      // Refresh inbox when a friendship is accepted (UPDATE) or removed (DELETE)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'friendships' }, (payload) => {
        if (payload.new?.status === 'accepted') fetchConversations();
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'friendships' }, () => {
        fetchConversations();
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile?.id, fetchConversations, fetchGroups]);

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
      <nav className="border-b border-surface-border sticky top-0 bg-surface-bg/80 backdrop-blur-xl z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-surface-muted hover:text-surface-text p-1 text-lg transition-colors">←</button>
          <h1 className="font-display font-bold text-surface-text flex-1">
            Mensajes
            {totalUnread > 0 && <span className="ml-2 bg-accent-primary text-surface-text text-xs px-2 py-0.5 rounded-full font-bold">{totalUnread}</span>}
          </h1>
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
                        <button onClick={() => navigate('/friends')} className="mt-3 text-accent-glow text-sm hover:underline">Crear grupo →</button>
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
