import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import BatterySlider from '../components/BatterySlider';
import FriendCard from '../components/FriendCard';
import BadgeUnlockModal from '../components/BadgeUnlockModal';
import BottomNav from '../components/BottomNav';
import { getBatteryColor, formatRelativeTime } from '../lib/battery';
import { supabase } from '../lib/supabase';

export default function HomePage() {
  const { profile, refreshProfile } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();

  const [battery, setBattery] = useState(profile?.battery_level ?? 50);
  const [friends, setFriends] = useState([]);
  const [groups, setGroups] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [newBadges, setNewBadges] = useState([]);

  useEffect(() => {
    if (profile) setBattery(profile.battery_level ?? 50);
  }, [profile]);

  const fetchFriends = useCallback(async () => {
    try {
      const { friends: data } = await api.get('/battery/friends');
      const sorted = [...(data || [])].sort((a, b) => (b.battery_level ?? -1) - (a.battery_level ?? -1));
      setFriends(sorted);
    } catch (e) { console.error(e); }
    finally { setLoadingFriends(false); }
  }, [profile?.battery_level]);

  const fetchPending = useCallback(async () => {
    try {
      const { requests } = await api.get('/friends/requests');
      setPendingCount((requests || []).length);
    } catch (e) {}
  }, []);

  const fetchUnread = useCallback(async () => {
    try {
      const { conversations } = await api.get('/messages');
      const unread = (conversations || []).reduce((acc, c) => acc + (c.unread || 0), 0);
      setUnreadCount(unread);
    } catch (e) {}
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const { groups: data } = await api.get('/groups');
      setGroups(data || []);
    } catch (e) {}
  }, []);

  useEffect(() => {
    fetchFriends();
    fetchPending();
    fetchUnread();
    fetchGroups();
  }, [fetchFriends, fetchPending, fetchUnread, fetchGroups]);

  // Realtime subscriptions
  useEffect(() => {
    if (!profile?.id) return;
    const ch1 = supabase.channel('home-users')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, () => fetchFriends())
      .subscribe();
    const ch2 = supabase.channel('home-friendships')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'friendships',
        filter: `addressee_id=eq.${profile.id}`,
      }, () => fetchPending())
      .subscribe();
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); };
  }, [profile?.id, fetchFriends, fetchPending]);

  async function saveBattery() {
    setSaving(true);
    try {
      const { newBadges: earned } = await api.patch('/battery', { level: battery });
      await refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      fetchFriends();
      if (earned?.length > 0) {
        setNewBadges(earned);
        addToast(`¡Batería actualizada! ${earned.length > 0 ? `+${earned.length} insignia${earned.length > 1 ? 's' : ''} 🏅` : ''}`, 'success');
      } else {
        addToast('¡Batería actualizada!', 'success');
      }
    } catch (err) {
      addToast('Error al actualizar', 'error');
    } finally {
      setSaving(false);
    }
  }

  const pendingUpdate = profile && (
    !profile.battery_updated_at ||
    new Date(profile.battery_updated_at).toDateString() !== new Date().toDateString()
  );

  const color = getBatteryColor(profile?.battery_level ?? 50);

  return (
    <div className="min-h-screen bg-surface-bg pb-24">
      <BadgeUnlockModal badges={newBadges} onClose={() => setNewBadges([])} />

      {/* Top nav */}
      <nav className="border-b border-surface-border sticky top-0 bg-surface-bg/90 backdrop-blur-xl z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔋</span>
            <span className="font-display font-bold text-surface-text">SocialBattery</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate('/settings')}
              className="p-2 text-surface-muted hover:text-surface-text transition-colors text-base"
              title="Ajustes"
            >
              ⚙️
            </button>
            <button
              onClick={() => navigate('/profile')}
              className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-display font-bold overflow-hidden"
              style={{ borderColor: color.hex, background: `${color.hex}20`, color: color.hex }}
            >
              {profile?.avatar_url
                ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover rounded-full" />
                : (profile?.display_name?.[0] || '?').toUpperCase()
              }
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-lg mx-auto px-4 py-5 space-y-4">

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
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs font-mono text-surface-muted uppercase tracking-widest">
                Tu batería social
              </div>
              {profile?.battery_is_estimated && (
                <span className="text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-lg font-mono">
                  ⚡ Estimada
                </span>
              )}
            </div>
            <div className="text-right">
              <span
                className="font-display text-4xl font-bold"
                style={{ color: color.hex, textShadow: `0 0 25px ${color.hex}50` }}
              >
                {profile?.battery_level ?? battery}
              </span>
              <span className="text-surface-muted text-lg font-display">%</span>
            </div>
          </div>

          <BatterySlider value={battery} onChange={setBattery} />

          <div className="flex items-center justify-between mt-1 mb-4">
            <span className="text-xs font-mono" style={{ color: color.hex }}>{color.label}</span>
            <span className="text-xs text-surface-muted/60">
              Última actualización: {formatRelativeTime(profile?.battery_updated_at)}
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
        </div>

        {/* Notification banners */}
        {pendingCount > 0 && (
          <button
            onClick={() => navigate('/friends')}
            className="w-full bg-accent-primary/10 border border-accent-primary/25 rounded-2xl p-4
              flex items-center gap-3 hover:bg-accent-primary/15 transition-all animate-fade-in text-left"
          >
            <span className="text-2xl">🤝</span>
            <div>
              <div className="font-display font-semibold text-surface-text text-sm">
                {pendingCount} solicitud{pendingCount > 1 ? 'es' : ''} de amistad
              </div>
              <div className="text-xs text-accent-glow">Toca para ver →</div>
            </div>
          </button>
        )}

        {/* Friends feed */}
        <div className="animate-slide-up" style={{ animationDelay: '0.1s' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-surface-text">
              Amigos{friends.length > 0 && (
                <span className="text-surface-muted font-normal"> · {friends.length}</span>
              )}
            </h3>
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
                onClick={() => navigate('/friends')}
                className="bg-accent-primary/20 text-accent-glow border border-accent-primary/30 px-4 py-2 rounded-xl text-sm font-display"
              >
                Buscar amigos
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {friends.slice(0, 8).map(friend => (
                  <FriendCard
                    key={friend.id}
                    friend={friend}
                    onClick={() => navigate(`/user/${friend.id}`)}
                  />
                ))}
                {friends.length > 8 && (
                  <button
                    onClick={() => navigate('/friends')}
                    className="w-full text-center text-sm text-accent-glow hover:underline py-2"
                  >
                    Ver {friends.length - 8} amigos más →
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {/* Groups panel */}
        {groups.length > 0 && (
          <div className="animate-slide-up" style={{ animationDelay: '0.15s' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-surface-text">
                Grupos<span className="text-surface-muted font-normal"> · {groups.length}</span>
              </h3>
            </div>
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
                <button onClick={() => navigate('/friends')} className="w-full text-center text-sm text-accent-glow hover:underline py-2">
                  Ver {groups.length - 4} grupos más →
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      <BottomNav pendingCount={pendingCount} unreadCount={unreadCount} />
    </div>
  );
}
