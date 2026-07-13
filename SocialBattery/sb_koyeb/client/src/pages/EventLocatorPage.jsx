import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { useUserLocation } from '../context/UserLocationContext';
import LocationMapView from '../components/LocationMapView';
import { api } from '../lib/api';

// ── Página "Locator" — ubicación del evento a pantalla completa ────────────
// Antes era un modal emergente dentro de EventDetailPage; ahora es su propia
// ruta (/community/event/:eventId/locator) para que el botón "Locator" del
// panel superior navegue a una página en vez de abrir un popup.
export default function EventLocatorPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { coords: userCoords, status: locationStatus, requestLocation } = useUserLocation();

  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
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

  function handleCreateLocatorGroup() {
    if (!canCreateLocatorGroup) return;
    showToast('Función en camino: pronto podrás crear el grupo de localización 📍', 'info');
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

        <div className="bg-surface-card border border-surface-border rounded-2xl p-4">
          {event.lat != null && event.lng != null ? (
            <LocationMapView lat={event.lat} lng={event.lng} label={event.location} />
          ) : (
            <p className="text-sm text-surface-muted text-center py-8">Este evento no tiene ubicación en el mapa.</p>
          )}
        </div>

        <div>
          <button
            type="button"
            onClick={handleCreateLocatorGroup}
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
      </main>
    </div>
  );
}
