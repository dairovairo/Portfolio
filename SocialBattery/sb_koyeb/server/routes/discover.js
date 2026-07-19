const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { haversineKm } = require('../lib/homeLocation');
const { applyBatteryExpiryToUsers } = require('../lib/batteryExpiry');

const DEFAULT_RADIUS_KM = 25;
const MAX_RADIUS_KM = 100;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

const PUBLIC_FIELDS = 'id, username, avatar_url, bio, battery_level, battery_is_estimated, battery_updated_at, last_seen_at';

// Ids a excluir de cualquier sugerencia: yo mismo, gente con la que ya hay
// relación de amistad (aceptada, pendiente o rechazada — si la rechazaron o
// la rechacé, no tiene sentido volver a sugerirla) y gente bloqueada en
// cualquiera de las dos direcciones.
async function getExcludedIds(userId) {
  const [{ data: friendships }, { data: blocked }] = await Promise.all([
    supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
    supabase
      .from('blocked_users')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
  ]);

  const excluded = new Set([userId]);
  (friendships || []).forEach(f => {
    excluded.add(f.requester_id === userId ? f.addressee_id : f.requester_id);
  });
  (blocked || []).forEach(b => {
    excluded.add(b.blocker_id === userId ? b.blocked_id : b.blocker_id);
  });
  return excluded;
}

// GET /api/discover/nearby — usuarios cerca de mi ubicación habitual
// (users.home_lat/lng, la misma ubicación "de casa" resuelta que ya usan
// las notificaciones de eventos/sorteos por cercanía en community.js).
router.get('/nearby', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const radiusKm = Math.min(MAX_RADIUS_KM, Math.max(1, Number(req.query.radius_km) || DEFAULT_RADIUS_KM));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT));

  try {
    const { data: me, error: meErr } = await supabase
      .from('users')
      .select('home_lat, home_lng')
      .eq('id', userId)
      .single();
    if (meErr) throw meErr;

    if (me?.home_lat == null || me?.home_lng == null) {
      return res.json({ users: [], hasLocation: false });
    }

    const centerLat = Number(me.home_lat);
    const centerLng = Number(me.home_lng);
    const excluded = await getExcludedIds(userId);

    // Mismo patrón de bounding-box + criba exacta con haversine que
    // community.js usa para el radio de notificaciones.
    const latDelta = radiusKm / 111.0;
    const cosLat = Math.cos((centerLat * Math.PI) / 180);
    const lngDelta = cosLat > 0.0001 ? radiusKm / (111.0 * cosLat) : 180;

    let bboxQuery = supabase
      .from('users')
      .select(`${PUBLIC_FIELDS}, home_lat, home_lng`)
      .eq('discoverable', true)
      .not('home_lat', 'is', null)
      .gte('home_lat', centerLat - latDelta)
      .lte('home_lat', centerLat + latDelta)
      .gte('home_lng', centerLng - lngDelta)
      .lte('home_lng', centerLng + lngDelta)
      .limit(200);
    const { data: bboxUsers, error: bboxErr } = await bboxQuery;
    if (bboxErr) throw bboxErr;

    const inCircle = (bboxUsers || [])
      .filter(u => !excluded.has(u.id))
      .map(u => ({
        ...u,
        distance_km: haversineKm(centerLat, centerLng, Number(u.home_lat), Number(u.home_lng)),
      }))
      .filter(u => u.distance_km <= radiusKm)
      .sort((a, b) => a.distance_km - b.distance_km)
      .slice(0, limit)
      .map(({ home_lat, home_lng, ...rest }) => ({
        ...rest,
        distance_km: Math.round(rest.distance_km * 10) / 10,
      }));

    res.json({ users: applyBatteryExpiryToUsers(inCircle), hasLocation: true });
  } catch (err) {
    console.error('[discover] GET /nearby error:', err);
    res.status(500).json({ error: 'Error al buscar gente cerca de ti' });
  }
});

// GET /api/discover/suggested — "gente que quizá conozcas", rankeado por
// número de amigos en común (mismo criterio que usan otras redes sociales
// cuando no hay acceso a la agenda de contactos del teléfono).
router.get('/suggested', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT));

  try {
    const { data: myFriendships, error: myErr } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
    if (myErr) throw myErr;

    const myFriendIds = (myFriendships || []).map(f => f.requester_id === userId ? f.addressee_id : f.requester_id);

    if (myFriendIds.length === 0) {
      return res.json({ users: [] });
    }

    const excluded = await getExcludedIds(userId);

    const { data: friendsOfFriends, error: fofErr } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(myFriendIds.map(id => `requester_id.eq.${id},addressee_id.eq.${id}`).join(','));
    if (fofErr) throw fofErr;

    // Cuenta, para cada candidato, con cuántos de mis amigos coincide.
    const mutualCount = new Map();
    (friendsOfFriends || []).forEach(f => {
      [f.requester_id, f.addressee_id].forEach(candidateId => {
        if (excluded.has(candidateId)) return;
        // El otro extremo de esa amistad tiene que ser uno de mis amigos
        // para que cuente como "amigo en común" (y no cualquier fila).
        const otherEnd = f.requester_id === candidateId ? f.addressee_id : f.requester_id;
        if (!myFriendIds.includes(otherEnd)) return;
        mutualCount.set(candidateId, (mutualCount.get(candidateId) || 0) + 1);
      });
    });

    const topIds = [...mutualCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);

    if (topIds.length === 0) {
      return res.json({ users: [] });
    }

    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select(PUBLIC_FIELDS)
      .in('id', topIds);
    if (usersErr) throw usersErr;

    const withCounts = applyBatteryExpiryToUsers(users || [])
      .map(u => ({ ...u, mutual_friends: mutualCount.get(u.id) || 0 }))
      .sort((a, b) => b.mutual_friends - a.mutual_friends);

    res.json({ users: withCounts });
  } catch (err) {
    console.error('[discover] GET /suggested error:', err);
    res.status(500).json({ error: 'Error al buscar sugerencias' });
  }
});

module.exports = router;
