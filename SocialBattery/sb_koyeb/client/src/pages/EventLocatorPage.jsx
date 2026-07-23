import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { useUserLocation } from '../context/UserLocationContext';
import GlobeLocationView from '../components/GlobeLocationView';
import MascotDisplay from '../components/MascotDisplay';
import MascotPreviewOverlay from '../components/MascotPreviewOverlay';
import { getBatteryColor } from '../lib/battery';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';

// Cada cuánto se envía la posición al servidor como máximo mientras
// watchPosition() está activo (throttle — el navegador puede disparar el
// callback mucho más a menudo que esto).
const LOCATION_PUSH_INTERVAL_MS = 15000;

function LocatorAvatar({ user }) {
  if (user?.avatar_url) {
    return <img src={user.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-surface-border flex-shrink-0" />;
  }
  return (
    <div className="w-9 h-9 rounded-full bg-accent-primary/20 border border-accent-primary/30 flex items-center justify-center text-xs font-display font-bold text-accent-glow flex-shrink-0">
      {(user?.username || '?').charAt(0).toUpperCase()}
    </div>
  );
}

// Mismo criterio de tier que usa el resto de la app (ver getMascotTier en
// FriendCard.jsx / PoolSnifferPage.jsx): 0-33 → low, 34-66 → mid, 67-100 → high.
function getMascotTier(level) {
  if (level <= 33) return 'low';
  if (level <= 66) return 'mid';
  return 'high';
}

// Mascota en miniatura para la lista de miembros del grupo de
// localización — mismo patrón que MiniMascot en PoolSnifferPage.jsx: capa
// base según tier de batería + overlay "horneado" (mascot_preview_url). Si
// es la mascota propia, se monta MascotDisplay sin overrides para leer el
// equipado real del contexto al instante (ver comentario original en
// PoolSnifferPage.jsx sobre por qué no usar mascot_preview_url para "mí").
function LocatorMiniMascot({ user, size = 34 }) {
  const { profile } = useAuth();
  const isMe = Boolean(profile?.id) && user?.id === profile.id;
  const color = getBatteryColor(user?.battery_level ?? 50);
  const tier = getMascotTier(user?.battery_level ?? 50);

  if (isMe) {
    return (
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <MascotDisplay tier={tier} size={size} glowColor={color.hex} />
      </div>
    );
  }

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <MascotDisplay
        tier={tier}
        size={size}
        glowColor={color.hex}
        outfitSrc={null}
        feetSrc={null}
        headSrc={null}
        accessories={[]}
        activityLayers={[]}
      />
      <MascotPreviewOverlay src={user.mascot_preview_url} />
    </div>
  );
}

function statusMeta(status) {
  if (status === 'accepted') return { label: 'En el grupo', className: 'text-green-400 bg-green-500/10 border-green-500/25' };
  if (status === 'declined') return { label: 'Rechazó', className: 'text-red-400 bg-red-500/10 border-red-500/25' };
  return { label: 'Pendiente', className: 'text-amber-300 bg-amber-500/10 border-amber-500/25' };
}

// ── Selector de amigos para invitar al grupo de localización ────────────────
function FriendPicker({ friends, selectedIds, onToggle, onCancel, onConfirm, creating }) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-3">
      <div>
        <h3 className="font-display font-bold text-surface-text text-sm">Elige a quién invitar</h3>
        <p className="text-xs text-surface-muted mt-0.5">Solo se muestran amigos que también van a este evento.</p>
      </div>

      {friends.length === 0 ? (
        <p className="text-sm text-surface-muted text-center py-6">
          Ninguno de tus amigos está apuntado a este evento todavía.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {friends.map(friend => {
            const checked = selectedIds.has(friend.id);
            return (
              <button
                key={friend.id}
                type="button"
                onClick={() => onToggle(friend.id)}
                className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 border transition-colors ${
                  checked
                    ? 'bg-accent-primary/10 border-accent-primary/30'
                    : 'bg-surface-bg border-surface-border hover:border-accent-primary/25'
                }`}
              >
                <LocatorAvatar user={friend} />
                <span className="flex-1 min-w-0 text-left text-sm text-surface-text truncate">{friend.username}</span>
                <span className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 text-xs ${
                  checked ? 'bg-accent-primary border-accent-primary text-white' : 'border-surface-border text-transparent'
                }`}>
                  ✓
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl border border-surface-border text-surface-muted text-sm font-display font-semibold hover:text-surface-text transition-colors"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={creating || selectedIds.size === 0}
          className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-sm font-display font-bold transition-all disabled:opacity-50"
        >
          {creating ? 'Creando...' : `Crear grupo (${selectedIds.size})`}
        </button>
      </div>
    </div>
  );
}

// ── Página "Locator" — ubicación del evento a pantalla completa ────────────
// Antes era un modal emergente dentro de EventDetailPage; ahora es su propia
// ruta (/community/event/:eventId/locator) para que el botón "Locator" del
// panel superior navegue a una página en vez de abrir un popup.
export default function EventLocatorPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { profile } = useAuth();
  const { coords: userCoords, status: locationStatus, requestLocation } = useUserLocation();

  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);

  const [group, setGroup] = useState(null); // null = sin cargar aún / sin grupo
  const [groupLoading, setGroupLoading] = useState(true);
  const [responding, setResponding] = useState(false);

  const [showPicker, setShowPicker] = useState(false);
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Ubicación en vivo de los miembros aceptados del grupo — user_id -> {lat, lng, updated_at}.
  // Se inicializa con lo que ya trae /locator (última posición persistida) y
  // se refresca al vuelo con los broadcasts de Realtime + con lo que envía
  // este mismo dispositivo por watchPosition.
  const [liveLocations, setLiveLocations] = useState({});
  const lastPushRef = useRef(0);
  const watchIdRef = useRef(null);

  const fetchGroup = useCallback(async () => {
    try {
      const data = await api.get(`/community/events/${eventId}/locator`);
      setGroup(data.group);
      setLiveLocations(prev => {
        const next = { ...prev };
        for (const m of data.group?.members || []) {
          if (m.lat != null && m.lng != null) {
            next[m.user_id] = { lat: m.lat, lng: m.lng, updated_at: m.location_updated_at };
          }
        }
        return next;
      });
    } catch {
      /* non-fatal: el bloque de creación sigue disponible */
    } finally {
      setGroupLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get(`/community/events/${eventId}`);
        if (!cancelled) setEvent(data.event);
      } catch (e) {
        if (!cancelled) showToast(e.message || 'Error al cargar el evento', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  useEffect(() => { fetchGroup(); }, [fetchGroup]);

  // ── Realtime: escucha la ubicación en vivo del resto del grupo ─────────
  // Cualquier miembro (aceptado, pendiente o rechazado) puede ver el mapa,
  // así que todo el que tenga la página abierta se suscribe al canal del
  // grupo — quien no comparte ubicación simplemente no emite broadcasts.
  useEffect(() => {
    const groupId = group?.id;
    if (!groupId) return;

    const channel = supabase
      .channel(`locator-group-${groupId}`)
      .on('broadcast', { event: 'location_update' }, (msg) => {
        const { user_id, lat, lng, updated_at } = msg.payload || {};
        if (!user_id || lat == null || lng == null) return;
        setLiveLocations(prev => ({ ...prev, [user_id]: { lat, lng, updated_at } }));
      })
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [group?.id]);

  // ── Geolocalización: comparte mi posición mientras soy miembro aceptado ──
  // watchPosition() sigue mi ubicación en segundo plano; el envío al
  // servidor va con throttle (LOCATION_PUSH_INTERVAL_MS) para no saturar la
  // API ni la batería. Se para automáticamente si salgo de la página, dejo
  // el grupo, o mi estado deja de ser 'accepted'.
  useEffect(() => {
    const shouldShare = group?.my_status === 'accepted' && 'geolocation' in navigator;
    if (!shouldShare) return;

    const pushLocation = (lat, lng) => {
      const now = Date.now();
      if (now - lastPushRef.current < LOCATION_PUSH_INTERVAL_MS) return;
      lastPushRef.current = now;
      api.post(`/community/events/${eventId}/locator/location`, { lat, lng }).catch(() => {});
      if (profile?.id) {
        setLiveLocations(prev => ({ ...prev, [profile.id]: { lat, lng, updated_at: new Date().toISOString() } }));
      }
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => pushLocation(pos.coords.latitude, pos.coords.longitude),
      () => { /* si falla el watch, simplemente no se actualiza — no es fatal */ },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [group?.my_status, eventId, profile?.id]);

  if (loading || groupLoading) {
    return (
      <div className="min-h-screen bg-surface-bg noise flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-pulse">📍</div>
          <p className="text-surface-muted font-mono text-sm">Cargando locator...</p>
        </div>
      </div>
    );
  }

  if (!event) return null;

  // El grupo de localización solo se puede crear cuando falta 1 hora o
  // menos para que empiece el evento (o ya ha empezado) — no tiene sentido
  // compartir ubicación con antelación, y así evitamos grupos abiertos
  // durante días sin actividad.
  const msToStart = new Date(event.event_date).getTime() - Date.now();
  const canCreateLocatorGroup = !Number.isNaN(msToStart) && msToStart <= 60 * 60 * 1000;

  // Marcadores de amigos en vivo para el mapa/globo — solo miembros que ya
  // aceptaron el grupo (los únicos que comparten ubicación) y de los que
  // tenemos alguna coordenada, ya sea persistida o llegada por Realtime.
  const memberMarkers = (group?.members || [])
    .filter(m => m.status === 'accepted')
    .map(m => {
      const live = liveLocations[m.user_id];
      return {
        user_id: m.user_id,
        username: m.user?.username,
        avatar_url: m.user?.avatar_url,
        battery_level: m.user?.battery_level,
        mascot_preview_url: m.user?.mascot_preview_url,
        isMe: m.user_id === profile?.id,
        lat: live?.lat ?? m.lat ?? null,
        lng: live?.lng ?? m.lng ?? null,
      };
    })
    .filter(m => m.lat != null && m.lng != null);

  async function handleOpenPicker() {
    if (!canCreateLocatorGroup) return;
    setShowPicker(true);
    setFriendsLoading(true);
    try {
      const data = await api.get(`/community/events/${eventId}/locator-friends`);
      setFriends(data.friends || []);
    } catch (e) {
      showToast(e.message || 'Error al cargar tus amigos', 'error');
    } finally {
      setFriendsLoading(false);
    }
  }

  function handleToggleFriend(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleConfirmCreate() {
    setCreatingGroup(true);
    try {
      await api.post(`/community/events/${eventId}/locator`, { friendIds: [...selectedIds] });
      showToast('Grupo de localización creado 📍', 'success');
      setShowPicker(false);
      setSelectedIds(new Set());
      await fetchGroup();
    } catch (e) {
      showToast(e.message || 'Error al crear el grupo', 'error');
    } finally {
      setCreatingGroup(false);
    }
  }

  async function handleRespond(status) {
    setResponding(true);
    try {
      await api.post(`/community/events/${eventId}/locator/respond`, { status });
      await fetchGroup();
    } catch (e) {
      showToast(e.message || 'Error al responder', 'error');
    } finally {
      setResponding(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-bg noise">
      <header className="sticky top-0 z-40 bg-surface-bg/90 backdrop-blur-xl border-b border-surface-border pt-safe">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-surface-border text-surface-muted hover:text-surface-text hover:border-accent-primary/40 transition-all flex-shrink-0"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-surface-text text-base truncate">📍 Locator</h1>
            <p className="text-xs font-mono text-surface-muted truncate">{event.title}</p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 pb-28 pt-4 space-y-4">
        {/* Aviso de ubicación desactivada — mismo patrón que en Comunidad
            (CommunityPage.jsx): se comprueba locationStatus === 'denied'
            explícitamente además de !userCoords por si quedaran coords
            cacheadas de un permiso ya revocado. Todo el aviso es clicable
            para pedir el permiso, no solo el texto "Activar". */}
        {(!userCoords || locationStatus === 'denied') && locationStatus !== 'unsupported' && (
          <button
            type="button"
            onClick={requestLocation}
            className="w-full flex items-center justify-between gap-3 text-xs bg-amber-500/10 border border-amber-500/25 text-amber-300 rounded-xl px-3 py-2.5 text-left hover:bg-amber-500/15 transition-colors"
          >
            <span>
              📍 {locationStatus === 'denied'
                ? 'Has denegado la ubicación: actívala para usar el localizador.'
                : 'No tienes la ubicación activada. Actívala para usar el localizador.'}
            </span>
            <span className="flex-shrink-0 underline font-display font-semibold whitespace-nowrap">Activar</span>
          </button>
        )}

        {event.lat != null && event.lng != null ? (
          <GlobeLocationView lat={event.lat} lng={event.lng} label={event.location} friends={memberMarkers} />
        ) : (
          <div className="bg-surface-card border border-surface-border rounded-2xl p-4">
            <p className="text-sm text-surface-muted text-center py-8">Este evento no tiene ubicación en el mapa.</p>
          </div>
        )}

        {/* ── Grupo de localización ──────────────────────────────────────── */}
        {!group && !showPicker && (
          <div>
            <button
              type="button"
              onClick={handleOpenPicker}
              disabled={!canCreateLocatorGroup}
              className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 border transition-colors ${
                canCreateLocatorGroup
                  ? 'bg-blue-500/15 text-blue-400 border-blue-500/25 hover:bg-blue-500/25 hover:border-blue-500/40 hover:text-blue-300'
                  : 'bg-surface-bg text-surface-muted border-surface-border opacity-50 cursor-not-allowed'
              }`}
            >
              <span className="text-xl flex-shrink-0">📍</span>
              <span className="flex-1 min-w-0 text-left">
                <span className="block font-display font-bold text-sm">Crear grupo de localización</span>
                <span className="block text-xs mt-0.5 opacity-90">Añade a tus amigos a un grupo para saber dónde están durante el evento</span>
              </span>
            </button>
            {!canCreateLocatorGroup && (
              <p className="text-[11px] text-surface-muted mt-1.5 px-1">
                Podrás crear el grupo de localización cuando falte 1 hora o menos para que empiece el evento.
              </p>
            )}
          </div>
        )}

        {!group && showPicker && (
          friendsLoading ? (
            <div className="bg-surface-card border border-surface-border rounded-2xl p-8 text-center">
              <p className="text-sm text-surface-muted font-mono">Cargando amigos...</p>
            </div>
          ) : (
            <FriendPicker
              friends={friends}
              selectedIds={selectedIds}
              onToggle={handleToggleFriend}
              onCancel={() => { setShowPicker(false); setSelectedIds(new Set()); }}
              onConfirm={handleConfirmCreate}
              creating={creatingGroup}
            />
          )
        )}

        {group && (
          <div className="bg-surface-card border border-surface-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">📍</span>
              <div>
                <h3 className="font-display font-bold text-surface-text text-sm">Grupo de localización</h3>
                <p className="text-xs text-surface-muted">
                  {group.my_status === 'accepted'
                    ? 'Estás compartiendo tu ubicación en vivo con el grupo'
                    : 'Comparten ubicación durante el evento'}
                </p>
              </div>
            </div>

            {group.my_status === 'pending' && (
              <div className="bg-accent-primary/10 border border-accent-primary/25 rounded-xl p-3 space-y-2">
                <p className="text-sm text-surface-text">Te han invitado a este grupo de localización. ¿Te unes?</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRespond('declined')}
                    disabled={responding}
                    className="flex-1 py-2 rounded-lg border border-surface-border text-surface-muted text-xs font-display font-semibold hover:text-surface-text transition-colors disabled:opacity-50"
                  >
                    Rechazar
                  </button>
                  <button
                    onClick={() => handleRespond('accepted')}
                    disabled={responding}
                    className="flex-1 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary/80 text-white text-xs font-display font-bold transition-colors disabled:opacity-50"
                  >
                    Aceptar
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              {group.members.map(m => {
                const meta = statusMeta(m.status);
                return (
                  <div key={m.user_id} className="flex items-center gap-3 bg-surface-bg border border-surface-border rounded-xl px-3 py-2">
                    <LocatorAvatar user={m.user} />
                    <span className="flex-1 min-w-0 text-sm text-surface-text truncate">{m.user?.username || 'Usuario'}</span>
                    <LocatorMiniMascot user={m.user} />
                    <span className={`flex-shrink-0 text-[10px] font-mono px-2 py-0.5 rounded-full border ${meta.className}`}>
                      {meta.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
