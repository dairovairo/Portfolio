import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import GlobeLocationView from '../components/GlobeLocationView';
import MascotDisplay from '../components/MascotDisplay';
import { useUserLocation } from '../context/UserLocationContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { getBatteryColor } from '../lib/battery';
import { supabase } from '../lib/supabase';

/**
 * PoolSnifferPage — "🐽 Sniffer" a pantalla completa.
 *
 * Antes era un modal (bottom-sheet) montado dentro de PoolsPage; ahora es
 * una página propia en /pools/:poolId/sniffer, con el mismo comportamiento
 * (mapa + círculo de radio + aviso de ubicación) pero además:
 *   - Al entrar, si nunca se ha pedido permiso de ubicación (status
 *     'idle'), se solicita automáticamente (aviso nativo del navegador),
 *     igual que el resto de la app hace al arrancar.
 *   - Botón "Estoy dentro" debajo del mapa: comprueba si la posición del
 *     usuario está dentro del círculo del radio del Sniffer y, si es así,
 *     añade una entrada con la hora a una lista debajo del botón.
 *
 * Desde que las quedadas guardan lat/lng reales (el punto exacto en el que
 * se hizo clic en LocationPicker al crearlas), el Sniffer las usa
 * directamente sin volver a geocodificar — así se evita el desfase de
 * ~15-20 m que aparecía siempre en la misma dirección al hacer un
 * reverse-geocode (clic → texto) seguido de un forward-geocode (texto →
 * coordenadas) con Nominatim, que no siempre devuelve el mismo punto.
 *
 * Para quedadas antiguas creadas antes de este cambio (sin lat/lng
 * guardadas), se mantiene como respaldo la geocodificación de
 * pool.location_hint, igual que antes.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org';

// Antelación máxima con la que se puede usar el Sniffer antes de que
// empiece la quedada.
const SNIFFER_UNLOCK_MINUTES = 30;

// Radio del círculo verde del mapa y radio de detección del botón "Estoy
// dentro" — ampliado de 50 a 75 m para dar más margen de error de GPS.
const SNIFFER_RADIUS_METERS = 75;

// Cache en memoria: mismas coordenadas mientras la sesión esté abierta, sin
// volver a golpear Nominatim cada vez que se abre el Sniffer de la misma quedada.
const geocodeCache = new Map();

async function geocodeLocation(query) {
  if (geocodeCache.has(query)) return geocodeCache.get(query);
  const res = await fetch(
    `${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=es`,
    { headers: { 'Accept-Language': 'es' } }
  );
  const data = await res.json();
  const hit = data?.[0];
  const result = hit ? { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) } : null;
  geocodeCache.set(query, result);
  return result;
}

// Distancia en metros entre dos coordenadas (fórmula de Haversine).
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Mismo criterio de tier que usa el resto de la app (ver getMascotTier en
// PoolsPage.jsx / HomePage.jsx / FriendCard.jsx / GroupChatPage.jsx): 0-33 →
// low, 34-66 → mid, 67-100 → high.
function getMascotTier(level) {
  if (level <= 33) return 'low';
  if (level <= 66) return 'mid';
  return 'high';
}

// Mascota en miniatura — mismo criterio que en el resto de la app: capa
// base según tier de batería + overlay "horneado" (mascot_preview_url) con
// la personalización del usuario.
//
// Si el check-in es el propio (isMe), NO se usa mascot_preview_url: ese PNG
// lo genera y sube MascotPreviewSync con debounce (1.2s) + red, así que
// cambiar de outfit y entrar aquí seguía enseñando la ropa anterior hasta
// refrescar. En su lugar, MascotDisplay se monta sin overrides para que lea
// directamente el equipado real del contexto (useMascot), igual que hace
// ProfilePage.jsx con la mascota propia — se ve al instante.
function MiniMascot({ user, size = 32 }) {
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
      {user?.mascot_preview_url && (
        <img
          src={user.mascot_preview_url}
          alt=""
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
        />
      )}
    </div>
  );
}

export default function PoolSnifferPage() {
  const { poolId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { coords: userCoords, status: locationStatus, requestLocation } = useUserLocation();

  const [pool, setPool] = useState(null);
  const [poolLoading, setPoolLoading] = useState(true);
  const [poolError, setPoolError] = useState('');

  const [coords, setCoords] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [checkins, setCheckins] = useState([]);
  const [checkinsLoading, setCheckinsLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkMsg, setCheckMsg] = useState(null); // { type: 'ok'|'error', text }

  // Lista compartida de "Estoy dentro" — se carga del servidor (persiste
  // entre sesiones y la ven todos los que tienen acceso a la quedada).
  useEffect(() => {
    let cancelled = false;
    setCheckinsLoading(true);
    api.get(`/pools/${poolId}/sniffer/checkins`)
      .then(({ checkins: list }) => { if (!cancelled) setCheckins(list || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCheckinsLoading(false); });
    return () => { cancelled = true; };
  }, [poolId]);

  // Realtime: cuando otro participante marca "Estoy dentro", se añade a la
  // lista sin necesidad de recargar la página — mismo patrón que el resto
  // de la app (ver PoolChatPage.jsx).
  useEffect(() => {
    const channel = supabase
      .channel(`pool-sniffer-${poolId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'pool_sniffer_checkins',
        filter: `pool_id=eq.${poolId}`,
      }, async (payload) => {
        const { data } = await supabase
          .from('pool_sniffer_checkins')
          .select('id, checked_in_at, user:user_id(id, username, avatar_url, battery_level, mascot_preview_url)')
          .eq('id', payload.new.id)
          .single();
        if (data) {
          setCheckins(prev => prev.some(c => c.id === data.id) ? prev : [...prev, data]);
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [poolId]);

  // Carga la quedada al entrar en la página.
  useEffect(() => {
    let cancelled = false;
    setPoolLoading(true);
    setPoolError('');
    api.get(`/pools/${poolId}`)
      .then(({ pool: full }) => { if (!cancelled) setPool(full); })
      .catch(() => { if (!cancelled) setPoolError('No se ha podido cargar la quedada.'); })
      .finally(() => { if (!cancelled) setPoolLoading(false); });
    return () => { cancelled = true; };
  }, [poolId]);

  // Si nunca se ha pedido permiso de ubicación (idle), se pide automáticamente
  // al entrar en el Sniffer — el aviso nativo del navegador es "el aviso
  // típico de la aplicación" que aparece siempre que se necesita la ubicación.
  useEffect(() => {
    if (locationStatus === 'idle') requestLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationStatus]);

  // El Sniffer se puede abrir siempre, pero solo muestra el mapa desde 30
  // minutos antes del comienzo de la quedada. Si falta más tiempo, se
  // avisa en vez de geocodificar/mostrar el mapa.
  const unlockAt = pool?.scheduled_at
    ? new Date(new Date(pool.scheduled_at).getTime() - SNIFFER_UNLOCK_MINUTES * 60 * 1000)
    : null;
  const isUnlocked = !unlockAt || new Date() >= unlockAt;

  const hasStoredCoords = pool?.lat != null && pool?.lng != null;

  useEffect(() => {
    if (!pool) return;
    if (!isUnlocked) { setLoading(false); return; }

    // Coordenadas ya guardadas al crear la quedada (clic exacto en el mapa)
    // — caso normal desde ahora, sin llamada a Nominatim ni desfase.
    if (hasStoredCoords) {
      setCoords({ lat: pool.lat, lng: pool.lng });
      setError('');
      setLoading(false);
      return;
    }

    // Respaldo para quedadas antiguas sin lat/lng guardadas: geocodificar
    // el texto libre, como se hacía antes.
    let cancelled = false;
    const query = pool?.location_hint?.trim();
    if (!query) {
      setLoading(false);
      setError('Esta quedada no tiene una ubicación indicada.');
      return;
    }
    setLoading(true);
    setError('');
    geocodeLocation(query)
      .then(result => {
        if (cancelled) return;
        if (!result) setError('No se ha podido localizar esta dirección en el mapa.');
        else setCoords(result);
      })
      .catch(() => {
        if (!cancelled) setError('No se ha podido localizar esta dirección en el mapa.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [pool, pool?.location_hint, pool?.lat, pool?.lng, hasStoredCoords, isUnlocked]);

  // Mismo criterio que en CommunityPage: coords cacheadas de un permiso ya
  // revocado no cuentan como "ubicación activada".
  const showLocationWarning = !userCoords || locationStatus === 'denied';

  const distanceToPool = useMemo(() => {
    if (!userCoords || !coords) return null;
    return distanceMeters(userCoords.lat, userCoords.lng, coords.lat, coords.lng);
  }, [userCoords, coords]);

  // Máximo una vez por usuario: si ya apareces en la lista (por check-in
  // propio o por el evento Realtime de otra sesión/pestaña tuya), el botón
  // se deshabilita en vez de dejar volver a pulsar sin necesidad — el
  // servidor ya lo impide (UNIQUE pool_id+user_id, fase101), esto es solo
  // para que la UI lo refleje también.
  const alreadyCheckedIn = useMemo(
    () => checkins.some(c => c.user?.id === profile?.id),
    [checkins, profile?.id]
  );

  const handleCheckIn = async () => {
    if (alreadyCheckedIn || checkingIn) return;
    if (!userCoords) {
      requestLocation();
      setCheckMsg({ type: 'error', text: 'Activa tu ubicación para poder comprobarlo.' });
      return;
    }
    if (!coords) return;

    setCheckingIn(true);
    setCheckMsg(null);
    try {
      const { checkin, already_checked_in } = await api.post(`/pools/${poolId}/sniffer/checkin`, {
        lat: userCoords.lat,
        lng: userCoords.lng,
      });
      setCheckins(prev => prev.some(c => c.id === checkin.id) ? prev : [...prev, checkin]);
      setCheckMsg({
        type: 'ok',
        text: already_checked_in ? 'Ya estabas anotado en la lista.' : '¡Estás dentro del radio! Anotado.',
      });
    } catch (e) {
      const metros = e?.distance_meters;
      setCheckMsg({
        type: 'error',
        text: metros != null
          ? `Todavía no estás dentro (a ~${metros} m del punto).`
          : (e?.message || 'No se ha podido comprobar tu distancia.'),
      });
    } finally {
      setCheckingIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-bg flex flex-col">
      <nav className="border-b border-surface-border bg-surface-bg/90 backdrop-blur-xl z-10 flex-shrink-0">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="text-surface-muted hover:text-surface-text transition-colors p-1 text-lg">←</button>
          <span className="text-xl">🐽</span>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-surface-text">Sniffer</h1>
            {pool?.location_hint && (
              <p className="text-xs text-surface-muted font-mono truncate">{pool.location_hint}</p>
            )}
          </div>
        </div>
      </nav>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
          {poolLoading ? (
            <div className="h-[260px] rounded-2xl bg-surface-card border border-surface-border animate-pulse flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-accent-primary/40 border-t-accent-primary rounded-full animate-spin" />
            </div>
          ) : poolError ? (
            <div className="h-[260px] rounded-2xl bg-surface-card border border-surface-border flex items-center justify-center px-4 text-center">
              <p className="text-xs text-surface-muted font-mono">{poolError}</p>
            </div>
          ) : (
            <>
              {/* Aviso de ubicación del móvil no activada — mismo patrón que en
                  Comunidad, para que sea consistente en toda la app. */}
              {showLocationWarning && (
                <div className="flex items-center justify-between gap-3 text-xs bg-amber-500/10 border border-amber-500/25 text-amber-300 rounded-xl px-3 py-2.5">
                  <span>
                    📍 {locationStatus === 'denied'
                      ? 'Has denegado la ubicación: actívala para verte en el mapa.'
                      : locationStatus === 'unsupported'
                        ? 'Tu navegador no permite compartir ubicación.'
                        : locationStatus === 'requesting'
                          ? 'Pidiendo acceso a tu ubicación…'
                          : 'No tienes activada la ubicación de tu móvil.'}
                  </span>
                  {locationStatus !== 'unsupported' && locationStatus !== 'requesting' && (
                    <button
                      type="button"
                      onClick={requestLocation}
                      className="flex-shrink-0 underline font-display font-semibold whitespace-nowrap hover:text-amber-200 transition-colors"
                    >
                      Activar
                    </button>
                  )}
                </div>
              )}

              {loading ? (
                <div className="h-[260px] rounded-2xl bg-surface-card border border-surface-border animate-pulse flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-accent-primary/40 border-t-accent-primary rounded-full animate-spin" />
                </div>
              ) : !isUnlocked ? (
                <div className="h-[260px] rounded-2xl bg-surface-card border border-surface-border flex flex-col items-center justify-center gap-2 px-6 text-center">
                  <span className="text-2xl">🔒</span>
                  <p className="text-sm text-surface-text font-display font-semibold">
                    El modo Sniffer se activa 30 min antes de la quedada
                  </p>
                  <p className="text-xs text-surface-muted font-mono">
                    Vuelve más tarde para ver la ubicación en el mapa.
                  </p>
                </div>
              ) : error ? (
                <div className="h-[260px] rounded-2xl bg-surface-card border border-surface-border flex items-center justify-center px-4 text-center">
                  <p className="text-xs text-surface-muted font-mono">{error}</p>
                </div>
              ) : (
                <>
                  <GlobeLocationView
                    lat={coords.lat}
                    lng={coords.lng}
                    label={pool.location_hint}
                    radiusCircleMeters={SNIFFER_RADIUS_METERS}
                  />

                  <button
                    type="button"
                    onClick={handleCheckIn}
                    disabled={checkingIn || alreadyCheckedIn}
                    className="w-full font-display font-bold text-sm px-4 py-3 rounded-2xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 hover:border-emerald-500/50 transition-colors active:scale-[0.98] disabled:opacity-60"
                  >
                    {checkingIn ? 'Comprobando…' : alreadyCheckedIn ? '✅ Ya estás anotado' : '📍 Estoy dentro'}
                  </button>

                  {checkMsg ? (
                    <p className={`text-xs font-mono text-center ${checkMsg.type === 'ok' ? 'text-emerald-400' : 'text-amber-300'}`}>
                      {checkMsg.text}
                    </p>
                  ) : distanceToPool != null && (
                    <p className="text-xs font-mono text-center text-surface-muted">
                      {distanceToPool <= SNIFFER_RADIUS_METERS
                        ? 'Estás dentro del radio ✅'
                        : `Estás a ~${Math.round(distanceToPool)} m del punto`}
                    </p>
                  )}

                  {!checkinsLoading && checkins.length > 0 && (
                    <div className="bg-surface-card border border-surface-border rounded-2xl divide-y divide-surface-border overflow-hidden">
                      {checkins.map(c => (
                        <div key={c.id} className="px-3 py-2.5 flex items-center gap-2.5">
                          <MiniMascot user={c.user} size={30} />
                          <span className="flex-1 min-w-0 text-sm font-display font-semibold text-surface-text truncate">
                            {c.user?.username || 'Alguien'}
                            {c.user?.id === profile?.id && <span className="text-surface-muted font-normal"> (tú)</span>}
                          </span>
                          <span className="flex-shrink-0 text-xs font-mono text-surface-muted">
                            {new Date(c.checked_in_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
