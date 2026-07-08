import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../lib/api';
import BatterySlider from '../components/BatterySlider';
import FriendCard from '../components/FriendCard';
import BadgeUnlockModal from '../components/BadgeUnlockModal';
import TutorialOverlay from '../components/TutorialOverlay';
import BottomNav from '../components/BottomNav';
import { getBatteryColor, formatRelativeTime, getEffectiveBatteryLevel, isBatteryExpired } from '../lib/battery';
import { supabase } from '../lib/supabase';
import { isOnline, useFriendsOnline } from '../hooks/usePresence';
import { generateBatteryStoryBlob, generateInviteBlob, shareOrDownloadBlob } from '../lib/instagramStory';
import { resolveMascotLayers } from '../lib/mascotRenderer';
import { useMascot } from '../context/MascotContext';
import MascotDisplay from '../components/MascotDisplay';
import LogoWordmark from '../components/LogoWordmark';
import { claimDailyBatteryReward, DAILY_BATTERY_REWARD, CURRENCY_NAME_PLURAL } from '../lib/currency';

// ── Avatar helper ─────────────────────────────────────────────────────────────
function getMascotTier(level) {
  if (level <= 33) return 'low';
  if (level <= 66) return 'mid';
  return 'high';
}

function Avatar({ user, size = 'sm', online = false }) {
  const color = getBatteryColor(user.battery_level ?? 50);
  const sz = size === 'sm' ? 'w-9 h-9 text-sm' : 'w-12 h-12 text-base';
  return (
    <div
      className={`${sz} rounded-full flex items-center justify-center font-display font-bold border-2 flex-shrink-0 relative`}
      style={{ borderColor: color.hex, boxShadow: `0 0 10px ${color.hex}20`, background: `${color.hex}15` }}
    >
      {user.avatar_url
        ? <img src={user.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
        : user.username?.[0]?.toUpperCase()
      }
      <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface-card ${online ? 'bg-green-400' : 'bg-slate-600'}`} />
    </div>
  );
}

function BatteryBadge({ level, isEstimated }) {
  const color = getBatteryColor(level ?? 50);
  return (
    <div className="flex items-center gap-1">
      <span className="font-display font-bold tabular-nums text-sm" style={{ color: color.hex }}>{level ?? '—'}%</span>
      {isEstimated && <span className="text-xs text-yellow-400">⚡</span>}
    </div>
  );
}

// ── Search friends modal ──────────────────────────────────────────────────────
function SearchModal({ friends, onClose, onToast }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { getMascotLayers, getFeetZones, getHeadZones, getOutfitZones, getAccessoryZones } = useMascot();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [sent, setSent] = useState(new Set());
  const [sharingInvite, setSharingInvite] = useState(false);
  const friendIds = new Set(friends.map(f => f.id));
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function handleInvite() {
    if (sharingInvite) return;
    setSharingInvite(true);
    try {
      const level = getEffectiveBatteryLevel(profile);
      const color = getBatteryColor(level);
      // Resolvemos la mascota tal y como está equipada ahora mismo, para
      // incluirla como "fotito" personal en la imagen de invitación.
      let mascot = null;
      try {
        mascot = await resolveMascotLayers(getMascotTier(level), {
          getMascotLayers, getFeetZones, getHeadZones, getOutfitZones, getAccessoryZones,
        });
      } catch (_) {
        mascot = null; // si falla, se genera la invitación sin la mascota
      }
      const username = profile?.username || 'Alguien';
      const blob = await generateInviteBlob({ username, mascot, hex: color.hex });
      const result = await shareOrDownloadBlob(blob, 'invitacion-sb.png', `${username} te ha invitado a SocialBattery`);
      if (result.method === 'download') {
        onToast('Imagen descargada. ¡Compártela donde quieras! 📲', 'success');
      } else if (result.method === 'share') {
        onToast('¡Invitación lista para compartir! 🚀', 'success');
      }
    } catch (e) {
      onToast('Error al generar la invitación', 'error');
    } finally {
      setSharingInvite(false);
    }
  }

  useEffect(() => {
    if (!query.trim() || query.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { users } = await api.get(`/users/search?q=${encodeURIComponent(query)}`);
        setResults(users || []);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  async function sendRequest(user) {
    setActionLoading(l => ({ ...l, [user.id]: true }));
    try {
      await api.post('/friends/request', { addressee_id: user.id });
      setSent(s => new Set([...s, user.id]));
      onToast(`Solicitud enviada a ${user.username} 🤝`);
    } catch (e) { onToast(e.message, 'error'); }
    finally { setActionLoading(l => ({ ...l, [user.id]: false })); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-2xl p-5 max-h-[80vh] flex flex-col">
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-4 sm:hidden" />
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xl">🔍</span>
          <h2 className="font-display font-bold text-surface-text flex-1">Buscar personas</h2>
          <button onClick={onClose} className="text-surface-muted hover:text-surface-text text-xl leading-none">×</button>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar por username..."
          className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text text-sm placeholder-slate-600 focus:outline-none focus:border-accent-primary transition-colors mb-3"
        />
        <div className="overflow-y-auto flex-1 space-y-2">
          {loading && <div className="text-center text-surface-muted text-sm py-6 animate-pulse">Buscando...</div>}
          {!loading && query.length >= 2 && results.length === 0 && (
            <div className="text-center text-surface-muted text-sm py-8">Sin resultados para "{query}"</div>
          )}
          {!loading && query.length < 2 && (
            <div className="text-center text-surface-muted text-sm py-8">
              <div className="text-3xl mb-2">👥</div>
              Escribe al menos 2 caracteres
            </div>
          )}
          {results.map(user => {
            const isFriend = friendIds.has(user.id);
            const wasSent = sent.has(user.id);
            return (
              <div key={user.id} className="bg-surface-bg border border-surface-border rounded-2xl p-3 flex items-center gap-3">
                <button onClick={() => navigate(`/user/${user.id}`)} className="flex-shrink-0">
                  <Avatar user={user} />
                </button>
                <div className="flex-1 min-w-0">
                  <button onClick={() => navigate(`/user/${user.id}`)} className="text-left">
                    <div className="font-display font-semibold text-surface-text text-sm truncate">{user.username}</div>
                    <div className="text-xs text-surface-muted font-mono">{user.username}</div>
                  </button>
                </div>
                <BatteryBadge level={user.battery_level} isEstimated={user.battery_is_estimated} />
                {isFriend ? (
                  <span className="text-xs text-surface-muted border border-surface-border px-2 py-1 rounded-lg">✓ Amigos</span>
                ) : wasSent ? (
                  <span className="text-xs text-surface-muted border border-surface-border px-2 py-1 rounded-lg">✓ Enviado</span>
                ) : (
                  <button
                    onClick={() => sendRequest(user)}
                    disabled={actionLoading[user.id]}
                    className="text-xs font-display font-semibold px-3 py-1.5 rounded-lg bg-accent-primary text-surface-text hover:bg-accent-primary/80 disabled:opacity-50 transition-all"
                  >
                    {actionLoading[user.id] ? '...' : '+ Añadir'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Invitar por redes sociales ──────────────────────────────────── */}
        <div className="pt-3 mt-3 border-t border-surface-border flex-shrink-0">
          <button
            onClick={handleInvite}
            disabled={sharingInvite}
            className="w-full bg-accent-primary/10 border border-accent-primary/25 rounded-2xl p-4 flex items-center gap-3 hover:bg-accent-primary/15 transition-all text-left disabled:opacity-60"
          >
            <span className="text-2xl">{sharingInvite ? '⏳' : '📲'}</span>
            <div>
              <div className="font-display font-semibold text-surface-text text-sm">
                {sharingInvite ? 'Generando invitación...' : 'Invitar por redes sociales'}
              </div>
              <div className="text-xs text-accent-glow">WhatsApp, Instagram Direct y más →</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Friend requests modal ─────────────────────────────────────────────────────
function RequestsModal({ onClose, onToast, onAccepted }) {
  const navigate = useNavigate();
  const { showOnline } = useSettings();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState({});

  useEffect(() => {
    api.get('/friends/requests')
      .then(({ requests: data }) => setRequests(data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function respond(requestId, status, username) {
    setActionLoading(l => ({ ...l, [requestId]: true }));
    try {
      await api.patch(`/friends/request/${requestId}`, { status });
      setRequests(r => r.filter(req => req.id !== requestId));
      if (status === 'accepted') { onToast(`¡Ahora eres amigo de ${username}! 🎉`); onAccepted?.(); }
      else onToast('Solicitud rechazada');
    } catch (e) { onToast(e.message, 'error'); }
    finally { setActionLoading(l => ({ ...l, [requestId]: false })); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-2xl p-5 max-h-[80vh] flex flex-col">
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-4 sm:hidden" />
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xl">🤝</span>
          <h2 className="font-display font-bold text-surface-text flex-1">Solicitudes de amistad</h2>
          <button onClick={onClose} className="text-surface-muted hover:text-surface-text text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 space-y-2">
          {loading && (
            <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-16 bg-surface-bg rounded-2xl animate-pulse" />)}</div>
          )}
          {!loading && requests.length === 0 && (
            <div className="text-center py-10">
              <div className="text-4xl mb-3">📭</div>
              <p className="text-surface-muted text-sm">Sin solicitudes pendientes</p>
            </div>
          )}
          {requests.map(req => (
            <div key={req.id} className="bg-surface-bg border border-surface-border rounded-2xl p-3 flex items-center gap-3">
              <button onClick={() => navigate(`/user/${req.requester.id}`)} className="flex-shrink-0">
                <Avatar user={req.requester} online={showOnline && isOnline(req.requester.last_seen_at)} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="font-display font-semibold text-surface-text text-sm truncate">{req.requester.username}</div>
                <div className="text-xs text-surface-muted font-mono">{req.requester.username}</div>
              </div>
              <BatteryBadge level={req.requester.battery_level} />
              <div className="flex gap-1.5 flex-shrink-0">
                <button
                  onClick={() => respond(req.id, 'accepted', req.requester.username)}
                  disabled={actionLoading[req.id]}
                  className="bg-green-500/20 text-green-400 border border-green-500/30 text-xs font-display font-semibold px-3 py-1.5 rounded-lg hover:bg-green-500/30 transition-all disabled:opacity-50"
                >✓ Aceptar</button>
                <button
                  onClick={() => respond(req.id, 'rejected', req.requester.username)}
                  disabled={actionLoading[req.id]}
                  className="bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-display font-semibold px-2 py-1.5 rounded-lg hover:bg-red-500/20 transition-all disabled:opacity-50"
                >✕</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Create group modal ────────────────────────────────────────────────────────
function CreateGroupModal({ friends, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggle(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleCreate() {
    if (!name.trim()) { setError('El nombre del grupo es obligatorio'); return; }
    setError('');
    setSaving(true);
    try {
      await onCreate({ name: name.trim(), member_ids: [...selected] });
      onClose();
    } catch (e) {
      setError(e.message || 'Error al crear el grupo');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-2xl p-5 max-h-[85vh] flex flex-col">
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-4 sm:hidden" />
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xl">👥</span>
          <div className="flex-1">
            <h2 className="font-display font-bold text-surface-text">Crear grupo</h2>
            <p className="text-xs text-surface-muted">Grupo privado para quedadas</p>
          </div>
          <button onClick={onClose} className="text-surface-muted hover:text-surface-text text-xl leading-none">×</button>
        </div>
        <div className="mb-3">
          <label className="block text-xs font-mono text-surface-muted mb-1.5">Nombre del grupo *</label>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Ej: Los de siempre, Equipo fútbol..." maxLength={60} autoFocus
            className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
          />
        </div>
        <div className="mb-3 flex-1 overflow-y-auto">
          <label className="block text-xs font-mono text-surface-muted mb-2">
            Añadir amigos {selected.size > 0 && <span className="text-accent-glow">({selected.size} seleccionados)</span>}
          </label>
          {friends.length === 0
            ? <p className="text-surface-muted text-sm text-center py-4">Aún no tienes amigos para añadir</p>
            : (
              <div className="space-y-2">
                {friends.map(f => {
                  const sel = selected.has(f.id);
                  return (
                    <div key={f.id} onClick={() => toggle(f.id)} className={`bg-surface-bg border rounded-2xl p-3 flex items-center gap-3 cursor-pointer transition-all ${sel ? 'border-accent-primary/50 bg-accent-primary/5' : 'border-surface-border'}`}>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs transition-all flex-shrink-0 ${sel ? 'border-accent-primary bg-accent-primary text-white' : 'border-slate-600'}`}>
                        {sel ? '✓' : ''}
                      </div>
                      <Avatar user={f} />
                      <div className="flex-1 min-w-0">
                        <div className="font-display font-semibold text-surface-text text-sm truncate">{f.username}</div>
                        <div className="text-xs text-surface-muted font-mono">{f.username}</div>
                      </div>
                      <BatteryBadge level={f.battery_level} isEstimated={f.battery_is_estimated} />
                    </div>
                  );
                })}
              </div>
            )
          }
        </div>
        {error && <p className="text-red-400 text-xs font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl mb-3">{error}</p>}
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

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function HomePage() {
  const { profile, refreshProfile } = useAuth();
  const { addToast } = useToast();
  const { isLight } = useTheme();
  const navigate = useNavigate();
  const { getMascotLayers, getFeetZones, getHeadZones, getOutfitZones, getAccessoryZones } = useMascot();

  const [battery, setBattery] = useState(profile?.battery_level ?? 50);
  const [friends, setFriends] = useState([]);
  const onlineMap = useFriendsOnline(friends);
  const [groups, setGroups] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [newBadges, setNewBadges] = useState([]);
  const [sharingStory, setSharingStory] = useState(false);
  const [ultraBannerEvents, setUltraBannerEvents] = useState([]);
  const friendIdsRef = useRef(new Set());

  // Modal state
  const [showSearch, setShowSearch] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  useEffect(() => {
    if (profile) setBattery(getEffectiveBatteryLevel(profile));
  }, [profile]);

  useEffect(() => {
    friendIdsRef.current = new Set(friends.map(f => f.id));
  }, [friends]);

  const fetchFriends = useCallback(async () => {
    try {
      const { friends: data } = await api.get('/battery/friends');
      const sorted = [...(data || [])].sort((a, b) => (b.battery_level ?? -1) - (a.battery_level ?? -1));
      setFriends(sorted);
    } catch (e) { console.error(e); }
    finally { setLoadingFriends(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — no deps: profile.battery_level was causing a cascade refetch on every save

  const fetchPending = useCallback(async () => {
    try {
      const { requests } = await api.get('/friends/requests');
      setPendingCount((requests || []).length);
    } catch (e) {}
  }, []);

  const fetchUnread = useCallback(async () => {
    try {
      const { count } = await api.get('/messages/unread-count');
      setUnreadCount(count || 0);
    } catch (e) {}
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const { groups: data } = await api.get('/groups');
      setGroups(data || []);
    } catch (e) {}
  }, []);

  const fetchUltraBannerEvents = useCallback(async () => {
    try {
      const { events } = await api.get('/community/events/ultra-banner');
      setUltraBannerEvents(events || []);
    } catch (e) {}
  }, []);

  useEffect(() => {
    fetchFriends();
    fetchPending();
    fetchUnread();
    fetchGroups();
    fetchUltraBannerEvents();
  }, [fetchFriends, fetchPending, fetchUnread, fetchGroups, fetchUltraBannerEvents]);

  // Realtime subscriptions
  useEffect(() => {
    if (!profile?.id) return;
    const ch1 = supabase.channel('home-users')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, (payload) => {
        const updated = payload.new;
        if (!updated?.id || !friendIdsRef.current.has(updated.id)) return;
        setFriends(prev => {
          let changed = false;
          const next = prev.map(friend => {
            if (friend.id !== updated.id) return friend;
            changed = true;
            return { ...friend, ...updated };
          });
          return changed
            ? next.sort((a, b) => (b.battery_level ?? -1) - (a.battery_level ?? -1))
            : prev;
        });
      })
      .subscribe();
    const ch2 = supabase.channel('home-friendships')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'friendships',
        filter: `addressee_id=eq.${profile.id}`,
      }, () => fetchPending())
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'friendships',
        filter: `addressee_id=eq.${profile.id}`,
      }, (payload) => {
        // Cubre el caso en el que la solicitud se acepta desde otra pantalla
        // (p. ej. la página de Amigos) o desde otro dispositivo: en cuanto
        // cambia a "accepted" refrescamos al instante, sin recargar la página.
        if (payload.new?.status === 'accepted') { fetchFriends(); fetchPending(); }
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'friendships',
        filter: `requester_id=eq.${profile.id}`,
      }, (payload) => {
        // La otra persona aceptó una solicitud que enviamos nosotros — que
        // aparezca en "Amigos" al instante, sin esperar a un refresco manual.
        if (payload.new?.status === 'accepted') fetchFriends();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); };
  }, [profile?.id, fetchFriends, fetchPending]);

  async function shareBatteryStory() {
    if (sharingStory) return;
    setSharingStory(true);
    try {
      const color = getBatteryColor(profileBatteryLevel);
      // Resolvemos la mascota tal y como está equipada ahora mismo (ropa,
      // calzado, gorro, accesorios y actividad), con sus colores
      // personalizados ya aplicados, para "hornearla" dentro de la imagen.
      let mascot = null;
      try {
        mascot = await resolveMascotLayers(getMascotTier(profileBatteryLevel), {
          getMascotLayers, getFeetZones, getHeadZones, getOutfitZones, getAccessoryZones,
        });
      } catch (_) {
        mascot = null; // si falla, se genera la historia sin la mascota
      }
      const blob = await generateBatteryStoryBlob({
        level: profileBatteryLevel,
        label: color.label,
        hex: color.hex,
        username: profile?.username || '',
        avatarUrl: profile?.avatar_url || null,
        mascot,
        mascotName: profile?.mascot_name || 'Volty',
      });
      const result = await shareOrDownloadBlob(blob, 'mi-bateria-social.png', 'Mi batería social · SocialBattery');
      if (result.method === 'download') {
        addToast('Imagen descargada. ¡Súbela a tu historia! 📸', 'success');
      } else if (result.method === 'share') {
        addToast('¡Historia lista para compartir! 🚀', 'success');
      }
    } catch (e) {
      addToast('Error al generar la historia', 'error');
    } finally {
      setSharingStory(false);
    }
  }

  async function saveBattery() {
    setSaving(true);
    try {
      const { newBadges: earned } = await api.patch('/battery', { level: battery });
      await refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);

      if (earned?.length > 0) {
        setNewBadges(earned);
        addToast(`¡Batería actualizada! +${earned.length} insignia${earned.length > 1 ? 's' : ''} 🏅`, 'success');
      } else {
        addToast('¡Batería actualizada!', 'success');
      }

      const reward = claimDailyBatteryReward(profile?.id);
      if (reward.claimed) {
        addToast(`⚡ +${DAILY_BATTERY_REWARD} ${CURRENCY_NAME_PLURAL} · recompensa diaria`, 'success');
      }
    } catch (err) {
      addToast('Error al actualizar', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function createGroup({ name, member_ids }) {
    const { group } = await api.post('/groups', { name, member_ids });
    addToast(`Grupo "${group.name}" creado 🎉`, 'success');
    fetchGroups();
  }

  const profileBatteryLevel = profile ? getEffectiveBatteryLevel(profile) : battery;
  const pendingUpdate = profile && isBatteryExpired(profile.battery_updated_at);

  const color = getBatteryColor(profileBatteryLevel);
  // batteryColor: live slider value — updates immediately while dragging
  const batteryColor = getBatteryColor(battery);

  return (
    <div className="min-h-screen bg-surface-bg pb-24">
      <TutorialOverlay currentPage="/" />
      <BadgeUnlockModal badges={newBadges} onClose={() => setNewBadges([])} />

      {/* Modals */}
      {showSearch && (
        <SearchModal
          friends={friends}
          onClose={() => setShowSearch(false)}
          onToast={(msg, type) => addToast(msg, type || 'success')}
        />
      )}
      {showRequests && (
        <RequestsModal
          onClose={() => setShowRequests(false)}
          onToast={(msg, type) => addToast(msg, type || 'success')}
          onAccepted={() => { fetchFriends(); fetchPending(); }}
        />
      )}
      {showCreateGroup && (
        <CreateGroupModal
          friends={friends}
          onClose={() => setShowCreateGroup(false)}
          onCreate={createGroup}
        />
      )}

      {/* Top nav */}
      <nav className="border-b border-surface-border sticky top-0 bg-surface-bg/90 backdrop-blur-xl z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo-icon.png" alt="SocialBattery" className="h-6 w-auto" />
            <span className="font-display font-bold text-surface-text">
              <LogoWordmark />
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate('/shop')}
              className="p-2 text-surface-text hover:text-accent-glow transition-colors text-base"
              title="Tienda"
            >
              <span className="sb-symbol text-lg" aria-hidden="true">🛒</span>
            </button>
            <button
              onClick={() => navigate('/settings')}
              className="p-2 text-surface-text hover:text-accent-glow transition-colors text-base"
              title="Ajustes"
            >
              <span className="sb-symbol text-lg" aria-hidden="true">⚙︎</span>
            </button>
            <button
              onClick={() => navigate('/profile')}
              className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-display font-bold overflow-hidden"
              style={{ borderColor: color.hex, background: `${color.hex}20`, color: color.hex }}
            >
              {profile?.avatar_url
                ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover rounded-full" />
                : (profile?.username?.[0] || '?').toUpperCase()
              }
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-lg mx-auto px-4 py-5 space-y-4">

        {/* Ultra event banner — eventos ultra notificados hoy al usuario */}
        {ultraBannerEvents.map(ev => (
          <button
            key={ev.id}
            type="button"
            onClick={() => navigate(`/community/event/${ev.id}`)}
            className="w-full bg-yellow-500/10 border border-yellow-400/30 rounded-2xl px-4 py-3 flex items-center gap-3 animate-slide-down hover:bg-yellow-500/15 active:scale-[0.99] transition-all text-left"
          >
            <span className="text-xl flex-shrink-0">🚀</span>
            <div className="flex-1 min-w-0">
              <p className="text-yellow-300 text-xs font-semibold truncate">Evento destacado: {ev.title}</p>
              <p className="text-yellow-300/60 text-[11px] truncate">
                {ev.location ? `${ev.location} · ` : ''}¡No te lo pierdas!
              </p>
            </div>
            <span className="text-yellow-300/50 text-base flex-shrink-0">›</span>
          </button>
        ))}

        {/* Daily update nudge */}
        {pendingUpdate && (
          <div className="bg-yellow-500/8 border border-yellow-500/20 rounded-2xl px-4 py-3 flex items-center gap-3 animate-slide-down">
            <span className="text-xl">⚡</span>
            <p className="text-yellow-300/80 text-xs flex-1">
              No has actualizado tu batería hoy. ¡Cuéntales a tus amigos cómo estás!
            </p>
          </div>
        )}

        {/* Battery card */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5 animate-slide-up">

          {/* Header: label + level left · mascot right */}
          <div className="flex items-end justify-between mb-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-white/70 uppercase tracking-widest">Tu batería social</span>
              {profile?.battery_is_estimated && (
                <span className="text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-lg font-mono self-start">
                  ⚡ Estimada
                </span>
              )}
              <div className="flex items-end gap-1 mt-1">
                <span
                  className="font-display text-5xl font-bold leading-none"
                  style={{ color: batteryColor.hex, textShadow: `0 0 28px ${batteryColor.hex}40` }}
                >
                  {battery}
                </span>
                <span className="text-surface-muted text-xl font-display mb-0.5">%</span>
              </div>
              <span className="text-xs font-mono uppercase tracking-widest" style={{ color: batteryColor.hex }}>
                {batteryColor.label}
              </span>
            </div>

            <MascotDisplay
              tier={getMascotTier(battery)}
              size={128}
              glowColor={batteryColor.hex}
              animate
            />
          </div>

          {/* Battery bar — ID para el tutorial paso 2 */}
          <div id="tutorial-battery-bar" className="rounded-xl transition-all duration-300">
            <BatterySlider value={battery} onChange={setBattery} hideDisplay />
          </div>

          <div className="flex items-center justify-end -mt-3 mb-4">
            <span className="text-xs text-surface-muted/60">
              Actualizado {formatRelativeTime(profile?.battery_updated_at)}
            </span>
          </div>

          <button
            onClick={saveBattery}
            disabled={saving}
            className={`w-full py-3 rounded-xl font-display font-semibold text-sm transition-all duration-200
              ${saved
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-accent-primary hover:bg-accent-primary/80 text-white hover:shadow-lg hover:shadow-accent-primary/20'
              } disabled:opacity-50`}
          >
            {saving ? 'Guardando...' : saved ? '✓ ¡Actualizado!' : 'Actualizar batería'}
          </button>

          {/* Share story button */}
          <button
            onClick={shareBatteryStory}
            disabled={sharingStory}
            title="Compartir mi batería"
            className="mt-2 w-full py-2.5 rounded-xl font-display font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2 border border-pink-500/40 text-pink-300 bg-pink-500/5 disabled:opacity-50"
          >
            {sharingStory
              ? <><span className="animate-spin text-base">⏳</span> Generando...</>
              : <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                  </svg>
                  Compartir
                </>
            }
          </button>
        </div>

        {/* Panel social — ID para el tutorial paso 3 (cubre amigos + grupos) */}
        <div id="tutorial-social-panels" className="space-y-4 rounded-2xl transition-all duration-300">

        {/* Friends feed */}
        <div className="animate-slide-up" style={{ animationDelay: '0.1s' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-surface-text">
              Amigos{friends.length > 0 && (
                <span className="text-surface-muted font-normal"> · {friends.length}</span>
              )}
            </h3>
            <div className="flex items-center gap-1.5">
              {/* Friend requests badge */}
              <button
                onClick={() => setShowRequests(true)}
                title="Solicitudes de amistad"
                className="relative w-8 h-8 rounded-xl flex items-center justify-center text-sm transition-all bg-accent-primary/20 border border-accent-primary/40 text-accent-glow hover:bg-accent-primary/30"
              >
                🤝
                {pendingCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-1 leading-none">
                    {pendingCount > 9 ? '9+' : pendingCount}
                  </span>
                )}
              </button>
              {/* Add friend */}
              <button
                onClick={() => setShowSearch(true)}
                title="Buscar amigos"
                className="w-8 h-8 rounded-xl bg-accent-primary/20 border border-accent-primary/40 text-accent-glow hover:bg-accent-primary/30 flex items-center justify-center text-base font-bold transition-all"
              >
                +
              </button>
            </div>
          </div>

          {loadingFriends ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-20 skeleton" />)}
            </div>
          ) : friends.length === 0 ? (
            <div className="bg-surface-card border border-surface-border rounded-2xl p-8 text-center">
              <div className="text-4xl mb-3">👥</div>
              <p className="text-surface-muted text-sm mb-4">Aún no tienes amigos en SocialBattery</p>
              <button
                onClick={() => setShowSearch(true)}
                className="bg-accent-primary/20 text-accent-glow border border-accent-primary/30 px-4 py-2 rounded-xl text-sm font-display"
              >
                Buscar amigos
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {friends.slice(0, 8).map(friend => (
                <FriendCard
                  key={friend.id}
                  friend={friend}
                  online={!!onlineMap[friend.id]}
                  onClick={() => navigate(`/user/${friend.id}`)}
                />
              ))}
              {friends.length > 8 && (
                <p className="text-center text-xs text-surface-muted py-1 font-mono">
                  y {friends.length - 8} más
                </p>
              )}
            </div>
          )}
        </div>

        {/* Groups panel */}
        <div className="animate-slide-up" style={{ animationDelay: '0.15s' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-surface-text">
              Grupos{groups.length > 0 && (
                <span className="text-surface-muted font-normal"> · {groups.length}</span>
              )}
            </h3>
            <button
              onClick={() => setShowCreateGroup(true)}
              title="Crear grupo"
              className="w-8 h-8 rounded-xl bg-accent-primary/20 border border-accent-primary/40 text-accent-glow hover:bg-accent-primary/30 flex items-center justify-center text-base font-bold transition-all"
            >
              +
            </button>
          </div>
          {groups.length === 0 ? (
            <div className="bg-surface-card border border-surface-border rounded-2xl p-6 text-center">
              <div className="text-3xl mb-2">👥</div>
              <p className="text-surface-muted text-sm mb-3">Sin grupos aún</p>
              <button
                onClick={() => setShowCreateGroup(true)}
                className="bg-accent-primary/20 text-accent-glow border border-accent-primary/30 px-4 py-2 rounded-xl text-sm font-display"
              >
                Crear grupo
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {groups.slice(0, 4).map(group => (
                <button
                  key={group.id}
                  onClick={() => navigate(`/messages/group/${group.id}`)}
                  className="w-full bg-surface-card border border-surface-border rounded-2xl p-3 flex items-center gap-3 hover:bg-surface-hover active:scale-[0.99] transition-all text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-accent-primary/15 border-2 border-accent-primary/30 flex items-center justify-center text-lg flex-shrink-0">👥</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-semibold text-surface-text text-sm truncate">{group.name}</div>
                    <div className="text-xs text-surface-muted font-mono">{group.member_count} miembros</div>
                  </div>
                  <span className="text-surface-muted text-sm">💬</span>
                </button>
              ))}
              {groups.length > 4 && (
                <p className="text-center text-xs text-surface-muted py-1 font-mono">
                  y {groups.length - 4} grupos más
                </p>
              )}
            </div>
          )}
        </div>{/* end Groups panel */}

        </div>{/* end tutorial-social-panels */}

      </main>

      <BottomNav pendingCount={pendingCount} unreadCount={unreadCount} />
    </div>
  );
}
