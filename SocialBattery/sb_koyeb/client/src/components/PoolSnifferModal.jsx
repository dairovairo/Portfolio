import { useEffect, useState } from 'react';
import GlobeLocationView from './GlobeLocationView';
import { useUserLocation } from '../context/UserLocationContext';

/**
 * PoolSnifferModal — "🐽 Sniffer": muestra en un mapa la ubicación de una
 * quedada (pool.location_hint). Las quedadas solo guardan la ubicación como
 * texto libre, así que aquí se geocodifica con Nominatim (mismo servicio que
 * ya usa LocationPicker) y se reutiliza GlobeLocationView para pintar el
 * mapa con precisión.
 *
 * También muestra el aviso estándar de la app cuando el usuario no tiene la
 * ubicación de su móvil activada (mismo texto/patrón que en CommunityPage),
 * con botón para solicitarla.
 *
 * Props:
 *   pool    {object} — quedada (usa pool.location_hint)
 *   onClose () => void
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org';

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

export default function PoolSnifferModal({ pool, onClose }) {
  const { coords: userCoords, status: locationStatus, requestLocation } = useUserLocation();
  const [coords, setCoords] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
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
  }, [pool?.location_hint]);

  // Mismo criterio que en CommunityPage: coords cacheadas de un permiso ya
  // revocado no cuentan como "ubicación activada".
  const showLocationWarning = !userCoords || locationStatus === 'denied';

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mt-3 mb-1 flex-shrink-0" />

        <div className="flex-shrink-0 px-5 py-3 border-b border-surface-border flex items-center gap-2">
          <span className="text-xl">🐽</span>
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-bold text-surface-text">Sniffer</h3>
            {pool?.location_hint && (
              <p className="text-xs text-surface-muted font-mono truncate">{pool.location_hint}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 text-slate-500 hover:text-slate-300 transition-colors text-lg px-1"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 min-h-0 space-y-3">
          {/* Aviso de ubicación del móvil no activada — mismo patrón que en
              Comunidad, para que sea consistente en toda la app. */}
          {showLocationWarning && (
            <div className="flex items-center justify-between gap-3 text-xs bg-amber-500/10 border border-amber-500/25 text-amber-300 rounded-xl px-3 py-2.5">
              <span>
                📍 {locationStatus === 'denied'
                  ? 'Has denegado la ubicación: actívala para verte en el mapa.'
                  : locationStatus === 'unsupported'
                    ? 'Tu navegador no permite compartir ubicación.'
                    : 'No tienes activada la ubicación de tu móvil.'}
              </span>
              {locationStatus !== 'unsupported' && (
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
          ) : error ? (
            <div className="h-[260px] rounded-2xl bg-surface-card border border-surface-border flex items-center justify-center px-4 text-center">
              <p className="text-xs text-surface-muted font-mono">{error}</p>
            </div>
          ) : (
            <GlobeLocationView lat={coords.lat} lng={coords.lng} label={pool.location_hint} />
          )}
        </div>
      </div>
    </div>
  );
}
