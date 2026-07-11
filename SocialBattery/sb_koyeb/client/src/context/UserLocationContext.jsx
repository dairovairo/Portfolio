import { createContext, useContext, useState, useCallback, useRef } from 'react';

// ── Ubicación del usuario (geolocalización del navegador) ─────────────────────
// Se usa para ordenar/filtrar eventos por cercanía en CommunityPage. El
// nombre del hook es `useUserLocation` (no `useLocation`) para no chocar con
// el hook de mismo nombre de react-router-dom, ya usado en BottomNav y
// PoolChatNotificationsContext.
//
// El permiso se pide una única vez al arrancar la app (ver App.jsx →
// AppRoutes, tras autenticar y con perfil completo). Si el usuario lo
// deniega, `status` queda en 'denied' y la UI que consuma este contexto
// puede mostrar un aviso con botón para reintentar (`requestLocation`).
//
// La última posición conocida se cachea en localStorage para no depender de
// que el navegador resuelva la geolocalización al instante en cada carga.

const UserLocationContext = createContext(null);

const CACHE_KEY = 'sb-user-last-location';

function loadCachedCoords() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.lat === 'number' && typeof parsed?.lng === 'number') return parsed;
  } catch {}
  return null;
}

export function UserLocationProvider({ children }) {
  const [coords, setCoords] = useState(() => loadCachedCoords());
  // 'idle' | 'requesting' | 'granted' | 'denied' | 'unsupported' | 'error'
  const [status, setStatus] = useState('idle');
  const requestedRef = useRef(false);

  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    requestedRef.current = true;
    setStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(next);
        setStatus('granted');
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch {}
      },
      (err) => {
        const denied = err?.code === 1; /* PERMISSION_DENIED */
        setStatus(denied ? 'denied' : 'error');
        if (denied) {
          // Si el permiso está realmente denegado, la última posición
          // cacheada ya no es de fiar (el usuario pudo desactivar la
          // ubicación tiempo después de concederla). La borramos para que
          // el resto de la UI (p.ej. el aviso en Comunidad) refleje el
          // estado real en vez de quedarse con coords obsoletas.
          setCoords(null);
          try { localStorage.removeItem(CACHE_KEY); } catch {}
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    );
  }, []);

  // Variante idempotente: la llama App.jsx al arrancar, pero si el usuario ya
  // ha pedido/reintentado manualmente (p.ej. desde el aviso en Comunidad) no
  // queremos relanzar otra petición al remontar rutas.
  const requestLocationOnce = useCallback(() => {
    if (requestedRef.current) return;
    requestLocation();
  }, [requestLocation]);

  return (
    <UserLocationContext.Provider value={{
      coords,
      status,
      hasCoords: Boolean(coords),
      requestLocation,
      requestLocationOnce,
    }}>
      {children}
    </UserLocationContext.Provider>
  );
}

export const useUserLocation = () => {
  const ctx = useContext(UserLocationContext);
  if (!ctx) throw new Error('useUserLocation must be inside UserLocationProvider');
  return ctx;
};
