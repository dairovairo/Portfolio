import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import GlobeLocationView from '../components/GlobeLocationView';
import ReminderBellButton, { DEFAULT_POOL_REMINDER_MINUTES } from '../components/ReminderBellButton';
import { usePoolChatNotifications } from '../context/PoolChatNotificationsContext';
import {
  getActivityEmoji,
  formatPoolDateRange,
  StatusBadge,
  MiniMascot,
  IdentityBadge,
} from '../components/PoolShared';

/**
 * PoolDetailPage — detalle de una quedada a pantalla completa.
 *
 * Antes era un modal (bottom-sheet "ParticipantsSheet") montado dentro de
 * PoolsPage; ahora es su propia página en /pools/:poolId, siguiendo el
 * mismo patrón que ya se usó para el chat (/pools/:poolId/chat) y el
 * Sniffer (/pools/:poolId/sniffer). Además del listado de apuntados, ahora
 * también enseña un mapa con la ubicación de la quedada.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const geocodeCache = new Map();

async function geocodeLocation(query) {
  if (geocodeCache.has(query)) return geocodeCache.get(query);
  try {
    const res = await fetch(
      `${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=es`,
      { headers: { 'Accept-Language': 'es' } }
    );
    const data = await res.json();
    const hit = data?.[0];
    const result = hit ? { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) } : null;
    geocodeCache.set(query, result);
    return result;
  } catch {
    return null;
  }
}

export default function PoolDetailPage() {
  const { poolId } = useParams();
  const navigate = useNavigate();
  const { hasUnreadPoolChat } = usePoolChatNotifications();

  const [pool, setPool] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [badgeData, setBadgeData] = useState({ assignments: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [coords, setCoords] = useState(null);
  const [mapLoading, setMapLoading] = useState(true);

  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    Promise.all([
      api.get(`/pools/${poolId}`),
      api.get(`/badges/pool/${poolId}`).catch(() => ({ assignments: [] })),
    ])
      .then(([{ pool: full }, badges]) => {
        if (cancelled) return;
        setPool(full);
        setParticipants(full.participants || []);
        setBadgeData({ assignments: badges.assignments || [] });
      })
      .catch(() => { if (!cancelled) setLoadError('No se ha podido cargar esta quedada.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [poolId]);

  // Mapa: usa las coordenadas guardadas al crear la quedada; si no las hay
  // (quedadas antiguas), geocodifica location_hint como respaldo — mismo
  // criterio que PoolSnifferPage.jsx.
  useEffect(() => {
    if (!pool) return;
    const hasStoredCoords = pool.lat != null && pool.lng != null;
    if (hasStoredCoords) {
      setCoords({ lat: pool.lat, lng: pool.lng });
      setMapLoading(false);
      return;
    }
    const query = pool.location_hint?.trim();
    if (!query) { setMapLoading(false); return; }
    let cancelled = false;
    setMapLoading(true);
    geocodeLocation(query).then(result => {
      if (!cancelled) { setCoords(result); setMapLoading(false); }
    });
    return () => { cancelled = true; };
  }, [pool]);

  const identitiesByUser = badgeData.assignments.reduce((acc, assignment) => {
    if (!acc[assignment.userId]) acc[assignment.userId] = [];
    acc[assignment.userId].push(assignment);
    return acc;
  }, {});

  const isPast = pool ? new Date(pool.scheduled_at) <= new Date() : false;
  const canJoin = pool && pool.status === 'open' && !pool.has_joined && !isPast && pool.status !== 'cancelled';
  const canLeave = pool && pool.has_joined && !pool.is_creator && !isPast;
  const canAdjustReminder = pool && pool.has_joined && !isPast && pool.status !== 'cancelled' && pool.status !== 'closed';
  const hasUnreadChat = pool ? hasUnreadPoolChat(pool.id) : false;

  async function handleJoin() {
    setJoining(true);
    try {
      await api.post(`/pools/${poolId}/join`, {});
      showToast('¡Te has unido! 🚀');
      setPool(p => ({ ...p, has_joined: true, status: p.status, participant_count: p.participant_count + 1 }));
      const { pool: full } = await api.get(`/pools/${poolId}`);
      setPool(full);
      setParticipants(full.participants || []);
    } catch (e) {
      showToast(e.message || 'No se pudo unir', 'error');
    } finally {
      setJoining(false);
    }
  }

  async function handleLeave() {
    setLeaving(true);
    try {
      const { cancelled } = await api.delete(`/pools/${poolId}/leave`);
      showToast(cancelled ? 'Plan cancelado' : 'Has salido del plan');
      if (cancelled) { navigate('/pools'); return; }
      const { pool: full } = await api.get(`/pools/${poolId}`);
      setPool(full);
      setParticipants(full.participants || []);
    } catch (e) {
      showToast(e.message || 'Error al salir', 'error');
    } finally {
      setLeaving(false);
    }
  }

  async function handleReminderChange(minutes) {
    if (reminderSaving) return;
    setReminderSaving(true);
    try {
      const data = await api.patch(`/pools/${poolId}/reminder`, { reminder_minutes_before: minutes });
      const nextMinutes = data.reminder_minutes_before || minutes;
      setPool(p => ({ ...p, current_user_reminder_minutes_before: nextMinutes }));
      showToast('Aviso actualizado');
    } catch (e) {
      showToast(e.message || 'Error al cambiar el aviso', 'error');
    } finally {
      setReminderSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-bg noise flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent-primary/40 border-t-accent-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError || !pool) {
    return (
      <div className="min-h-screen bg-surface-bg noise flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-surface-muted">{loadError || 'Esta quedada ya no existe.'}</p>
        <button
          onClick={() => navigate('/pools')}
          className="text-sm font-display font-semibold text-accent-glow hover:underline"
        >
          Volver a quedadas
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-bg noise pb-28">
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
      <nav className="sticky top-0 z-10 border-b border-surface-border bg-surface-bg/90 backdrop-blur-xl">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/pools')} className="text-surface-muted hover:text-surface-text transition-colors p-1 text-lg">
            ←
          </button>
          <h1 className="font-display font-bold text-surface-text flex-1 truncate">{pool.activity}</h1>
          <button
            onClick={() => navigate(`/pools/${pool.id}/sniffer`)}
            title="Ver la ubicación de la quedada en el mapa"
            className="flex-shrink-0 flex items-center gap-1 text-xs font-display font-semibold px-2.5 py-1.5 rounded-xl bg-pink-500/15 text-pink-400 border border-pink-500/25 hover:bg-pink-500/25 hover:border-pink-500/40 hover:text-pink-300 transition-colors"
          >
            <span>🐽</span> Sniffer
          </button>
          <button
            onClick={() => navigate(`/pools/${pool.id}/chat`)}
            title="Abrir chat de la quedada"
            className="relative flex-shrink-0 flex items-center gap-1 text-xs font-display font-semibold px-2.5 py-1.5 rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/25 hover:bg-blue-500/25 hover:border-blue-500/40 hover:text-blue-300 transition-colors"
          >
            <span>💬</span> Chat
            {hasUnreadChat && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 border-2 border-surface-bg" />
              </span>
            )}
          </button>
        </div>
      </nav>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Cover + cabecera */}
        <div>
          {pool.cover_image_url && (
            <div className="mb-3 aspect-[16/9] overflow-hidden rounded-2xl border border-surface-border bg-surface-card">
              <img src={pool.cover_image_url} alt="" className="h-full w-full object-cover" />
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <span className="text-3xl flex-shrink-0">{getActivityEmoji(pool.activity)}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-display font-bold text-surface-text text-lg leading-tight">{pool.activity}</h2>
                <StatusBadge status={pool.status} />
              </div>
              <p className="text-xs text-surface-muted font-mono mt-0.5">{formatPoolDateRange(pool)}</p>
            </div>
          </div>
          {pool.description && (
            <p className="text-sm text-surface-muted mt-3 leading-relaxed">{pool.description}</p>
          )}
        </div>

        {/* Mapa de la ubicación */}
        {mapLoading ? (
          <div className="h-[260px] rounded-2xl bg-surface-card border border-surface-border animate-pulse flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-accent-primary/40 border-t-accent-primary rounded-full animate-spin" />
          </div>
        ) : coords ? (
          <GlobeLocationView lat={coords.lat} lng={coords.lng} label={pool.location_hint} />
        ) : pool.location_hint ? (
          <div className="h-[120px] rounded-2xl bg-surface-card border border-surface-border flex flex-col items-center justify-center gap-1 px-4 text-center">
            <span className="text-lg">📍</span>
            <p className="text-xs text-surface-muted font-mono">{pool.location_hint}</p>
            <p className="text-[11px] text-surface-muted/70">No se ha podido localizar esta dirección en el mapa.</p>
          </div>
        ) : null}

        {/* Recordatorio */}
        {canAdjustReminder && (
          <ReminderBellButton
            value={pool.current_user_reminder_minutes_before}
            defaultMinutes={DEFAULT_POOL_REMINDER_MINUTES}
            saving={reminderSaving}
            onChange={handleReminderChange}
            placement="bottom"
            wide
          />
        )}

        {/* Apuntados */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-display font-bold text-surface-text">Apuntados</h3>
            <span className="text-xs font-mono text-surface-muted">
              {pool.max_people !== null && pool.max_people !== undefined
                ? `${pool.participant_count}/${pool.max_people}`
                : `${pool.participant_count} apuntados`}
            </span>
          </div>

          {participants.length === 0 ? (
            <p className="text-surface-muted text-sm text-center py-4">Nadie apuntado aún</p>
          ) : (
            <div className="space-y-2">
              {participants.map((p, idx) => {
                const isFirst = idx === 0;
                const identity = (identitiesByUser[p.id] || [])[0] || null;
                return (
                  <div key={p.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-surface-card/50 transition-colors">
                    <div className="relative flex-shrink-0">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-display font-bold border-2 border-surface-border bg-surface-card flex-shrink-0">
                        {p.avatar_url
                          ? <img src={p.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                          : (p.username?.[0] || '?').toUpperCase()
                        }
                      </div>
                      <div className="absolute" style={{ bottom: 'calc(-0.25rem - 8%)', left: 'calc(-0.25rem - 6%)' }}>
                        <MiniMascot user={p} size={35} />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-display font-semibold text-surface-text truncate flex items-center gap-1.5">
                        {p.username}
                        {isFirst && (
                          <span className="text-xs font-mono text-accent-glow bg-accent-primary/10 border border-accent-primary/20 px-1.5 py-0.5 rounded-full">
                            Organiza
                          </span>
                        )}
                      </div>
                    </div>
                    {identity && (
                      <IdentityBadge identity={identity} size="panel" showName align="right" popoverPlacement={isFirst ? 'bottom' : 'top'} />
                    )}
                    {p.battery_level != null && (
                      <div className="font-display font-bold tabular-nums text-sm text-center flex-shrink-0" style={{ width: 38 }}>
                        {p.battery_level}%
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {pool.spots_left !== null && pool.spots_left > 0 && pool.status === 'open' && (
            <div className="mt-3 space-y-1.5">
              {Array.from({ length: Math.min(pool.spots_left, 3) }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-xl border border-dashed border-surface-border/50 opacity-40">
                  <div className="w-10 h-10 rounded-full border-2 border-dashed border-slate-600 flex items-center justify-center">
                    <span className="text-slate-600 text-xs">?</span>
                  </div>
                  <span className="text-xs text-slate-600 font-mono">Plaza libre</span>
                </div>
              ))}
              {pool.spots_left > 3 && (
                <p className="text-xs text-slate-600 font-mono text-center">
                  +{pool.spots_left - 3} plazas libres más
                </p>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Botones — fijos abajo */}
      {(canJoin || canLeave) && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-surface-border bg-surface-bg/95 backdrop-blur-xl px-4 py-3 pb-safe">
          <div className="max-w-lg mx-auto">
            {canJoin && (
              <button
                onClick={handleJoin}
                disabled={joining || pool.status === 'full'}
                className="w-full py-3 rounded-2xl bg-accent-primary hover:bg-accent-primary/80 text-surface-text text-sm font-display font-bold transition-all disabled:opacity-50"
              >
                {joining ? 'Uniéndose...' : '🚀 Unirse al plan'}
              </button>
            )}
            {canLeave && (
              <button
                onClick={handleLeave}
                disabled={leaving}
                className="w-full py-3 rounded-2xl bg-slate-700/50 hover:bg-red-500/20 text-slate-300 hover:text-red-400 text-sm font-display font-bold border border-slate-600/30 hover:border-red-500/30 transition-all disabled:opacity-50"
              >
                {leaving ? 'Saliendo...' : 'Salir del plan'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
