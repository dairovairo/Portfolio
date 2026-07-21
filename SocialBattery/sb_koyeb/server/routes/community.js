const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const supabase = require('../lib/supabase');
const { applyBatteryExpiry } = require('../lib/batteryExpiry');
const { requireAuth } = require('../middleware/auth');
const { createImageUpload, createMediaUpload, storeImage, storeMedia, mediaKindFromMimetype } = require('../lib/imageUpload');
const { notifyUsers, getMutedUserIds } = require('../lib/webpush');
const { parseReminderMinutes } = require('../lib/reminderLeadTime');
const { getNotificationDayKey } = require('../lib/notificationDay');
const { runEventPromoPacingTick, FREE_THRESHOLD } = require('../jobs/eventPromoPacing');
const { addYears, addMonths } = require('../lib/dateRangeLimits');
const { BOOST_GROUP_SIZE } = require('../lib/adaptiveBoost');
const { pickRaffleFromRatioGroups } = require('../lib/promoDistribution');

const eventCoverUpload = createImageUpload({ maxSizeMb: 3 });
const communityCoverUpload = createImageUpload({ maxSizeMb: 3 });
const eventUpdateImageUpload = createImageUpload({ maxSizeMb: 8 });
// Multer instance for community chat image uploads (8 MB max) — mismo
// límite que el chat de grupos (groups.js).
const _communityChatImageUpload = createImageUpload({ maxSizeMb: 8 }).single('image');
// Multer para el hilo de comunidad (fotos o vídeos, 30 MB máx.).
const communityPostMediaUpload = createMediaUpload({ maxSizeMb: 30 });

function uploadEventCover(req, res, next) {
  eventCoverUpload.single('cover')(req, res, err => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message || 'No se pudo subir la portada' });
  });
}

function uploadCommunityCover(req, res, next) {
  communityCoverUpload.single('cover')(req, res, err => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message || 'No se pudo subir la foto' });
  });
}

function uploadEventUpdateImage(req, res, next) {
  eventUpdateImageUpload.single('image')(req, res, err => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message || 'No se pudo subir la imagen' });
  });
}

function uploadCommunityPostMedia(req, res, next) {
  communityPostMediaUpload.single('media')(req, res, err => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message || 'No se pudo subir el archivo' });
  });
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseRequestKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

function getUserSupabase(req) {
  if (!supabaseUrl || !supabaseRequestKey || !req.token) return supabase;

  return createClient(supabaseUrl, supabaseRequestKey, {
    global: {
      headers: {
        Authorization: `Bearer ${req.token}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function communityErrorMessage(err, fallback) {
  if (err?.code === '23503') {
    return 'Tu perfil no esta listo para crear contenido. Completa el perfil e intentalo de nuevo.';
  }
  if (err?.code === '42501') {
    return 'No tienes permisos para realizar esta accion.';
  }
  if (err?.code === '42P01' || err?.code === '42703') {
    return 'Falta aplicar la migracion de comunidad en Supabase.';
  }
  return fallback;
}

function fallbackUsername(user) {
  const idPart = user.id.replace(/-/g, '').slice(0, 12);
  return `user_${idPart}`;
}

const MAX_CATEGORIES = 3;

// Fase 121: como mucho 4 "actividades" (eventos + sorteos) vivas a la vez
// por comunidad. Una actividad está viva si NO está acabada — mismo
// criterio que ya usa el dashboard (server-side y cliente-side). Se
// aplica en POST /events y POST /communities/:id/raffles vía
// assertActiveActivityCapNotReached() usando la RPC
// community_active_activity_count (ver migración phase 121).
const ACTIVE_ACTIVITY_LIMIT_PER_COMMUNITY = 4;

// Cuenta actividades vivas de la comunidad (eventos + sorteos) y lanza
// un error 400-friendly si ya se llegó al tope. Se llama justo después
// de la comprobación de admin en los POST de creación (nunca en edits ni
// renovaciones — solo la creación gasta un hueco del cap).
//
// El resultado (n, limit) también se devuelve para poder pintarlo en la
// respuesta del dashboard sin repetir la consulta.
async function getActiveActivityCount(communityId) {
  const { data, error } = await supabase.rpc('community_active_activity_count', {
    p_community_id: communityId,
  });
  if (error) {
    // Si falta la migración phase 121 la RPC devuelve PGRST202 —
    // exactamente igual que las de la fase 111 (ver adStatsError).
    const code = error?.code;
    const message = error?.message || '';
    if (code === 'PGRST202' || /could not find the function|does not exist/i.test(message)) {
      throw new Error(
        'Falta la función community_active_activity_count en la base de datos: ejecuta supabase_schema_phase121_activity_cap_and_url_clicks.sql en el SQL Editor de Supabase.'
      );
    }
    throw error;
  }
  // La RPC devuelve un integer plano. Supabase lo entrega como number o
  // como string en función de la versión — normalizamos.
  const n = Number(data ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function activityCapError(count) {
  return {
    error: `Ya tienes ${count}/${ACTIVE_ACTIVITY_LIMIT_PER_COMMUNITY} actividades activas en esta comunidad (eventos + sorteos). Espera a que alguna acabe o finalízala antes de crear otra.`,
    code: 'activity_cap_reached',
    active_activity_count: count,
    active_activity_limit: ACTIVE_ACTIVITY_LIMIT_PER_COMMUNITY,
  };
}

// El cliente manda `categories` como un string JSON dentro del FormData
// (p.ej. '["Música","Arte"]'), ya que FormData solo admite valores string.
// Devuelve un array de strings ya recortados y sin vacíos/duplicados.
function parseCategories(raw) {
  if (raw === undefined || raw === null || raw === '') return [];

  let list;
  if (Array.isArray(raw)) {
    list = raw;
  } else {
    try {
      const parsed = JSON.parse(raw);
      list = Array.isArray(parsed) ? parsed : [raw];
    } catch {
      list = [raw];
    }
  }

  const seen = new Set();
  const cleaned = [];
  for (const item of list) {
    const value = String(item ?? '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(value);
  }
  return cleaned;
}

async function ensurePublicProfile(user) {
  const { data: existing, error: selectError } = await supabase
    .from('users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return;

  const { error: insertError } = await supabase
    .from('users')
    .insert({
      id: user.id,
      username: fallbackUsername(user),
      display_name: fallbackUsername(user),
    });

  if (!insertError) return;

  const { data: afterInsert } = await supabase
    .from('users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (!afterInsert) throw insertError;
}

async function getCommunityAdminState(communityId, userId) {
  const { data: community, error: communityError } = await supabase
    .from('communities')
    .select('id, creator_id')
    .eq('id', communityId)
    .single();

  if (communityError || !community) {
    return { community: null, membership: null, isAdmin: false };
  }

  const { data: membership } = await supabase
    .from('community_members')
    .select('role')
    .eq('community_id', communityId)
    .eq('user_id', userId)
    .maybeSingle();

  const isAdmin = community.creator_id === userId || membership?.role === 'admin';
  const isModerator = membership?.role === 'moderator';

  return {
    community,
    membership,
    isAdmin,
    isModerator,
    // admin o moderador: puede cambiar el fondo del chat de la comunidad
    isStaff: isAdmin || isModerator,
  };
}

async function selectEventRows(db, table, eventIds, columns = 'event_id, user_id') {
  const { data, error } = await db
    .from(table)
    .select(columns)
    .in('event_id', eventIds);

  if (!error) return data || [];
  if ((error.code === '42P01' || error.code === '42703') && columns !== 'event_id, user_id') {
    return selectEventRows(db, table, eventIds);
  }
  if (error.code === '42P01' || error.code === '42703') return [];
  throw error;
}

function countByEvent(rows = []) {
  return rows.reduce((acc, row) => {
    acc[row.event_id] = (acc[row.event_id] || 0) + 1;
    return acc;
  }, {});
}

async function enrichEvents(db, events = [], currentUserId = null) {
  const eventList = events || [];
  const eventIds = eventList.map(ev => ev.id).filter(Boolean);
  if (eventIds.length === 0) return eventList;

  const [attendees, likes] = await Promise.all([
    selectEventRows(db, 'community_event_attendees', eventIds, 'event_id, user_id, reminder_minutes_before'),
    selectEventRows(db, 'community_event_likes', eventIds),
  ]);

  const attendeeCountByEvent = countByEvent(attendees);
  const likeCountByEvent = countByEvent(likes);
  const attendeeIdsByEvent = attendees.reduce((acc, row) => {
    if (!acc[row.event_id]) acc[row.event_id] = [];
    acc[row.event_id].push(row.user_id);
    return acc;
  }, {});
  const likedEventIds = new Set(
    currentUserId
      ? likes.filter(row => row.user_id === currentUserId).map(row => row.event_id)
      : []
  );
  const currentReminderByEvent = currentUserId
    ? attendees.reduce((acc, row) => {
        if (row.user_id === currentUserId) {
          acc[row.event_id] = row.reminder_minutes_before ?? null;
        }
        return acc;
      }, {})
    : {};

  return eventList.map(ev => ({
    ...ev,
    creator_name: ev.creator?.username || 'Alguien',
    community_name: ev.community?.name || null,
    organization: ev.organization || ev.community?.organization || null,
    attendee_count: attendeeCountByEvent[ev.id] || 0,
    attendee_ids: attendeeIdsByEvent[ev.id] || [],
    like_count: likeCountByEvent[ev.id] || 0,
    liked_by_current_user: likedEventIds.has(ev.id),
    current_user_reminder_minutes_before: attendeeIdsByEvent[ev.id]?.includes(currentUserId)
      ? currentReminderByEvent[ev.id] ?? null
      : null,
  }));
}

function splitEventsByDate(events) {
  const now = Date.now();
  const getEndTime = ev => {
    const endTime = ev.ends_at ? new Date(ev.ends_at).getTime() : NaN;
    if (!Number.isNaN(endTime)) return endTime;
    const startTime = new Date(ev.event_date).getTime();
    return Number.isNaN(startTime) ? 0 : startTime;
  };
  const current_events = events.filter(ev => getEndTime(ev) >= now);
  const past_events = events
    .filter(ev => getEndTime(ev) < now)
    .sort((a, b) => new Date(b.event_date) - new Date(a.event_date));

  return { current_events, past_events };
}

// GET /api/community/events
router.get('/events', requireAuth, async (req, res) => {
  const db = getUserSupabase(req);

  try {
    // Only fetch events that haven't ended yet (or have no end date but start in the future/today).
    // Limit to 100 to prevent unbounded scans; enrichEvents batches attendees+likes over the full set.
    const now = new Date().toISOString();
    const { data: events, error } = await db
      .from('community_events')
      .select(`
        id, title, description, category, categories, event_date, ends_at, location, lat, lng, organization, cover_image_url,
        url, price, additional_info, max_attendees, creator_id, community_id, created_at, promotion_plan, notification_count,
        creator:users!community_events_creator_id_fkey(username),
        community:communities!community_events_community_id_fkey(id, name, organization)
      `)
      .or(`ends_at.gte.${now},and(ends_at.is.null,event_date.gte.${now})`)
      .order('event_date', { ascending: true })
      .limit(100);

    if (error) throw error;

    const enriched = await enrichEvents(db, events || [], req.user.id);

    res.json({ events: enriched });
  } catch (err) {
    console.error('[community] GET /events error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al obtener los eventos') });
  }
});

// GET /api/community/events/calendar
// Eventos del usuario para la vista de calendario mensual (CalendarPage.jsx):
// solo los eventos a los que está apuntado (community_event_attendees),
// sin filtrar por fecha (pasados y futuros), con los campos mínimos.
router.get('/events/calendar', requireAuth, async (req, res) => {
  const db = getUserSupabase(req);
  const userId = req.user.id;

  try {
    const { data: attending } = await db
      .from('community_event_attendees')
      .select('event_id')
      .eq('user_id', userId);
    const eventIds = [...new Set((attending || []).map(a => a.event_id))];
    if (!eventIds.length) return res.json({ events: [] });

    const { data: events, error } = await db
      .from('community_events')
      .select('id, title, event_date, ends_at')
      .in('id', eventIds);

    if (error) throw error;

    res.json({
      events: (events || []).map(e => ({
        id: e.id,
        title: e.title,
        date: e.event_date,
        ends_at: e.ends_at,
      })),
    });
  } catch (err) {
    console.error('[community] GET /events/calendar error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al obtener el calendario de eventos') });
  }
});

// GET /api/community/events/ranking
// Devuelve eventos para los rankings, incluyendo eventos ya finalizados
// (a diferencia de GET /events, que solo trae eventos activos/futuros).
// Se ordena por fecha descendente y se limita a 300 para evitar escaneos
// sin control, priorizando los eventos más recientes si hay overflow.
router.get('/events/ranking', requireAuth, async (req, res) => {
  const db = getUserSupabase(req);

  try {
    const { data: events, error } = await db
      .from('community_events')
      .select(`
        id, title, description, category, categories, event_date, ends_at, location, lat, lng, organization, cover_image_url,
        url, price, additional_info, max_attendees, creator_id, community_id, created_at, promotion_plan, notification_count,
        creator:users!community_events_creator_id_fkey(username),
        community:communities!community_events_community_id_fkey(id, name, organization)
      `)
      .order('event_date', { ascending: false })
      .limit(300);

    if (error) throw error;

    const enriched = await enrichEvents(db, events || [], req.user.id);

    res.json({ events: enriched });
  } catch (err) {
    console.error('[community] GET /events/ranking error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al obtener el ranking de eventos') });
  }
});

// Devuelve el Set de candidateIds que tiene activado "Silenciar nuevos
// eventos de tus comunidades" (users.mute_new_events, fase 92). Se usa para
// no mandar el push inmediato de "nuevo evento en tu comunidad" (cualquier
// plan) a quien lo tenga silenciado — igual que getPoolChatMuteFilteredIds
// en routes/pools.js.
async function getMuteNewEventsFilteredIds(candidateIds) {
  if (!candidateIds.length) return new Set();
  try {
    const { data } = await supabase
      .from('users')
      .select('id')
      .in('id', candidateIds)
      .eq('mute_new_events', true);
    return new Set((data || []).map(u => u.id));
  } catch {
    return new Set();
  }
}

// Devuelve el Set de candidateIds que tiene activado "Silenciar nuevos
// sorteos de tus comunidades" (users.mute_new_raffles, fase 107). Se usa en
// notifyCommunityRaffleTargets para no mandar el broadcast (avioneta popup
// instantánea) ni el push inmediato de "nuevo sorteo en tu comunidad" a
// quien lo tenga silenciado — mismo patrón que getMuteNewEventsFilteredIds
// (fase 92) y getMuteNewPoolsFilteredIds/getPoolMuteFilteredIds en pools.js.
async function getMuteNewRafflesFilteredIds(candidateIds) {
  if (!candidateIds.length) return new Set();
  try {
    const { data } = await supabase
      .from('users')
      .select('id')
      .in('id', candidateIds)
      .eq('mute_new_raffles', true);
    return new Set((data || []).map(u => u.id));
  } catch {
    return new Set();
  }
}

// ── GET /api/community/events/promotion-audience ─────────────────────────────
// Devuelve el tamaño de la audiencia potencial de una promoción Premium/Ultra
// para un evento que aún NO se ha creado (draft en el cliente,
// EventAdConfigPage.jsx). El total es "todos los usuarios de la app salvo el
// propio creador Y salvo los miembros de la comunidad organizadora" — misma
// lógica que usa server/jobs/eventPromoPacing.js para su pool real (ver
// communityMembersByCommunity en ese archivo: los miembros ya se enteran del
// evento al publicarse, así que la promoción de pago no debe contarlos ni
// dirigirse a ellos).
//
// Fase 108: community_id es OBLIGATORIO. Si no se manda, se rechaza (ya no
// existen "eventos sueltos" sin comunidad).
//
// Con ?filter=interested&categories=<JSON array> se añade además cuántos de
// esos usuarios tienen entre sus intereses alguna de las categorías del
// evento (users.interests ∩ event.categories) — este es el filtro de
// intereses del EventAdConfigPage. Si no se manda ninguna categoría, se
// responde categories_defined=false y interested=null (mismo contrato que
// raffle-audience cuando la comunidad no tiene categorías definidas).
//
// Fase 110: con ?center_lat=X&center_lng=Y&radius_km=Z se añade también
// nearby = cuántos usuarios notificables tienen home_lat/home_lng dentro
// del círculo, e interested_nearby = intersección de ambos filtros. El
// radio debe estar en [1, 500] km (constraint replicada en la BD, ver
// supabase_schema_phase110_event_location_filter.sql). Si el usuario no
// ha sido reportado nunca su ubicación (home_lat NULL), no cuenta como
// notificable para nearby — es una limitación consciente, no cabreamos
// a nadie mandándole publicidad "de cerca" cuando no sabemos dónde vive.
router.get('/events/promotion-audience', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const wantInterested = req.query.filter === 'interested';
  const communityId = req.query.community_id || null;
  if (!communityId) {
    return res.status(400).json({ error: 'community_id es obligatorio (los eventos deben pertenecer a una comunidad)' });
  }

  let categories = [];
  if (req.query.categories) {
    try {
      const parsed = JSON.parse(req.query.categories);
      if (Array.isArray(parsed)) categories = parsed.filter(Boolean);
    } catch {
      return res.status(400).json({ error: 'categories debe ser un JSON array' });
    }
  }

  // Fase 110: filtro por ubicación (opcional, "all-or-nothing")
  const wantLocation = req.query.center_lat != null && req.query.center_lng != null && req.query.radius_km != null;
  let centerLat, centerLng, radiusKm;
  if (wantLocation) {
    centerLat = Number(req.query.center_lat);
    centerLng = Number(req.query.center_lng);
    radiusKm = Number(req.query.radius_km);
    if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng) || !Number.isFinite(radiusKm)) {
      return res.status(400).json({ error: 'center_lat/center_lng/radius_km deben ser numéricos' });
    }
    if (centerLat < -90 || centerLat > 90 || centerLng < -180 || centerLng > 180) {
      return res.status(400).json({ error: 'center_lat/center_lng fuera de rango WGS-84' });
    }
    if (radiusKm < 1 || radiusKm > 500) {
      return res.status(400).json({ error: 'radius_km debe estar entre 1 y 500' });
    }
  }

  try {
    const { data: members, error: memErr } = await supabase
      .from('community_members')
      .select('user_id')
      .eq('community_id', communityId);
    if (memErr) throw memErr;
    const excludedMemberIds = (members || []).map(m => m.user_id).filter(id => id !== userId);

    let totalQuery = supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .neq('id', userId);
    if (excludedMemberIds.length) totalQuery = totalQuery.not('id', 'in', `(${excludedMemberIds.join(',')})`);
    const { count: totalCount, error: totalErr } = await totalQuery;
    if (totalErr) throw totalErr;

    let interested = null;
    let categoriesDefined = null;
    if (wantInterested) {
      if (!categories.length) {
        categoriesDefined = false;
      } else {
        categoriesDefined = true;
        let interestedQuery = supabase
          .from('users')
          .select('id', { count: 'exact', head: true })
          .neq('id', userId)
          .overlaps('interests', categories);
        if (excludedMemberIds.length) interestedQuery = interestedQuery.not('id', 'in', `(${excludedMemberIds.join(',')})`);
        const { count: interestedCount, error: interestedErr } = await interestedQuery;
        if (interestedErr) throw interestedErr;
        interested = interestedCount || 0;
      }
    }

    let nearby = null;
    let interestedNearby = null;
    if (wantLocation) {
      const { haversineKm } = require('../lib/homeLocation');
      // Bounding-box en JS. 1 grado de lat ≈ 111 km; para lng se corrige por
      // cos(centerLat). Es rápido (usa el índice users_home_coords_idx) y
      // devuelve un superconjunto; la criba exacta la hace haversine abajo.
      const latDelta = radiusKm / 111.0;
      const cosLat = Math.cos((centerLat * Math.PI) / 180);
      const lngDelta = cosLat > 0.0001 ? radiusKm / (111.0 * cosLat) : 180;
      let bboxQuery = supabase
        .from('users')
        .select(`id, home_lat, home_lng${wantInterested && categories.length ? ', interests' : ''}`)
        .neq('id', userId)
        .not('home_lat', 'is', null)
        .gte('home_lat', centerLat - latDelta)
        .lte('home_lat', centerLat + latDelta)
        .gte('home_lng', centerLng - lngDelta)
        .lte('home_lng', centerLng + lngDelta);
      if (excludedMemberIds.length) bboxQuery = bboxQuery.not('id', 'in', `(${excludedMemberIds.join(',')})`);
      const { data: bboxUsers, error: bboxErr } = await bboxQuery;
      if (bboxErr) throw bboxErr;

      const inCircle = (bboxUsers || []).filter(u =>
        haversineKm(centerLat, centerLng, Number(u.home_lat), Number(u.home_lng)) <= radiusKm
      );
      nearby = inCircle.length;

      if (wantInterested && categories.length) {
        const categorySet = new Set(categories);
        interestedNearby = inCircle.filter(u =>
          (u.interests || []).some(cat => categorySet.has(cat))
        ).length;
      }
    }

    res.json({
      total: totalCount || 0,
      interested,
      categories_defined: categoriesDefined,
      nearby,
      interested_nearby: interestedNearby,
    });
  } catch (err) {
    console.error('[community] GET /events/promotion-audience error:', err);
    res.status(500).json({ error: err.message || 'Error al calcular la audiencia' });
  }
});

// POST /api/community/events
router.post('/events', requireAuth, uploadEventCover, async (req, res) => {
  const { title, description, category, event_date, ends_at, location, lat, lng, max_attendees, community_id, organization, url, price, additional_info, promotion_plan, notification_count, audience_interested_only, audience_center_lat, audience_center_lng, audience_radius_km } = req.body;
  const userId = req.user.id;

  const categories = parseCategories(req.body.categories ?? category);
  if (categories.length > MAX_CATEGORIES) {
    return res.status(400).json({ error: `Puedes elegir hasta ${MAX_CATEGORIES} categorías` });
  }
  if (!categories.length) {
    return res.status(400).json({ error: 'Elige al menos una categoría para el evento' });
  }

  if (!title?.trim()) return res.status(400).json({ error: 'El titulo es obligatorio' });
  if (!event_date) return res.status(400).json({ error: 'La fecha es obligatoria' });
  const eventDate = new Date(event_date);
  if (Number.isNaN(eventDate.getTime())) {
    return res.status(400).json({ error: 'La fecha no es valida' });
  }
  // La fecha de inicio no puede quedar a más de un año de la creación del evento.
  const maxEventStartDate = addYears(new Date(), 1);
  if (eventDate > maxEventStartDate) {
    return res.status(400).json({ error: 'La fecha de inicio no puede ser más de un año después de la creación del evento' });
  }
  const eventLocation = location?.trim();
  if (!eventLocation) return res.status(400).json({ error: 'La ubicacion es obligatoria' });

  let endDateIso = null;
  if (ends_at) {
    const endDate = new Date(ends_at);
    if (Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'La fecha fin no es valida' });
    }
    if (endDate <= eventDate) {
      return res.status(400).json({ error: 'La fecha fin debe ser posterior al inicio' });
    }
    // La fecha de fin no puede quedar a más de un mes de la fecha de inicio.
    const maxEventEndDate = addMonths(eventDate, 1);
    if (endDate > maxEventEndDate) {
      return res.status(400).json({ error: 'La fecha fin no puede ser más de un mes después del inicio' });
    }
    endDateIso = endDate.toISOString();
  }

  const maxAttendees = Number.parseInt(max_attendees, 10) || 50;
  if (maxAttendees < 2 || maxAttendees > 10000) {
    return res.status(400).json({ error: 'El maximo de asistentes debe estar entre 2 y 10000' });
  }

  // Premium/Ultra: notificaciones push on-demand, contratables entre NOTIF_MIN y NOTIF_MAX.
  const NOTIF_MIN = 500;
  const NOTIF_MAX = 50000;
  const resolvedPlan = ['basic', 'premium', 'ultra'].includes(promotion_plan) ? promotion_plan : 'basic';

  let resolvedNotificationCount = null;
  if (resolvedPlan === 'premium' || resolvedPlan === 'ultra') {
    const parsedCount = Number.parseInt(notification_count, 10);
    if (!Number.isFinite(parsedCount) || parsedCount < NOTIF_MIN || parsedCount > NOTIF_MAX) {
      return res.status(400).json({
        error: `Elige cuántas notificaciones quieres contratar (entre ${NOTIF_MIN} y ${NOTIF_MAX})`,
      });
    }
    resolvedNotificationCount = parsedCount;
  }

  // Fase 105: filtro opcional "solo intereses" — restringe el pool de
  // notificables del evento a los usuarios cuyos intereses se cruzan con
  // las categorías del evento (users.interests ∩ event.categories). Se
  // ignora fuera de premium/ultra (basic no tiene alcance contratado).
  const resolvedInterestedOnly =
    (resolvedPlan === 'premium' || resolvedPlan === 'ultra') &&
    (audience_interested_only === 'true' || audience_interested_only === true);

  // Fase 110: filtro opcional por ubicación — círculo alrededor del punto
  // del evento. Es all-or-nothing: los tres campos van juntos. Fuera de
  // premium/ultra se ignora (basic no tiene alcance contratado). El radio
  // debe caer en [1, 500] km, coherente con la constraint de BD.
  let resolvedCenterLat = null;
  let resolvedCenterLng = null;
  let resolvedRadiusKm = null;
  const wantsLocationFilter =
    (resolvedPlan === 'premium' || resolvedPlan === 'ultra') &&
    audience_center_lat != null && audience_center_lat !== '' &&
    audience_center_lng != null && audience_center_lng !== '' &&
    audience_radius_km != null && audience_radius_km !== '';
  if (wantsLocationFilter) {
    resolvedCenterLat = Number.parseFloat(audience_center_lat);
    resolvedCenterLng = Number.parseFloat(audience_center_lng);
    resolvedRadiusKm  = Number.parseFloat(audience_radius_km);
    if (!Number.isFinite(resolvedCenterLat) || !Number.isFinite(resolvedCenterLng) || !Number.isFinite(resolvedRadiusKm)) {
      return res.status(400).json({ error: 'Filtro por ubicación: valores numéricos inválidos' });
    }
    if (resolvedCenterLat < -90 || resolvedCenterLat > 90 || resolvedCenterLng < -180 || resolvedCenterLng > 180) {
      return res.status(400).json({ error: 'Filtro por ubicación: coordenadas fuera de rango' });
    }
    if (resolvedRadiusKm < 1 || resolvedRadiusKm > 500) {
      return res.status(400).json({ error: 'Filtro por ubicación: el radio debe estar entre 1 y 500 km' });
    }
  }

  try {
    await ensurePublicProfile(req.user);

    // Fase 108: todo evento debe pertenecer a una comunidad. Rechazamos
    // aquí ANTES de tocar BD; ver también la constraint NOT NULL en
    // supabase_schema_phase108_events_require_community.sql.
    const communityId = community_id || null;
    if (!communityId) {
      return res.status(400).json({ error: 'Los eventos deben pertenecer a una comunidad' });
    }
    const { community, isAdmin } = await getCommunityAdminState(communityId, userId);
    if (!community) return res.status(404).json({ error: 'Comunidad no encontrada' });
    if (!isAdmin) {
      return res.status(403).json({ error: 'Solo el administrador puede publicar eventos en esta comunidad' });
    }

    // Fase 121: tope de actividades vivas por comunidad. Se aplica solo
    // en creación (renovaciones y edits no cuentan). Va aquí — después
    // de resolver la comunidad y confirmar que somos admin — para no
    // filtrar información a un ajeno con un 400 sobre una comunidad que
    // no puede ni ver.
    const activeCount = await getActiveActivityCount(communityId);
    if (activeCount >= ACTIVE_ACTIVITY_LIMIT_PER_COMMUNITY) {
      return res.status(400).json(activityCapError(activeCount));
    }

    // Política de bloqueo por audiencia insuficiente (debe reflejar
    // exactamente blockedByFilterShortfall en EventAdConfigPage.jsx): SOLO
    // se bloquea si algún filtro DURO (intereses, ubicación o ambos) está
    // activo y el pool resultante (excluyendo creador y, si aplica,
    // miembros de la comunidad) no llega al mínimo contratable (NOTIF_MIN).
    // SIN filtro, se deja publicar el evento aunque el pool notificable
    // sea menor — esto favorece el crecimiento de la app cuando aún tiene
    // pocos usuarios; el pacing (eventPromoPacing.js) ya reparte como
    // mucho tantas notificaciones como quepan en el pool real.
    if (resolvedInterestedOnly || wantsLocationFilter) {
      if (resolvedInterestedOnly && !categories.length) {
        return res.status(400).json({ error: 'Define categorías en el evento para poder filtrar por intereses' });
      }
      // Fase 108: communityId siempre existe (validado arriba). Excluimos
      // a los miembros del pool de audiencia porque ya se enteran del
      // evento por el aviso inmediato a la comunidad, no cuentan como
      // publicidad de pago.
      const { data: members, error: memErr } = await supabase
        .from('community_members')
        .select('user_id')
        .eq('community_id', communityId);
      if (memErr) throw memErr;
      const excludedMemberIds = (members || []).map(m => m.user_id).filter(id => id !== userId);

      // Cuenta el pool notificable respetando todos los filtros duros
      // activos combinados: intereses (users.interests ∩ categories) y
      // ubicación (users.home_lat/lng dentro del círculo). El código de
      // aquí y el del endpoint /promotion-audience deben mantener el
      // mismo criterio o la UI y el POST divergirán.
      let filteredCount;
      if (wantsLocationFilter) {
        // Bounding-box + haversine JS. Fetch selecciona interests solo si
        // hace falta cruzarlos.
        const { haversineKm } = require('../lib/homeLocation');
        const latDelta = resolvedRadiusKm / 111.0;
        const cosLat = Math.cos((resolvedCenterLat * Math.PI) / 180);
        const lngDelta = cosLat > 0.0001 ? resolvedRadiusKm / (111.0 * cosLat) : 180;
        let bboxQuery = supabase
          .from('users')
          .select(`id, home_lat, home_lng${resolvedInterestedOnly ? ', interests' : ''}`)
          .neq('id', userId)
          .not('home_lat', 'is', null)
          .gte('home_lat', resolvedCenterLat - latDelta)
          .lte('home_lat', resolvedCenterLat + latDelta)
          .gte('home_lng', resolvedCenterLng - lngDelta)
          .lte('home_lng', resolvedCenterLng + lngDelta);
        if (excludedMemberIds.length) bboxQuery = bboxQuery.not('id', 'in', `(${excludedMemberIds.join(',')})`);
        const { data: bboxUsers, error: bboxErr } = await bboxQuery;
        if (bboxErr) throw bboxErr;

        let inCircle = (bboxUsers || []).filter(u =>
          haversineKm(resolvedCenterLat, resolvedCenterLng, Number(u.home_lat), Number(u.home_lng)) <= resolvedRadiusKm
        );
        if (resolvedInterestedOnly) {
          const categorySet = new Set(categories);
          inCircle = inCircle.filter(u => (u.interests || []).some(cat => categorySet.has(cat)));
        }
        filteredCount = inCircle.length;
      } else {
        // Sin filtro por ubicación → mismo count query que antes (solo
        // intereses).
        let interestedQuery = supabase
          .from('users')
          .select('id', { count: 'exact', head: true })
          .neq('id', userId)
          .overlaps('interests', categories);
        if (excludedMemberIds.length) interestedQuery = interestedQuery.not('id', 'in', `(${excludedMemberIds.join(',')})`);
        const { count: interestedCount, error: interestedErr } = await interestedQuery;
        if (interestedErr) throw interestedErr;
        filteredCount = interestedCount || 0;
      }

      if (filteredCount < NOTIF_MIN) {
        const filterLabels = [];
        if (resolvedInterestedOnly) filterLabels.push('intereses');
        if (wantsLocationFilter) filterLabels.push('ubicación');
        return res.status(400).json({
          error: `Solo hay ${filteredCount} usuarios disponibles con los filtros aplicados (${filterLabels.join(' y ')}), por debajo del mínimo contratable (${NOTIF_MIN}): amplía o quita algún filtro para poder publicar el evento`,
        });
      }
    }

    let coverImageUrl = req.body.cover_image_url?.trim() || null;
    if (req.file) {
      coverImageUrl = await storeImage({
        file: req.file,
        objectName: `event-covers/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fallbackMaxLength: 4500000,
      });
    }

    const { data: event, error } = await supabase
      .from('community_events')
      .insert({
        title: title.trim(),
        description: description?.trim() || null,
        category: categories[0] || null,
        categories,
        event_date: eventDate.toISOString(),
        ends_at: endDateIso,
        location: eventLocation,
        lat: lat != null && lat !== '' ? parseFloat(lat) : null,
        lng: lng != null && lng !== '' ? parseFloat(lng) : null,
        organization: organization?.trim() || null,
        cover_image_url: coverImageUrl,
        url: url?.trim() || null,
        price: price != null && price !== '' ? parseFloat(price) : null,
        additional_info: additional_info?.trim() || null,
        max_attendees: maxAttendees,
        creator_id: userId,
        community_id: communityId,
        promotion_plan: resolvedPlan,
        notification_count: resolvedNotificationCount,
        audience_interested_only: resolvedInterestedOnly,
        audience_center_lat: resolvedCenterLat,
        audience_center_lng: resolvedCenterLng,
        audience_radius_km: resolvedRadiusKm,
      })
      .select()
      .single();

    if (error) throw error;

    const { error: attendeeError } = await supabase
      .from('community_event_attendees')
      .upsert(
        { event_id: event.id, user_id: userId },
        { onConflict: 'event_id,user_id', ignoreDuplicates: true }
      );

    if (attendeeError) {
      console.warn('[community] event creator auto-join error:', attendeeError);
    }

    // ── Push notifications (fire-and-forget) ─────────────────────────────────
    // Aviso inmediato SIEMPRE a los miembros de la comunidad, sea cual sea el
    // plan de promoción (basic/premium/ultra): son "su" comunidad, así que se
    // les avisa igualmente incluso si ya alcanzaron el tope diario de 1
    // notificación/evento (excepción explícita al tope). Esto no cuenta
    // contra el cupo contratado (notification_sent_count). Se registra en
    // event_promo_notifications (histórico por evento) y, desde la fase 70,
    // también en user_daily_notification_claims — la tabla que
    // server/jobs/eventPromoPacing.js usa como fuente de verdad atómica del
    // tope diario — para que estos usuarios queden marcados como "ya
    // notificados hoy" de cara a CUALQUIER OTRO evento (de otra comunidad o
    // de alcance general) y no reciban una segunda notificación no
    // relacionada con su comunidad el mismo día.
    //
    // El alcance adicional de premium/ultra (resolvedNotificationCount) YA NO
    // se dispara aquí de golpe: desde la fase 69 lo reparte gradualmente
    // server/jobs/eventPromoPacing.js (cron cada 5 min) hasta el inicio del
    // evento, respetando 1 notificación/usuario/día (across events) y
    // priorizando alcanzar las 200 notificaciones mínimas antes de repartir
    // el resto de forma uniforme entre eventos activos.
    (async () => {
      try {
        if (communityId) {
          const [{ data: comm }, { data: members }] = await Promise.all([
            supabase.from('communities').select('name').eq('id', communityId).single(),
            supabase.from('community_members').select('user_id').eq('community_id', communityId).neq('user_id', userId),
          ]);

          const communityMemberIds = members?.map(m => m.user_id) || [];
          const mutedNewEventsIds = await getMuteNewEventsFilteredIds(communityMemberIds);
          const pushMemberIds = communityMemberIds.filter(uid => !mutedNewEventsIds.has(uid));
          const communityLabel = comm?.name ? `en "${comm.name}"` : 'en tu comunidad';
          console.log(`[NOTIF-CAP] evento ${event.id} ("${event.title}") es de comunidad ${communityId}: ${communityMemberIds.length} miembros (${pushMemberIds.length} sin silenciar) a notificar SIEMPRE (excepción al tope diario).`);

          const notifiedUserIds = await notifyUsers(supabase, pushMemberIds, userId, {
            title: `📅 Nuevo evento ${communityLabel}`,
            body:  `${event.title}${event.location ? ` · ${event.location}` : ''}`,
            url:   `/community/event/${event.id}?src=community`,
            tag:   `community-event-${event.id}`,
          });

          console.log(`[NOTIF-CAP] evento ${event.id}: push de comunidad entregado a ${notifiedUserIds?.length || 0}/${communityMemberIds.length} miembros.`);

          if (notifiedUserIds?.length) {
            // Fase 111 — se etiqueta la fila con ad_source='community' (este
            // aviso NO consume cupo contratado, a diferencia de los envíos
            // del pacing, que van con ad_source='promo') y con si el miembro
            // era o no "interesado" en el momento del envío. Sin lo primero
            // el total de la tabla nunca cuadraría con notification_sent_count.
            const interestedIds = await getInterestedUserIdSet(event.categories);
            const { error: logError } = await supabase
              .from('event_promo_notifications')
              .upsert(
                notifiedUserIds.map(uid => ({
                  event_id: event.id,
                  user_id: uid,
                  ad_source: 'community',
                  matched_interest: interestedIds ? interestedIds.has(uid) : null,
                })),
                { onConflict: 'event_id,user_id', ignoreDuplicates: true }
              );
            if (logError) {
              console.warn('[community] error registrando aviso inmediato en log diario:', logError.message);
            }

            // Marca el hueco del día como usado en la misma tabla que lee
            // server/jobs/eventPromoPacing.js para el tope de 1/día. El
            // aviso de comunidad YA se envió (no depende de ganar esta
            // reserva, es la excepción al tope), así que un simple
            // "insertar e ignorar si ya existe" basta: da igual si dos
            // cosas intentan marcar el mismo (user_id, día) a la vez, la
            // UNIQUE de Postgres se encarga de que quede una sola fila.
            const { error: claimError, data: claimRows } = await supabase
              .from('user_daily_notification_claims')
              .upsert(
                notifiedUserIds.map(uid => ({ user_id: uid, claim_date: getNotificationDayKey(), event_id: event.id })),
                { onConflict: 'user_id,claim_date', ignoreDuplicates: true }
              )
              .select('user_id');
            if (claimError) {
              // Si esto falla sistemáticamente (p.ej. la tabla no existe
              // porque la migración de fase 70 no se llegó a ejecutar en
              // Supabase, o SUPABASE_SERVICE_KEY no es la service_role key
              // real y RLS está bloqueando el insert), el hueco diario de
              // estos usuarios NUNCA queda reservado y por tanto pueden
              // recibir además una notificación no relacionada el mismo
              // día vía server/jobs/eventPromoPacing.js — este log es la
              // señal a buscar en Railway si el tope no se respeta.
              console.error('[NOTIF-CAP] ⚠️ error reservando hueco diario tras aviso de comunidad (revisar migración fase70 / SUPABASE_SERVICE_KEY):', claimError.message);
            } else {
              console.log(`[NOTIF-CAP] evento ${event.id}: hueco diario reservado para ${claimRows?.length || 0} usuarios.`);
            }
          }
        }

        // Premium/Ultra: en vez de esperar hasta 5 min al siguiente tick del
        // cron (server/jobs/eventPromoPacing.js), disparamos un tick ahora
        // mismo para que el reparto empiece de inmediato. El cron sigue
        // corriendo cada 5 min para continuar repartiendo lo que falte hasta
        // el inicio del evento — esto solo adelanta el primer envío.
        if (resolvedPlan === 'premium' || resolvedPlan === 'ultra') {
          console.log(`[NOTIF-CAP] evento ${event.id} es ${resolvedPlan}, disparando tick de pacing inmediato...`);
          await runEventPromoPacingTick();
        }
      } catch (err) {
        console.warn('[community] event push notification error:', err.message);
      }
    })();

    res.status(201).json({ event });
  } catch (err) {
    console.error('[community] POST /events error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al crear el evento') });
  }
});

// POST /api/community/events/:id/renew-promotion
// Permite al CREADOR del evento renovar su promoción (mismos planes y misma
// validación que al crear el evento: basic/premium/ultra, con
// notification_count entre 500 y 50.000 para premium/ultra). Al renovar:
//
//   1. Se actualiza promotion_plan / notification_count del evento y se
//      resetea notification_sent_count a 0 (nuevo ciclo de facturación:
//      "la promoción se cobrará al empezar el evento automáticamente o al
//      renovar la promoción").
//   2. Se BORRA el historial de event_promo_notifications de este evento,
//      para que los usuarios que ya habían sido notificados en el ciclo
//      anterior vuelvan a ser candidatos ("en cada promoción cada usuario
//      se notifica una vez; para que vuelva a serlo, hay que renovar").
//      Esto no salta el tope diario global (user_daily_notification_claims,
//      1 notificación/usuario/día entre TODOS los eventos): si a alguien ya
//      se le notificó HOY de cualquier evento, no recibirá otra hasta
//      mañana aunque se acabe de renovar esta promoción.
//   3. Se dispara, igual que al crear el evento, el aviso inmediato a los
//      miembros de la comunidad (si tiene) y un tick de pacing inmediato
//      si el plan resultante es premium/ultra.
//
// Nota: esta ruta se mantiene deliberadamente independiente del bloque de
// notificación de POST /events (no se refactoriza a un helper compartido)
// para no tocar ese flujo ya estabilizado.
router.post('/events/:id/renew-promotion', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { promotion_plan, notification_count } = req.body;

  const NOTIF_MIN = 500;
  const NOTIF_MAX = 50000;
  const resolvedPlan = ['basic', 'premium', 'ultra'].includes(promotion_plan) ? promotion_plan : null;
  if (!resolvedPlan) return res.status(400).json({ error: 'Elige un plan de promoción válido' });

  let resolvedNotificationCount = null;
  if (resolvedPlan === 'premium' || resolvedPlan === 'ultra') {
    const parsedCount = Number.parseInt(notification_count, 10);
    if (!Number.isFinite(parsedCount) || parsedCount < NOTIF_MIN || parsedCount > NOTIF_MAX) {
      return res.status(400).json({
        error: `Elige cuántas notificaciones quieres contratar (entre ${NOTIF_MIN} y ${NOTIF_MAX})`,
      });
    }
    resolvedNotificationCount = parsedCount;
  }

  try {
    const { data: event, error: eventError } = await supabase
      .from('community_events')
      // categories: necesario para clasificar el aviso de comunidad por
      // intereses al re-notificar (fase 111, ver más abajo).
      .select('id, title, location, creator_id, community_id, event_date, ends_at, promotion_plan, notification_sent_count, categories')
      .eq('id', id)
      .single();

    if (eventError || !event) return res.status(404).json({ error: 'Evento no encontrado' });
    if (event.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el creador del evento puede renovar su promoción' });
    }
    if (new Date(event.ends_at || event.event_date) < new Date()) {
      return res.status(400).json({ error: 'No se puede renovar la promoción de un evento ya finalizado' });
    }

    // No se permite renovar (y por tanto resetear notification_sent_count a
    // 0 y borrar el historial de notificados) una promoción premium/ultra
    // que todavía no ha alcanzado el mínimo de FREE_THRESHOLD notificaciones
    // enviadas: si se permitiera, se podría encadenar renovaciones antes de
    // llegar al umbral de cobro y conseguir notificaciones ilimitadas gratis.
    const sentCount = event.notification_sent_count || 0;
    if ((event.promotion_plan === 'premium' || event.promotion_plan === 'ultra') && sentCount < FREE_THRESHOLD) {
      return res.status(400).json({
        error: `Aún no puedes renovar: hace falta alcanzar el mínimo de ${FREE_THRESHOLD} notificaciones enviadas para que se pueda cobrar (llevas ${sentCount}/${FREE_THRESHOLD}).`,
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from('community_events')
      .update({
        promotion_plan: resolvedPlan,
        notification_count: resolvedNotificationCount,
        notification_sent_count: 0,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    const { error: clearError } = await supabase
      .from('event_promo_notifications')
      .delete()
      .eq('event_id', id);
    if (clearError) {
      console.warn('[community] error limpiando historial de notificados al renovar:', clearError.message);
    }

    // ── Push notifications (fire-and-forget) — mismo patrón que POST /events ──
    (async () => {
      try {
        if (event.community_id) {
          const [{ data: comm }, { data: members }] = await Promise.all([
            supabase.from('communities').select('name').eq('id', event.community_id).single(),
            supabase.from('community_members').select('user_id').eq('community_id', event.community_id).neq('user_id', userId),
          ]);

          const communityMemberIds = members?.map(m => m.user_id) || [];
          const mutedNewEventsIds = await getMuteNewEventsFilteredIds(communityMemberIds);
          const pushMemberIds = communityMemberIds.filter(uid => !mutedNewEventsIds.has(uid));
          const communityLabel = comm?.name ? `en "${comm.name}"` : 'en tu comunidad';
          console.log(`[NOTIF-CAP] renovación evento ${event.id} ("${event.title}") es de comunidad ${event.community_id}: ${communityMemberIds.length} miembros (${pushMemberIds.length} sin silenciar) a re-notificar SIEMPRE (excepción al tope diario).`);

          const notifiedUserIds = await notifyUsers(supabase, pushMemberIds, userId, {
            title: `📅 Evento renovado ${communityLabel}`,
            body:  `${event.title}${event.location ? ` · ${event.location}` : ''}`,
            url:   `/community/event/${event.id}?src=community`,
            tag:   `community-event-${event.id}`,
          });

          console.log(`[NOTIF-CAP] renovación evento ${event.id}: push de comunidad entregado a ${notifiedUserIds?.length || 0}/${communityMemberIds.length} miembros.`);

          if (notifiedUserIds?.length) {
            // Fase 111 — mismo etiquetado que en POST /events. Aquí el
            // historial de event_promo_notifications se acaba de borrar
            // (nuevo ciclo de promoción), así que estas filas arrancan
            // limpias: los clicks del ciclo anterior no se arrastran al
            // nuevo, que es justo lo que se quiere para comparar campañas.
            const interestedIds = await getInterestedUserIdSet(event.categories);
            const { error: logError } = await supabase
              .from('event_promo_notifications')
              .upsert(
                notifiedUserIds.map(uid => ({
                  event_id: event.id,
                  user_id: uid,
                  ad_source: 'community',
                  matched_interest: interestedIds ? interestedIds.has(uid) : null,
                })),
                { onConflict: 'event_id,user_id', ignoreDuplicates: true }
              );
            if (logError) {
              console.warn('[community] error registrando aviso inmediato (renovación) en log diario:', logError.message);
            }

            const { error: claimError, data: claimRows } = await supabase
              .from('user_daily_notification_claims')
              .upsert(
                notifiedUserIds.map(uid => ({ user_id: uid, claim_date: getNotificationDayKey(), event_id: event.id })),
                { onConflict: 'user_id,claim_date', ignoreDuplicates: true }
              )
              .select('user_id');
            if (claimError) {
              console.error('[NOTIF-CAP] ⚠️ error reservando hueco diario tras aviso de comunidad (renovación):', claimError.message);
            } else {
              console.log(`[NOTIF-CAP] renovación evento ${event.id}: hueco diario reservado para ${claimRows?.length || 0} usuarios.`);
            }
          }
        }

        if (resolvedPlan === 'premium' || resolvedPlan === 'ultra') {
          console.log(`[NOTIF-CAP] renovación evento ${event.id} es ${resolvedPlan}, disparando tick de pacing inmediato...`);
          await runEventPromoPacingTick();
        }
      } catch (err) {
        console.warn('[community] renew-promotion push notification error:', err.message);
      }
    })();

    res.json({ event: updated });
  } catch (err) {
    console.error('[community] POST /events/:id/renew-promotion error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al renovar la promoción') });
  }
});

// POST /api/community/events/:id/end-promotion
// Permite al CREADOR del evento finalizar su promoción premium/ultra antes
// de tiempo: el evento pasa a listado Basic (gratis) y deja de recibir
// nuevos envíos del job de pacing (que solo selecciona eventos con
// promotion_plan IN ('premium','ultra')).
//
// A diferencia de renovar, aquí NO se resetea notification_sent_count ni se
// borra el historial de event_promo_notifications: la lógica de cobro sigue
// siendo la misma que ya existía ("el pago se efectuará al empezar el
// evento, en base a las notificaciones enviadas hasta su comienzo") — al
// finalizar simplemente se congela ese contador antes de tiempo, igual que
// ocurre de forma natural cuando arranca el evento.
//
// Igual que al renovar, no se permite finalizar una promoción premium/ultra
// que todavía no ha alcanzado el mínimo de FREE_THRESHOLD notificaciones
// enviadas, para evitar contratar una promoción y cancelarla al instante sin
// que llegue nunca a poder cobrarse.
router.post('/events/:id/end-promotion', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { data: event, error: eventError } = await supabase
      .from('community_events')
      .select('id, title, creator_id, event_date, ends_at, promotion_plan, notification_sent_count')
      .eq('id', id)
      .single();

    if (eventError || !event) return res.status(404).json({ error: 'Evento no encontrado' });
    if (event.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el creador del evento puede finalizar su promoción' });
    }
    if (new Date(event.ends_at || event.event_date) < new Date()) {
      return res.status(400).json({ error: 'No se puede finalizar la promoción de un evento ya finalizado' });
    }
    if (event.promotion_plan !== 'premium' && event.promotion_plan !== 'ultra') {
      return res.status(400).json({ error: 'Este evento no tiene una promoción activa que finalizar' });
    }

    const sentCount = event.notification_sent_count || 0;
    if (sentCount < FREE_THRESHOLD) {
      return res.status(400).json({
        error: `Aún no puedes finalizar: hace falta alcanzar el mínimo de ${FREE_THRESHOLD} notificaciones enviadas para que se pueda cobrar (llevas ${sentCount}/${FREE_THRESHOLD}).`,
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from('community_events')
      .update({
        promotion_plan: 'basic',
        notification_count: null,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ event: updated });
  } catch (err) {
    console.error('[community] POST /events/:id/end-promotion error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al finalizar la promoción') });
  }
});


// POST /api/community/events/:id/join
router.post('/events/:id/join', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { data: event, error: evErr } = await supabase
      .from('community_events')
      .select('id, max_attendees, event_date, ends_at')
      .eq('id', id)
      .single();

    if (evErr || !event) return res.status(404).json({ error: 'Evento no encontrado' });
    if (new Date(event.ends_at || event.event_date) < new Date()) {
      return res.status(400).json({ error: 'El evento ya ha pasado' });
    }

    const { data: existing } = await supabase
      .from('community_event_attendees')
      .select('user_id')
      .eq('event_id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) return res.status(400).json({ error: 'Ya estas apuntado a este evento' });

    const { count } = await supabase
      .from('community_event_attendees')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', id);

    if (event.max_attendees && count >= event.max_attendees) {
      return res.status(400).json({ error: 'El evento esta lleno' });
    }

    const { error: joinError } = await supabase
      .from('community_event_attendees')
      .insert({ event_id: id, user_id: userId });

    if (joinError) throw joinError;
    res.json({ ok: true });
  } catch (err) {
    console.error('[community] POST /events/:id/join error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al apuntarse al evento') });
  }
});

// POST /api/community/events/:id/leave
router.post('/events/:id/leave', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { error } = await supabase
      .from('community_event_attendees')
      .delete()
      .eq('event_id', id)
      .eq('user_id', userId);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[community] POST /events/:id/leave error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al salir del evento') });
  }
});

router.patch('/events/:id/reminder', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const reminderMinutes = parseReminderMinutes(req.body?.reminder_minutes_before);

  if (reminderMinutes == null) {
    return res.status(400).json({ error: 'El aviso debe estar entre 10 minutos y 1 semana' });
  }

  try {
    const { data: event, error: eventError } = await supabase
      .from('community_events')
      .select('id, event_date, ends_at')
      .eq('id', id)
      .single();

    if (eventError || !event) return res.status(404).json({ error: 'Evento no encontrado' });
    if (new Date(event.ends_at || event.event_date) < new Date()) {
      return res.status(400).json({ error: 'El evento ya ha pasado' });
    }

    const { data: attendee } = await supabase
      .from('community_event_attendees')
      .select('event_id')
      .eq('event_id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!attendee) return res.status(403).json({ error: 'Tienes que estar apuntado para ajustar el aviso' });

    const { data: updated, error } = await supabase
      .from('community_event_attendees')
      .update({ reminder_minutes_before: reminderMinutes })
      .eq('event_id', id)
      .eq('user_id', userId)
      .select('reminder_minutes_before')
      .single();

    if (error) throw error;
    res.json({ reminder_minutes_before: updated.reminder_minutes_before });
  } catch (err) {
    console.error('[community] PATCH /events/:id/reminder error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al cambiar el aviso') });
  }
});

// POST /api/community/events/:id/like
router.post('/events/:id/like', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    await ensurePublicProfile(req.user);

    const { data: event, error: eventError } = await supabase
      .from('community_events')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (eventError) throw eventError;
    if (!event) return res.status(404).json({ error: 'Evento no encontrado' });

    const { data: existing, error: existingError } = await supabase
      .from('community_event_likes')
      .select('event_id')
      .eq('event_id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
      const { error } = await supabase
        .from('community_event_likes')
        .delete()
        .eq('event_id', id)
        .eq('user_id', userId);

      if (error) throw error;
      return res.json({ liked: false });
    }

    const { error } = await supabase
      .from('community_event_likes')
      .insert({ event_id: id, user_id: userId });

    if (error) throw error;
    res.json({ liked: true });
  } catch (err) {
    console.error('[community] POST /events/:id/like error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al cambiar el like') });
  }
});

// GET /api/community/communities
router.get('/communities', requireAuth, async (req, res) => {
  const db = getUserSupabase(req);
  const userId = req.user.id;

  try {
    const { data: communities, error } = await db
      .from('communities')
      .select(`
        id, name, description, category, categories, organization, creator_id, created_at, cover_image_url,
        creator:users!communities_creator_id_fkey(username)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const communityIds = (communities || []).map(c => c.id);

    // Single query for all members across all communities — eliminates N+1
    let allMembers = [];
    if (communityIds.length > 0) {
      const { data: membersData, error: mErr } = await db
        .from('community_members')
        .select('community_id, user_id, role')
        .in('community_id', communityIds);
      if (mErr) throw mErr;
      allMembers = membersData || [];
    }

    // Sorteo activo: aún no sorteado (drawn_at IS NULL) y no ha llegado su
    // fecha de cierre. Evento próximo: al menos un evento de la comunidad
    // que todavía no ha terminado (mismo criterio que isUpcomingEvent en
    // el frontend: ends_at si existe, si no event_date).
    const nowIso = new Date().toISOString();
    const communitiesWithActiveRaffle = new Set();
    const communitiesWithUpcomingEvent = new Set();
    if (communityIds.length > 0) {
      // community_raffles solo es legible por RLS para miembros de esa
      // comunidad (ver phase79); aquí necesitamos el flag para TODAS las
      // comunidades listadas, incluidas las que el usuario aún no se ha
      // unido, así que se usa el cliente de servicio (bypassa RLS), igual
      // que el resto de rutas de sorteos.
      const { data: activeRaffles, error: rErr } = await supabase
        .from('community_raffles')
        .select('community_id')
        .in('community_id', communityIds)
        .is('drawn_at', null)
        .gt('ends_at', nowIso);
      if (rErr) throw rErr;
      (activeRaffles || []).forEach(r => communitiesWithActiveRaffle.add(r.community_id));

      // community_events es pública (cualquiera puede ver eventos de
      // cualquier comunidad, sea o no miembro), pero se usa igualmente el
      // cliente de servicio aquí para no depender de la política RLS y
      // mantener el mismo criterio que la consulta de sorteos de arriba.
      const { data: upcomingEvents, error: eErr } = await supabase
        .from('community_events')
        .select('community_id, event_date, ends_at')
        .in('community_id', communityIds);
      if (eErr) throw eErr;
      const now = Date.now();
      (upcomingEvents || []).forEach(ev => {
        const endTime = ev.ends_at ? new Date(ev.ends_at).getTime() : new Date(ev.event_date).getTime();
        if (!Number.isNaN(endTime) && endTime >= now) communitiesWithUpcomingEvent.add(ev.community_id);
      });
    }

    // Group members by community_id in JS
    const membersByCommunity = allMembers.reduce((acc, m) => {
      if (!acc[m.community_id]) acc[m.community_id] = [];
      acc[m.community_id].push(m);
      return acc;
    }, {});

    const enriched = (communities || []).map((comm) => {
      const members = membersByCommunity[comm.id] || [];
      const currentMembership = members.find(m => m.user_id === userId);

      return {
        ...comm,
        creator_name: comm.creator?.username || 'Alguien',
        member_count: members.length,
        member_ids: members.map(m => m.user_id),
        admin_ids: members.filter(m => m.role === 'admin').map(m => m.user_id),
        current_user_role: comm.creator_id === userId ? 'admin' : currentMembership?.role || null,
        is_admin: comm.creator_id === userId || currentMembership?.role === 'admin',
        has_active_raffle: communitiesWithActiveRaffle.has(comm.id),
        has_upcoming_event: communitiesWithUpcomingEvent.has(comm.id),
      };
    });

    res.json({ communities: enriched });
  } catch (err) {
    console.error('[community] GET /communities error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al obtener las comunidades') });
  }
});

// GET /api/community/communities/:id
router.get('/communities/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const db = getUserSupabase(req);

  try {
    const { data: community, error } = await db
      .from('communities')
      .select(`
        id, name, description, category, categories, organization, url, creator_id, created_at, collab_amount_cents, cover_image_url,
        creator:users!communities_creator_id_fkey(username)
      `)
      .eq('id', id)
      .single();

    if (error || !community) return res.status(404).json({ error: 'Comunidad no encontrada' });

    const { data: members, count } = await db
      .from('community_members')
      .select('user_id, role, joined_at')
      .eq('community_id', id);
    const currentMembership = (members || []).find(m => m.user_id === userId);

    let hasCollaborated = false;
    if (community.collab_amount_cents) {
      const { data: existingCollab } = await db
        .from('community_collaborations')
        .select('id')
        .eq('community_id', id)
        .eq('user_id', userId)
        .limit(1);
      hasCollaborated = Boolean(existingCollab?.length);
    }

    const { data: events, error: eventsError } = await db
      .from('community_events')
      .select(`
        id, title, description, category, categories, event_date, ends_at, location, lat, lng, organization, cover_image_url,
        max_attendees, creator_id, community_id, created_at,
        creator:users!community_events_creator_id_fkey(username),
        community:communities!community_events_community_id_fkey(id, name, organization)
      `)
      .eq('community_id', id)
      .order('event_date', { ascending: true });

    if (eventsError) throw eventsError;

    const enrichedEvents = await enrichEvents(db, events || [], userId);
    const splitEvents = splitEventsByDate(enrichedEvents);

    res.json({
      community: {
        ...community,
        creator_name: community.creator?.username || 'Alguien',
        member_count: count || 0,
        member_ids: (members || []).map(m => m.user_id),
        admin_ids: (members || []).filter(m => m.role === 'admin').map(m => m.user_id),
        current_user_role: community.creator_id === userId ? 'admin' : currentMembership?.role || null,
        is_member: Boolean(currentMembership),
        is_admin: community.creator_id === userId || currentMembership?.role === 'admin',
        has_collaborated: hasCollaborated,
      },
      ...splitEvents,
    });
  } catch (err) {
    console.error('[community] GET /communities/:id error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al obtener la comunidad') });
  }
});

// POST /api/community/communities
router.post('/communities', requireAuth, uploadCommunityCover, async (req, res) => {
  const { name, description, category, organization, url } = req.body;
  const userId = req.user.id;

  const categories = parseCategories(req.body.categories ?? category);
  if (categories.length > MAX_CATEGORIES) {
    return res.status(400).json({ error: `Puedes elegir hasta ${MAX_CATEGORIES} categorías` });
  }
  if (!categories.length) {
    return res.status(400).json({ error: 'Elige al menos una categoría para la comunidad' });
  }

  if (!name?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

  // Importe de colaboración (opcional): el admin lo fija al crear la
  // comunidad. Debe ser >= 0.99 € si se especifica. SocialBattery no
  // se queda ningún porcentaje de este importe.
  let collabAmountCents = null;
  if (req.body.collab_amount_cents !== undefined && req.body.collab_amount_cents !== '') {
    const parsed = Number(req.body.collab_amount_cents);
    if (!Number.isFinite(parsed) || parsed < 99) {
      return res.status(400).json({ error: 'El importe de colaboración debe ser de al menos 0,99 €' });
    }
    collabAmountCents = Math.round(parsed);
  }

  try {
    await ensurePublicProfile(req.user);

    let coverImageUrl = null;
    if (req.file) {
      coverImageUrl = await storeImage({
        file: req.file,
        objectName: `community-covers/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fallbackMaxLength: 4500000,
      });
    }

    const { data: community, error } = await supabase
      .from('communities')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        category: categories[0] || null,
        categories,
        organization: organization?.trim() || null,
        url: url?.trim() || null,
        cover_image_url: coverImageUrl,
        creator_id: userId,
        collab_amount_cents: collabAmountCents,
      })
      .select()
      .single();

    if (error) throw error;

    const { error: memberError } = await supabase
      .from('community_members')
      .upsert(
        { community_id: community.id, user_id: userId, role: 'admin' },
        { onConflict: 'community_id,user_id', ignoreDuplicates: true }
      );

    if (memberError) {
      console.warn('[community] community creator auto-join error:', memberError);
    }

    res.status(201).json({ community });
  } catch (err) {
    console.error('[community] POST /communities error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al crear la comunidad') });
  }
});

// PATCH /api/community/communities/:id
// Permite al creador de la comunidad reconfigurar sus atributos (nombre,
// descripción, categorías, organización, url, foto, colaboraciones) después
// de haberla creado. Solo el creador puede editar (no basta con ser admin).
router.patch('/communities/:id', requireAuth, uploadCommunityCover, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { name, description, category, organization, url } = req.body;

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('communities')
      .select('id, creator_id, cover_image_url')
      .eq('id', id)
      .single();

    if (fetchError || !existing) return res.status(404).json({ error: 'Comunidad no encontrada' });
    if (existing.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el creador de la comunidad puede editarla' });
    }

    const updates = {};

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
      updates.name = name.trim();
    }

    if (description !== undefined) updates.description = description?.trim() || null;
    if (organization !== undefined) updates.organization = organization?.trim() || null;
    if (url !== undefined) updates.url = url?.trim() || null;

    if (req.body.categories !== undefined || category !== undefined) {
      const categories = parseCategories(req.body.categories ?? category);
      if (categories.length > MAX_CATEGORIES) {
        return res.status(400).json({ error: `Puedes elegir hasta ${MAX_CATEGORIES} categorías` });
      }
      updates.categories = categories;
      updates.category = categories[0] || null;
    }

    // Colaboraciones económicas: se puede activar, cambiar el importe, o
    // desactivar mandando remove_collab=true (no se admite bajar de 0.99€).
    if (req.body.remove_collab === 'true') {
      updates.collab_amount_cents = null;
    } else if (req.body.collab_amount_cents !== undefined && req.body.collab_amount_cents !== '') {
      const parsed = Number(req.body.collab_amount_cents);
      if (!Number.isFinite(parsed) || parsed < 99) {
        return res.status(400).json({ error: 'El importe de colaboración debe ser de al menos 0,99 €' });
      }
      updates.collab_amount_cents = Math.round(parsed);
    }

    if (req.file) {
      updates.cover_image_url = await storeImage({
        file: req.file,
        objectName: `community-covers/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fallbackMaxLength: 4500000,
      });
    } else if (req.body.remove_cover === 'true') {
      updates.cover_image_url = null;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No hay cambios que guardar' });
    }

    const { data: community, error } = await supabase
      .from('communities')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ community });
  } catch (err) {
    console.error('[community] PATCH /communities/:id error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al actualizar la comunidad') });
  }
});

// ── GET /api/community/communities/:id/raffle-audience — tamaño de audiencia
//    para la configuración de publicidad de un sorteo Light ────────────────
// El "pool" de un sorteo Light es el mismo que assignRaffleBannerTargets usa
// al crearlo (getRaffleLightAudienceIds): todos los usuarios de la app
// EXCEPTO el propio creador Y EXCEPTO los miembros de la comunidad que
// organiza el sorteo (no tiene sentido pagar publicidad a quien ya la
// conoce — misma razón por la que Light excluye miembros del pool, ver
// getRaffleLightAudienceIds). Con ?filter=interested se añade además cuántos
// de esos usuarios notificables tienen entre sus intereses alguna de las
// CATEGORÍAS EFECTIVAS DEL SORTEO: las del propio sorteo (fase 116) si el
// cliente las manda por ?categories=<JSON array> — el sorteo aún no existe
// en el flujo de creación, así que el borrador viaja por query — o las de
// la comunidad como fallback si el sorteo no tiene o el cliente no las
// manda. Mismo esquema que ya usan los eventos con sus propias categorías.
router.get('/communities/:id/raffle-audience', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const wantInterested = req.query.filter === 'interested';

  // Parseo tolerante: si el cliente manda ?categories=[…] mal formado, en
  // vez de romper la carga de la pantalla se ignora y se cae al fallback
  // de comunidad — el peor caso es enseñar el número "clásico".
  let raffleCategories = null;
  if (req.query.categories) {
    try {
      const parsed = JSON.parse(req.query.categories);
      if (Array.isArray(parsed)) raffleCategories = parsed.filter(Boolean);
    } catch (_) {
      raffleCategories = null;
    }
  }

  try {
    const { data: community, error: communityErr } = await supabase
      .from('communities')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (communityErr) throw communityErr;
    if (!community) return res.status(404).json({ error: 'Comunidad no encontrada' });

    const { ids: totalIds } = await getRaffleLightAudienceIds(id, userId);

    let interested = null;
    let categoriesDefined = null;
    if (wantInterested) {
      const { ids: interestedIds, categoriesDefined: hasCategories } = await getRaffleLightAudienceIds(id, userId, { interestedOnly: true, raffleCategories });
      categoriesDefined = hasCategories;
      interested = hasCategories ? interestedIds.length : null;
    }

    res.json({ total: totalIds.length, interested, categories_defined: categoriesDefined });
  } catch (err) {
    console.error('[community] GET /communities/:id/raffle-audience error:', err);
    res.status(500).json({ error: err.message || 'Error al calcular la audiencia' });
  }
});

// POST /api/community/communities/:id/join
router.post('/communities/:id/join', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { data: community } = await supabase
      .from('communities')
      .select('id')
      .eq('id', id)
      .single();

    if (!community) return res.status(404).json({ error: 'Comunidad no encontrada' });

    const { data: existing } = await supabase
      .from('community_members')
      .select('user_id')
      .eq('community_id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) return res.status(400).json({ error: 'Ya eres miembro de esta comunidad' });

    const { error: joinError } = await supabase
      .from('community_members')
      .insert({ community_id: id, user_id: userId, role: 'member' });

    if (joinError) throw joinError;
    res.json({ ok: true });
  } catch (err) {
    console.error('[community] POST /communities/:id/join error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al unirse a la comunidad') });
  }
});

// POST /api/community/communities/:id/leave
router.post('/communities/:id/leave', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { data: membership, error: memberErr } = await supabase
      .from('community_members')
      .select('role')
      .eq('community_id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (memberErr) throw memberErr;
    if (!membership) return res.status(400).json({ error: 'No eres miembro de esta comunidad' });

    const { data: community, error: commErr } = await supabase
      .from('communities')
      .select('creator_id')
      .eq('id', id)
      .single();

    if (commErr || !community) return res.status(404).json({ error: 'Comunidad no encontrada' });

    if (membership.role === 'admin' || community.creator_id === userId) {
      const { count: adminCount } = await supabase
        .from('community_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('community_id', id)
        .eq('role', 'admin');

      if ((adminCount || 0) <= 1) {
        return res.status(400).json({ error: 'El ultimo administrador no puede salir de la comunidad' });
      }
    }

    const { error } = await supabase
      .from('community_members')
      .delete()
      .eq('community_id', id)
      .eq('user_id', userId);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[community] POST /communities/:id/leave error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al salir de la comunidad') });
  }
});

// POST /api/community/communities/:id/collaborate
// Registra la colaboración económica de un miembro no-admin con el
// importe fijado por el admin. NOTA: de momento no hay cobro real
// (no hay pasarela de pago conectada); solo queda constancia de quién
// colabora y con qué importe, para poder enchufar el cobro real más
// adelante sin cambiar el modelo de datos.
router.post('/communities/:id/collaborate', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { data: community, error: commErr } = await supabase
      .from('communities')
      .select('id, creator_id, collab_amount_cents')
      .eq('id', id)
      .single();

    if (commErr || !community) return res.status(404).json({ error: 'Comunidad no encontrada' });
    if (!community.collab_amount_cents) {
      return res.status(400).json({ error: 'Esta comunidad no tiene colaboraciones habilitadas' });
    }

    const { data: membership } = await supabase
      .from('community_members')
      .select('role')
      .eq('community_id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Debes pertenecer a la comunidad para colaborar' });

    const isAdmin = community.creator_id === userId || membership.role === 'admin';
    if (isAdmin) return res.status(400).json({ error: 'El administrador no puede colaborar en su propia comunidad' });

    const { data: collaboration, error } = await supabase
      .from('community_collaborations')
      .insert({
        community_id: id,
        user_id: userId,
        amount_cents: community.collab_amount_cents,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ collaboration });
  } catch (err) {
    console.error('[community] POST /communities/:id/collaborate error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al registrar la colaboración') });
  }
});

// GET /api/community/communities/:id/collaborations
// Solo el admin/creador puede ver el listado de quién ha colaborado.
router.get('/communities/:id/collaborations', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { data: community, error: commErr } = await supabase
      .from('communities')
      .select('id, creator_id')
      .eq('id', id)
      .single();

    if (commErr || !community) return res.status(404).json({ error: 'Comunidad no encontrada' });

    const { data: membership } = await supabase
      .from('community_members')
      .select('role')
      .eq('community_id', id)
      .eq('user_id', userId)
      .maybeSingle();

    const isAdmin = community.creator_id === userId || membership?.role === 'admin';
    if (!isAdmin) return res.status(403).json({ error: 'Solo el administrador puede ver las colaboraciones' });

    const { data: collaborations, error } = await supabase
      .from('community_collaborations')
      .select('id, amount_cents, created_at, user:users!community_collaborations_user_id_fkey(id, username)')
      .eq('community_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const totalCents = (collaborations || []).reduce((sum, c) => sum + (c.amount_cents || 0), 0);

    res.json({
      collaborations: collaborations || [],
      total_cents: totalCents,
      count: (collaborations || []).length,
    });
  } catch (err) {
    console.error('[community] GET /communities/:id/collaborations error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al obtener las colaboraciones') });
  }
});

// GET /api/community/events/:id
router.get('/events/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const db = getUserSupabase(req);

  try {
    const { data: event, error } = await db
      .from('community_events')
      .select(`
        id, title, description, category, categories, event_date, ends_at, location, lat, lng, organization,
        cover_image_url, url, price, additional_info, max_attendees, creator_id, community_id, created_at,
        promotion_plan, notification_count, notification_sent_count,
        creator:users!community_events_creator_id_fkey(username),
        community:communities!community_events_community_id_fkey(id, name, organization)
      `)
      .eq('id', id)
      .single();

    if (error || !event) return res.status(404).json({ error: 'Evento no encontrado' });

    const [enriched] = await enrichEvents(db, [event], req.user.id);
    res.json({ event: enriched });
  } catch (err) {
    console.error('[community] GET /events/:id error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al obtener el evento') });
  }
});

// GET /api/community/notifications/today-event
// Devuelve el evento que le "ganó" al usuario el hueco diario de
// notificación (user_daily_notification_claims, PK user_id+claim_date):
// como esa tabla solo permite una fila por usuario y día (el resto de
// intentos de otros eventos se ignoran por conflicto de PK), esto es
// exactamente "el primer evento que le notificó hoy" — da igual que
// luego le llegue un aviso de otro evento (p.ej. de una comunidad suya),
// el panel del front no debe cambiar en todo el día.
//
// Fase 109: SOLO se devuelve si el evento es Ultra. Es una prestación
// exclusiva del plan Ultra (ver EventAdConfigPage: "Apariciones en banner
// menú principal a número de usuarios contratado"). Premium también
// consume el hueco diario del usuario, pero NO genera este panel — el
// front recibe {event: null} en ese caso y no muestra nada.
router.get('/notifications/today-event', requireAuth, async (req, res) => {
  try {
    const { data: claim, error: claimError } = await supabase
      .from('user_daily_notification_claims')
      .select('event_id')
      .eq('user_id', req.user.id)
      .eq('claim_date', getNotificationDayKey())
      .maybeSingle();

    if (claimError) throw claimError;
    if (!claim?.event_id) return res.json({ event: null });

    const { data: event, error: eventError } = await supabase
      .from('community_events')
      .select('id, title, organization, cover_image_url, promotion_plan, community:communities!community_events_community_id_fkey(organization)')
      .eq('id', claim.event_id)
      .maybeSingle();

    if (eventError || !event) return res.json({ event: null });
    // Fase 109: banner del menú principal exclusivo de Ultra.
    if (event.promotion_plan !== 'ultra') return res.json({ event: null });

    res.json({
      event: {
        id: event.id,
        title: event.title,
        organization: event.organization || event.community?.organization || null,
        cover_image_url: event.cover_image_url || null,
      },
    });
  } catch (err) {
    console.error('[community] GET /notifications/today-event error:', err);
    res.status(500).json({ error: 'Error al comprobar el evento notificado hoy' });
  }
});

// Construye el resumen de una encuesta (recuentos por opción + voto propio)
// a partir de las opciones y las filas de event_poll_votes de esa encuesta.
function buildPollSummary(pollOptions, voteRows, userId) {
  const options = Array.isArray(pollOptions) ? pollOptions : [];
  const votes = options.map(() => 0);
  let myVote = null;
  for (const v of voteRows) {
    if (v.option_index >= 0 && v.option_index < votes.length) votes[v.option_index] += 1;
    if (v.user_id === userId) myVote = v.option_index;
  }
  const totalVotes = votes.reduce((a, b) => a + b, 0);
  return { options, votes, totalVotes, myVote };
}

// GET /api/community/events/:id/updates
router.get('/events/:id/updates', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { data: updates, error } = await supabase
      .from('event_updates')
      .select(`
        id, content, image_url, poll_question, poll_options, created_at, creator_id,
        creator:users!event_updates_creator_id_fkey(username, avatar_url)
      `)
      .eq('event_id', id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Adjunta el recuento de votos a las filas que son encuestas
    const pollUpdates = (updates || []).filter(u => u.poll_question);
    if (pollUpdates.length) {
      const pollIds = pollUpdates.map(u => u.id);
      const { data: voteRows } = await supabase
        .from('event_poll_votes')
        .select('update_id, user_id, option_index')
        .in('update_id', pollIds);

      const votesByUpdate = new Map();
      for (const v of voteRows || []) {
        if (!votesByUpdate.has(v.update_id)) votesByUpdate.set(v.update_id, []);
        votesByUpdate.get(v.update_id).push(v);
      }
      for (const u of pollUpdates) {
        u.poll = buildPollSummary(u.poll_options, votesByUpdate.get(u.id) || [], userId);
      }
    }

    res.json({ updates: updates || [] });
  } catch (err) {
    console.error('[community] GET /events/:id/updates error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al obtener actualizaciones') });
  }
});

// ── Broadcast de actualizaciones de evento a los asistentes ─────────────────
// Antes esto solo se detectaba en el cliente con un listener de
// postgres_changes sobre event_updates — el mismo patrón que ya dio
// problemas de fiabilidad con RLS en los chats de grupo/quedada/comunidad
// (ver comentario en useMessageNotifications.js) y que se sustituyó por un
// broadcast explícito con la service key. Aplicamos aquí el mismo arreglo:
// el servidor manda el aviso in-app instantáneo a cada asistente por su
// canal personal, sin depender de que Realtime respete la RLS de la tabla.
async function broadcastEventUpdateToAttendees({ eventId, eventTitle, creatorId, body, kind }) {
  try {
    const { data: attendees } = await supabase
      .from('community_event_attendees')
      .select('user_id')
      .eq('event_id', eventId)
      .neq('user_id', creatorId);

    const attendeeIds = (attendees || []).map(a => a.user_id);
    if (!attendeeIds.length) return attendeeIds;

    const broadcastPayload = {
      event_id:    eventId,
      event_title: eventTitle,
      creator_id:  creatorId,
      body,
      kind, // 'update' | 'poll' — decide el emoji del título en el cliente
    };

    await Promise.allSettled(
      attendeeIds.map(uid =>
        supabase
          .channel(`event-update-notif-${uid}`)
          .send({ type: 'broadcast', event: 'new_event_update', payload: broadcastPayload })
      )
    );

    return attendeeIds;
  } catch (err) {
    console.error('[community] broadcastEventUpdateToAttendees error:', err);
    return [];
  }
}

// POST /api/community/events/:id/updates
router.post('/events/:id/updates', requireAuth, uploadEventUpdateImage, async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  const userId = req.user.id;

  const hasContent = content?.trim();
  const hasImage = !!req.file;

  if (!hasContent && !hasImage) {
    return res.status(400).json({ error: 'Escribe un mensaje o adjunta una imagen' });
  }
  if (hasContent && hasContent.length > 2000) {
    return res.status(400).json({ error: 'Máximo 2000 caracteres' });
  }

  try {
    // Only the event creator can post updates
    const { data: event, error: evErr } = await supabase
      .from('community_events')
      .select('creator_id')
      .eq('id', id)
      .single();

    if (evErr || !event) return res.status(404).json({ error: 'Evento no encontrado' });
    if (event.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el organizador puede publicar actualizaciones' });
    }

    // Upload image to Supabase Storage if provided
    let imageUrl = null;
    if (req.file) {
      imageUrl = await storeImage({
        file: req.file,
        bucket: 'chat-images',
        objectName: `event-updates/${userId}/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fallbackMaxLength: 8_000_000,
      });
    }

    // Fetch event title for the notification
    const { data: eventFull } = await supabase
      .from('community_events')
      .select('id, title')
      .eq('id', id)
      .single();

    const { data: update, error } = await supabase
      .from('event_updates')
      .insert({
        event_id: id,
        creator_id: userId,
        content: hasContent || null,
        image_url: imageUrl,
      })
      .select(`
        id, content, image_url, created_at, creator_id,
        creator:users!event_updates_creator_id_fkey(username, avatar_url)
      `)
      .single();

    if (error) throw error;

    // ── Aviso in-app instantáneo (broadcast) + push a los asistentes ─────────
    if (eventFull) {
      const notifBody = hasContent
        ? hasContent.length > 80 ? hasContent.slice(0, 77) + '…' : hasContent
        : '📷 Se ha publicado una imagen';

      const attendeeIds = await broadcastEventUpdateToAttendees({
        eventId: id,
        eventTitle: eventFull.title,
        creatorId: userId,
        body: notifBody,
        kind: 'update',
      });

      if (attendeeIds.length) {
        // No mandar el push a quien haya silenciado los avisos de este evento (fase 89).
        const mutedIds = await getMutedUserIds(supabase, 'event', id, attendeeIds);
        const pushAttendeeIds = attendeeIds.filter(uid => !mutedIds.has(uid));

        notifyUsers(supabase, pushAttendeeIds, userId, {
          title: `📣 ${eventFull.title}`,
          body:  notifBody,
          url:   `/community/event/${id}`,
          tag:   `event-update-${id}`,
        }).catch(() => {});
      }
    }

    res.status(201).json({ update });
  } catch (err) {
    console.error('[community] POST /events/:id/updates error:', err);
    res.status(err.status || 500).json({ error: communityErrorMessage(err, 'Error al publicar actualización') });
  }
});

// POST /api/community/events/:id/polls
// Crea una encuesta como una fila más del hilo de actualizaciones. Solo el
// organizador del evento puede publicarlas (igual que las actualizaciones).
router.post('/events/:id/polls', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const question = (req.body?.question || '').trim();
  const rawOptions = Array.isArray(req.body?.options) ? req.body.options : [];
  const options = rawOptions.map(o => (o || '').trim()).filter(Boolean);

  if (!question) return res.status(400).json({ error: 'Escribe una pregunta para la encuesta' });
  if (question.length > 200) return res.status(400).json({ error: 'La pregunta es demasiado larga (máx. 200)' });
  if (options.length < 2) return res.status(400).json({ error: 'Añade al menos 2 opciones' });
  if (options.length > 4) return res.status(400).json({ error: 'Máximo 4 opciones' });
  if (options.some(o => o.length > 60)) return res.status(400).json({ error: 'Cada opción debe tener máx. 60 caracteres' });
  if (new Set(options.map(o => o.toLowerCase())).size !== options.length) {
    return res.status(400).json({ error: 'Las opciones no pueden repetirse' });
  }

  try {
    const { data: event, error: evErr } = await supabase
      .from('community_events')
      .select('id, creator_id, title')
      .eq('id', id)
      .single();

    if (evErr || !event) return res.status(404).json({ error: 'Evento no encontrado' });
    if (event.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el organizador puede crear encuestas' });
    }

    const { data: update, error } = await supabase
      .from('event_updates')
      .insert({
        event_id: id,
        creator_id: userId,
        poll_question: question,
        poll_options: options,
      })
      .select(`
        id, content, image_url, poll_question, poll_options, created_at, creator_id,
        creator:users!event_updates_creator_id_fkey(username, avatar_url)
      `)
      .single();

    if (error) throw error;
    update.poll = buildPollSummary(options, [], userId);

    // ── Aviso in-app instantáneo (broadcast) + push a los asistentes ─────────
    const pollBody = `Nueva encuesta: ${question.length > 70 ? question.slice(0, 67) + '…' : question}`;
    const attendeeIds = await broadcastEventUpdateToAttendees({
      eventId: id,
      eventTitle: event.title,
      creatorId: userId,
      body: pollBody,
      kind: 'poll',
    });

    if (attendeeIds.length) {
      // No mandar el push a quien haya silenciado los avisos de este evento (fase 89).
      const mutedIds = await getMutedUserIds(supabase, 'event', id, attendeeIds);
      const pushAttendeeIds = attendeeIds.filter(uid => !mutedIds.has(uid));

      notifyUsers(supabase, pushAttendeeIds, userId, {
        title: `📊 ${event.title}`,
        body:  pollBody,
        url:   `/community/event/${id}`,
        tag:   `event-update-${id}`,
      }).catch(() => {});
    }

    res.status(201).json({ update });
  } catch (err) {
    console.error('[community] POST /events/:id/polls error:', err);
    res.status(err.status || 500).json({ error: communityErrorMessage(err, 'Error al crear la encuesta') });
  }
});

// GET /api/community/events/:id/updates/:updateId/poll
// Resumen de resultados de una encuesta concreta (usado por el cliente para
// refrescar solo esa encuesta cuando llega un evento realtime de votos).
router.get('/events/:id/updates/:updateId/poll', requireAuth, async (req, res) => {
  const { id, updateId } = req.params;
  const userId = req.user.id;

  try {
    const { data: update, error: updErr } = await supabase
      .from('event_updates')
      .select('id, poll_options')
      .eq('id', updateId)
      .eq('event_id', id)
      .not('poll_question', 'is', null)
      .single();

    if (updErr || !update) return res.status(404).json({ error: 'Encuesta no encontrada' });

    const { data: voteRows, error: votesErr } = await supabase
      .from('event_poll_votes')
      .select('update_id, user_id, option_index')
      .eq('update_id', updateId);

    if (votesErr) throw votesErr;

    res.json({ poll: buildPollSummary(update.poll_options, voteRows || [], userId) });
  } catch (err) {
    console.error('[community] GET /events/:id/updates/:updateId/poll error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al obtener la encuesta') });
  }
});

// POST /api/community/events/:id/updates/:updateId/vote
// Vota (o cambia el voto) en una encuesta. Cualquier usuario autenticado que
// pueda ver el evento puede votar, no solo los asistentes confirmados.
router.post('/events/:id/updates/:updateId/vote', requireAuth, async (req, res) => {
  const { id, updateId } = req.params;
  const userId = req.user.id;
  const optionIndex = Number(req.body?.optionIndex);

  try {
    const { data: update, error: updErr } = await supabase
      .from('event_updates')
      .select('id, poll_options')
      .eq('id', updateId)
      .eq('event_id', id)
      .not('poll_question', 'is', null)
      .single();

    if (updErr || !update) return res.status(404).json({ error: 'Encuesta no encontrada' });

    const optionCount = Array.isArray(update.poll_options) ? update.poll_options.length : 0;
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= optionCount) {
      return res.status(400).json({ error: 'Opción no válida' });
    }

    const { error } = await supabase
      .from('event_poll_votes')
      .upsert(
        { update_id: updateId, event_id: id, user_id: userId, option_index: optionIndex, created_at: new Date().toISOString() },
        { onConflict: 'update_id,user_id' }
      );

    if (error) throw error;

    const { data: voteRows } = await supabase
      .from('event_poll_votes')
      .select('update_id, user_id, option_index')
      .eq('update_id', updateId);

    res.json({ poll: buildPollSummary(update.poll_options, voteRows || [], userId) });
  } catch (err) {
    console.error('[community] POST /events/:id/updates/:updateId/vote error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al votar') });
  }
});

// DELETE /api/community/events/:id/updates/:updateId/vote
// Retira el voto propio de una encuesta (permite "des-votar" tocando la
// misma opción otra vez).
router.delete('/events/:id/updates/:updateId/vote', requireAuth, async (req, res) => {
  const { id, updateId } = req.params;
  const userId = req.user.id;

  try {
    const { data: update, error: updErr } = await supabase
      .from('event_updates')
      .select('id, poll_options')
      .eq('id', updateId)
      .eq('event_id', id)
      .not('poll_question', 'is', null)
      .single();

    if (updErr || !update) return res.status(404).json({ error: 'Encuesta no encontrada' });

    const { error } = await supabase
      .from('event_poll_votes')
      .delete()
      .eq('update_id', updateId)
      .eq('user_id', userId);

    if (error) throw error;

    const { data: voteRows } = await supabase
      .from('event_poll_votes')
      .select('update_id, user_id, option_index')
      .eq('update_id', updateId);

    res.json({ poll: buildPollSummary(update.poll_options, voteRows || [], userId) });
  } catch (err) {
    console.error('[community] DELETE /events/:id/updates/:updateId/vote error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al quitar el voto') });
  }
});

// DELETE /api/community/events/:id/updates/:updateId
router.delete('/events/:id/updates/:updateId', requireAuth, async (req, res) => {
  const { updateId } = req.params;
  const userId = req.user.id;

  try {
    const { error } = await supabase
      .from('event_updates')
      .delete()
      .eq('id', updateId)
      .eq('creator_id', userId);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[community] DELETE /events/:id/updates/:updateId error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al eliminar actualización') });
  }
});

// ════════════════════════════════════════════════════════════════════════
//  Grupo de localización de evento (fase 98) — botón "Crear grupo de
//  localización" dentro del modo Locator (EventLocatorPage.jsx). Cualquier
//  asistente del evento puede crear el grupo invitando a una selección de
//  sus amigos que también asisten; solo hay un grupo por evento.
// ════════════════════════════════════════════════════════════════════════

// Aviso in-app instantáneo (broadcast por canal personal) + web-push a los
// amigos invitados, mismo patrón que broadcastCommunityPostToMembers /
// broadcastEventUpdateToAttendees. El push lleva a /community/event/:id/locator,
// donde el invitado ve la lista de miembros y puede aceptar o rechazar.
async function notifyLocatorGroupInvitees({ eventId, eventTitle, creatorName, inviteeIds }) {
  if (!inviteeIds.length) return;

  const broadcastPayload = { event_id: eventId, event_title: eventTitle, creator_name: creatorName };
  await Promise.allSettled(
    inviteeIds.map(uid =>
      supabase
        .channel(`locator-invite-notif-${uid}`)
        .send({ type: 'broadcast', event: 'locator_group_invite', payload: broadcastPayload })
    )
  );

  notifyUsers(supabase, inviteeIds, null, {
    title: `📍 Grupo de localización: ${eventTitle || 'Evento'}`,
    body:  `${creatorName || 'Alguien'} te ha invitado a compartir ubicación durante el evento`,
    url:   `/community/event/${eventId}/locator`,
    tag:   `locator-group-${eventId}`,
  }).catch(() => {});
}

// GET /api/community/events/:id/locator-friends — amigos aceptados del
// usuario que también asisten a este evento, para elegir a quién invitar.
router.get('/events/:id/locator-friends', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { data: friendRows, error: friendsErr } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

    if (friendsErr) throw friendsErr;

    const friendIds = (friendRows || []).map(f => (f.requester_id === userId ? f.addressee_id : f.requester_id));
    if (!friendIds.length) return res.json({ friends: [] });

    const { data: attendeeRows, error: attendeesErr } = await supabase
      .from('community_event_attendees')
      .select('user_id')
      .eq('event_id', id)
      .in('user_id', friendIds);

    if (attendeesErr) throw attendeesErr;

    const attendingFriendIds = (attendeeRows || []).map(a => a.user_id);
    if (!attendingFriendIds.length) return res.json({ friends: [] });

    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id, username, avatar_url')
      .in('id', attendingFriendIds);

    if (usersErr) throw usersErr;

    res.json({ friends: users || [] });
  } catch (err) {
    console.error('[community] GET /events/:id/locator-friends error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al obtener amigos del evento') });
  }
});

// GET /api/community/events/:id/locator — grupo de localización del evento
// (si existe), con sus miembros y el estado del usuario actual.
router.get('/events/:id/locator', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { data: group, error: groupErr } = await supabase
      .from('event_locator_groups')
      .select('id, creator_id, created_at')
      .eq('event_id', id)
      .maybeSingle();

    if (groupErr) throw groupErr;
    if (!group) return res.json({ group: null });

    const { data: members, error: membersErr } = await supabase
      .from('event_locator_group_members')
      .select('user_id, status, created_at, responded_at, lat, lng, location_updated_at, user:user_id(id, username, avatar_url, battery_level, battery_updated_at, mascot_preview_url, mascot_name)')
      .eq('group_id', group.id)
      .order('created_at', { ascending: true });

    if (membersErr) throw membersErr;

    // Se aplica el mismo criterio de caducidad de batería que en el resto
    // de la app (chats, quedadas...) — necesario aquí porque battery_level
    // ahora se usa también para elegir el tier de la mascota en el mapa y
    // en la lista del grupo de localización (ver EventLocatorPage.jsx).
    const membersWithBattery = (members || []).map(m => ({ ...m, user: applyBatteryExpiry(m.user) }));

    const myMember = membersWithBattery.find(m => m.user_id === userId);

    res.json({
      group: {
        id: group.id,
        creator_id: group.creator_id,
        is_creator: group.creator_id === userId,
        my_status: myMember?.status || null,
        members: membersWithBattery,
      },
    });
  } catch (err) {
    console.error('[community] GET /events/:id/locator error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al obtener el grupo de localización') });
  }
});

// POST /api/community/events/:id/locator — crear el grupo de localización.
router.post('/events/:id/locator', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const friendIds = Array.isArray(req.body.friendIds) ? [...new Set(req.body.friendIds)].filter(Boolean) : [];

  try {
    const { data: event, error: eventErr } = await supabase
      .from('community_events')
      .select('id, title, event_date, creator:users!community_events_creator_id_fkey(username)')
      .eq('id', id)
      .maybeSingle();

    if (eventErr) throw eventErr;
    if (!event) return res.status(404).json({ error: 'Evento no encontrado' });

    // Solo se puede crear cuando falta 1 hora o menos para el evento (o ya
    // ha empezado) — mismo criterio que el botón deshabilitado en el cliente,
    // comprobado también aquí para no depender solo de la UI.
    const msToStart = new Date(event.event_date).getTime() - Date.now();
    if (Number.isNaN(msToStart) || msToStart > 60 * 60 * 1000) {
      return res.status(400).json({ error: 'Aún falta más de 1 hora para el evento' });
    }

    const { data: existing } = await supabase
      .from('event_locator_groups')
      .select('id')
      .eq('event_id', id)
      .maybeSingle();

    if (existing) return res.status(409).json({ error: 'Este evento ya tiene un grupo de localización' });

    const { data: newGroup, error: createErr } = await supabase
      .from('event_locator_groups')
      .insert({ event_id: id, creator_id: userId })
      .select('id')
      .single();

    if (createErr) throw createErr;

    const { data: creatorProfile } = await supabase.from('users').select('username').eq('id', userId).single();

    const memberRows = [
      { group_id: newGroup.id, user_id: userId, status: 'accepted', responded_at: new Date().toISOString() },
      ...friendIds.map(fid => ({ group_id: newGroup.id, user_id: fid, status: 'pending' })),
    ];

    const { error: membersErr } = await supabase.from('event_locator_group_members').insert(memberRows);
    if (membersErr) throw membersErr;

    if (friendIds.length) {
      notifyLocatorGroupInvitees({
        eventId: id,
        eventTitle: event.title,
        creatorName: creatorProfile?.username || 'Alguien',
        inviteeIds: friendIds,
      }).catch(() => {});
    }

    res.status(201).json({ groupId: newGroup.id });
  } catch (err) {
    console.error('[community] POST /events/:id/locator error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al crear el grupo de localización') });
  }
});

// POST /api/community/events/:id/locator/respond — aceptar o rechazar la
// invitación al grupo de localización de este evento.
router.post('/events/:id/locator/respond', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { status } = req.body;

  if (!['accepted', 'declined'].includes(status)) {
    return res.status(400).json({ error: 'Status debe ser accepted o declined' });
  }

  try {
    const { data: group, error: groupErr } = await supabase
      .from('event_locator_groups')
      .select('id')
      .eq('event_id', id)
      .maybeSingle();

    if (groupErr) throw groupErr;
    if (!group) return res.status(404).json({ error: 'Grupo de localización no encontrado' });

    const { data, error } = await supabase
      .from('event_locator_group_members')
      .update({ status, responded_at: new Date().toISOString() })
      .eq('group_id', group.id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'No estás invitado a este grupo' });

    res.json({ member: data });
  } catch (err) {
    console.error('[community] POST /events/:id/locator/respond error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al responder a la invitación') });
  }
});

// POST /api/community/events/:id/locator/location — actualizar mi posición
// en vivo dentro del grupo de localización. Solo miembros con status
// 'accepted' pueden compartir ubicación. Persiste la última posición (para
// quien entra/recarga más tarde) y retransmite un broadcast de Realtime al
// canal del grupo para que el resto la vea al instante sin refetch.
router.post('/events/:id/locator/location', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { lat, lng } = req.body;

  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'lat/lng inválidos' });
  }

  try {
    const { data: group, error: groupErr } = await supabase
      .from('event_locator_groups')
      .select('id')
      .eq('event_id', id)
      .maybeSingle();

    if (groupErr) throw groupErr;
    if (!group) return res.status(404).json({ error: 'Grupo de localización no encontrado' });

    const updatedAt = new Date().toISOString();

    const { data, error } = await supabase
      .from('event_locator_group_members')
      .update({ lat, lng, location_updated_at: updatedAt })
      .eq('group_id', group.id)
      .eq('user_id', userId)
      .eq('status', 'accepted')
      .select('user_id')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(403).json({ error: 'Solo los miembros aceptados pueden compartir ubicación' });

    supabase
      .channel(`locator-group-${group.id}`)
      .send({
        type: 'broadcast',
        event: 'location_update',
        payload: { user_id: userId, lat, lng, updated_at: updatedAt },
      })
      .catch(() => {});

    res.json({ ok: true, updated_at: updatedAt });
  } catch (err) {
    console.error('[community] POST /events/:id/locator/location error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al actualizar tu ubicación') });
  }
});

// ════════════════════════════════════════════════════════════════════════
//  Chat de comunidad — mismo patrón que groups.js, pero con community_id
//  y comprobando membership en community_members. El fondo (wallpaper) se
//  gestiona en el cliente (localStorage) igual que en grupos; lo único que
//  cambia es que aquí solo admin/moderador puede abrir esa opción del menú.
// ════════════════════════════════════════════════════════════════════════

async function broadcastCommunityMessage({ communityId, senderId, senderName, content, type }) {
  try {
    const [{ data: community }, { data: members }] = await Promise.all([
      supabase.from('communities').select('name').eq('id', communityId).single(),
      supabase
        .from('community_members')
        .select('user_id')
        .eq('community_id', communityId)
        .neq('user_id', senderId),
    ]);

    const communityName = community?.name || 'Comunidad';
    const recipientIds = (members || []).map(m => m.user_id);
    if (!recipientIds.length) return;

    const broadcastPayload = {
      community_id:   communityId,
      community_name: communityName,
      sender_id:      senderId,
      sender_name:    senderName,
      content,
      type,
    };

    await Promise.allSettled(
      recipientIds.map(recipientId =>
        supabase
          .channel(`community-msg-notif-${recipientId}`)
          .send({ type: 'broadcast', event: 'new_community_message', payload: broadcastPayload })
      )
    );

    // No mandar el push a quien haya silenciado este chat de comunidad en
    // concreto (fase 88) NI a quien tenga activado el silencio global de
    // "chat de comunidad" (users.mute_community_chats, fase 91) — aplica en
    // foreground (useMessageNotifications) y en background/app cerrada, y el
    // push real es lo único que llega en ese segundo caso.
    const [mutedIds, globallyMutedIds] = await Promise.all([
      getMutedUserIds(supabase, 'community', communityId, recipientIds),
      getCommunityChatMuteFilteredIds(recipientIds),
    ]);
    const pushRecipientIds = recipientIds.filter(
      id => !mutedIds.has(id) && !globallyMutedIds.has(id)
    );
    const previewText = type === 'image' ? '📷 Imagen' : content?.slice(0, 80) || '📩 Nuevo mensaje';
    await notifyUsers(supabase, pushRecipientIds, senderId, {
      title: communityName,
      body:  `${senderName}: ${previewText}`,
      url:   `/messages/community/${communityId}`,
      tag:   `community-${communityId}`,
    });
  } catch (err) {
    console.error('[community] broadcastCommunityMessage error:', err);
  }
}

// Devuelve el Set de candidateIds que tiene activado el silencio global del
// chat de comunidad (users.mute_community_chats, fase 91). Mismo patrón que
// getPoolChatMuteFilteredIds en routes/pools.js.
async function getCommunityChatMuteFilteredIds(candidateIds) {
  if (!candidateIds.length) return new Set();
  try {
    const { data } = await supabase
      .from('users')
      .select('id')
      .in('id', candidateIds)
      .eq('mute_community_chats', true);
    return new Set((data || []).map(u => u.id));
  } catch {
    return new Set();
  }
}

// Devuelve el Set de candidateIds que tiene activado el silencio global de
// los hilos de comunidad (users.mute_community_threads, fase 96). Mismo
// patrón que getCommunityChatMuteFilteredIds, pero para el aviso de "nueva
// publicación en el hilo" en vez del chat.
async function getCommunityThreadMuteFilteredIds(candidateIds) {
  if (!candidateIds.length) return new Set();
  try {
    const { data } = await supabase
      .from('users')
      .select('id')
      .in('id', candidateIds)
      .eq('mute_community_threads', true);
    return new Set((data || []).map(u => u.id));
  } catch {
    return new Set();
  }
}

async function requireCommunityMembership(communityId, userId) {
  const { data } = await supabase
    .from('community_members')
    .select('community_id')
    .eq('community_id', communityId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

// Verifica que `messageId` pertenece a esta comunidad (mismo patrón que
// findReplyTarget en routes/messages.js y findPoolReplyTarget en routes/pools.js).
async function findCommunityReplyTarget(messageId, communityId) {
  if (!messageId) return null;
  const { data } = await supabase
    .from('community_messages')
    .select('id, sender_id')
    .eq('id', messageId)
    .eq('community_id', communityId)
    .maybeSingle();
  return data || null;
}

// ── GET /api/community/communities/:id/messages ─────────────────────────────
router.get('/communities/:id/messages', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const communityId = req.params.id;
  const limit = parseInt(req.query.limit) || 60;

  try {
    if (!(await requireCommunityMembership(communityId, userId))) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const { data, error } = await supabase
      .from('community_messages')
      .select(`
        id, content, type, poll_options, created_at,
        liked_by, deleted_for_self, deleted_for_everyone, deleted_for_everyone_at, reply_to_id,
        reply_to:reply_to_id(id, sender_id, content, type, deleted_for_everyone, sender:sender_id(username)),
        sender:sender_id(id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at)
      `)
      .eq('community_id', communityId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw error;

    const pollMessages = (data || []).filter(m => m.type === 'poll');
    if (pollMessages.length) {
      const pollIds = pollMessages.map(m => m.id);
      const { data: voteRows } = await supabase
        .from('community_message_poll_votes')
        .select('message_id, user_id, option_index')
        .in('message_id', pollIds);

      const votesByMessage = new Map();
      for (const v of voteRows || []) {
        if (!votesByMessage.has(v.message_id)) votesByMessage.set(v.message_id, []);
        votesByMessage.get(v.message_id).push(v);
      }
      for (const m of pollMessages) {
        m.poll = buildPollSummary(m.poll_options, votesByMessage.get(m.id) || [], userId);
      }
    }

    const { data: clearData } = await supabase
      .from('community_conversation_clears')
      .select('cleared_at')
      .eq('user_id', userId)
      .eq('community_id', communityId)
      .maybeSingle();

    const { isStaff } = await getCommunityAdminState(communityId, userId);
    const pinnedMessage = await fetchPinnedCommunityMessage(communityId, data || []);

    res.json({
      messages: (data || []).map(message => ({ ...message, sender: applyBatteryExpiry(message.sender) })),
      cleared_at: clearData?.cleared_at || null,
      can_manage_wallpaper: isStaff,
      can_pin_messages: isStaff,
      pinned_message: pinnedMessage,
    });
  } catch (err) {
    console.error('[community] GET /communities/:id/messages', err);
    res.status(500).json({ error: `Failed to fetch messages: ${err.message || err}` });
  }
});

// ── Helper: resuelve el mensaje fijado de una comunidad (si lo hay) ─────────
async function fetchPinnedCommunityMessage(communityId, loadedMessages = []) {
  const { data: community } = await supabase
    .from('communities')
    .select('pinned_message_id, pinned_at, pinned_by:pinned_by(id, username, avatar_url)')
    .eq('id', communityId)
    .maybeSingle();

  if (!community?.pinned_message_id) return null;

  const alreadyLoaded = loadedMessages.find(m => m.id === community.pinned_message_id);
  let base = alreadyLoaded;
  if (!base) {
    const { data: msgRow } = await supabase
      .from('community_messages')
      .select(`id, content, type, created_at, sender:sender_id(id, username, avatar_url)`)
      .eq('id', community.pinned_message_id)
      .maybeSingle();
    base = msgRow;
  }
  if (!base) return null;

  return {
    id: base.id,
    content: base.content,
    type: base.type,
    created_at: base.created_at,
    sender: base.sender,
    pinned_at: community.pinned_at,
    pinned_by: community.pinned_by || null,
  };
}

// ── POST /api/community/communities/:id/messages/:messageId/pin ────────────
// Fijar mensaje: solo admin o moderador de la comunidad.
router.post('/communities/:id/messages/:messageId/pin', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const communityId = req.params.id;
  const messageId = req.params.messageId;

  try {
    const { isStaff } = await getCommunityAdminState(communityId, userId);
    if (!isStaff) {
      return res.status(403).json({ error: 'Solo un administrador o moderador puede fijar mensajes' });
    }

    const { data: msg } = await supabase
      .from('community_messages')
      .select('id')
      .eq('id', messageId)
      .eq('community_id', communityId)
      .maybeSingle();
    if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' });

    const pinnedAt = new Date().toISOString();
    const { error } = await supabase
      .from('communities')
      .update({ pinned_message_id: messageId, pinned_by: userId, pinned_at: pinnedAt })
      .eq('id', communityId);
    if (error) throw error;

    res.json({ success: true, pinned_message_id: messageId, pinned_at: pinnedAt });
  } catch (err) {
    console.error('[community] POST /communities/:id/messages/:messageId/pin', err);
    res.status(500).json({ error: 'Failed to pin message' });
  }
});

// ── DELETE /api/community/communities/:id/pin — desfijar mensaje ────────────
// Solo admin o moderador de la comunidad.
router.delete('/communities/:id/pin', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const communityId = req.params.id;

  try {
    const { isStaff } = await getCommunityAdminState(communityId, userId);
    if (!isStaff) {
      return res.status(403).json({ error: 'Solo un administrador o moderador puede desfijar mensajes' });
    }

    const { error } = await supabase
      .from('communities')
      .update({ pinned_message_id: null, pinned_by: null, pinned_at: null })
      .eq('id', communityId);
    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('[community] DELETE /communities/:id/pin', err);
    res.status(500).json({ error: 'Failed to unpin message' });
  }
});

// ── POST /api/community/communities/:id/clear — vaciar chat (solo para mí) ──
router.post('/communities/:id/clear', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const communityId = req.params.id;
  try {
    if (!(await requireCommunityMembership(communityId, userId))) {
      return res.status(403).json({ error: 'Not a member' });
    }
    const clearedAt = new Date().toISOString();
    const { error } = await supabase
      .from('community_conversation_clears')
      .upsert(
        { user_id: userId, community_id: communityId, cleared_at: clearedAt },
        { onConflict: 'user_id,community_id' }
      );
    if (error) throw error;
    res.json({ success: true, cleared_at: clearedAt });
  } catch (err) {
    console.error('[community] POST /communities/:id/clear', err);
    res.status(500).json({ error: 'Failed to clear chat' });
  }
});

// ── POST /api/community/communities/:id/messages ────────────────────────────
router.post('/communities/:id/messages', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const communityId = req.params.id;
  const { content, type = 'text', reply_to_id } = req.body;

  if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
  if (type !== 'text') return res.status(400).json({ error: 'Invalid type' });

  try {
    if (!(await requireCommunityMembership(communityId, userId))) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const insertData = { community_id: communityId, sender_id: userId, content: content.trim(), type };
    if (reply_to_id) {
      const target = await findCommunityReplyTarget(reply_to_id, communityId);
      if (target) insertData.reply_to_id = target.id;
    }

    const { data, error } = await supabase
      .from('community_messages')
      .insert(insertData)
      .select(`
        id, content, type, created_at, reply_to_id,
        reply_to:reply_to_id(id, sender_id, content, type, deleted_for_everyone, sender:sender_id(username)),
        sender:sender_id(id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at)
      `)
      .single();

    if (error) throw error;

    res.status(201).json({ message: { ...data, sender: applyBatteryExpiry(data.sender) } });

    const senderName = data.sender?.username || 'Alguien';
    broadcastCommunityMessage({ communityId, senderId: userId, senderName, content: data.content, type: data.type }).catch(() => {});
  } catch (err) {
    console.error('[community] POST /communities/:id/messages', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ── PATCH /api/community/communities/:id/messages/:messageId/like ──────────
router.patch('/communities/:id/messages/:messageId/like', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { id: communityId, messageId } = req.params;

  try {
    if (!(await requireCommunityMembership(communityId, userId))) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const { data: msg, error: fetchErr } = await supabase
      .from('community_messages')
      .select('id, sender_id, deleted_for_everyone, liked_by')
      .eq('id', messageId)
      .eq('community_id', communityId)
      .single();

    if (fetchErr || !msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.deleted_for_everyone) {
      return res.status(400).json({ error: 'No puedes reaccionar a un mensaje eliminado' });
    }

    const current = Array.isArray(msg.liked_by) ? msg.liked_by : [];
    const alreadyLiked = current.includes(userId);
    const nextLikedBy = alreadyLiked ? current.filter(id => id !== userId) : [...current, userId];

    const { data, error } = await supabase
      .from('community_messages')
      .update({ liked_by: nextLikedBy })
      .eq('id', messageId)
      .select('id, liked_by')
      .single();

    if (error) throw error;
    res.json({ message: data });
  } catch (err) {
    console.error('[community] PATCH /communities/:id/messages/:messageId/like', err);
    res.status(500).json({ error: 'Failed to update like' });
  }
});

// ── PATCH /api/community/communities/:id/messages/:messageId — eliminar mensaje ──
router.patch('/communities/:id/messages/:messageId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { id: communityId, messageId } = req.params;
  const { scope } = req.body;

  if (!['me', 'everyone'].includes(scope)) {
    return res.status(400).json({ error: 'scope must be "me" or "everyone"' });
  }

  try {
    if (!(await requireCommunityMembership(communityId, userId))) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const { data: msg, error: fetchErr } = await supabase
      .from('community_messages')
      .select('id, sender_id, deleted_for_self')
      .eq('id', messageId)
      .eq('community_id', communityId)
      .single();

    if (fetchErr || !msg) return res.status(404).json({ error: 'Message not found' });

    if (scope === 'everyone') {
      if (msg.sender_id !== userId) {
        return res.status(403).json({ error: 'Solo puedes eliminar para todos tus propios mensajes' });
      }
      const { data, error } = await supabase
        .from('community_messages')
        .update({ deleted_for_everyone: true, deleted_for_everyone_at: new Date().toISOString() })
        .eq('id', messageId)
        .select('id, deleted_for_everyone, deleted_for_everyone_at')
        .single();

      if (error) throw error;
      return res.json({ message: data });
    } else {
      const current = Array.isArray(msg.deleted_for_self) ? msg.deleted_for_self : [];
      if (!current.includes(userId)) current.push(userId);

      const { data, error } = await supabase
        .from('community_messages')
        .update({ deleted_for_self: current })
        .eq('id', messageId)
        .select('id, deleted_for_self')
        .single();

      if (error) throw error;
      return res.json({ message: data });
    }
  } catch (err) {
    console.error('[community] PATCH /communities/:id/messages/:messageId', err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// ── POST /api/community/communities/:id/messages/image ──────────────────────
router.post('/communities/:id/messages/image', requireAuth, (req, res, next) => {
  _communityChatImageUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  const userId = req.user.id;
  const communityId = req.params.id;

  if (!req.file) return res.status(400).json({ error: 'Se requiere una imagen' });

  try {
    if (!(await requireCommunityMembership(communityId, userId))) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const imageUrl = await storeImage({
      file: req.file,
      bucket: 'chat-images',
      objectName: `community/${communityId}/${Date.now()}`,
      fallbackMaxLength: 8_000_000,
    });

    const insertData = { community_id: communityId, sender_id: userId, content: imageUrl, type: 'image' };
    if (req.body.reply_to_id) {
      const target = await findCommunityReplyTarget(req.body.reply_to_id, communityId);
      if (target) insertData.reply_to_id = target.id;
    }

    const { data, error } = await supabase
      .from('community_messages')
      .insert(insertData)
      .select(`
        id, content, type, created_at, reply_to_id,
        reply_to:reply_to_id(id, sender_id, content, type, deleted_for_everyone, sender:sender_id(username)),
        sender:sender_id(id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at)
      `)
      .single();

    if (error) throw error;

    res.status(201).json({ message: { ...data, sender: applyBatteryExpiry(data.sender) } });

    const senderName = data.sender?.username || 'Alguien';
    broadcastCommunityMessage({ communityId, senderId: userId, senderName, content: data.content, type: 'image' }).catch(() => {});
  } catch (e) {
    console.error('[community] image upload error:', e);
    res.status(e.status || 500).json({ error: e.message || 'Error al subir la imagen' });
  }
});

// ── POST /api/community/communities/:id/polls — crear encuesta ──────────────
router.post('/communities/:id/polls', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const communityId = req.params.id;
  const question = (req.body?.question || '').trim();
  const rawOptions = Array.isArray(req.body?.options) ? req.body.options : [];
  const options = rawOptions.map(o => (o || '').trim()).filter(Boolean);

  if (!question) return res.status(400).json({ error: 'Escribe una pregunta para la encuesta' });
  if (question.length > 200) return res.status(400).json({ error: 'La pregunta es demasiado larga (máx. 200)' });
  if (options.length < 2) return res.status(400).json({ error: 'Añade al menos 2 opciones' });
  if (options.length > 4) return res.status(400).json({ error: 'Máximo 4 opciones' });
  if (options.some(o => o.length > 60)) return res.status(400).json({ error: 'Cada opción debe tener máx. 60 caracteres' });
  if (new Set(options.map(o => o.toLowerCase())).size !== options.length) {
    return res.status(400).json({ error: 'Las opciones no pueden repetirse' });
  }

  try {
    if (!(await requireCommunityMembership(communityId, userId))) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const { data, error } = await supabase
      .from('community_messages')
      .insert({ community_id: communityId, sender_id: userId, content: question, type: 'poll', poll_options: options })
      .select(`
        id, content, type, poll_options, created_at,
        sender:sender_id(id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at)
      `)
      .single();

    if (error) throw error;
    data.poll = buildPollSummary(options, [], userId);

    res.status(201).json({ message: { ...data, sender: applyBatteryExpiry(data.sender) } });

    const senderName = data.sender?.username || 'Alguien';
    broadcastCommunityMessage({ communityId, senderId: userId, senderName, content: `📊 ${question}`, type: 'poll' }).catch(() => {});
  } catch (err) {
    console.error('[community] POST /communities/:id/polls', err);
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

// ── GET /api/community/communities/:id/messages/:messageId/poll ─────────────
router.get('/communities/:id/messages/:messageId/poll', requireAuth, async (req, res) => {
  const communityId = req.params.id;
  const messageId = req.params.messageId;
  const userId = req.user.id;

  try {
    if (!(await requireCommunityMembership(communityId, userId))) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const { data: message, error: msgErr } = await supabase
      .from('community_messages')
      .select('id, poll_options')
      .eq('id', messageId)
      .eq('community_id', communityId)
      .eq('type', 'poll')
      .single();

    if (msgErr || !message) return res.status(404).json({ error: 'Encuesta no encontrada' });

    const { data: voteRows, error: votesErr } = await supabase
      .from('community_message_poll_votes')
      .select('message_id, user_id, option_index')
      .eq('message_id', messageId);

    if (votesErr) throw votesErr;

    res.json({ poll: buildPollSummary(message.poll_options, voteRows || [], userId) });
  } catch (err) {
    console.error('[community] GET /communities/:id/messages/:messageId/poll', err);
    res.status(500).json({ error: 'Failed to fetch poll' });
  }
});

// ── POST /api/community/communities/:id/messages/:messageId/vote ───────────
router.post('/communities/:id/messages/:messageId/vote', requireAuth, async (req, res) => {
  const communityId = req.params.id;
  const messageId = req.params.messageId;
  const userId = req.user.id;
  const optionIndex = Number(req.body?.optionIndex);

  try {
    if (!(await requireCommunityMembership(communityId, userId))) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const { data: message, error: msgErr } = await supabase
      .from('community_messages')
      .select('id, poll_options')
      .eq('id', messageId)
      .eq('community_id', communityId)
      .eq('type', 'poll')
      .single();

    if (msgErr || !message) return res.status(404).json({ error: 'Encuesta no encontrada' });

    const optionCount = Array.isArray(message.poll_options) ? message.poll_options.length : 0;
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= optionCount) {
      return res.status(400).json({ error: 'Opción no válida' });
    }

    const { error } = await supabase
      .from('community_message_poll_votes')
      .upsert(
        { message_id: messageId, community_id: communityId, user_id: userId, option_index: optionIndex, created_at: new Date().toISOString() },
        { onConflict: 'message_id,user_id' }
      );

    if (error) throw error;

    const { data: voteRows } = await supabase
      .from('community_message_poll_votes')
      .select('message_id, user_id, option_index')
      .eq('message_id', messageId);

    res.json({ poll: buildPollSummary(message.poll_options, voteRows || [], userId) });
  } catch (err) {
    console.error('[community] POST /communities/:id/messages/:messageId/vote', err);
    res.status(500).json({ error: 'Failed to vote' });
  }
});

// ── DELETE /api/community/communities/:id/messages/:messageId/vote ─────────
router.delete('/communities/:id/messages/:messageId/vote', requireAuth, async (req, res) => {
  const communityId = req.params.id;
  const messageId = req.params.messageId;
  const userId = req.user.id;

  try {
    const { data: message, error: msgErr } = await supabase
      .from('community_messages')
      .select('id, poll_options')
      .eq('id', messageId)
      .eq('community_id', communityId)
      .eq('type', 'poll')
      .single();

    if (msgErr || !message) return res.status(404).json({ error: 'Encuesta no encontrada' });

    const { error } = await supabase
      .from('community_message_poll_votes')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId);

    if (error) throw error;

    const { data: voteRows } = await supabase
      .from('community_message_poll_votes')
      .select('message_id, user_id, option_index')
      .eq('message_id', messageId);

    res.json({ poll: buildPollSummary(message.poll_options, voteRows || [], userId) });
  } catch (err) {
    console.error('[community] DELETE /communities/:id/messages/:messageId/vote', err);
    res.status(500).json({ error: 'Failed to remove vote' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// SORTEOS DE COMUNIDAD

const raffleImageUpload = createImageUpload({ maxSizeMb: 5 });
// Fase 122 — el POST de sorteo ahora puede subir además hasta N fotos
// de premios (nombre de campo `prize_image`). El cliente ordena las
// imágenes con un `image_index` dentro del JSON `prizes` para casarlas
// con el premio correcto — ver POST /communities/:id/raffles. El límite
// blando de 20 imágenes por request es un cinturón contra abuso, no una
// restricción de negocio (el frontend cap N=10 premios).
function uploadRaffleAssets(req, res, next) {
  raffleImageUpload.fields([
    { name: 'image', maxCount: 1 },        // portada del sorteo
    { name: 'prize_image', maxCount: 20 }, // imagen(es) de premios
  ])(req, res, err => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message || 'No se pudo subir la foto' });
  });
}
// Alias intencional: no hay otro llamador de `uploadRaffleImage`, así
// que dejamos solo `uploadRaffleAssets` con nombre honesto.

// Tipos de sorteo disponibles. "price_cents" es solo informativo por
// ahora (no hay pasarela de cobro conectada todavía, igual que en las
// colaboraciones de comunidad — ver phase81/phase82).
const RAFFLE_TIERS = {
  volt: {
    label: 'Sorteo Volt',
    price_cents: 0,
    rules: 'Participan los miembros de la comunidad con suscripción Volt de la app.',
  },
  community: {
    label: 'Sorteo Community',
    price_cents: 500,
    rules: 'Participan los miembros que han colaborado con la comunidad.',
  },
  light: {
    label: 'Sorteo Light',
    price_cents: 2000,
    rules: 'Participan todos los miembros de la comunidad.',
  },
};
const RAFFLE_TIER_KEYS = Object.keys(RAFFLE_TIERS);

// Rango de visualizaciones de banner contratables en un sorteo Light (entre
// BANNER_VIEWS_MIN y BANNER_VIEWS_MAX). Se usa al crear el sorteo
// (validación del aforo contratado).
const BANNER_VIEWS_MIN = 1000;
const BANNER_VIEWS_MAX = 100000;

function normalizeRaffleTier(tier) {
  return RAFFLE_TIERS[tier] ? tier : 'light';
}

// Devuelve los user_id elegibles para un sorteo según su tier. Los
// admins de la comunidad nunca participan, sea cual sea el tier.
async function getEligibleRaffleMembers(communityId, tier) {
  const { data: members, error } = await supabase
    .from('community_members')
    .select('user_id')
    .eq('community_id', communityId)
    .neq('role', 'admin');

  if (error) throw error;
  let userIds = (members || []).map(m => m.user_id);
  if (!userIds.length) return [];

  if (tier === 'volt') {
    const { data: subs, error: subErr } = await supabase
      .from('users')
      .select('id')
      .in('id', userIds)
      .eq('is_volt_subscriber', true);
    if (subErr) throw subErr;
    const subIds = new Set((subs || []).map(u => u.id));
    userIds = userIds.filter(id => subIds.has(id));
  } else if (tier === 'community') {
    const { data: collabs, error: collabErr } = await supabase
      .from('community_collaborations')
      .select('user_id')
      .eq('community_id', communityId);
    if (collabErr) throw collabErr;
    const collabIds = new Set((collabs || []).map(c => c.user_id));
    userIds = userIds.filter(id => collabIds.has(id));
  }

  return userIds;
}

// ── Audiencia de banner para sorteos Light ──────────────────────────────────
// A diferencia de 'volt' y 'community', el tier Light es publicidad de
// pago dirigida a usuarios AJENOS a la comunidad que organiza el sorteo:
// el pool de "usuarios notificables/contratables" son todos los usuarios de
// la app EXCEPTO el propio creador Y EXCEPTO quienes ya son miembros de esa
// comunidad (no tiene sentido pagar por publicidad a quien ya la conoce).
// Si interestedOnly es true, se filtra además a quienes tengan algún
// interés de perfil en común con las CATEGORÍAS EFECTIVAS DEL SORTEO — las
// del propio sorteo (fase 116) si están definidas, o las de la comunidad
// como fallback (mismo esquema que ya usan los eventos, que se clasifican
// por sus propias categorías). El caller resuelve el fallback y pasa el
// resultado en `raffleCategories`; si no lo pasa (llamada antigua o
// preview sin borrador), se cae al comportamiento histórico y se cargan
// las categorías de la comunidad aquí dentro. Se usa tanto para calcular
// el tamaño de la audiencia (GET .../raffle-audience) como para el reparto
// real del banner al crear el sorteo, así el número que se le enseña al
// creador en la pantalla de configuración de publicidad coincide
// exactamente con el pool real del que luego se sortean los targets.
async function getRaffleLightAudienceIds(communityId, creatorId, { interestedOnly = false, raffleCategories = null } = {}) {
  const { data: members, error: memErr } = await supabase
    .from('community_members')
    .select('user_id')
    .eq('community_id', communityId);
  if (memErr) throw memErr;
  const excludedIds = new Set((members || []).map(m => m.user_id));
  excludedIds.add(creatorId);

  let query = supabase.from('users').select('id');
  if (interestedOnly) {
    let categories = Array.isArray(raffleCategories) ? raffleCategories.filter(Boolean) : null;
    if (!categories || !categories.length) {
      // Fallback: sin categorías propias del sorteo, se usan las de la
      // comunidad (comportamiento previo a la fase 116).
      const { data: community, error: communityErr } = await supabase
        .from('communities')
        .select('categories')
        .eq('id', communityId)
        .maybeSingle();
      if (communityErr) throw communityErr;
      categories = (community?.categories || []).filter(Boolean);
    }
    if (!categories.length) return { ids: [], categoriesDefined: false };
    query = query.overlaps('interests', categories);
  }

  const { data: users, error } = await query;
  if (error) throw error;
  const ids = (users || []).map(u => u.id).filter(id => !excludedIds.has(id));
  return { ids, categoriesDefined: true };
}

// Helper de conveniencia: dado el sorteo (o borrador) y la comunidad,
// devuelve las categorías efectivas para clasificar interesados — las
// propias del sorteo si tiene, si no las de la comunidad. Se usa como
// fuente única de verdad en la creación, la renovación y el tagging de
// matched_interest, para que el número que ve el creador en la pantalla
// de publicidad coincida con el reparto real y con la clasificación del
// dashboard.
function resolveRaffleEffectiveCategories(raffleCategories, communityCategories) {
  const own = Array.isArray(raffleCategories) ? raffleCategories.filter(Boolean) : [];
  if (own.length) return own;
  return (communityCategories || []).filter(Boolean);
}

// Devuelve el subconjunto (Set) de userIds cuyos intereses de perfil solapan
// con las categorías dadas. Se usa para dar prioridad, dentro del reparto
// del banner de un sorteo Light, a quien coincide categoría de evento con
// categoría de usuario (ver assignRaffleBannerTargets → priorityIds).
async function getCategoryMatchingUserIds(userIds, categories) {
  const cats = (categories || []).filter(Boolean);
  if (!userIds?.length || !cats.length) return new Set();
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .in('id', userIds)
    .overlaps('interests', cats);
  if (error) throw error;
  return new Set((data || []).map(u => u.id));
}

// Fase 111 — Igual que getCategoryMatchingUserIds pero SIN acotar a una
// lista previa de userIds: devuelve el Set de TODOS los usuarios de la app
// cuyos intereses cruzan con las categorías dadas. Se usa para etiquetar
// matched_interest en el momento del envío/asignación (ver el dashboard de
// publicidad), donde el conjunto a clasificar puede ser enorme: un sorteo
// Volt asigna un target por cada usuario de la app, y meter 100.000 UUIDs
// en un .in() significa una URL de varios MB que PostgREST rechaza. Aquí
// se hace UNA consulta con overlaps (que aprovecha el índice sobre
// interests) y la intersección se resuelve en memoria contra el Set.
//
// Devuelve null — no un Set vacío — si no hay categorías con las que
// cruzar: son casos distintos y el dashboard los trata distinto. Set vacío
// = "clasificado, no coincide nadie" (matched_interest = false para todos);
// null = "no clasificable" (matched_interest se queda NULL).
async function getInterestedUserIdSet(categories) {
  const cats = (categories || []).filter(Boolean);
  if (!cats.length) return null;
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .overlaps('interests', cats);
  if (error) throw error;
  return new Set((data || []).map(u => u.id));
}

// ── Reparto del banner volador (avioneta con pancarta "¡Sorteo nuevo!") ────
// Aplica a los tiers 'light', 'volt' y 'community' (los que incluyen banner
// en el menú principal, ver RAFFLE_TIER_OPTIONS en CommunityDetailPage.jsx).
// En 'light' se reparte a una selección aleatoria de tamaño
// banner_views_contracted (capCount) tomada de TODOS los usuarios de la
// app. En 'volt' no hay número contratado ("al número de usuarios
// disponibles"): se reparte a TODOS los usuarios de la app (capCount =
// null). En 'community' tampoco hay número contratado, pero el "pool" no es
// toda la app: se reparte únicamente entre los MIEMBROS DE LA COMUNIDAD del
// propio sorteo (capCount = null, pool restringido — ver llamada en
// POST /communities/:id/raffles).
//
// Un mismo usuario puede acabar siendo target de varios sorteos a la vez
// (p.ej. un Light y un Volt en paralelo); no hay problema en que se le
// asignen ambos. Lo que garantiza la prioridad de Community sobre Light
// sobre Volt es el ORDEN DE ENTREGA en GET /raffle-banner (más abajo): si un
// usuario tiene pendiente un banner Community, se le sirve ese primero; el
// resto le llegarán en siguientes entradas a la app, una vez consumidos los
// de mayor prioridad. Además, GET /raffle-banner limita a como mucho una
// avioneta cada 15 minutos por usuario (ver BANNER_COOLDOWN_MS), sea cual
// sea el tier, para no saturarle a base de entradas seguidas a la app.
// Baraja un array in-place con Fisher–Yates (selección aleatoria sin sesgo).
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// priorityIds (opcional, Set<string>): usuarios cuya categoría de interés
// coincide con la categoría del sorteo/evento. Cuando se proporciona y el
// reparto está limitado (capCount != null, caso Light con aforo contratado),
// estos usuarios se colocan primero en la cola de candidatos — barajados
// entre sí para no introducir sesgo dentro del propio grupo prioritario —
// de modo que si el aforo contratado no llega a cubrir todo el pool, se
// publicita antes a quien coincide categoría de evento con categoría de
// usuario. El resto (sin coincidencia) rellena las plazas sobrantes,
// también en orden aleatorio. Sin priorityIds, el comportamiento es el
// aleatorio uniforme de siempre.
//
// matchedIds (opcional, Set<string> | null): usuarios cuyos intereses de
// perfil cruzan con las categorías de la comunidad, tal como estaban EN
// ESTE MOMENTO (ver getInterestedUserIdSet). Se congela por fila en
// raffle_banner_targets.matched_interest para que el dashboard de
// publicidad pueda desglosar visualizaciones y clicks por segmento sin
// recalcularlo a posteriori (los intereses del perfil cambian con el
// tiempo; lo que importa es a quién se le enseñó el banner cuando se le
// enseñó). Con null se deja matched_interest a NULL = "no clasificable"
// (comunidad sin categorías definidas). Ojo: no confundir con priorityIds
// — priorityIds ORDENA el reparto, matchedIds solo lo ETIQUETA. Suelen
// coincidir en Light sin filtro, pero son cosas independientes.
async function assignRaffleBannerTargets(raffleId, creatorId, capCount, pool = null, priorityIds = null, matchedIds = null) {
  try {
    let candidates = pool;
    if (!candidates) {
      const { data: allUsers, error } = await supabase
        .from('users')
        .select('id')
        .neq('id', creatorId);
      if (error) throw error;
      candidates = (allUsers || []).map(u => u.id);
    } else {
      candidates = candidates.filter(id => id !== creatorId);
    }

    if (priorityIds && priorityIds.size && capCount != null) {
      const priority = candidates.filter(id => priorityIds.has(id));
      const rest = candidates.filter(id => !priorityIds.has(id));
      candidates = [...shuffleInPlace(priority), ...shuffleInPlace(rest)];
    } else {
      shuffleInPlace(candidates);
    }

    const targetIds = capCount != null ? candidates.slice(0, Math.min(capCount, candidates.length)) : candidates;
    if (!targetIds.length) return [];

    const rows = targetIds.map(userId => ({
      raffle_id: raffleId,
      user_id: userId,
      matched_interest: matchedIds ? matchedIds.has(userId) : null,
    }));
    const { error: insertErr } = await supabase.from('raffle_banner_targets').insert(rows);
    if (insertErr) throw insertErr;
    return targetIds;
  } catch (err) {
    console.error('[community] assignRaffleBannerTargets error:', err);
    return [];
  }

}

// Todos los miembros de una comunidad (sin filtrar por rol), excluyendo al
// creador del sorteo — es el "pool" del banner volador Community: solo se
// enseña a quien ya es miembro de esa comunidad, y solamente una vez por
// usuario (igual que Light y Volt, ver raffle_banner_targets).
async function getCommunityMemberIdsForBanner(communityId, excludeUserId) {
  const { data, error } = await supabase
    .from('community_members')
    .select('user_id')
    .eq('community_id', communityId);
  if (error) throw error;
  return (data || []).map(m => m.user_id).filter(id => id !== excludeUserId);
}

// ── Notificación inmediata de sorteo (avioneta) a quien pertenece a la
//    comunidad del sorteo ───────────────────────────────────────────────────
// Además del banner volador (que se sirve de forma diferida, la próxima vez
// que el usuario entre al menú principal — ver GET /raffle-banner), quienes
// hayan sido "elegidos" como target del banner (assignRaffleBannerTargets) Y
// además ya pertenezcan a la comunidad del sorteo reciben también un aviso
// inmediato nada más crearse el sorteo: broadcast por canal personal (para
// que le llegue al instante con la app abierta, mismo patrón que
// broadcastCommunityPostToMembers) + web-push (para que le llegue con la app
// en segundo plano o cerrada). En 'community' esto es siempre el 100% de los
// targets, ya que su pool son los propios miembros; en 'light'/'volt' es
// solo la intersección entre los elegidos al azar y los miembros de esa
// comunidad en concreto — a quien le toque el sorteo pero no sea de esa
// comunidad solo le llegará el banner volador diferido, sin aviso inmediato.
async function notifyCommunityRaffleTargets({ raffleId, communityId, communityName, creatorId, title, tier, targetIds, memberIds = null }) {
  try {
    if (!targetIds?.length) return;

    const knownMemberIds = memberIds || await getCommunityMemberIdsForBanner(communityId, creatorId);
    const memberIdSet = new Set(knownMemberIds);
    const candidateIds = targetIds.filter(id => memberIdSet.has(id));
    if (!candidateIds.length) return;

    // Fase 107 — filtrar a quien tenga "silenciar nuevos sorteos de tus
    // comunidades" activo (users.mute_new_raffles). Se aplica ANTES de
    // ambos canales (broadcast + web-push), a diferencia de los mutes de
    // conversación (muted_conversations, fase 88) que solo filtran el
    // push: aquí el aviso es "hay algo nuevo", no un mensaje entrante,
    // así que si el usuario lo silenció tampoco quiere ver el popup con
    // la app abierta.
    const mutedIds = await getMuteNewRafflesFilteredIds(candidateIds);
    const recipientIds = candidateIds.filter(id => !mutedIds.has(id));
    if (!recipientIds.length) return;

    const broadcastPayload = {
      raffle_id:      raffleId,
      community_id:   communityId,
      community_name: communityName,
      creator_id:     creatorId,
      title,
      tier,
    };

    await Promise.allSettled(
      recipientIds.map(uid =>
        supabase
          .channel(`raffle-banner-notif-${uid}`)
          .send({ type: 'broadcast', event: 'new_raffle_banner', payload: broadcastPayload })
      )
    );

    // ?src=raffle — marca de atribución (fase 111). Al aterrizar en la
    // comunidad, CommunityDetailPage ve el parámetro y registra el click
    // contra el target de este sorteo (POST /raffles/:raffleId/banner-click),
    // igual que hace la avioneta al tocarla. Sin la marca no habría forma de
    // distinguir "entró desde el push" de "entró por su cuenta". El hash va
    // detrás del query string, que es el orden que exige una URL válida.
    notifyUsers(supabase, recipientIds, creatorId, {
      title: `🎉 Nuevo sorteo en ${communityName || 'tu comunidad'}`,
      body:  title || 'Se ha creado un nuevo sorteo',
      url:   `/community/${communityId}?src=raffle#raffle-${raffleId}`,
      tag:   `raffle-banner-${raffleId}`,
    }).catch(() => {});
  } catch (err) {
    console.error('[community] notifyCommunityRaffleTargets error:', err);
  }
}

// Devuelve un mapa raffleId -> nº de targets ya mostrados (shown_at no nulo),
// para los "cartelitos" de progreso de banner en la UI (mismo patrón que
// notification_sent_count en eventos Premium/Ultra).
async function getBannerSentCounts(raffleIds) {
  const counts = {};
  if (!raffleIds.length) return counts;
  const { data, error } = await supabase
    .from('raffle_banner_targets')
    .select('raffle_id')
    .in('raffle_id', raffleIds)
    .not('shown_at', 'is', null);
  if (error) throw error;
  for (const row of data || []) {
    counts[row.raffle_id] = (counts[row.raffle_id] || 0) + 1;
  }
  return counts;
}

// Fase 119: agregación de likes por sorteo. Devuelve { likeCountByRaffle,
// likedRaffleIds } donde likedRaffleIds es el conjunto de ids que el
// usuario actual ha marcado con like — mismo patrón que
// community_event_likes/enrichEvents.
async function getRaffleLikeAggregates(raffleIds, currentUserId = null) {
  const likeCountByRaffle = {};
  const likedRaffleIds = new Set();
  if (!raffleIds.length) return { likeCountByRaffle, likedRaffleIds };
  const { data, error } = await supabase
    .from('community_raffle_likes')
    .select('raffle_id, user_id')
    .in('raffle_id', raffleIds);
  if (error) throw error;
  for (const row of data || []) {
    likeCountByRaffle[row.raffle_id] = (likeCountByRaffle[row.raffle_id] || 0) + 1;
    if (currentUserId && row.user_id === currentUserId) {
      likedRaffleIds.add(row.raffle_id);
    }
  }
  return { likeCountByRaffle, likedRaffleIds };
}

// Fase 122 — carga los premios de un lote de sorteos, con join a users
// para obtener los datos del ganador de cada premio. Devuelve un Map de
// raffleId → array de premios (ya con winner: {id,username,avatar_url}
// | null, en el shape que espera serializeRaffle). Los sorteos anteriores
// a la fase 122 no tienen filas aquí y salen como [] — el serializer
// entonces cae al winner legacy de community_raffles.winner_id.
async function fetchRafflePrizes(raffleIds) {
  const map = new Map();
  if (!raffleIds || !raffleIds.length) return map;
  const { data, error } = await supabase
    .from('community_raffle_prizes')
    .select('id, raffle_id, position, title, image_url, value_cents, winner:winner_id(id, username, avatar_url)')
    .in('raffle_id', raffleIds)
    .order('position', { ascending: true });
  if (error) throw error;
  for (const p of data || []) {
    if (!map.has(p.raffle_id)) map.set(p.raffle_id, []);
    // El caller pasa cada elemento a serializeRaffle tal cual; no hace
    // falta romper el shape aquí.
    map.get(p.raffle_id).push({
      id: p.id,
      position: p.position,
      title: p.title,
      image_url: p.image_url || null,
      value_cents: p.value_cents,
      winner: p.winner || null,
    });
  }
  return map;
}

function serializeRaffle(raffle, { participantCount, currentUserId, isEligible, bannerViewsSent, likeCount, likedByMe, prizes } = {}) {
  const tier = normalizeRaffleTier(raffle.tier);
  const tierMeta = RAFFLE_TIERS[tier];
  const hasBanner = tier === 'light' || tier === 'volt' || tier === 'community';

  // Fase 122 — array de premios. `prizes` viene ya con formato uniforme
  // desde el caller (position, title, image_url, value_cents, winner: {id,
  // username, avatar_url} | null). Se ordena por position siempre — un
  // caller descuidado que pase el array sin ordenar no debe romper la
  // UI. Si el caller no pasa prizes (rutas legacy que aún no se han
  // actualizado a la fase 122), se cae a [] y el frontend interpreta
  // "sorteo anterior a la fase de premios" y usa el winner legacy.
  const prizeArray = Array.isArray(prizes)
    ? [...prizes].sort((a, b) => (a.position || 0) - (b.position || 0))
    : [];

  // Winner "principal" para retrocompat con lo que ya existía en el
  // frontend (Boolean(raffle.winner) para saber si se sorteó, muestra
  // del ganador en CommunityPage/CommunityDetailPage/circleBadges).
  //   · Si hay premios (fase 122): el ganador del primer premio con
  //     winner asignado, o null si aún no se sorteó / no hubo elegibles.
  //   · Si no hay premios (sorteos anteriores): raffle.winner legacy
  //     como venía del JOIN winner:winner_id(...).
  const legacyWinner = raffle.winner || null;
  const firstPrizeWinner = prizeArray.find(p => p.winner)?.winner || null;
  const effectiveWinner = prizeArray.length > 0 ? firstPrizeWinner : legacyWinner;

  return {
    id: raffle.id,
    community_id: raffle.community_id,
    title: raffle.title,
    description: raffle.description,
    image_url: raffle.image_url,
    categories: Array.isArray(raffle.categories) ? raffle.categories : [],
    ends_at: raffle.ends_at,
    created_at: raffle.created_at,
    drawn_at: raffle.drawn_at,
    // Fase 122 — nuevos campos:
    //   · prizes: array completo (posición, título, foto, valoración,
    //     ganador). Siempre presente aunque esté vacío (raffle legacy).
    //   · is_drawn: bandera explícita — el frontend puede depender de
    //     esto en vez de `!!winner`, útil cuando el sorteo se ejecuta
    //     con menos elegibles que premios (drawn_at seteado pero
    //     algunos premios sin winner).
    prizes: prizeArray,
    is_drawn: !!raffle.drawn_at,
    winner: effectiveWinner,
    participant_count: participantCount ?? null,
    tier,
    tier_label: tierMeta.label,
    tier_rules: tierMeta.rules,
    price_cents: tierMeta.price_cents,
    banner_views_contracted: raffle.banner_views_contracted ?? null,
    banner_views_sent: hasBanner ? (bannerViewsSent ?? 0) : null,
    // Fase 119 — likes en sorteos, mismo shape que en eventos
    // (like_count + liked_by_current_user). Cuando el caller no los pasa
    // (rutas antiguas que no se hayan actualizado) se cae a 0/false para
    // no romper el frontend.
    like_count: likeCount ?? 0,
    liked_by_current_user: !!likedByMe,
    // Fase 112 — necesarios para pintar los botones de renovar/finalizar
    // publicidad del sorteo en CommunityDetailPage (solo los ve el creador).
    // banner_interested_only se prellena en el toggle de la página de
    // renovación para partir del mismo estado que el ciclo actual.
    banner_interested_only: !!raffle.banner_interested_only,
    promo_ended_at: raffle.promo_ended_at || null,
    is_creator: currentUserId ? raffle.creator_id === currentUserId : undefined,
    can_participate: currentUserId
      ? (raffle.creator_id !== currentUserId && (isEligible ?? true))
      : undefined,
  };
}

// ── Hilo de comunidad (posts de foto/vídeo/texto + comentarios) ────────────
// Solo el CREADOR de la comunidad puede publicar en el hilo; cualquier
// miembro puede comentar. Mismo criterio de pertenencia que el chat
// (requireCommunityMembership) y de creador que los sorteos.

function serializeCommunityPost(row, { commentCount = 0 } = {}) {
  return {
    id: row.id,
    community_id: row.community_id,
    type: row.type,
    content: row.content,
    media_url: row.media_url,
    created_at: row.created_at,
    creator: row.creator || null,
    comment_count: commentCount,
  };
}

function serializeCommunityPostComment(row) {
  return {
    id: row.id,
    post_id: row.post_id,
    content: row.content,
    created_at: row.created_at,
    user: row.user || null,
  };
}

// ── GET /api/community/communities/:id/posts — listar hilo ─────────────────
router.get('/communities/:id/posts', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const communityId = req.params.id;

  try {
    if (!(await requireCommunityMembership(communityId, userId))) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const { data, error } = await supabase
      .from('community_posts')
      .select(`
        id, community_id, type, content, media_url, created_at,
        creator:creator_id(id, username, avatar_url)
      `)
      .eq('community_id', communityId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const posts = data || [];
    const postIds = posts.map(p => p.id);
    const countByPost = new Map();
    if (postIds.length) {
      const { data: commentRows } = await supabase
        .from('community_post_comments')
        .select('post_id')
        .in('post_id', postIds);
      for (const c of commentRows || []) {
        countByPost.set(c.post_id, (countByPost.get(c.post_id) || 0) + 1);
      }
    }

    res.json({
      posts: posts.map(p => serializeCommunityPost(p, { commentCount: countByPost.get(p.id) || 0 })),
    });
  } catch (err) {
    console.error('[community] GET /communities/:id/posts', err);
    res.status(500).json({ error: `Failed to fetch posts: ${err.message || err}` });
  }
});

// ── Aviso de nueva publicación en el hilo a todos los miembros ─────────────
// Mismo patrón que broadcastEventUpdateToAttendees / broadcastCommunityMessage:
// broadcast por canal personal (aviso in-app instantáneo con la app abierta)
// + web-push (app en segundo plano/cerrada). Se filtra tanto por el
// silencio del hilo de esa comunidad en concreto (conversation_type
// 'community_thread', fase 97 — independiente del silencio del chat) como
// por el ajuste global "Silenciar hilos de comunidad"
// (users.mute_community_threads, fase 96), que aplica a todas las
// comunidades del usuario a la vez.
async function broadcastCommunityPostToMembers({ communityId, communityName, creatorId, creatorName, postId, body }) {
  try {
    const { data: members } = await supabase
      .from('community_members')
      .select('user_id')
      .eq('community_id', communityId)
      .neq('user_id', creatorId);

    const memberIds = (members || []).map(m => m.user_id);
    if (!memberIds.length) return memberIds;

    const broadcastPayload = {
      community_id:   communityId,
      community_name: communityName,
      creator_id:     creatorId,
      creator_name:   creatorName,
      post_id:        postId,
      body,
    };

    await Promise.allSettled(
      memberIds.map(uid =>
        supabase
          .channel(`community-post-notif-${uid}`)
          .send({ type: 'broadcast', event: 'new_community_post', payload: broadcastPayload })
      )
    );

    return memberIds;
  } catch (err) {
    console.error('[community] broadcastCommunityPostToMembers error:', err);
    return [];
  }
}

// ── POST /api/community/communities/:id/posts — publicar en el hilo ────────
// Solo el creador de la comunidad. Admite foto, vídeo o solo texto.
router.post('/communities/:id/posts', requireAuth, uploadCommunityPostMedia, async (req, res) => {
  const userId = req.user.id;
  const communityId = req.params.id;
  const content = req.body.content?.trim() || null;

  if (!content && !req.file) {
    return res.status(400).json({ error: 'Escribe un mensaje o adjunta una foto o vídeo' });
  }

  try {
    const { data: community } = await supabase
      .from('communities')
      .select('id, name, creator_id')
      .eq('id', communityId)
      .maybeSingle();

    if (!community) return res.status(404).json({ error: 'Comunidad no encontrada' });
    if (community.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el creador de la comunidad puede publicar en el hilo' });
    }

    let mediaUrl = null;
    let type = 'text';
    if (req.file) {
      type = mediaKindFromMimetype(req.file.mimetype) || 'photo';
      mediaUrl = await storeMedia({
        file: req.file,
        bucket: 'chat-images',
        objectName: `community-posts/${communityId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
    }

    const { data, error } = await supabase
      .from('community_posts')
      .insert({
        community_id: communityId,
        creator_id: userId,
        type,
        content,
        media_url: mediaUrl,
      })
      .select(`
        id, community_id, type, content, media_url, created_at,
        creator:creator_id(id, username, avatar_url)
      `)
      .single();

    if (error) throw error;

    // ── Aviso in-app instantáneo (broadcast) + push a los miembros ──────────
    const previewBody = content
      ? (content.length > 80 ? content.slice(0, 77) + '…' : content)
      : type === 'video' ? '🎬 Se ha publicado un vídeo' : '📷 Se ha publicado una foto';

    const memberIds = await broadcastCommunityPostToMembers({
      communityId,
      communityName: community.name || 'Comunidad',
      creatorId: userId,
      creatorName: data.creator?.username || 'El admin',
      postId: data.id,
      body: previewBody,
    });

    if (memberIds.length) {
      // No mandar el push a quien haya silenciado el HILO de esta comunidad
      // en concreto (conversation_type 'community_thread', fase 97 —
      // independiente del silencio del chat) NI a quien tenga activado el
      // silencio global de "hilos de comunidad" (users.mute_community_threads,
      // fase 96).
      const [mutedIds, globallyMutedIds] = await Promise.all([
        getMutedUserIds(supabase, 'community_thread', communityId, memberIds),
        getCommunityThreadMuteFilteredIds(memberIds),
      ]);
      const pushMemberIds = memberIds.filter(uid => !mutedIds.has(uid) && !globallyMutedIds.has(uid));

      notifyUsers(supabase, pushMemberIds, userId, {
        title: `📌 ${community.name || 'Comunidad'}`,
        body:  `${data.creator?.username || 'El admin'}: ${previewBody}`,
        url:   `/community/${communityId}`,
        tag:   `community-post-${communityId}`,
      }).catch(() => {});
    }

    res.status(201).json({ post: serializeCommunityPost(data, { commentCount: 0 }) });
  } catch (err) {
    console.error('[community] POST /communities/:id/posts', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to create post' });
  }
});

// ── DELETE /api/community/communities/:id/posts/:postId — borrar post ──────
// Solo el creador de la comunidad.
router.delete('/communities/:id/posts/:postId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { id: communityId, postId } = req.params;

  try {
    const { data: community } = await supabase
      .from('communities')
      .select('id, creator_id')
      .eq('id', communityId)
      .maybeSingle();

    if (!community) return res.status(404).json({ error: 'Comunidad no encontrada' });
    if (community.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el creador de la comunidad puede borrar publicaciones del hilo' });
    }

    const { error } = await supabase
      .from('community_posts')
      .delete()
      .eq('id', postId)
      .eq('community_id', communityId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[community] DELETE /communities/:id/posts/:postId', err);
    res.status(500).json({ error: err.message || 'Failed to delete post' });
  }
});

// ── GET /api/community/communities/:id/posts/:postId/comments ──────────────
router.get('/communities/:id/posts/:postId/comments', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { id: communityId, postId } = req.params;

  try {
    if (!(await requireCommunityMembership(communityId, userId))) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const { data: post } = await supabase
      .from('community_posts')
      .select('id')
      .eq('id', postId)
      .eq('community_id', communityId)
      .maybeSingle();
    if (!post) return res.status(404).json({ error: 'Publicación no encontrada' });

    const { data, error } = await supabase
      .from('community_post_comments')
      .select(`
        id, post_id, content, created_at,
        user:user_id(id, username, avatar_url)
      `)
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json({ comments: (data || []).map(serializeCommunityPostComment) });
  } catch (err) {
    console.error('[community] GET /communities/:id/posts/:postId/comments', err);
    res.status(500).json({ error: `Failed to fetch comments: ${err.message || err}` });
  }
});

// ── POST /api/community/communities/:id/posts/:postId/comments ─────────────
// Cualquier miembro de la comunidad puede comentar.
router.post('/communities/:id/posts/:postId/comments', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { id: communityId, postId } = req.params;
  const content = req.body.content?.trim();

  if (!content) return res.status(400).json({ error: 'El comentario no puede estar vacío' });
  if (content.length > 1000) return res.status(400).json({ error: 'El comentario es demasiado largo' });

  try {
    if (!(await requireCommunityMembership(communityId, userId))) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const { data: post } = await supabase
      .from('community_posts')
      .select('id')
      .eq('id', postId)
      .eq('community_id', communityId)
      .maybeSingle();
    if (!post) return res.status(404).json({ error: 'Publicación no encontrada' });

    const { data, error } = await supabase
      .from('community_post_comments')
      .insert({ post_id: postId, user_id: userId, content })
      .select(`
        id, post_id, content, created_at,
        user:user_id(id, username, avatar_url)
      `)
      .single();

    if (error) throw error;

    res.status(201).json({ comment: serializeCommunityPostComment(data) });
  } catch (err) {
    console.error('[community] POST /communities/:id/posts/:postId/comments', err);
    res.status(500).json({ error: err.message || 'Failed to create comment' });
  }
});

// ── DELETE /api/community/communities/:id/posts/:postId/comments/:commentId ─
// El autor del comentario o el creador de la comunidad pueden borrarlo.
router.delete('/communities/:id/posts/:postId/comments/:commentId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { id: communityId, postId, commentId } = req.params;

  try {
    const { data: community } = await supabase
      .from('communities')
      .select('id, creator_id')
      .eq('id', communityId)
      .maybeSingle();
    if (!community) return res.status(404).json({ error: 'Comunidad no encontrada' });

    const { data: comment } = await supabase
      .from('community_post_comments')
      .select('id, user_id, post_id')
      .eq('id', commentId)
      .eq('post_id', postId)
      .maybeSingle();
    if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });

    if (comment.user_id !== userId && community.creator_id !== userId) {
      return res.status(403).json({ error: 'No puedes borrar este comentario' });
    }

    const { error } = await supabase
      .from('community_post_comments')
      .delete()
      .eq('id', commentId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[community] DELETE /communities/:id/posts/:postId/comments/:commentId', err);
    res.status(500).json({ error: err.message || 'Failed to delete comment' });
  }
});

// ── POST /api/community/raffles/:id/like — toggle like en sorteo ─────────
// Réplica exacta de POST /events/:id/like. La tabla community_raffle_likes
// tiene PK compuesta (raffle_id, user_id), así que el "estado" del like es
// "existe la fila o no"; togglear es DELETE si existía, INSERT si no.
router.post('/raffles/:id/like', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    await ensurePublicProfile(req.user);

    const { data: raffle, error: raffleError } = await supabase
      .from('community_raffles')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (raffleError) throw raffleError;
    if (!raffle) return res.status(404).json({ error: 'Sorteo no encontrado' });

    const { data: existing, error: existingError } = await supabase
      .from('community_raffle_likes')
      .select('raffle_id')
      .eq('raffle_id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
      const { error } = await supabase
        .from('community_raffle_likes')
        .delete()
        .eq('raffle_id', id)
        .eq('user_id', userId);
      if (error) throw error;
      return res.json({ liked: false });
    }

    const { error } = await supabase
      .from('community_raffle_likes')
      .insert({ raffle_id: id, user_id: userId });
    if (error) throw error;
    res.json({ liked: true });
  } catch (err) {
    console.error('[community] POST /raffles/:id/like error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al cambiar el like') });
  }
});

// ── GET /api/community/raffles/ranking — histórico global de sorteos ──────
// Mismo contrato que GET /events/ranking pero para sorteos: se incluyen
// sorteos ya finalizados o ya sorteados (los "actuales" también aparecen),
// se limita a 300 filas priorizando los más recientes. Se usa en el modal
// de rankings de la sub-vista Sorteos.
router.get('/raffles/ranking', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const { data, error } = await supabase
      .from('community_raffles')
      .select(`
        id, community_id, creator_id, title, description, image_url,
        ends_at, drawn_at, created_at, tier, categories, banner_views_contracted,
        banner_interested_only, promo_ended_at,
        winner:winner_id(id, username, avatar_url),
        community:community_id(id, name, cover_image_url, categories)
      `)
      .order('created_at', { ascending: false })
      .limit(300);

    if (error) throw error;
    const raffles = data || [];

    // Cachea elegibles por (community_id, tier) — mismo patrón que /raffles.
    const eligibleCache = new Map();
    async function eligibleFor(communityId, tier) {
      const key = `${communityId}:${tier}`;
      if (!eligibleCache.has(key)) {
        eligibleCache.set(key, await getEligibleRaffleMembers(communityId, tier));
      }
      return eligibleCache.get(key);
    }

    const bannerRaffleIds = raffles
      .filter(r => ['light', 'volt', 'community'].includes(normalizeRaffleTier(r.tier)))
      .map(r => r.id);
    const bannerSentCounts = await getBannerSentCounts(bannerRaffleIds);
    const { likeCountByRaffle, likedRaffleIds } = await getRaffleLikeAggregates(
      raffles.map(r => r.id),
      userId,
    );
    // Fase 122 — premios (con winners joinados) de todos los sorteos de
    // este listado en una sola query. fetchRafflePrizes devuelve un Map
    // por raffle_id; los sorteos sin premios (pre-fase-122) salen [].
    const prizesByRaffle = await fetchRafflePrizes(raffles.map(r => r.id));

    const serialized = [];
    for (const r of raffles) {
      const tier = normalizeRaffleTier(r.tier);
      const eligibleIds = await eligibleFor(r.community_id, tier);
      const base = serializeRaffle(r, {
        participantCount: eligibleIds.length,
        currentUserId: userId,
        isEligible: eligibleIds.includes(userId),
        bannerViewsSent: bannerSentCounts[r.id] || 0,
        likeCount: likeCountByRaffle[r.id] || 0,
        likedByMe: likedRaffleIds.has(r.id),
        prizes: prizesByRaffle.get(r.id) || [],
      });
      serialized.push({
        ...base,
        community: r.community
          ? {
              id: r.community.id,
              name: r.community.name,
              cover_image_url: r.community.cover_image_url,
              categories: Array.isArray(r.community.categories) ? r.community.categories : [],
            }
          : null,
      });
    }

    res.json({ raffles: serialized });
  } catch (err) {
    console.error('[community] GET /raffles/ranking', err);
    res.status(500).json({ error: `Failed to fetch raffle ranking: ${err.message || err}` });
  }
});

// ── GET /api/community/raffles — descubrimiento global de sorteos ──────────
// Lista todos los sorteos ACTIVOS (aún sin realizarse y con ends_at futuro)
// de todas las comunidades para la vista "Actividades → Sorteos" del menú
// principal (CommunityPage). participant_count = nº de miembros elegibles
// según el tier del sorteo, mismo criterio que la lista por-comunidad de
// justo debajo. Se usa el cliente de servicio para saltar la RLS de
// community_raffles y poder mostrar sorteos de comunidades a las que el
// usuario aún no pertenece, mismo criterio que ya usa GET /communities
// para marcar `has_active_raffle`.
router.get('/raffles', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('community_raffles')
      .select(`
        id, community_id, creator_id, title, description, image_url,
        ends_at, drawn_at, created_at, tier, categories, banner_views_contracted,
        banner_interested_only, promo_ended_at,
        winner:winner_id(id, username, avatar_url),
        community:community_id(id, name, cover_image_url, categories)
      `)
      .is('drawn_at', null)
      .gt('ends_at', nowIso)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const raffles = data || [];

    // Los elegibles se cachean por (community_id, tier): la misma comunidad
    // puede tener varios sorteos activos del mismo tier y no queremos
    // repetir la consulta a community_members / users / colaboraciones.
    const eligibleCache = new Map();
    async function eligibleFor(communityId, tier) {
      const key = `${communityId}:${tier}`;
      if (!eligibleCache.has(key)) {
        eligibleCache.set(key, await getEligibleRaffleMembers(communityId, tier));
      }
      return eligibleCache.get(key);
    }

    const bannerRaffleIds = raffles
      .filter(r => ['light', 'volt', 'community'].includes(normalizeRaffleTier(r.tier)))
      .map(r => r.id);
    const bannerSentCounts = await getBannerSentCounts(bannerRaffleIds);
    const { likeCountByRaffle, likedRaffleIds } = await getRaffleLikeAggregates(
      raffles.map(r => r.id),
      userId,
    );
    // Fase 122 — premios (con winners joinados) de todos los sorteos de
    // este listado en una sola query. fetchRafflePrizes devuelve un Map
    // por raffle_id; los sorteos sin premios (pre-fase-122) salen [].
    const prizesByRaffle = await fetchRafflePrizes(raffles.map(r => r.id));

    const serialized = [];
    for (const r of raffles) {
      const tier = normalizeRaffleTier(r.tier);
      const eligibleIds = await eligibleFor(r.community_id, tier);
      const base = serializeRaffle(r, {
        participantCount: eligibleIds.length,
        currentUserId: userId,
        isEligible: eligibleIds.includes(userId),
        bannerViewsSent: bannerSentCounts[r.id] || 0,
        likeCount: likeCountByRaffle[r.id] || 0,
        likedByMe: likedRaffleIds.has(r.id),
        prizes: prizesByRaffle.get(r.id) || [],
      });
      serialized.push({
        ...base,
        // Datos mínimos de la comunidad para pintar la tarjeta de
        // descubrimiento sin necesidad de segundas llamadas. También se
        // usan las categorías de la comunidad como fallback para el
        // matching de intereses cuando el sorteo no las trae (mismo
        // criterio que usa el backend en getInterestedUserIdSet).
        community: r.community
          ? {
              id: r.community.id,
              name: r.community.name,
              cover_image_url: r.community.cover_image_url,
              categories: Array.isArray(r.community.categories) ? r.community.categories : [],
            }
          : null,
      });
    }

    res.json({ raffles: serialized });
  } catch (err) {
    console.error('[community] GET /raffles', err);
    res.status(500).json({ error: `Failed to fetch raffles: ${err.message || err}` });
  }
});

// ── GET /api/community/communities/:id/raffles — listar sorteos ────────────
router.get('/communities/:id/raffles', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const communityId = req.params.id;

  try {
    // Los sorteos deben verse al entrar en la comunidad aunque no seas
    // miembro todavía (para animar a unirse); solo crear/sortear requiere
    // pertenecer/ser el creador, y eso ya se comprueba en esas rutas.
    const { data, error } = await supabase
      .from('community_raffles')
      .select(`
        id, community_id, creator_id, title, description, image_url,
        ends_at, drawn_at, created_at, tier, categories, banner_views_contracted,
        banner_interested_only, promo_ended_at,
        winner:winner_id(id, username, avatar_url)
      `)
      .eq('community_id', communityId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const raffles = data || [];
    const uniqueTiers = [...new Set(raffles.map(r => normalizeRaffleTier(r.tier)))];
    const eligibleByTier = {};
    for (const tier of uniqueTiers) {
      eligibleByTier[tier] = await getEligibleRaffleMembers(communityId, tier);
    }

    const bannerRaffleIds = raffles
      .filter(r => ['light', 'volt', 'community'].includes(normalizeRaffleTier(r.tier)))
      .map(r => r.id);
    const bannerSentCounts = await getBannerSentCounts(bannerRaffleIds);
    const { likeCountByRaffle, likedRaffleIds } = await getRaffleLikeAggregates(
      raffles.map(r => r.id),
      userId,
    );
    // Fase 122 — premios (con winners joinados) de todos los sorteos de
    // la comunidad. Un solo query en vez de N.
    const prizesByRaffle = await fetchRafflePrizes(raffles.map(r => r.id));

    res.json({
      raffles: raffles.map(r => {
        const tier = normalizeRaffleTier(r.tier);
        const eligibleIds = eligibleByTier[tier] || [];
        return serializeRaffle(r, {
          participantCount: eligibleIds.length,
          currentUserId: userId,
          isEligible: eligibleIds.includes(userId),
          bannerViewsSent: bannerSentCounts[r.id] || 0,
          likeCount: likeCountByRaffle[r.id] || 0,
          likedByMe: likedRaffleIds.has(r.id),
          prizes: prizesByRaffle.get(r.id) || [],
        });
      }),
    });
  } catch (err) {
    console.error('[community] GET /communities/:id/raffles', err);
    res.status(500).json({ error: `Failed to fetch raffles: ${err.message || err}` });
  }
});

// ── POST /api/community/communities/:id/raffles — crear sorteo ─────────────
// Solo el CREADOR de la comunidad (no vale con ser admin/moderador promovido).
router.post('/communities/:id/raffles', requireAuth, uploadRaffleAssets, async (req, res) => {
  const userId = req.user.id;
  const communityId = req.params.id;
  const { title, description, ends_at, tier, banner_views_contracted, banner_interested_only } = req.body;

  if (!title?.trim()) return res.status(400).json({ error: 'El título es obligatorio' });
  if (!ends_at) return res.status(400).json({ error: 'La fecha de fin es obligatoria' });
  if (tier && !RAFFLE_TIER_KEYS.includes(tier)) {
    return res.status(400).json({ error: 'Tipo de sorteo no válido' });
  }
  const raffleTier = normalizeRaffleTier(tier);

  const categories = parseCategories(req.body.categories);
  // Fase 120: las categorías del sorteo son obligatorias (paridad con
  // eventos y para eliminar el fallback a las categorías de la comunidad
  // en el matching de intereses). El schema también lo impone con un
  // CHECK, pero validamos aquí antes para dar un mensaje de error útil.
  if (categories.length < 1) {
    return res.status(400).json({ error: 'Elige al menos una categoría para el sorteo' });
  }
  if (categories.length > MAX_CATEGORIES) {
    return res.status(400).json({ error: `Puedes elegir hasta ${MAX_CATEGORIES} categorías` });
  }

  // Fase 122 — premios del sorteo. Al menos uno es obligatorio (todo
  // sorteo tiene que tener algo que dar). El cliente manda:
  //
  //   · req.body.prizes: JSON string, array de
  //       {title, value_cents, has_image, image_index}.
  //     `image_index` es el índice dentro de req.files.prize_image
  //     (array) — permite mezclar premios con y sin foto en el mismo
  //     request sin arrastrar la incomodidad de "el i-ésimo premio se
  //     corresponde con el i-ésimo fichero".
  //   · req.files.prize_image: array de ficheros subidos (multer con
  //     .fields, ver uploadRaffleAssets arriba).
  //
  // Validaciones:
  //   · 1..PRIZE_MAX_PER_RAFFLE. El techo protege contra abuso y limita
  //     el tiempo del sorteo (elegir N ganadores sin reemplazo es O(N)).
  //   · Cada premio necesita título (1..120 chars, mismo rango que el
  //     título del sorteo). value_cents es opcional, entero no negativo.
  //   · image_index (si viene) tiene que apuntar a un fichero existente.
  const PRIZE_MAX_PER_RAFFLE = 10;
  let parsedPrizes;
  try {
    parsedPrizes = JSON.parse(req.body.prizes || '[]');
  } catch {
    return res.status(400).json({ error: 'Los premios llegaron en formato inválido' });
  }
  if (!Array.isArray(parsedPrizes) || parsedPrizes.length < 1) {
    return res.status(400).json({ error: 'Añade al menos un premio al sorteo' });
  }
  if (parsedPrizes.length > PRIZE_MAX_PER_RAFFLE) {
    return res.status(400).json({ error: `Puedes añadir hasta ${PRIZE_MAX_PER_RAFFLE} premios por sorteo` });
  }
  const prizeImageFiles = (req.files && req.files.prize_image) || [];
  const cleanPrizes = [];
  for (let i = 0; i < parsedPrizes.length; i++) {
    const raw = parsedPrizes[i] || {};
    const pTitle = String(raw.title || '').trim();
    if (!pTitle || pTitle.length > 120) {
      return res.status(400).json({ error: `Premio ${i + 1}: el nombre es obligatorio (máx. 120 caracteres)` });
    }
    let pValueCents = null;
    if (raw.value_cents != null && raw.value_cents !== '' && raw.value_cents !== false) {
      const parsedValue = Number.parseInt(raw.value_cents, 10);
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        return res.status(400).json({ error: `Premio ${i + 1}: la valoración económica no es válida` });
      }
      pValueCents = parsedValue;
    }
    let pImageFile = null;
    if (raw.has_image) {
      const idx = Number.parseInt(raw.image_index, 10);
      if (!Number.isFinite(idx) || idx < 0 || idx >= prizeImageFiles.length) {
        return res.status(400).json({ error: `Premio ${i + 1}: falta la foto adjunta` });
      }
      pImageFile = prizeImageFiles[idx];
    }
    cleanPrizes.push({ title: pTitle, value_cents: pValueCents, imageFile: pImageFile });
  }

  const endsAtDate = new Date(ends_at);
  if (Number.isNaN(endsAtDate.getTime())) {
    return res.status(400).json({ error: 'La fecha de fin no es válida' });
  }
  if (endsAtDate <= new Date()) {
    return res.status(400).json({ error: 'La fecha de fin debe ser en el futuro' });
  }

  // Sorteo Light: visualizaciones de banner a contratar, entre BANNER_VIEWS_MIN
  // y BANNER_VIEWS_MAX (rango propio del sorteo, distinto del notification_count
  // de eventos Premium/Ultra — ver POST /community/events más arriba). El
  // mínimo de facturación (a partir de cuántos banners realmente enseñados se
  // empieza a cobrar) es más bajo que BANNER_VIEWS_MIN y vive solo en el
  // frontend (CHARGE_MIN en RaffleAdAudiencePage.jsx), no aquí. Debe coincidir
  // con la constraint de la BD (phase106_raffle_banner_views_range.sql: CHECK
  // banner_views_contracted BETWEEN 1000 AND 100000), o si no la fila se
  // rechaza en el INSERT aunque haya pasado esta validación de la API.
  const resolvedInterestedOnly = raffleTier === 'light' && String(banner_interested_only) === 'true';
  let resolvedBannerViews = null;
  if (raffleTier === 'light') {
    const parsedViews = Number.parseInt(banner_views_contracted, 10);
    if (!Number.isFinite(parsedViews) || parsedViews < BANNER_VIEWS_MIN || parsedViews > BANNER_VIEWS_MAX) {
      return res.status(400).json({
        error: `Elige cuántas visualizaciones quieres contratar (entre ${BANNER_VIEWS_MIN} y ${BANNER_VIEWS_MAX})`,
      });
    }
    resolvedBannerViews = parsedViews;
  }

  try {
    const { data: community } = await supabase
      .from('communities')
      .select('id, creator_id, name, categories')
      .eq('id', communityId)
      .maybeSingle();

    if (!community) return res.status(404).json({ error: 'Comunidad no encontrada' });
    if (community.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el creador de la comunidad puede crear un sorteo' });
    }

    // Fase 121: tope de actividades vivas por comunidad. Se aplica solo
    // en creación (renovaciones no cuentan). Va aquí — después de
    // confirmar que somos el creador — para no filtrar información con
    // un 400 sobre una comunidad que no es nuestra.
    const activeCount = await getActiveActivityCount(communityId);
    if (activeCount >= ACTIVE_ACTIVITY_LIMIT_PER_COMMUNITY) {
      return res.status(400).json(activityCapError(activeCount));
    }

    // Pool real de la audiencia Light (usuarios notificables, excluyendo al
    // creador y a los miembros de la propia comunidad; si
    // resolvedInterestedOnly, restringido además a quien tenga intereses
    // afines a las categorías de la comunidad). Se calcula ANTES de crear
    // el sorteo para decidir si hay que bloquear la contratación.
    //
    // Política de bloqueo (debe reflejar exactamente blockedByFilterShortfall
    // en RaffleAdAudiencePage.jsx): SOLO se bloquea si el filtro de
    // intereses está activo y el pool resultante no llega al mínimo
    // contratable (BANNER_VIEWS_MIN). SIN filtro, se deja crear el sorteo
    // aunque el pool sea menor que lo contratado (incluso menor que
    // BANNER_VIEWS_MIN) — esto favorece el crecimiento de la app cuando
    // aún tiene pocos usuarios; assignRaffleBannerTargets ya se encarga de
    // repartir como mucho tantos banners como quepan en el pool real.
    // Categorías efectivas del sorteo para clasificar interesados: las del
    // propio sorteo si el creador eligió (fase 116), o las de la comunidad
    // como fallback — mismo esquema que ya usan los eventos con sus propias
    // categorías. Se calcula una vez y se usa en TODO lo que dependa de
    // "interés": pool Light filtrado, prioridad de reparto y tagging de
    // matched_interest (dashboard).
    const effectiveCategories = resolveRaffleEffectiveCategories(categories, community.categories);

    let lightAudienceIds = null;
    let lightPriorityIds = null;
    if (raffleTier === 'light') {
      const { ids, categoriesDefined } = await getRaffleLightAudienceIds(communityId, userId, { interestedOnly: resolvedInterestedOnly, raffleCategories: effectiveCategories });
      if (resolvedInterestedOnly && !categoriesDefined) {
        return res.status(400).json({ error: 'Ni el sorteo ni la comunidad tienen categorías de intereses definidas: no se puede filtrar por interesados' });
      }
      if (resolvedInterestedOnly && ids.length < BANNER_VIEWS_MIN) {
        return res.status(400).json({
          error: `Solo hay ${ids.length} usuarios interesados disponibles, por debajo del mínimo contratable (${BANNER_VIEWS_MIN}): quita el filtro para poder crear el sorteo`,
        });
      }
      lightAudienceIds = ids;
      // Si el pool ya viene filtrado a "solo interesados" coincide entero
      // con la categoría, así que no hace falta calcular prioridad (todos
      // están al mismo nivel). Si el pool es el general (sin filtro), sí se
      // calcula qué subconjunto coincide categoría de sorteo con categoría
      // de usuario, para priorizarlo en el reparto del banner.
      if (!resolvedInterestedOnly) {
        lightPriorityIds = await getCategoryMatchingUserIds(lightAudienceIds, effectiveCategories);
      }
    }

    // Fase 122 — con multer.fields() la portada llega como
    // req.files.image[0] en vez de req.file. Se mantiene el mismo path
    // de almacenamiento y opciones.
    const coverFile = req.files && Array.isArray(req.files.image) ? req.files.image[0] : null;
    let imageUrl = null;
    if (coverFile) {
      imageUrl = await storeImage({
        file: coverFile,
        objectName: `raffle-images/${communityId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fallbackMaxLength: 6000000,
      });
    }

    const { data, error } = await supabase
      .from('community_raffles')
      .insert({
        community_id: communityId,
        creator_id: userId,
        title: title.trim(),
        description: description?.trim() || null,
        image_url: imageUrl,
        ends_at: endsAtDate.toISOString(),
        tier: raffleTier,
        categories,
        banner_views_contracted: resolvedBannerViews,
        banner_interested_only: resolvedInterestedOnly,
      })
      .select('id, community_id, creator_id, title, description, image_url, ends_at, drawn_at, created_at, tier, categories, banner_views_contracted, banner_interested_only')
      .single();

    if (error) throw error;

    // Fase 122 — subir imágenes de premios (secuencial para no saturar
    // Supabase Storage con N uploads simultáneos y para preservar el
    // orden por si hay que retrasar el rate-limit) y luego insertar las
    // N filas de community_raffle_prizes en un solo batch. La position
    // 1-based la asigna el server aquí — el cliente NO manda position:
    // el orden de `cleanPrizes` es la fuente de verdad y así no hay
    // forma de que dos premios lleguen con la misma position (y de
    // esquivar el UNIQUE del schema).
    //
    // Si algo falla a mitad, la fila del raffle queda creada sin premios
    // — no ideal, pero preferible a duplicar el raffle si el retry sube
    // el POST entero. La regla "todo raffle tiene ≥1 premio" se
    // garantiza en creación (validado arriba); esto solo se saltaría si
    // falla el upload de una foto, y en ese caso el organizador va a
    // volver a intentar, no arreglar filas huérfanas.
    const prizeRows = [];
    for (let i = 0; i < cleanPrizes.length; i++) {
      const p = cleanPrizes[i];
      let prizeImageUrl = null;
      if (p.imageFile) {
        prizeImageUrl = await storeImage({
          file: p.imageFile,
          objectName: `raffle-prizes/${data.id}/${i}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fallbackMaxLength: 6000000,
        });
      }
      prizeRows.push({
        raffle_id: data.id,
        position: i + 1,
        title: p.title,
        image_url: prizeImageUrl,
        value_cents: p.value_cents,
      });
    }
    const { data: insertedPrizes, error: prizesErr } = await supabase
      .from('community_raffle_prizes')
      .insert(prizeRows)
      .select('id, position, title, image_url, value_cents, winner_id');
    if (prizesErr) throw prizesErr;
    // Los premios recién creados aún no tienen ganador — se le pasan al
    // serializer con winner:null para que la respuesta ya lleve el array
    // completo sin un round-trip extra.
    const prizesForResponse = (insertedPrizes || [])
      .sort((a, b) => a.position - b.position)
      .map(p => ({ ...p, winner: null }));

    // Fase 111 — foto de "quién estaba interesado" en el instante de crear
    // el sorteo, para etiquetar cada target (ver assignRaffleBannerTargets
    // → matched_interest y el dashboard de publicidad). Una sola consulta,
    // compartida por los tres tiers. Se clasifica por las categorías
    // efectivas del sorteo (propias si tiene, si no las de la comunidad —
    // ver resolveRaffleEffectiveCategories arriba); si no hay ni unas ni
    // otras devuelve null y los targets quedan sin clasificar.
    const interestedIds = await getInterestedUserIdSet(effectiveCategories);

    if (raffleTier === 'light' && resolvedBannerViews) {
      const targetIds = await assignRaffleBannerTargets(data.id, userId, resolvedBannerViews, lightAudienceIds, lightPriorityIds, interestedIds);
      await notifyCommunityRaffleTargets({
        raffleId: data.id, communityId, communityName: community.name,
        creatorId: userId, title: data.title, tier: raffleTier, targetIds,
      });
    } else if (raffleTier === 'volt') {
      const targetIds = await assignRaffleBannerTargets(data.id, userId, null, null, null, interestedIds);
      await notifyCommunityRaffleTargets({
        raffleId: data.id, communityId, communityName: community.name,
        creatorId: userId, title: data.title, tier: raffleTier, targetIds,
      });
    } else if (raffleTier === 'community') {
      const memberIds = await getCommunityMemberIdsForBanner(communityId, userId);
      const targetIds = await assignRaffleBannerTargets(data.id, userId, null, memberIds, null, interestedIds);
      // Aquí memberIds y targetIds son el mismo conjunto (el pool YA estaba
      // restringido a los miembros), así que se lo pasamos ya calculado a
      // notifyCommunityRaffleTargets para no repetir la consulta.
      await notifyCommunityRaffleTargets({
        raffleId: data.id, communityId, communityName: community.name,
        creatorId: userId, title: data.title, tier: raffleTier, targetIds, memberIds,
      });
    }

    const eligibleIds = await getEligibleRaffleMembers(communityId, raffleTier);
    res.status(201).json({
      raffle: serializeRaffle({ ...data, winner: null }, {
        participantCount: eligibleIds.length,
        currentUserId: userId,
        isEligible: eligibleIds.includes(userId),
        bannerViewsSent: 0,
        likeCount: 0,
        likedByMe: false,
        prizes: prizesForResponse,
      }),
    });
  } catch (err) {
    console.error('[community] POST /communities/:id/raffles', err);
    res.status(500).json({ error: err.message || 'Failed to create raffle' });
  }
});

// ── GET /api/community/raffle-banner — banner volador pendiente ────────────
// Comprueba si el usuario autenticado es uno de los "elegidos" (ver
// assignRaffleBannerTargets) para ver el banner volador de algún sorteo
// Community, Light o Volt todavía activo, y en tal caso lo consume
// (shown_at = ahora) para que no se le vuelva a mostrar por ese sorteo. Se
// llama al entrar en el menú principal. Como mucho se sirve una avioneta
// por usuario cada BANNER_COOLDOWN_MS (15 min), para no saturarle si entra
// varias veces seguidas a la app.
const BANNER_COOLDOWN_MS = 15 * 60 * 1000;

router.get('/raffle-banner', requireAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    // Cooldown global (todos los tiers comparten el mismo límite de 15 min):
    // miramos el último shown_at del usuario en CUALQUIER sorteo, no solo en
    // el candidato que le tocaría ahora, para no reventar el límite solo
    // porque cambiemos de tier o de sorteo en la siguiente entrada.
    const { data: lastShownRow, error: lastShownErr } = await supabase
      .from('raffle_banner_targets')
      .select('shown_at')
      .eq('user_id', userId)
      .not('shown_at', 'is', null)
      .order('shown_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastShownErr) throw lastShownErr;

    if (lastShownRow?.shown_at) {
      const elapsed = Date.now() - new Date(lastShownRow.shown_at).getTime();
      if (elapsed < BANNER_COOLDOWN_MS) {
        return res.json({ banner: null });
      }
    }

    const { data: pending, error } = await supabase
      .from('raffle_banner_targets')
      .select(`
        id, created_at,
        raffle:raffle_id(
          id, community_id, title, ends_at, drawn_at, tier, image_url, banner_views_contracted, banner_interested_only, promo_ended_at,
          community:community_id(id, name, categories)
        )
      `)
      .eq('user_id', userId)
      .is('shown_at', null)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Solo cuentan sorteos que siguen activos (no sorteados, no terminados
    // y con la promoción abierta — fase 112). Si el sorteo ya terminó o su
    // reparto se cerró antes de tiempo, se descarta sin mostrarlo pero
    // tampoco se "gasta" la visualización de otro sorteo por error.
    const now = new Date();
    const activeRows = (pending || []).filter(row => {
      const raffle = row.raffle;
      return raffle
        && !raffle.drawn_at
        && !raffle.promo_ended_at
        && new Date(raffle.ends_at) > now;
    });

    // Comunidades de las que el usuario es miembro: dentro de cada tier, un
    // sorteo cuya comunidad sea una de las suyas tiene prioridad sobre uno
    // de una comunidad ajena (Community siempre lo es, ya que su pool son
    // los propios miembros; Light y Volt pueden o no serlo).
    const { data: memberships, error: memErr } = await supabase
      .from('community_members')
      .select('community_id')
      .eq('user_id', userId);
    if (memErr) throw memErr;
    const ownCommunityIds = new Set((memberships || []).map(m => m.community_id));

    // Intereses propios del usuario — se usan SOLO como segundo criterio de
    // prioridad dentro del tier 'volt' (ver pickWithinTier más abajo), para
    // no tocar la prioridad ya existente de comunidad propia ni la de
    // Community > Light > Volt entre tiers.
    const { data: selfUser, error: selfErr } = await supabase
      .from('users')
      .select('interests')
      .eq('id', userId)
      .maybeSingle();
    if (selfErr) throw selfErr;
    const ownInterests = new Set((selfUser?.interests || []).filter(Boolean));

    // ── Anti-inanición ─────────────────────────────────────────────────────
    // La prioridad por intereses de arriba, aplicada sin más, puede hacer
    // que un sorteo de categoría popular le "robe" sistemáticamente la
    // pantalla a otros sorteos del mismo tier cada vez que compitan por el
    // mismo usuario, dejando a estos últimos sin alcanzar nunca sus
    // visualizaciones (contratadas, en Light) aunque tengan targets
    // asignados. Para evitarlo, el boost por intereses se evalúa en
    // GRUPOS FIJOS de tamaño BOOST_GROUP_SIZE=3 (ver lib/adaptiveBoost.js),
    // ordenados de más a menos necesitado:
    //   - "Necesitado" = peor ratio de visualizaciones conseguidas entre
    //     las contratadas (Light) o menos visualizaciones servidas hasta
    //     ahora (Volt, que no tiene aforo contratado con el que calcular un
    //     ratio).
    //   - Se comprueba el PRIMER grupo de 3 (los más necesitados); si
    //     ninguno coincide con los intereses del usuario, se pasa al
    //     SIGUIENTE grupo de 3, y así sucesivamente — en vez de tener un
    //     único grupo de tamaño variable, o de saltar directamente a "todo
    //     el resto" sin respetar el orden de necesidad (ver pickWithinTier).
    // Dentro de un mismo grupo de 3, si varios coinciden a la vez con los
    // intereses del usuario, gana el de PEOR ratio (más rezagado). Entre
    // sorteos que nunca coinciden con categorías de ningún usuario, no hay
    // boost posible y compiten en igualdad (orden cronológico de
    // asignación), como siempre.
    async function computeBoostRaffleInfo(tier, rows) {
      const uniqueRaffles = new Map();
      for (const row of rows) {
        if (!uniqueRaffles.has(row.raffle.id)) uniqueRaffles.set(row.raffle.id, row.raffle);
      }
      const raffleList = [...uniqueRaffles.values()];
      if (raffleList.length <= 1) {
        const ratioById = new Map(raffleList.map(r => [r.id, 0]));
        return { sortedIds: raffleList.map(r => r.id), ratioById };
      }

      const raffleIds = raffleList.map(r => r.id);
      const { data: shownRows, error: shownErr } = await supabase
        .from('raffle_banner_targets')
        .select('raffle_id')
        .in('raffle_id', raffleIds)
        .not('shown_at', 'is', null);
      if (shownErr) throw shownErr;

      const shownCounts = new Map();
      for (const row of shownRows || []) {
        shownCounts.set(row.raffle_id, (shownCounts.get(row.raffle_id) || 0) + 1);
      }

      const stats = raffleList.map(r => {
        const shown = shownCounts.get(r.id) || 0;
        const contracted = tier === 'light' ? (r.banner_views_contracted || null) : null;
        // En Light, el ratio es visualizaciones servidas / contratadas
        // (cuanto más bajo, más necesitado). En Volt no hay aforo
        // contratado, así que se usa directamente lo servido hasta ahora.
        const ratio = contracted ? shown / contracted : shown;
        return { id: r.id, ratio };
      });

      stats.sort((a, b) => a.ratio - b.ratio);
      const ratioById = new Map(stats.map(s => [s.id, s.ratio]));
      return { sortedIds: stats.map(s => s.id), ratioById };
    }

    // Dentro de las filas de un mismo tier, prioriza la primera (por orden
    // cronológico de asignación) cuya comunidad sea del propio usuario; si
    // ninguna lo es, cae de vuelta a la primera disponible de ese tier.
    //
    // Para los tiers 'volt' y 'light' se añade un criterio intermedio:
    // paginación por GRUPOS FIJOS de 3 sorteos (ver computeBoostRaffleInfo),
    // ordenados de más a menos necesitado por ratio de visualizaciones
    // conseguidas / contratadas ascendente:
    //   - Grupo de los 3 más necesitados (peor ratio). Si alguno coincide
    //     categoría con los intereses del usuario, gana el de peor ratio de
    //     entre esos matches.
    //   - Si ninguno del grupo coincide categoría, gana igualmente el de
    //     peor ratio del grupo — el mecanismo por defecto es "worst-ratio",
    //     el match solo lo sobrescribe cuando lo hay. Excepción: los
    //     sorteos con banner_interested_only NO se pueden servir a un
    //     usuario que no matchea (sería contradecir el filtro contratado),
    //     así que se descartan del grupo. Si al descartarlos queda alguno
    //     no restringido, gana el peor ratio de los que quedan.
    //   - Solo si el grupo entero es banner_interested_only y el usuario
    //     no matchea con NINGUNO de ellos se pasa al SIGUIENTE grupo de 3
    //     (los 3 siguientes por ratio ascendente), y así sucesivamente
    //     hasta agotar la lista.
    //   - Si ningún grupo llega a resolver (poco probable en la práctica),
    //     cae al primero disponible por orden cronológico (fallback).
    async function pickWithinTier(tier) {
      const rows = activeRows.filter(row => normalizeRaffleTier(row.raffle.tier) === tier);
      if (!rows.length) return null;
      const ownCommunityRow = rows.find(row => ownCommunityIds.has(row.raffle.community_id));
      if (ownCommunityRow) return ownCommunityRow;
      if ((tier === 'volt' || tier === 'light') && ownInterests.size) {
        const { sortedIds, ratioById } = await computeBoostRaffleInfo(tier, rows);
        const matchesCategory = row => (row.raffle.community?.categories || []).some(cat => ownInterests.has(cat));
        const isRestricted = row => row.raffle.banner_interested_only === true;
        const rowsById = new Map(rows.map(row => [row.raffle.id, row]));

        const picked = pickRaffleFromRatioGroups({
          sortedIds,
          rowsById,
          ratioById,
          matchesCategory,
          isRestricted,
          groupSize: BOOST_GROUP_SIZE,
        });
        if (picked) return picked;
      }
      return rows[0];
    }

    // 1) Máxima prioridad: si el usuario tiene un banner Community
    //    pendiente, es ese el que se sirve. La prioridad de comunidad
    //    propia dentro del tier es aquí un no-op, ya que todo Community
    //    pertenece por definición a la comunidad del usuario (su pool son
    //    los propios miembros).
    let candidate = await pickWithinTier('community');

    // 2) Si el usuario no tiene ningún Community pendiente (puede que no le
    //    haya tocado ninguno, o que ya se le haya mostrado el suyo en una
    //    entrada anterior), puede recibir su Light pendiente con
    //    normalidad (con prioridad de comunidad propia dentro del propio
    //    tier). La prioridad de Community sobre Light es PERSONAL, no un
    //    bloqueo global: a otro usuario le puede tocar su Light aunque a un
    //    tercero todavía le quede un Community pendiente por repartir.
    if (!candidate) {
      candidate = await pickWithinTier('light');
    }

    // 3) Si tampoco tiene ningún Light pendiente, se le sirve su Volt
    //    pendiente (misma lógica de prioridad personal que en el paso 2,
    //    con prioridad de comunidad propia dentro del tier).
    if (!candidate) {
      candidate = await pickWithinTier('volt');
    }

    if (!candidate) return res.json({ banner: null });

    // Guarda .is('shown_at', null) + .select(): si dos requests concurrentes
    // del mismo usuario (doble tap, retry de red) llegan a la vez, ambas
    // pueden elegir el mismo candidato en el SELECT de arriba (todavía no
    // marcado), pero aquí solo UNA gana el UPDATE — la fila ya no cumple
    // shown_at IS NULL para la segunda. Antes no había guarda: las dos
    // podían "ganar" el update (uno sobrescribiendo el timestamp del otro),
    // sin corromper datos pero sirviendo el banner dos veces sin necesidad.
    const { data: updatedRows, error: updateShownErr } = await supabase
      .from('raffle_banner_targets')
      .update({ shown_at: now.toISOString() })
      .eq('id', candidate.id)
      .is('shown_at', null)
      .select('id');
    if (updateShownErr) throw updateShownErr;
    if (!updatedRows?.length) {
      // Perdió la carrera: otra request ya lo marcó como mostrado justo
      // antes. No se sirve nada en este intento — la próxima entrada a la
      // app recalculará el siguiente candidato con normalidad.
      return res.json({ banner: null });
    }

    res.json({
      banner: {
        raffle_id: candidate.raffle.id,
        community_id: candidate.raffle.community_id,
        community_name: candidate.raffle.community?.name || 'Comunidad',
        title: candidate.raffle.title,
        tier: normalizeRaffleTier(candidate.raffle.tier),
        image_url: candidate.raffle.image_url || null,
      },
    });
  } catch (err) {
    console.error('[community] GET /raffle-banner', err);
    res.status(500).json({ error: err.message || 'Failed to fetch raffle banner' });
  }
});

// ── POST /api/community/communities/:id/raffles/:raffleId/draw — sortear ───
// Solo el creador, y solo una vez pasada la fecha de fin.
// ══════════════════════════════════════════════════════════════════════════
// Fase 111 — Atribución de clicks y dashboard de publicidad
// ══════════════════════════════════════════════════════════════════════════

// ── POST /api/community/events/:id/ad-click ────────────────────────────────
// Registra que el usuario autenticado abrió el evento DESDE una notificación
// (push promocional del pacing con ?src=promo, o aviso de comunidad con
// ?src=community — ver buildPayload en jobs/eventPromoPacing.js y POST
// /events). Lo llama EventDetailPage al montarse si detecta el parámetro.
//
// Es idempotente y anti-inflación por construcción: solo se marca la fila
// (event_id, user_id) que YA existe en event_promo_notifications, es decir,
// solo si a ese usuario se le envió realmente esa notificación. Si alguien
// se pasa el enlace con ?src=promo a un amigo, o el propio usuario recarga
// la página cinco veces, no hay fila que marcar o ya está marcada: no suma.
// Se cuenta el PRIMER click, no las visitas repetidas — la métrica es
// "cuánta gente convirtió", no "cuántas veces volvió".
router.post('/events/:id/ad-click', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { data: row, error } = await supabase
      .from('event_promo_notifications')
      .select('id, clicked_at')
      .eq('event_id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;

    if (!row || row.clicked_at) return res.json({ registered: false });

    // .is('clicked_at', null) cierra la carrera entre dos peticiones
    // simultáneas (doble tap, reintento de red): solo una gana el UPDATE y
    // el timestamp que queda es el del primer click, no el del último.
    const { error: updateErr } = await supabase
      .from('event_promo_notifications')
      .update({ clicked_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('clicked_at', null);
    if (updateErr) throw updateErr;

    res.json({ registered: true });
  } catch (err) {
    console.error('[community] POST /events/:id/ad-click', err);
    res.status(500).json({ error: 'Error al registrar el click' });
  }
});

// ── POST /api/community/raffles/:raffleId/banner-click ─────────────────────
// Equivalente para sorteos: lo llama RaffleBannerFlyover al tocar la
// avioneta, y CommunityDetailPage al aterrizar desde el push del sorteo
// (?src=raffle). Mismas garantías que arriba: solo marca una fila que ya
// existe en raffle_banner_targets (o sea, alguien a quien le tocó ese
// banner) y solo la primera vez.
//
// Detalle importante: si el click llega desde el PUSH, puede que la avioneta
// todavía no se le haya mostrado (shown_at NULL) — el push es inmediato y el
// banner se sirve diferido, la próxima vez que entre al menú principal. En
// ese caso se marca también shown_at, por dos motivos:
//
//   · Honestidad de la métrica: el anuncio SÍ se le mostró (como
//     notificación). Sin esto, el CTR del dashboard (clicks/mostrados)
//     podría pasar del 100%, que es un sinsentido.
//   · Utilidad: consume el banner pendiente, para no cruzarle luego la
//     avioneta de un sorteo que ya ha visitado.
//
// Esto NO puede inflar la facturación de un sorteo Light: el push solo se
// manda a targets que son MIEMBROS de la comunidad (ver
// notifyCommunityRaffleTargets), y el pool de Light excluye precisamente a
// los miembros (getRaffleLightAudienceIds), así que la intersección es
// vacía. Solo llega a afectar a Volt y Community, que no tienen aforo
// contratado ni cobro por visualización.
router.post('/raffles/:raffleId/banner-click', requireAuth, async (req, res) => {
  const { raffleId } = req.params;
  const userId = req.user.id;

  try {
    const { data: row, error } = await supabase
      .from('raffle_banner_targets')
      .select('id, shown_at, clicked_at')
      .eq('raffle_id', raffleId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;

    if (!row || row.clicked_at) return res.json({ registered: false });

    const nowIso = new Date().toISOString();
    const patch = { clicked_at: nowIso };
    if (!row.shown_at) patch.shown_at = nowIso;

    const { error: updateErr } = await supabase
      .from('raffle_banner_targets')
      .update(patch)
      .eq('id', row.id)
      .is('clicked_at', null);
    if (updateErr) throw updateErr;

    res.json({ registered: true });
  } catch (err) {
    console.error('[community] POST /raffles/:raffleId/banner-click', err);
    res.status(500).json({ error: 'Error al registrar el click' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// Fase 121 — Tracking de clicks al enlace externo (URL "que cuelga el
// organizador"). Tres endpoints simétricos, uno por tabla: comunidad,
// evento y sorteo. A diferencia de banner-click / ad-click más arriba
// (que son CTR de personas únicas del anuncio interno), aquí se hace un
// conteo INGENUO: cada tap suma uno, aunque sea el mismo usuario tres
// veces. Se está midiendo la tracción bruta del enlace, no el CTR.
//
// Se responde 204 sin cuerpo — es fire-and-forget desde el cliente: la
// navegación al enlace externo NO espera a que este endpoint termine
// (ver client/src/lib/urlClickTracker.js con sendBeacon), y devolver
// JSON solo generaría un pico de bytes tirado. Errores se loggean pero
// no se le devuelven al usuario: perder un click en analytics no debe
// romper la experiencia de abrir el enlace.
router.post('/communities/:id/url-click', requireAuth, async (req, res) => {
  const communityId = req.params.id;
  try {
    const { error } = await supabase.rpc('increment_community_url_clicks', { p_id: communityId });
    if (error) throw error;
    res.status(204).end();
  } catch (err) {
    console.error('[community] POST /communities/:id/url-click', err);
    res.status(204).end();
  }
});

router.post('/events/:id/url-click', requireAuth, async (req, res) => {
  const eventId = req.params.id;
  try {
    const { error } = await supabase.rpc('increment_event_url_clicks', { p_id: eventId });
    if (error) throw error;
    res.status(204).end();
  } catch (err) {
    console.error('[community] POST /events/:id/url-click', err);
    res.status(204).end();
  }
});


// ══════════════════════════════════════════════════════════════════════════
// Fase 112 — Fin y renovación de la publicidad de un sorteo
// ══════════════════════════════════════════════════════════════════════════

// Mismo umbral que los eventos (FREE_THRESHOLD = 200 envíos): banners
// realmente enseñados por debajo de los cuales no se puede finalizar ni
// renovar, para que no se pueda encadenar "ciclo + cancelación instantánea"
// y regalarse aforo. Se llama RAFFLE_ para distinguirlo léxicamente en las
// trazas, aunque hoy coincida con el de eventos.
const RAFFLE_FREE_THRESHOLD = 200;

// Volt es gratis: no hay nada que "cobrar" ni sentido en cerrar/renovar su
// promo — su reparto se acaba cuando el sorteo termina y punto. Estos dos
// endpoints solo aceptan Light y Community.
const RAFFLE_LIFECYCLE_TIERS = new Set(['light', 'community']);

// Cuenta los banners realmente enseñados de un sorteo (shown_at IS NOT
// NULL). Es lo que decide si se supera el umbral de cobro. Usa
// count: 'exact', head: true para no traer las filas: en un sorteo Light
// contratado al máximo son 100k, y en un Volt es una por usuario de la app.
async function countRaffleShown(raffleId) {
  const { count, error } = await supabase
    .from('raffle_banner_targets')
    .select('*', { count: 'exact', head: true })
    .eq('raffle_id', raffleId)
    .not('shown_at', 'is', null);
  if (error) throw error;
  return count || 0;
}

// ── POST /api/community/raffles/:raffleId/end-promotion ────────────────────
// Cierra el reparto de banners de un sorteo antes de tiempo: los targets
// pendientes (shown_at NULL) dejan de servirse al filtrar por promo_ended_at
// en GET /raffle-banner. El sorteo en sí sigue vivo hasta su ends_at o
// drawn_at — cerrar la promo NO es sortear.
router.post('/raffles/:raffleId/end-promotion', requireAuth, async (req, res) => {
  const { raffleId } = req.params;
  const userId = req.user.id;

  try {
    const { data: raffle, error: fetchErr } = await supabase
      .from('community_raffles')
      .select('id, title, creator_id, community_id, tier, ends_at, drawn_at, promo_ended_at')
      .eq('id', raffleId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!raffle) return res.status(404).json({ error: 'Sorteo no encontrado' });
    if (raffle.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el creador del sorteo puede finalizar su publicidad' });
    }

    const tier = normalizeRaffleTier(raffle.tier);
    if (!RAFFLE_LIFECYCLE_TIERS.has(tier)) {
      return res.status(400).json({
        error: 'Los sorteos Volt no tienen publicidad de pago que finalizar.',
      });
    }
    if (raffle.promo_ended_at) {
      return res.status(400).json({ error: 'La publicidad de este sorteo ya está finalizada' });
    }
    if (raffle.drawn_at) {
      return res.status(400).json({ error: 'Este sorteo ya está sorteado' });
    }
    if (new Date(raffle.ends_at) <= new Date()) {
      return res.status(400).json({ error: 'Este sorteo ya ha terminado' });
    }

    const shownCount = await countRaffleShown(raffleId);
    if (shownCount < RAFFLE_FREE_THRESHOLD) {
      return res.status(400).json({
        error: `Aún no puedes finalizar: hace falta alcanzar el mínimo de ${RAFFLE_FREE_THRESHOLD} banners enseñados para que se pueda cobrar (llevas ${shownCount}/${RAFFLE_FREE_THRESHOLD}).`,
      });
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateErr } = await supabase
      .from('community_raffles')
      .update({ promo_ended_at: nowIso })
      .eq('id', raffleId)
      .is('promo_ended_at', null) // idempotencia bajo carrera: dos peticiones simultáneas ganan solo una
      .select()
      .single();
    if (updateErr) throw updateErr;

    res.json({ raffle: updated });
  } catch (err) {
    console.error('[community] POST /raffles/:raffleId/end-promotion error:', err);
    res.status(500).json({ error: err.message || 'Error al finalizar la publicidad del sorteo' });
  }
});

// ── POST /api/community/raffles/:raffleId/renew-promotion ──────────────────
// Cierra el ciclo actual y arranca uno nuevo: borra los targets del ciclo
// que se acaba, resetea promo_ended_at a NULL, y llama al mismo
// assignRaffleBannerTargets que se usa al crear un sorteo, esta vez con los
// parámetros que se acaban de contratar (banner_views_contracted y
// banner_interested_only para Light — Community mantiene aforo ilimitado
// entre sus miembros). Los clicks y las visualizaciones del ciclo anterior
// se pierden — es lo mismo que hace renew-promotion de eventos con
// event_promo_notifications, y por el mismo motivo: cada renovación es un
// ciclo limpio a efectos de métricas y de facturación.
//
// No se puede cambiar de tier (afectaría al pool de participantes, que ya
// están comprometidos con este sorteo) ni la fecha (ends_at es del sorteo,
// no de la publicidad). Solo se retoca el reparto.
router.post('/raffles/:raffleId/renew-promotion', requireAuth, async (req, res) => {
  const { raffleId } = req.params;
  const userId = req.user.id;
  const { banner_views_contracted, banner_interested_only } = req.body || {};

  try {
    const { data: raffle, error: fetchErr } = await supabase
      .from('community_raffles')
      .select('id, title, creator_id, community_id, tier, categories, ends_at, drawn_at, promo_ended_at, banner_views_contracted, banner_interested_only')
      .eq('id', raffleId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!raffle) return res.status(404).json({ error: 'Sorteo no encontrado' });
    if (raffle.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el creador del sorteo puede renovar su publicidad' });
    }

    const tier = normalizeRaffleTier(raffle.tier);
    if (!RAFFLE_LIFECYCLE_TIERS.has(tier)) {
      return res.status(400).json({
        error: 'Los sorteos Volt no tienen publicidad de pago que renovar.',
      });
    }
    if (raffle.drawn_at) {
      return res.status(400).json({ error: 'Este sorteo ya está sorteado' });
    }
    if (new Date(raffle.ends_at) <= new Date()) {
      return res.status(400).json({ error: 'Este sorteo ya ha terminado' });
    }

    const shownCount = await countRaffleShown(raffleId);
    if (shownCount < RAFFLE_FREE_THRESHOLD) {
      return res.status(400).json({
        error: `Aún no puedes renovar: hace falta alcanzar el mínimo de ${RAFFLE_FREE_THRESHOLD} banners enseñados para que se pueda cobrar (llevas ${shownCount}/${RAFFLE_FREE_THRESHOLD}).`,
      });
    }

    // Aforo del nuevo ciclo. En Light se puede cambiar (por eso se acepta en
    // el body) pero se valida contra el rango de siempre. En Community el
    // aforo no aplica (memberIds manda), así que se ignora lo que llegue.
    let resolvedBannerViews = null;
    if (tier === 'light') {
      const parsed = Number.parseInt(banner_views_contracted, 10);
      if (!Number.isFinite(parsed) || parsed < BANNER_VIEWS_MIN || parsed > BANNER_VIEWS_MAX) {
        return res.status(400).json({
          error: `Elige cuántas visualizaciones quieres contratar (entre ${BANNER_VIEWS_MIN} y ${BANNER_VIEWS_MAX})`,
        });
      }
      resolvedBannerViews = parsed;
    }

    const resolvedInterestedOnly = !!banner_interested_only;

    // Datos de la comunidad — se necesitan para calcular el pool (Light) y
    // el conjunto de "interesados" para etiquetar los targets del nuevo
    // ciclo (fase 111).
    const { data: community, error: commErr } = await supabase
      .from('communities')
      .select('id, name, categories')
      .eq('id', raffle.community_id)
      .single();
    if (commErr || !community) return res.status(404).json({ error: 'Comunidad no encontrada' });

    // Ciclo limpio: se borran los targets del ciclo anterior (clicks,
    // visualizaciones e historial). Los datos históricos del dashboard se
    // pierden — mismo comportamiento que en eventos y por la misma razón.
    const { error: delErr } = await supabase
      .from('raffle_banner_targets')
      .delete()
      .eq('raffle_id', raffleId);
    if (delErr) throw delErr;

    // Actualiza el sorteo con los nuevos parámetros. Se reabre la promo
    // (promo_ended_at = null) tanto si estaba cerrada como si no — la
    // renovación cubre los dos casos de uso: "ya se cumplió el aforo,
    // quiero otro ciclo" y "cerré antes de tiempo, me arrepiento".
    const { data: updated, error: updateErr } = await supabase
      .from('community_raffles')
      .update({
        promo_ended_at: null,
        banner_views_contracted: resolvedBannerViews,
        banner_interested_only: resolvedInterestedOnly,
      })
      .eq('id', raffleId)
      .select()
      .single();
    if (updateErr) throw updateErr;

    // Reasignación del nuevo ciclo — misma lógica que al crear el sorteo
    // (ver POST /communities/:id/raffles más arriba). Se replica en lugar
    // de extraerse a un helper porque los dos flujos tienen validaciones
    // previas distintas y compartir tres bloques de código con lambdas
    // acabaría siendo menos legible que la duplicación explícita.
    // Mismo cálculo de categorías efectivas que al crear: propias del
    // sorteo si tiene (fase 116), si no las de la comunidad. La renovación
    // NO puede tocar las categorías del sorteo (esta pantalla solo edita
    // aforo y filtro), así que se leen tal cual de la fila.
    const effectiveCategories = resolveRaffleEffectiveCategories(raffle.categories, community.categories);
    const interestedIds = await getInterestedUserIdSet(effectiveCategories);
    let targetIds = [];
    if (tier === 'light') {
      const { ids, categoriesDefined } = await getRaffleLightAudienceIds(raffle.community_id, userId, { interestedOnly: resolvedInterestedOnly, raffleCategories: effectiveCategories });
      if (resolvedInterestedOnly && !categoriesDefined) {
        return res.status(400).json({ error: 'Ni el sorteo ni la comunidad tienen categorías de intereses definidas: no se puede filtrar por interesados' });
      }
      if (resolvedInterestedOnly && ids.length < BANNER_VIEWS_MIN) {
        return res.status(400).json({
          error: `Solo hay ${ids.length} usuarios interesados disponibles, por debajo del mínimo contratable (${BANNER_VIEWS_MIN}): quita el filtro para poder renovar`,
        });
      }
      // Sin filtro, se calcula el subconjunto con match de categoría para
      // repartir con prioridad (mismo comportamiento que al crear).
      const lightPriorityIds = resolvedInterestedOnly
        ? null
        : await getCategoryMatchingUserIds(ids, effectiveCategories);
      targetIds = await assignRaffleBannerTargets(raffleId, userId, resolvedBannerViews, ids, lightPriorityIds, interestedIds);
    } else if (tier === 'community') {
      const memberIds = await getCommunityMemberIdsForBanner(raffle.community_id, userId);
      targetIds = await assignRaffleBannerTargets(raffleId, userId, null, memberIds, null, interestedIds);
    }

    await notifyCommunityRaffleTargets({
      raffleId,
      communityId: raffle.community_id,
      communityName: community.name,
      creatorId: userId,
      title: raffle.title,
      tier,
      targetIds,
    });

    res.json({ raffle: updated, target_count: targetIds.length });
  } catch (err) {
    console.error('[community] POST /raffles/:raffleId/renew-promotion error:', err);
    res.status(500).json({ error: err.message || 'Error al renovar la publicidad del sorteo' });
  }
});

// Traduce el error de una RPC que no existe todavía en Supabase a algo
// accionable. Sin esto, no haber ejecutado la migración de la fase 111 se
// manifiesta como un 500 opaco en el dashboard.
function adStatsError(err) {
  const code = err?.code;
  const message = err?.message || '';
  if (code === 'PGRST202' || /could not find the function|does not exist/i.test(message)) {
    return new Error(
      'Faltan las funciones de métricas en la base de datos: ejecuta supabase_schema_phase111_ad_dashboard.sql en el SQL Editor de Supabase.'
    );
  }
  return err;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Ratio en tanto por ciento con un decimal, o null si no hay base sobre la
// que dividir. null y 0 son cosas distintas y el cliente las pinta distinto:
// null = "todavía no hay datos", 0 = "hubo impresiones y nadie hizo click".
function rate(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

// ── GET /api/community/communities/:id/dashboard ───────────────────────────
// Métricas de toda la publicidad de una comunidad — eventos Premium/Ultra y
// sorteos Light/Volt/Community — en una sola respuesta. Solo para el CREADOR
// de la comunidad: es información de negocio (a cuánta gente llegó, quién
// picó, qué se va a cobrar), no algo que deba ver un miembro cualquiera.
//
// Los conteos pesados se hacen con dos RPC de agregación (fase 111): un
// sorteo Volt tiene una fila de target por CADA usuario de la app, así que
// contar en JS no es una opción. Ver supabase_schema_phase111_ad_dashboard.sql.
router.get('/communities/:id/dashboard', requireAuth, async (req, res) => {
  const communityId = req.params.id;
  const userId = req.user.id;

  try {
    const { data: community, error: communityErr } = await supabase
      .from('communities')
      .select('id, name, creator_id, categories, url, url_click_count')
      .eq('id', communityId)
      .maybeSingle();
    if (communityErr) throw communityErr;
    if (!community) return res.status(404).json({ error: 'Comunidad no encontrada' });
    if (community.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el creador de la comunidad puede ver el dashboard' });
    }

    const [eventsRes, rafflesRes] = await Promise.all([
      supabase
        .from('community_events')
        .select('id, title, event_date, ends_at, created_at, categories, promotion_plan, notification_count, notification_sent_count, audience_interested_only, audience_radius_km, url, url_click_count')
        .eq('community_id', communityId)
        .order('event_date', { ascending: false }),
      supabase
        .from('community_raffles')
        .select('id, title, tier, categories, ends_at, drawn_at, created_at, banner_views_contracted, banner_interested_only, promo_ended_at')
        .eq('community_id', communityId)
        .order('created_at', { ascending: false }),
    ]);
    if (eventsRes.error) throw eventsRes.error;
    if (rafflesRes.error) throw rafflesRes.error;

    const events = eventsRes.data || [];
    const raffles = rafflesRes.data || [];

    const [eventStatsRes, raffleStatsRes] = await Promise.all([
      supabase.rpc('community_event_ad_stats', { p_community_id: communityId }),
      supabase.rpc('community_raffle_ad_stats', { p_community_id: communityId }),
    ]);
    if (eventStatsRes.error) throw adStatsError(eventStatsRes.error);
    if (raffleStatsRes.error) throw adStatsError(raffleStatsRes.error);

    const eventStatsById = new Map((eventStatsRes.data || []).map(r => [r.stat_event_id, r]));
    const raffleStatsById = new Map((raffleStatsRes.data || []).map(r => [r.stat_raffle_id, r]));

    // Engagement "orgánico" del evento (apuntados y likes). Son tablas
    // pequeñas comparadas con las de envíos, así que se cuentan en JS con
    // dos consultas en vez de montar otra RPC.
    const eventIds = events.map(e => e.id);
    const attendeesByEvent = new Map();
    const likesByEvent = new Map();
    if (eventIds.length) {
      const [attRes, likeRes] = await Promise.all([
        supabase.from('community_event_attendees').select('event_id').in('event_id', eventIds),
        supabase.from('community_event_likes').select('event_id').in('event_id', eventIds),
      ]);
      for (const row of attRes.data || []) {
        attendeesByEvent.set(row.event_id, (attendeesByEvent.get(row.event_id) || 0) + 1);
      }
      for (const row of likeRes.data || []) {
        likesByEvent.set(row.event_id, (likesByEvent.get(row.event_id) || 0) + 1);
      }
    }

    // Participantes elegibles por tier (la regla cambia según el tipo de
    // sorteo, ver getEligibleRaffleMembers). Se cachea por tier: como mucho
    // son 3 consultas aunque la comunidad tenga 50 sorteos.
    const eligibleByTier = new Map();
    for (const tier of new Set(raffles.map(r => normalizeRaffleTier(r.tier)))) {
      eligibleByTier.set(tier, (await getEligibleRaffleMembers(communityId, tier)).length);
    }

    const now = Date.now();

    // Si la comunidad no tiene categorías, ningún sorteo suyo se pudo
    // clasificar por intereses (no hay nada con lo que cruzar): se propaga a
    // cada fila para que el dashboard explique el hueco en vez de dar por
    // hecho que son datos viejos. En eventos la categoría es del propio
    // evento, no de la comunidad, así que ahí se calcula evento a evento.
    const communityHasCategories = (community.categories || []).filter(Boolean).length > 0;

    const eventRows = events.map(e => {
      const s = eventStatsById.get(e.id);
      const promoted = e.promotion_plan === 'premium' || e.promotion_plan === 'ultra';

      const sendsTotal      = num(s?.sends_total);
      const sendsPromo      = num(s?.sends_promo);
      const sendsCommunity  = num(s?.sends_community);
      const sendsUnknownSrc = num(s?.sends_unknown_source);
      const interested      = num(s?.sends_interested);
      const notInterested   = num(s?.sends_not_interested);
      const unknownInterest = num(s?.sends_unknown_interest);
      const clicksTotal     = num(s?.clicks_total);
      const clicksInterested    = num(s?.clicks_interested);
      const clicksNotInterested = num(s?.clicks_not_interested);

      const contracted = e.notification_count ?? null;
      // notification_sent_count es la cifra oficial de envíos publicitarios
      // (la que se factura, incrementada atómicamente por el pacing). El
      // conteo de filas ad_source='promo' debería coincidir; se exponen las dos
      // para poder detectar una descuadre sin entrar en la BD.
      const sentOfficial = num(e.notification_sent_count);
      const started = new Date(e.event_date).getTime() <= now;

      return {
        id: e.id,
        title: e.title,
        event_date: e.event_date,
        promotion_plan: e.promotion_plan,
        promoted,
        started,
        audience_interested_only: !!e.audience_interested_only,
        audience_radius_km: e.audience_radius_km != null ? Number(e.audience_radius_km) : null,
        has_categories: (e.categories || []).filter(Boolean).length > 0,
        contracted,
        sent_official: sentOfficial,
        progress: contracted ? rate(sentOfficial, contracted) : null,
        sends: {
          total: sendsTotal,
          promo: sendsPromo,
          community: sendsCommunity,
          unknown_source: sendsUnknownSrc,
        },
        interest: { interested, not_interested: notInterested, unknown: unknownInterest },
        clicks: {
          total: clicksTotal,
          interested: clicksInterested,
          not_interested: clicksNotInterested,
        },
        ctr: rate(clicksTotal, sendsTotal),
        ctr_interested: rate(clicksInterested, interested),
        ctr_not_interested: rate(clicksNotInterested, notInterested),
        last_click_at: s?.last_click_at || null,
        attendees: attendeesByEvent.get(e.id) || 0,
        likes: likesByEvent.get(e.id) || 0,
        // Fase 121 — enlace externo del evento y clicks acumulados a él.
        // Se separa del CTR interno del anuncio (clicks_total arriba); es
        // un contador ingenuo (cada tap suma) no personas únicas.
        url: e.url || null,
        url_clicks: Number(e.url_click_count || 0),
        // El cobro se hace sobre lo REALMENTE enviado hasta el inicio del
        // evento, y solo si se pasa el mínimo (ver FREE_THRESHOLD y el
        // bloqueo de renovación más arriba).
        billable: promoted && sentOfficial >= FREE_THRESHOLD,
        // Flags de acción para el dashboard. Se calculan aquí y no en el
        // cliente para que el UI no tenga que replicar las reglas de
        // negocio (evento ya empezado / plan actual / umbral) — el cliente
        // solo pinta un botón si el servidor dice que sí y, aun así, la
        // petición vuelve a validarlo entera antes de aplicar el cambio.
        can_end:   promoted && !started && sentOfficial >= FREE_THRESHOLD,
        can_renew: promoted && !started && sentOfficial >= FREE_THRESHOLD,
      };
    });

    const raffleRows = raffles.map(r => {
      const tier = normalizeRaffleTier(r.tier);
      const s = raffleStatsById.get(r.id);

      const targets       = num(s?.targets_total);
      const shown         = num(s?.shown_total);
      const interested    = num(s?.shown_interested);
      const notInterested = num(s?.shown_not_interested);
      const unknown       = num(s?.shown_unknown_interest);
      const clicksTotal   = num(s?.clicks_total);
      const clicksInterested    = num(s?.clicks_interested);
      const clicksNotInterested = num(s?.clicks_not_interested);

      const contracted = tier === 'light' ? (r.banner_views_contracted ?? null) : null;

      // Reglas de fin/renovación de sorteo (fase 112): mismas que en el
      // endpoint (RAFFLE_LIFECYCLE_TIERS + umbral), calculadas aquí para
      // que el dashboard sepa cuándo pintar los botones. Volt queda fuera
      // — no hay nada facturable —, y ambos requieren:
      //   · sorteo vivo (no sorteado, no expirado),
      //   · publicidad enseñada por encima del umbral de cobro.
      // Finalizar exige además que la promo esté abierta; renovar la
      // reabre si estaba cerrada, así que se puede tanto renovar una
      // promo activa como resucitar una que ya se había cerrado.
      const promoEndedAt = r.promo_ended_at || null;
      const ended = !!r.drawn_at || new Date(r.ends_at).getTime() <= now;
      const lifecycleTier = tier === 'light' || tier === 'community';
      const meetsThreshold = shown >= FREE_THRESHOLD;
      const canEnd   = lifecycleTier && !ended && !promoEndedAt && meetsThreshold;
      const canRenew = lifecycleTier && !ended && meetsThreshold;

      // Categorías efectivas del sorteo — propias si tiene (fase 116), si
      // no las de la comunidad — mismo criterio que usa el reparto y el
      // tagging de matched_interest. has_categories se calcula sobre ellas
      // para que el dashboard sepa si el sorteo pudo clasificarse por
      // intereses (idéntico esquema al de eventos, donde se mira
      // event.categories fila a fila).
      const raffleCategories = Array.isArray(r.categories) ? r.categories.filter(Boolean) : [];
      const hasEffectiveCategories = raffleCategories.length > 0 || communityHasCategories;

      return {
        id: r.id,
        title: r.title,
        tier,
        tier_label: RAFFLE_TIERS[tier].label,
        categories: raffleCategories,
        ends_at: r.ends_at,
        drawn_at: r.drawn_at,
        ended,
        promo_ended_at: promoEndedAt,
        banner_interested_only: !!r.banner_interested_only,
        has_categories: hasEffectiveCategories,
        contracted,
        // Targets asignados vs banners realmente enseñados: la diferencia es
        // el reparto que aún está en cola (el banner se sirve diferido, la
        // próxima vez que cada usuario entre al menú principal).
        targets,
        shown,
        pending: Math.max(targets - shown, 0),
        progress: contracted ? rate(shown, contracted) : null,
        interest: { interested, not_interested: notInterested, unknown },
        clicks: {
          total: clicksTotal,
          interested: clicksInterested,
          not_interested: clicksNotInterested,
        },
        ctr: rate(clicksTotal, shown),
        ctr_interested: rate(clicksInterested, interested),
        ctr_not_interested: rate(clicksNotInterested, notInterested),
        last_click_at: s?.last_click_at || null,
        eligible_participants: eligibleByTier.get(tier) ?? null,
        can_end:   canEnd,
        can_renew: canRenew,
      };
    });

    const sum = (rows, pick) => rows.reduce((acc, row) => acc + pick(row), 0);

    const eventSends  = sum(eventRows, r => r.sends.total);
    const eventClicks = sum(eventRows, r => r.clicks.total);
    const raffleShown  = sum(raffleRows, r => r.shown);
    const raffleClicks = sum(raffleRows, r => r.clicks.total);

    // Fase 121 — conteo de actividades activas (para pintar el "X/4" en
    // la UI y avisar cuando se llegue al tope) y agregado de clicks a
    // URLs externas (organizador). No es la misma consulta que arriba
    // aunque el criterio esté parametrizado en JS: la fuente de verdad
    // del cap está en la RPC community_active_activity_count, y así lo
    // que enseña el dashboard es EXACTAMENTE lo que el server evaluaría
    // al recibir un POST /events o /raffles nuevos — no pueden desviarse.
    const activeActivityCount = await getActiveActivityCount(communityId);

    const eventUrlClicks = sum(eventRows,  r => r.url_clicks);

    res.json({
      community: {
        id: community.id,
        name: community.name,
        categories: community.categories || [],
        url: community.url || null,
        url_clicks: Number(community.url_click_count || 0),
      },
      summary: {
        events_total: eventRows.length,
        events_promoted: eventRows.filter(r => r.promoted).length,
        event_sends: eventSends,
        event_clicks: eventClicks,
        event_ctr: rate(eventClicks, eventSends),
        raffles_total: raffleRows.length,
        raffle_targets: sum(raffleRows, r => r.targets),
        raffle_shown: raffleShown,
        raffle_clicks: raffleClicks,
        raffle_ctr: rate(raffleClicks, raffleShown),
        total_impressions: eventSends + raffleShown,
        total_clicks: eventClicks + raffleClicks,
        total_ctr: rate(eventClicks + raffleClicks, eventSends + raffleShown),
        free_threshold: FREE_THRESHOLD,
        // Fase 121 — tope de actividades vivas (para el badge X/4) y
        // clicks acumulados a URLs externas. Los sorteos no tienen URL
        // (fase 122 lo revirtió): solo se agregan comunidad + eventos.
        active_activity_count: activeActivityCount,
        active_activity_limit: ACTIVE_ACTIVITY_LIMIT_PER_COMMUNITY,
        community_url_clicks: Number(community.url_click_count || 0),
        event_url_clicks: eventUrlClicks,
        total_url_clicks: Number(community.url_click_count || 0) + eventUrlClicks,
      },
      events: eventRows,
      raffles: raffleRows,
    });
  } catch (err) {
    console.error('[community] GET /communities/:id/dashboard', err);
    res.status(500).json({ error: err.message || 'Error al obtener el dashboard' });
  }
});

router.post('/communities/:id/raffles/:raffleId/draw', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { id: communityId, raffleId } = req.params;

  try {
    const { data: raffle, error: fetchErr } = await supabase
      .from('community_raffles')
      .select('id, community_id, creator_id, ends_at, drawn_at, winner_id, tier')
      .eq('id', raffleId)
      .eq('community_id', communityId)
      .single();

    if (fetchErr || !raffle) return res.status(404).json({ error: 'Sorteo no encontrado' });
    if (raffle.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el creador de la comunidad puede sortear' });
    }
    if (raffle.drawn_at || raffle.winner_id) {
      return res.status(400).json({ error: 'Este sorteo ya tiene ganador' });
    }
    if (new Date(raffle.ends_at) > new Date()) {
      return res.status(400).json({ error: 'El sorteo todavía no ha terminado' });
    }

    const raffleTier = normalizeRaffleTier(raffle.tier);
    const eligibleIds = await getEligibleRaffleMembers(communityId, raffleTier);

    if (!eligibleIds.length) {
      return res.status(400).json({ error: 'No hay participantes para sortear' });
    }

    // Fase 122 — sorteo de N ganadores (uno por premio). Los sorteos
    // antiguos (previos a la fase 122) no tienen filas en
    // community_raffle_prizes; ahí caemos al flujo legacy de "1 ganador,
    // guardar en community_raffles.winner_id" para no romperlos.
    const { data: prizeRows, error: prizesFetchErr } = await supabase
      .from('community_raffle_prizes')
      .select('id, position')
      .eq('raffle_id', raffleId)
      .order('position', { ascending: true });
    if (prizesFetchErr) throw prizesFetchErr;

    const nowIso = new Date().toISOString();

    if (!prizeRows || prizeRows.length === 0) {
      // ── Camino legacy (raffle sin premios en la tabla nueva) ──
      const winnerId = eligibleIds[Math.floor(Math.random() * eligibleIds.length)];
      const { error: updateErr } = await supabase
        .from('community_raffles')
        .update({ winner_id: winnerId, drawn_at: nowIso })
        .eq('id', raffleId);
      if (updateErr) throw updateErr;
    } else {
      // ── Camino de premios (fase 122) ──
      // Fisher-Yates parcial: baraja los primeros K = min(nº premios,
      // nº elegibles) elementos y toma esos K como ganadores en orden.
      // El primer extraído se lleva el premio position=1, el segundo
      // el 2, etc. Si sobran premios respecto a elegibles, quedan sin
      // winner (permitido por schema: winner_id NULL). No se re-sortea
      // ni se rota: drawn_at queda seteado y este endpoint no se puede
      // volver a llamar.
      const shuffled = eligibleIds.slice();
      const draws = Math.min(prizeRows.length, shuffled.length);
      for (let i = 0; i < draws; i++) {
        const j = i + Math.floor(Math.random() * (shuffled.length - i));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      // Actualiza cada premio con su ganador. Se hace en secuencia (no
      // en batch upsert) porque el WHERE de un upsert cambia el schema
      // "una fila por id" y la tabla usa gen_random_uuid — tirar de
      // .update por id es fiable y son pocas rows (PRIZE_MAX_PER_RAFFLE=10).
      // Si alguno falla, drawn_at NO se toca y el endpoint puede
      // reintentarse (los premios ya asignados quedarían adjudicados,
      // pero la ruta ya rechaza reintentos vía "drawn_at" — así que en
      // la práctica el organizador vería un error 500 y tendría que
      // arreglar en BD; caso raro).
      for (let i = 0; i < draws; i++) {
        const { error: prizeUpdateErr } = await supabase
          .from('community_raffle_prizes')
          .update({ winner_id: shuffled[i] })
          .eq('id', prizeRows[i].id);
        if (prizeUpdateErr) throw prizeUpdateErr;
      }
      const { error: raffleUpdateErr } = await supabase
        .from('community_raffles')
        .update({ drawn_at: nowIso })
        .eq('id', raffleId);
      if (raffleUpdateErr) throw raffleUpdateErr;
    }

    // Refresh completo para la respuesta — incluye el winner legacy (si
    // fue el camino de sorteo antiguo) o los premios recién asignados.
    const { data: updated, error: refreshErr } = await supabase
      .from('community_raffles')
      .select(`
        id, community_id, creator_id, title, description, image_url,
        ends_at, drawn_at, created_at, tier, categories,
        banner_views_contracted, banner_interested_only, promo_ended_at,
        winner:winner_id(id, username, avatar_url)
      `)
      .eq('id', raffleId)
      .single();
    if (refreshErr) throw refreshErr;

    const bannerSentCounts = await getBannerSentCounts(
      ['light', 'volt', 'community'].includes(raffleTier) ? [raffleId] : []
    );
    const { likeCountByRaffle, likedRaffleIds } = await getRaffleLikeAggregates([raffleId], userId);
    const prizesByRaffle = await fetchRafflePrizes([raffleId]);

    res.json({
      raffle: serializeRaffle(updated, {
        participantCount: eligibleIds.length,
        currentUserId: userId,
        isEligible: eligibleIds.includes(userId),
        bannerViewsSent: bannerSentCounts[raffleId] || 0,
        likeCount: likeCountByRaffle[raffleId] || 0,
        likedByMe: likedRaffleIds.has(raffleId),
        prizes: prizesByRaffle.get(raffleId) || [],
      }),
    });
  } catch (err) {
    console.error('[community] POST /communities/:id/raffles/:raffleId/draw', err);
    res.status(500).json({ error: err.message || 'Failed to draw raffle winner' });
  }
});


module.exports = router;
