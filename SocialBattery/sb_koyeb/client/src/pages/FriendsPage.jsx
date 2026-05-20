import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomNav from '../components/BottomNav';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { getBatteryColor, formatRelativeTime } from '../lib/battery';
import { supabase } from '../lib/supabase';
import { isOnline, useFriendsOnline } from '../hooks/usePresence';

// ── Shared Components ──────────────────────────────────────────────────────

function Avatar({ user, size = 'md', online = false }) {
  const color = getBatteryColor(user.battery_level ?? 50);
  const sizes = { sm: 'w-9 h-9 text-sm', md: 'w-12 h-12 text-lg', lg: 'w-16 h-16 text-2xl' };
  return (
    <div
      className={`${sizes[size]} rounded-full flex items-center justify-center font-display font-bold border-2 flex-shrink-0 relative`}
      style={{ borderColor: color.hex, boxShadow: `0 0 12px ${color.hex}25`, background: `${color.hex}15` }}
    >
      {user.avatar_url
        ? <img src={user.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
        : (user.display_name || user.username)?.[0]?.toUpperCase()
      }
      {/* Battery dot */}
      <div
        className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-surface-card"
        style={{ backgroundColor: color.hex }}
      />
      {/* Online ring */}
      {online && (
        <div className="absolute inset-0 rounded-full ring-2 ring-green-400/50 ring-offset-1 ring-offset-surface-bg" />
      )}
    </div>
  );
}

function BatteryBadge({ level, isEstimated }) {
  const color = getBatteryColor(level ?? 50);
  return (
    <div className="flex items-center gap-1">
      <span className="font-display font-bold tabular-nums text-sm" style={{ color: color.hex }}>
        {level ?? '—'}%
      </span>
      {isEstimated && (
        <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1 py-0.5 rounded font-mono">⚡</span>
      )}
    </div>
  );
}

function OnlineLabel({ online, lastSeenAt }) {
  if (online) return <span className="text-xs text-green-400 font-mono">● En línea</span>;
  if (lastSeenAt) return <span className="text-xs text-slate-600 font-mono">{formatRelativeTime(lastSeenAt)}</span>;
  return <span className="text-xs text-slate-700 font-mono">Sin actividad</span>;
}

// ── Friend Row ──────────────────────────────────────────────────────────────

function FriendRow({ friend, onMessage, onRemove, myBattery, online }) {
  const navigate = useNavigate();
  const diff = Math.abs((friend.battery_level ?? 50) - myBattery);

  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl p-3 flex items-center gap-3 group hover:bg-surface-hover transition-all">
      <button onClick={() => navigate(`/user/${friend.id}`)} className="flex-shrink-0">
        <Avatar user={friend} size="sm" online={online} />
      </button>
      <div className="flex-1 min-w-0">
        <button onClick={() => navigate(`/user/${friend.id}`)} className="text-left w-full">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold text-surface-text text-sm truncate">
              {friend.display_name || friend.username}
            </span>
            {diff <= 15 && (
              <span className="text-xs bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded-md font-mono flex-shrink-0">
                ~tuyo
              </span>
            )}
          </div>
          <OnlineLabel online={online} lastSeenAt={friend.last_seen_at} />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <BatteryBadge level={friend.battery_level} isEstimated={friend.battery_is_estimated} />
        <button
          onClick={() => onMessage(friend)}
          className="p-1.5 text-surface-muted hover:text-accent-glow transition-colors rounded-lg hover:bg-accent-primary/10"
          title="Enviar mensaje"
        >
          💬
        </button>
        <button
          onClick={() => onRemove(friend)}
          className="p-1.5 text-slate-600 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10 opacity-0 group-hover:opacity-100"
          title="Eliminar amigo"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ── Search Result Row ───────────────────────────────────────────────────────

function UserRow({ user, action, onAction, loading }) {
  const navigate = useNavigate();
  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl p-3 flex items-center gap-3">
      <button onClick={() => navigate(`/user/${user.id}`)} className="flex-shrink-0">
        <Avatar user={user} size="sm" online={isOnline(user.last_seen_at)} />
      </button>
      <div className="flex-1 min-w-0">
        <button onClick={() => navigate(`/user/${user.id}`)} className="text-left">
          <div className="font-display font-semibold text-surface-text text-sm truncate">
            {user.display_name || user.username}
          </div>
          <div className="text-xs text-surface-muted font-mono">@{user.username}</div>
        </button>
      </div>
      <BatteryBadge level={user.battery_level} isEstimated={user.battery_is_estimated} />
      {action && (
        <button
          onClick={() => onAction(user)}
          disabled={loading}
          className={`flex-shrink-0 text-xs font-display font-semibold px-3 py-1.5 rounded-lg transition-all duration-200 ${action.style}`}
        >
          {loading ? '...' : action.label}
        </button>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function FriendsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const myBattery = profile?.battery_level ?? 50;

  const [tab, setTab] = useState('friends');
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [sentRequests, setSentRequests] = useState(new Set());
  const [toast, setToast] = useState(null);

  // Online status map for friends
  const onlineMap = useFriendsOnline(friends);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchFriends = useCallback(async () => {
    try {
      const { friends: data } = await api.get('/friends');
      const sorted = [...(data || [])].sort((a, b) => {
        return (b.battery_level ?? -1) - (a.battery_level ?? -1);
      });
      setFriends(sorted);
    } catch (e) { console.error(e); }
    finally { setLoadingFriends(false); }
  }, [myBattery]);

  const fetchRequests = useCallback(async () => {
    try {
      const { requests: data } = await api.get('/friends/requests');
      setRequests(data || []);
    } catch (e) { console.error(e); }
    finally { setLoadingRequests(false); }
  }, []);

  useEffect(() => { fetchFriends(); fetchRequests(); }, [fetchFriends, fetchRequests]);

  // Realtime: new friend requests
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`friendships-${profile.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'friendships',
        filter: `addressee_id=eq.${profile.id}`,
      }, () => { fetchRequests(); })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'friendships',
      }, () => { fetchFriends(); fetchRequests(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, fetchFriends, fetchRequests]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoadingSearch(true);
      try {
        const { users } = await api.get(`/users/search?q=${encodeURIComponent(searchQuery)}`);
        setSearchResults(users || []);
      } catch (e) { console.error(e); }
      finally { setLoadingSearch(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  async function sendRequest(user) {
    setActionLoading(l => ({ ...l, [user.id]: true }));
    try {
      await api.post('/friends/request', { addressee_id: user.id });
      setSentRequests(s => new Set([...s, user.id]));
      showToast(`Solicitud enviada a @${user.username} 🤝`);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setActionLoading(l => ({ ...l, [user.id]: false }));
    }
  }

  async function respondRequest(requestId, status, requesterName) {
    setActionLoading(l => ({ ...l, [requestId]: true }));
    try {
      await api.patch(`/friends/request/${requestId}`, { status });
      setRequests(r => r.filter(req => req.id !== requestId));
      if (status === 'accepted') {
        showToast(`¡Ahora eres amigo de @${requesterName}! 🎉`);
        fetchFriends();
      } else {
        showToast('Solicitud rechazada');
      }
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setActionLoading(l => ({ ...l, [requestId]: false }));
    }
  }

  async function removeFriend(friend) {
    if (!confirm(`¿Eliminar a @${friend.username} de tus amigos?`)) return;
    try {
      await api.delete(`/friends/${friend.id}`);
      setFriends(f => f.filter(fr => fr.id !== friend.id));
      showToast(`@${friend.username} eliminado de amigos`);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  const friendIds = new Set(friends.map(f => f.id));
  const pendingCount = requests.length;
  const onlineFriendsCount = friends.filter(f => onlineMap[f.id]).length;

  return (
    <div className="min-h-screen bg-surface-bg pb-24">
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
      <nav className="border-b border-surface-border sticky top-0 bg-surface-bg/80 backdrop-blur-xl z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-surface-muted hover:text-surface-text transition-colors p-1 text-lg">
            ←
          </button>
          <h1 className="font-display font-bold text-surface-text flex-1">Amigos</h1>
          <div className="flex items-center gap-2">
            {onlineFriendsCount > 0 && (
              <span className="text-xs text-green-400 font-mono flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full inline-block" />
                {onlineFriendsCount} en línea
              </span>
            )}
            {pendingCount > 0 && (
              <span className="bg-accent-primary text-surface-text text-xs font-display font-bold px-2 py-0.5 rounded-full animate-pulse">
                {pendingCount}
              </span>
            )}
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-lg mx-auto px-4 pb-3 flex gap-1">
          {[
            { id: 'friends', label: `Amigos${friends.length ? ` (${friends.length})` : ''}` },
            { id: 'requests', label: `Solicitudes${pendingCount ? ` (${pendingCount})` : ''}` },
            { id: 'search', label: '🔍 Buscar' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-display font-semibold transition-all duration-200 ${
                tab === t.id
                  ? 'bg-accent-primary text-surface-text'
                  : 'text-slate-400 hover:text-surface-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-2">

        {/* ── FRIENDS TAB ──────────────────────────────────────────────── */}
        {tab === 'friends' && (
          <>
            {loadingFriends ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-16 bg-surface-card rounded-2xl animate-pulse" />)}
              </div>
            ) : friends.length === 0 ? (
              <div className="bg-surface-card border border-surface-border rounded-2xl p-10 text-center">
                <div className="text-5xl mb-3">👥</div>
                <p className="text-slate-300 font-display font-semibold mb-1">Sin amigos aún</p>
                <p className="text-slate-500 text-sm mb-5">
                  Busca personas para conectar según vuestra energía social
                </p>
                <button
                  onClick={() => setTab('search')}
                  className="bg-accent-primary/20 text-accent-glow border border-accent-primary/30 px-4 py-2 rounded-xl text-sm font-display font-semibold hover:bg-accent-primary/30 transition-all"
                >
                  Buscar personas
                </button>
              </div>
            ) : (
              <>
                <p className="text-xs text-slate-600 font-mono px-1">
                  Ordenados por batería social, de más a menos
                  {onlineFriendsCount > 0 && ` · ${onlineFriendsCount} en línea`}
                </p>
                {friends.map(f => (
                  <FriendRow
                    key={f.id}
                    friend={f}
                    myBattery={myBattery}
                    online={!!onlineMap[f.id]}
                    onMessage={() => navigate(`/messages/${f.id}`)}
                    onRemove={removeFriend}
                  />
                ))}
              </>
            )}
          </>
        )}

        {/* ── REQUESTS TAB ──────────────────────────────────────────────── */}
        {tab === 'requests' && (
          <>
            {loadingRequests ? (
              <div className="space-y-2">
                {[1, 2].map(i => <div key={i} className="h-16 bg-surface-card rounded-2xl animate-pulse" />)}
              </div>
            ) : requests.length === 0 ? (
              <div className="bg-surface-card border border-surface-border rounded-2xl p-10 text-center">
                <div className="text-5xl mb-3">📭</div>
                <p className="text-slate-300 font-display font-semibold mb-1">Sin solicitudes pendientes</p>
                <p className="text-slate-500 text-sm">Cuando alguien te envíe una solicitud, aparecerá aquí</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-slate-600 font-mono px-1">
                  {requests.length} solicitud{requests.length !== 1 ? 'es' : ''} pendiente{requests.length !== 1 ? 's' : ''}
                </p>
                {requests.map(req => (
                  <div key={req.id} className="bg-surface-card border border-surface-border rounded-2xl p-3 flex items-center gap-3">
                    <button onClick={() => navigate(`/user/${req.requester.id}`)} className="flex-shrink-0">
                      <Avatar user={req.requester} size="sm" online={isOnline(req.requester.last_seen_at)} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-semibold text-surface-text text-sm truncate">
                        {req.requester.display_name || req.requester.username}
                      </div>
                      <div className="text-xs text-surface-muted font-mono">@{req.requester.username}</div>
                    </div>
                    <BatteryBadge level={req.requester.battery_level} />
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => respondRequest(req.id, 'accepted', req.requester.username)}
                        disabled={actionLoading[req.id]}
                        className="bg-green-500/20 text-green-400 border border-green-500/30 text-xs font-display font-semibold px-3 py-1.5 rounded-lg hover:bg-green-500/30 active:scale-95 transition-all disabled:opacity-50"
                      >
                        ✓ Aceptar
                      </button>
                      <button
                        onClick={() => respondRequest(req.id, 'rejected', req.requester.username)}
                        disabled={actionLoading[req.id]}
                        className="bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-display font-semibold px-2 py-1.5 rounded-lg hover:bg-red-500/20 active:scale-95 transition-all disabled:opacity-50"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* ── SEARCH TAB ──────────────────────────────────────────────────── */}
        {tab === 'search' && (
          <>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar por username..."
                autoFocus
                className="w-full bg-surface-card border border-surface-border rounded-2xl px-4 py-3 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary transition-colors pr-10"
              />
              {loadingSearch && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-surface-muted text-xs animate-pulse">
                  ...
                </div>
              )}
            </div>

            {searchQuery.length >= 2 && !loadingSearch && (
              searchResults.length === 0 ? (
                <div className="text-center text-surface-muted text-sm py-8">
                  No se encontraron usuarios con "@{searchQuery}"
                </div>
              ) : (
                <div className="space-y-2">
                  {searchResults.map(user => {
                    const isFriend = friendIds.has(user.id);
                    const sent = sentRequests.has(user.id);
                    return (
                      <UserRow
                        key={user.id}
                        user={user}
                        loading={actionLoading[user.id]}
                        action={
                          isFriend
                            ? { label: '✓ Amigos', style: 'bg-surface-bg text-surface-muted cursor-default border border-surface-border' }
                            : sent
                            ? { label: '✓ Enviado', style: 'bg-surface-bg text-surface-muted cursor-default border border-surface-border' }
                            : { label: '+ Añadir', style: 'bg-accent-primary text-surface-text hover:bg-accent-primary/80 active:scale-95 transition-all' }
                        }
                        onAction={isFriend || sent ? () => {} : sendRequest}
                      />
                    );
                  })}
                </div>
              )
            )}

            {searchQuery.length < 2 && (
              <div className="text-center text-surface-muted text-sm py-10">
                <div className="text-3xl mb-3">🔍</div>
                Escribe al menos 2 caracteres para buscar
              </div>
            )}
          </>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
