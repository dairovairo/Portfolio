// server/lib/homeLocation.js — Lógica pura para decidir qué hacer con la
// ubicación "home" del usuario cuando llega un nuevo report del navegador.
//
// Se llama desde POST /users/me/report-location cada vez que el cliente
// consigue coords (UserLocationContext). Es pura: no toca BD, no toca
// red — sólo recibe estado + incoming y devuelve el estado nuevo. Se
// prueba en server/test/homeLocation.test.js.
//
// La regla es la "doble confirmación de sitio nuevo": queremos que el
// home_lat/home_lng del usuario refleje dónde vive/trabaja, no dónde
// abrió la app hoy. Para eso, un sitio nuevo tiene que verse DOS VECES
// SEGUIDAS (separadas por otras coords o no) antes de sobreescribir el
// home. Los pasos, exactos:
//
//   1) Si aún no hay home → el incoming se convierte en home.
//   2) Si el incoming está cerca (≤ confirmMeters) del home → se
//      confirma el home actual y se descarta cualquier pending (falso
//      positivo, el usuario estaba de paso).
//   3) Si hay pending y el incoming está cerca del pending → el
//      pending se promociona a home (la "segunda vez seguida en el
//      mismo sitio nuevo").
//   4) Si nada de lo anterior → el incoming se guarda como nuevo
//      pending, sustituyendo cualquier pending previo. El home sigue
//      igual.
//
// El helper devuelve { home, pending, change } — el caller es quien
// escribe en BD.

// Distancia Haversine (km) entre dos coordenadas geodésicas WGS-84.
// Precisión sobrada para nuestros radios (kilómetros), no hace falta
// la corrección de elipsoide de Vincenty.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // radio medio de la Tierra en km
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const DEFAULT_CONFIRM_METERS = 500;

function resolveHomeLocationUpdate({ current, pending, incoming, confirmMeters = DEFAULT_CONFIRM_METERS }) {
  if (!incoming || typeof incoming.lat !== 'number' || typeof incoming.lng !== 'number') {
    throw new Error('resolveHomeLocationUpdate: incoming.lat/lng requeridos');
  }
  const confirmKm = confirmMeters / 1000;

  // (1) Sin home → set home.
  if (!current) {
    return {
      home: { lat: incoming.lat, lng: incoming.lng },
      pending: null,
      change: 'set_home',
    };
  }

  const distToHomeKm = haversineKm(current.lat, current.lng, incoming.lat, incoming.lng);

  // (2) Cerca del home → confirma. Descarta pending si lo había.
  if (distToHomeKm <= confirmKm) {
    return {
      home: current,
      pending: null,
      change: pending ? 'confirm_home_discard_pending' : 'confirm_home',
    };
  }

  // (3) Cerca del pending → promociona.
  if (pending) {
    const distToPendingKm = haversineKm(pending.lat, pending.lng, incoming.lat, incoming.lng);
    if (distToPendingKm <= confirmKm) {
      return {
        home: { lat: incoming.lat, lng: incoming.lng },
        pending: null,
        change: 'promote_pending_to_home',
      };
    }
  }

  // (4) Sitio nuevo → guarda/reemplaza pending.
  return {
    home: current,
    pending: { lat: incoming.lat, lng: incoming.lng },
    change: pending ? 'replace_pending' : 'set_pending',
  };
}

module.exports = {
  resolveHomeLocationUpdate,
  haversineKm,
  DEFAULT_CONFIRM_METERS,
};
