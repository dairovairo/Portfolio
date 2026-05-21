import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { getBatteryColor, formatRelativeTime } from '../lib/battery';

function BadgePill({ badge }) {
  return (
    <div className="flex items-center gap-1.5 bg-surface-card border border-surface-border rounded-xl px-2.5 py-1.5">
      <span className="text-sm">{badge.emoji}</span>
      <span className="text-xs font-display font-semibold text-white">{badge.name}</span>
    </div>
  );
}

export default function UserProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile: myProfile } = useAuth();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [friendshipStatus, setFriendshipStatus] = useState(null); // null | 'pending' | 'accepted' | 'sent'
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    async function load() {
      try {
        const [{ user: u }, { status }, { badges: earnedBadgesData }] = await Promise.all([
          api.get(`/users/${id}`),
          api.get(`/friends/status/${id}`),
          api.get(`/badges/user/${id}`).catch(() => ({ badges: [] })),
        ]);
        // earnedBadgesData: [{ earned_at, badge: { id, name, emoji, description, category } }]
        setUser({ ...u, _earnedBadges: (earnedBadgesData || []).map(ub => ub.badge).filter(Boolean) });
        setFriendshipStatus(status);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function sendRequest() {
    setActionLoading(true);
    try {
      await api.post('/friends/request', { addressee_id: id });
      setFriendshipStatus('sent');
      showToast('Solicitud de amistad enviada 🤝');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function removeFriend() {
    if (!confirm('¿Eliminar de tus amigos?')) return;
    setActionLoading(true);
    try {
      await api.delete(`/friends/${id}`);
      setFriendshipStatus(null);
      showToast('Amigo eliminado');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-bg flex items-center justify-center">
        <div className="text-slate-500 font-mono text-sm animate-pulse">Cargando perfil...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-surface-bg flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-5xl mb-4">🕵️</div>
          <h2 className="font-display text-xl text-white mb-2">Usuario no encontrado</h2>
          <button onClick={() => navigate(-1)} className="text-accent-glow text-sm underline underline-offset-4">
            Volver
          </button>
        </div>
      </div>
    );
  }

  const isMe = user.id === myProfile?.id;
  const color = getBatteryColor(user.battery_level ?? 50);
  const earnedBadges = (user._earnedBadges || user.user_badges?.map(ub => ub.badges) || []).filter(Boolean);
  const diff = myProfile ? Math.abs((user.battery_level ?? 50) - (myProfile.battery_level ?? 50)) : null;

  return (
    <div className="min-h-screen bg-surface-bg">
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl font-display text-sm font-semibold shadow-2xl animate-slide-up ${
          toast.type === 'error' ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'bg-green-500/20 text-green-300 border border-green-500/30'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Nav */}
      <nav className="border-b border-surface-border sticky top-0 bg-surface-bg/80 backdrop-blur-xl z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-white transition-colors p-1">
            ←
          </button>
          <h1 className="font-display font-bold text-white flex-1">@{user.username}</h1>
        </div>
      </nav>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-5">
        {/* Profile card */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-display font-bold border-2 flex-shrink-0"
              style={{ borderColor: color.hex, boxShadow: `0 0 24px ${color.hex}50`, background: `${color.hex}15` }}
            >
              {user.avatar_url
                ? <img src={user.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                : user.display_name?.[0]?.toUpperCase()
              }
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-display font-bold text-white text-xl truncate">{user.display_name}</h2>
              <div className="text-sm text-slate-500 font-mono">@{user.username}</div>
              {user.bio && <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">{user.bio}</p>}

              {/* Battery compatibility */}
              {!isMe && diff !== null && (
                <div className={`mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-display font-semibold ${
                  diff <= 15 ? 'bg-green-500/15 text-green-400 border border-green-500/20' :
                  diff <= 35 ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20' :
                  'bg-slate-500/15 text-slate-400 border border-slate-500/20'
                }`}>
                  {diff <= 15 ? '⚡ Compatibilidad alta' :
                   diff <= 35 ? '🔋 Compatibilidad media' :
                   '🪫 Compatibilidad baja'}
                  <span className="font-mono">({diff}% dif.)</span>
                </div>
              )}
            </div>
          </div>

          {/* Battery display */}
          <div className="mt-5 p-4 bg-surface-bg rounded-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500 font-mono uppercase tracking-widest">
                Batería social
              </span>
              {user.battery_is_estimated && (
                <span className="text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded font-mono">
                  ⚡ Estimada
                </span>
              )}
            </div>
            {/* Battery bar */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-3 bg-surface-card rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${user.battery_level ?? 0}%`,
                    backgroundColor: color.hex,
                    boxShadow: `0 0 10px ${color.hex}80`,
                  }}
                />
              </div>
              <span className="font-display font-bold text-lg tabular-nums flex-shrink-0" style={{ color: color.hex }}>
                {user.battery_level ?? '—'}%
              </span>
            </div>
            <div className="text-xs text-slate-600 mt-2 font-mono">
              {formatRelativeTime(user.battery_updated_at)}
            </div>
          </div>

          {/* Actions */}
          {!isMe && (
            <div className="mt-4 flex gap-2">
              {friendshipStatus === 'accepted' ? (
                <>
                  <button
                    onClick={() => navigate(`/messages/${user.id}`)}
                    className="flex-1 bg-accent-primary/20 text-accent-glow border border-accent-primary/30 rounded-xl py-2.5 text-sm font-display font-semibold hover:bg-accent-primary/30 transition-all"
                  >
                    💬 Mensaje
                  </button>
                  <button
                    onClick={removeFriend}
                    disabled={actionLoading}
                    className="px-4 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl py-2.5 text-sm font-display font-semibold hover:bg-red-500/20 transition-all"
                  >
                    {actionLoading ? '...' : '✕'}
                  </button>
                </>
              ) : friendshipStatus === 'sent' ? (
                <div className="flex-1 bg-surface-bg text-slate-500 border border-surface-border rounded-xl py-2.5 text-sm font-display font-semibold text-center">
                  Solicitud enviada
                </div>
              ) : friendshipStatus === 'pending' ? (
                <div className="flex-1 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded-xl py-2.5 text-sm font-display font-semibold text-center">
                  Solicitud pendiente · Ve a Amigos
                </div>
              ) : (
                <button
                  onClick={sendRequest}
                  disabled={actionLoading}
                  className="flex-1 bg-accent-primary text-white rounded-xl py-2.5 text-sm font-display font-semibold hover:bg-accent-primary/80 transition-all"
                >
                  {actionLoading ? '...' : '+ Añadir amigo'}
                </button>
              )}
            </div>
          )}

          {isMe && (
            <button
              onClick={() => navigate('/profile')}
              className="mt-4 w-full bg-surface-bg text-slate-400 border border-surface-border rounded-xl py-2.5 text-sm font-display font-semibold hover:text-white transition-all"
            >
              Editar mi perfil →
            </button>
          )}
        </div>

        {/* Badges */}
        {earnedBadges.length > 0 && (
          <div className="bg-surface-card border border-surface-border rounded-2xl p-4">
            <h3 className="font-display font-semibold text-white mb-3">
              Insignias · {earnedBadges.length}
            </h3>
            <div className="flex flex-wrap gap-2">
              {earnedBadges.map((badge, i) => (
                <BadgePill key={i} badge={badge} />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
