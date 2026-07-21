// ─────────────────────────────────────────────────────────────────────────
// Tracking de clicks a URL externa (fase 121)
// ─────────────────────────────────────────────────────────────────────────
// Dispara un ping fire-and-forget al backend cuando el usuario tapea el
// enlace externo del creador (comunidad o evento). Se usa desde los dos
// sitios donde ese enlace se pinta:
//
//   · CommunityPage.jsx  → community.url ("🔗 Ver más")
//   · EventDetailPage.jsx → event.url    ("🔗 Enlace")
//
// (Los sorteos NO tienen URL — se descartó en fase 122; para medir la
// tracción de un sorteo se usan los premios y su valoración, no un
// enlace externo.)
//
// Es CRÍTICO que el envío sobreviva a la navegación: al tapear un
// <a target="_blank"> o incluso un enlace en la misma pestaña, la
// petición de un fetch normal puede cancelarse cuando el navegador
// empieza a cargar la nueva URL. Se prioriza `navigator.sendBeacon`
// (diseñado exactamente para esto: encola en el navegador antes de
// permitir la navegación). Como fallback, `fetch(..., {keepalive:true})`.
//
// El ping no bloquea el enlace: se dispara en el onClick, y el navegador
// sigue con la navegación normal. Si el ping falla, se silencia — perder
// un click en analytics no debe romper la experiencia de abrir el
// enlace.
// ─────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase';

// Base del API — mismo criterio que lib/api.js (usa VITE_API_URL si
// existe, si no /api). Se resuelve una sola vez porque
// import.meta.env es estático a build-time.
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Mapa kind → path del endpoint. Se centraliza aquí para que las
// llamadas del cliente sean una línea y no una URL a mano.
// Nota: los sorteos NO tienen URL (fase 122 revirtió esa idea), así que
// solo comunidad y evento cuelgan enlaces externos que trackear.
const PATHS = {
  community: id => `/community/communities/${encodeURIComponent(id)}/url-click`,
  event:     id => `/community/events/${encodeURIComponent(id)}/url-click`,
};

// Cache de sesión: se recupera una sola vez al montar el módulo (el
// token se refresca solo vía onAuthStateChange en lib/api.js). Reutilizar
// el token evita ir a network cada tap.
let _tokenCache = null;
supabase.auth.onAuthStateChange((_event, session) => {
  _tokenCache = session?.access_token || null;
});

async function getToken() {
  if (_tokenCache) return _tokenCache;
  try {
    const { data } = await supabase.auth.getSession();
    _tokenCache = data?.session?.access_token || null;
  } catch {
    _tokenCache = null;
  }
  return _tokenCache;
}

// Envía el ping. `kind` = 'community' | 'event' | 'raffle'. No lanza:
// cualquier error se silencia. No devuelve nada útil — es fire-and-forget.
export async function trackUrlClick(kind, id) {
  const build = PATHS[kind];
  if (!build || !id) return;
  const path = build(id);
  const url = `${BASE_URL}${path}`;
  const token = await getToken();

  // sendBeacon no acepta headers arbitrarios, así que el token va como
  // querystring `?access_token=...` — el server usa
  // requireAuth (middleware/auth.js) que hoy lee del header Authorization.
  // Si el middleware no acepta el token por query, se pasa por fetch
  // keepalive como plan B. En la práctica, hoy solo Authorization
  // header vale — así que sendBeacon queda como best-effort silencioso y
  // fetch keepalive es lo que acaba llegando en la mayoría de casos.
  //
  // Intentamos sendBeacon primero porque es lo único que **garantiza**
  // que la petición se manda cuando el navegador está a punto de
  // navegar fuera. Si falla o el navegador no lo soporta, keepalive es
  // suficiente para enlaces target="_blank" (que no cancelan el
  // documento actual).
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      // Empaquetamos el token en el body como fallback si más adelante
      // el server acepta ambos; hoy no se lee, no hace daño.
      const payload = new Blob([JSON.stringify({ access_token: token })], { type: 'application/json' });
      navigator.sendBeacon(url, payload);
    }
  } catch {
    /* seguimos con fetch */
  }

  // fetch keepalive con Authorization header — es lo que el server
  // realmente entiende hoy. `keepalive: true` deja al navegador terminar
  // la petición aunque el usuario abandone la página.
  try {
    await fetch(url, {
      method: 'POST',
      keepalive: true,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    /* silencio absoluto — analytics no debe romper el link */
  }
}
