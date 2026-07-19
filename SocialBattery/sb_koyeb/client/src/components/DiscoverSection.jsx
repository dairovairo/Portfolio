import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useUserLocation } from '../context/UserLocationContext';
import { getBatteryColor } from '../lib/battery';

// ── Discover section — "Cerca de ti" (por ubicación) y "Quizás conozcas"
// (por amigos en común), debajo de Amigos y Grupos en HomePage.jsx. Backend:
// GET /discover/nearby y GET /discover/suggested (server/routes/discover.js,
// phase 113). Respeta el toggle de privacidad "discoverable"
// (SettingsPage.jsx → Privacidad → Aparecer en Descubrir).

function DiscoverAvatar({ user }) {
  const color = getBatteryColor(user.battery_level ?? 50);
  return (
    <div
      className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-display font-bold border-2 flex-shrink-0"
      style={{ borderColor: color.hex, boxShadow: `0 0 10px ${color.hex}25`, background: `${color.hex}15` }}
    >
      {user.avatar_url
        ? <img src={user.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
        : user.username?.[0]?.toUpperCase()
      }
    </div>
  );
}

function DiscoverCard({ user, subtitle, onAdd, adding, added }) {
  const navigate = useNavigate();
  return (
    <div className="flex-shrink-0 w-[124px] bg-surface-card border border-surface-border rounded-2xl p-3 flex flex-col items-center text-center gap-2 snap-start">
      <button onClick={() => navigate(`/user/${user.id}`)} className="flex-shrink-0">
        <DiscoverAvatar user={user} />
      </button>
      <button onClick={() => navigate(`/user/${user.id}`)} className="w-full min-w-0">
        <div className="text-xs font-display font-semibold text-surface-text truncate">{user.username}</div>
        <div className="text-[10px] text-surface-muted font-mono truncate mt-0.5">{subtitle}</div>
      </button>
      {added ? (
        <span className="text-[10px] text-surface-muted border border-surface-border px-2 py-1 rounded-lg w-full">✓ Enviado</span>
      ) : (
        <button
          onClick={() => onAdd(user)}
          disabled={adding}
          className="text-[10px] font-display font-semibold px-2 py-1.5 rounded-lg bg-accent-primary text-surface-text hover:bg-accent-primary/80 disabled:opacity-50 transition-all w-full"
        >
          {adding ? '...' : '+ Añadir'}
        </button>
      )}
    </div>
  );
}

function ScrollRow({ children }) {
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1 snap-x snap-mandatory -mx-1 px-1">
      {children}
    </div>
  );
}

function CardSkeletonRow() {
  return (
    <div className="flex gap-2.5 overflow-x-hidden">
      {[1, 2, 3].map(i => (
        <div key={i} className="flex-shrink-0 w-[124px] h-[148px] skeleton rounded-2xl" />
      ))}
    </div>
  );
}

function formatDistance(km) {
  if (km < 1) return `A ${Math.round(km * 1000)} m`;
  return `A ${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export default function DiscoverSection() {
  const { addToast } = useToast();
  const { status: locationStatus, requestLocation } = useUserLocation();

  const [nearby, setNearby] = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [hasLocation, setHasLocation] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sentIds, setSentIds] = useState(new Set());
  const [actionLoading, setActionLoading] = useState({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get('/discover/nearby').catch(() => ({ users: [], hasLocation: true })),
      api.get('/discover/suggested').catch(() => ({ users: [] })),
    ]).then(([nearbyRes, suggestedRes]) => {
      if (cancelled) return;
      setNearby(nearbyRes.users || []);
      setHasLocation(nearbyRes.hasLocation !== false);
      setSuggested(suggestedRes.users || []);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function sendRequest(user) {
    setActionLoading(l => ({ ...l, [user.id]: true }));
    try {
      await api.post('/friends/request', { addressee_id: user.id });
      setSentIds(s => new Set([...s, user.id]));
      addToast(`Solicitud enviada a ${user.username} 🤝`);
    } catch (e) {
      addToast(e.message || 'Error al enviar la solicitud', 'error');
    } finally {
      setActionLoading(l => ({ ...l, [user.id]: false }));
    }
  }

  const showNearbyPrompt = !loading && !hasLocation && locationStatus === 'denied';
  const showNearbyRow = nearby.length > 0;
  const showSuggestedRow = suggested.length > 0;

  const nothingToShow = !loading && !showNearbyPrompt && !showNearbyRow && !showSuggestedRow;
  if (nothingToShow) return null;

  return (
    <div className="animate-slide-up" style={{ animationDelay: '0.2s' }}>
      <h3 className="font-display font-semibold text-surface-text mb-3">Descubrir</h3>

      {loading ? (
        <div className="space-y-4">
          <CardSkeletonRow />
        </div>
      ) : (
        <div className="space-y-4">
          {(showNearbyRow || showNearbyPrompt) && (
            <div>
              <h4 className="text-xs font-display font-semibold text-surface-muted mb-2 flex items-center gap-1.5">
                📍 Cerca de ti
              </h4>
              {showNearbyRow ? (
                <ScrollRow>
                  {nearby.map(user => (
                    <DiscoverCard
                      key={user.id}
                      user={user}
                      subtitle={formatDistance(user.distance_km)}
                      onAdd={sendRequest}
                      adding={!!actionLoading[user.id]}
                      added={sentIds.has(user.id)}
                    />
                  ))}
                </ScrollRow>
              ) : (
                <button
                  onClick={requestLocation}
                  className="w-full bg-surface-card border border-surface-border rounded-2xl p-4 flex items-center gap-3 text-left hover:bg-surface-hover transition-all"
                >
                  <span className="text-2xl flex-shrink-0">📍</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-display font-semibold text-surface-text">Activa tu ubicación</div>
                    <div className="text-xs text-surface-muted">Para ver gente cerca de ti</div>
                  </div>
                </button>
              )}
            </div>
          )}

          {showSuggestedRow && (
            <div>
              <h4 className="text-xs font-display font-semibold text-surface-muted mb-2 flex items-center gap-1.5">
                🤝 Quizás conozcas
              </h4>
              <ScrollRow>
                {suggested.map(user => (
                  <DiscoverCard
                    key={user.id}
                    user={user}
                    subtitle={user.mutual_friends === 1 ? '1 amigo en común' : `${user.mutual_friends} amigos en común`}
                    onAdd={sendRequest}
                    adding={!!actionLoading[user.id]}
                    added={sentIds.has(user.id)}
                  />
                ))}
              </ScrollRow>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
