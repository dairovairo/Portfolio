const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const supabase = require('../lib/supabase');
const { applyBatteryExpiry } = require('../lib/batteryExpiry');
const { requireAuth } = require('../middleware/auth');
const { createImageUpload, createMediaUpload, storeImage, storeMedia, mediaKindFromMimetype } = require('../lib/imageUpload');
const { notifyUsers, getMutedUserIds } = require('../lib/webpush');
const { parseReminderMinutes } = require('../lib/reminderLeadTime');
const { runEventPromoPacingTick } = require('../jobs/eventPromoPacing');
const { addYears, addMonths } = require('../lib/dateRangeLimits');
const { BOOST_GROUP_SIZE } = require('../lib/adaptiveBoost');
const raffleLib = require('../lib/raffles');
const { createDrawSecret, drawRaffle, redrawPrize, getVerification, entryKey } = require('../lib/raffleDraw');
const { buildRaffleRules } = require('../lib/raffleRules');
const { notifyRaffleDrawn } = require('../lib/raffleNotifications');
const connect = require('../lib/connect');
const { pickRaffleFromRatioGroups } = require('../lib/promoDistribution');
const wallet = require('../lib/wallet');
const { RAFFLE_AD_PRICING } = require('../lib/adPricing');
const { COMMUNITY_RAFFLE_FEE_CENTS } = require('../lib/billingCatalog');
const { fetchAll, selectInChunks } = require('../lib/paginate');
const audience = require('../lib/audience');
const entitlements = require('../lib/entitlements');
const eventPromotion = require('../lib/eventPromotion');
const freePromo = require('../lib/freePromo');

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

function appBaseUrl() {
  const url = process.env.PUBLIC_APP_URL || (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
  return url.replace(/\/$/, '');
}

function fallbackUsername(user) {
  const idPart = user.id.replace(/-/g, '').slice(0, 12);
  return `user_${idPart}`;
}

const MAX_CATEGORIES = 3;

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
  try {
    return await selectInChunks(eventIds, ids => db
      .from(table)
      .select(columns)
      .in('event_id', ids)
      .order('event_id').order('user_id'));
  } catch (error) {
    if ((error.code === '42P01' || error.code === '42703') && columns !== 'event_id, user_id') {
      return selectEventRows(db, table, eventIds);
    }
    if (error.code === '42P01' || error.code === '42703') return [];
    throw error;
  }
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
  const isOver = ev => Boolean(ev.cancelled_at) || getEndTime(ev) < now;
  const current_events = events.filter(ev => !isOver(ev));
  const past_events = events
    .filter(isOver)
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
      .is('cancelled_at', null)
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
      .is('cancelled_at', null)
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
      .is('cancelled_at', null)
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

// GET /api/community/promo-quota — promociones gratis que le quedan a la
// cuenta (null si los pagos están encendidos).
router.get('/promo-quota', requireAuth, async (req, res) => {
  try {
    res.json({ free_promo: await freePromo.getStatus(req.user.id) });
  } catch (err) {
    console.error('[community] GET /promo-quota error:', err);
    res.status(500).json({ error: 'Error al consultar tus promociones' });
  }
});

// ── GET /api/community/events/promotion-audience ─────────────────────────────
// Público al que puede llegar una promoción Premium/Ultra de un evento que
// aún no existe (EventAdConfigPage): usuarios con notificaciones activas, que
// no las hayan silenciado, sin suscripción sin anuncios y que no sean ni el
// creador ni miembros de la comunidad. Es exactamente el mismo criterio que
// usa el reparto (lib/audience.js), así que el número es entregable.
//
// Con ?filter=interested&categories=<JSON array> añade `interested`; con
// ?center_lat&center_lng&radius_km añade `nearby` e `interested_nearby`.
router.get('/events/promotion-audience', requireAuth, async (req, res) => {
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

  let center = null;
  if (req.query.center_lat != null && req.query.center_lng != null && req.query.radius_km != null) {
    center = {
      lat: Number(req.query.center_lat),
      lng: Number(req.query.center_lng),
      radiusKm: Number(req.query.radius_km),
    };
    if (!Object.values(center).every(Number.isFinite)) {
      return res.status(400).json({ error: 'center_lat/center_lng/radius_km deben ser numéricos' });
    }
    if (Math.abs(center.lat) > 90 || Math.abs(center.lng) > 180) {
      return res.status(400).json({ error: 'center_lat/center_lng fuera de rango WGS-84' });
    }
    if (center.radiusKm < 1 || center.radiusKm > 500) {
      return res.status(400).json({ error: 'radius_km debe estar entre 1 y 500' });
    }
  }

  try {
    const users = await audience.getEventAudience({ creatorId: req.user.id, communityId });
    const wantInterested = req.query.filter === 'interested';
    const near = center ? users.filter(u => audience.isWithin(u, center)) : null;
    const countInterested = (list) => list.filter(u => audience.matchesInterests(u, categories)).length;

    res.json({
      total: users.length,
      interested: wantInterested && categories.length ? countInterested(users) : null,
      categories_defined: wantInterested ? categories.length > 0 : null,
      nearby: near ? near.length : null,
      interested_nearby: near && wantInterested && categories.length ? countInterested(near) : null,
      free_units: await wallet.getFreeUnits(req.user.id, 'event', req.query.event_id || null),
      free_promo: await freePromo.getStatus(req.user.id, req.query.event_id || null),
    });
  } catch (err) {
    console.error('[community] GET /events/promotion-audience error:', err);
    res.status(500).json({ error: err.message || 'Error al calcular la audiencia' });
  }
});

// Valida los campos editables de un evento (crear y editar).
function readEventFields(body, { createdAt = new Date() } = {}) {
  const fail = (message) => { throw new eventPromotion.PromotionInputError(message); };

  const title = body.title?.trim();
  if (!title) fail('El titulo es obligatorio');
  if (!body.event_date) fail('La fecha es obligatoria');
  const eventDate = new Date(body.event_date);
  if (Number.isNaN(eventDate.getTime())) fail('La fecha no es valida');
  if (eventDate > addYears(new Date(createdAt), 1)) {
    fail('La fecha de inicio no puede ser más de un año después de la creación del evento');
  }
  const location = body.location?.trim();
  if (!location) fail('La ubicacion es obligatoria');

  let endsAt = null;
  if (body.ends_at) {
    const endDate = new Date(body.ends_at);
    if (Number.isNaN(endDate.getTime())) fail('La fecha fin no es valida');
    if (endDate <= eventDate) fail('La fecha fin debe ser posterior al inicio');
    if (endDate > addMonths(eventDate, 1)) fail('La fecha fin no puede ser más de un mes después del inicio');
    endsAt = endDate.toISOString();
  }

  const maxAttendees = Number.parseInt(body.max_attendees, 10) || 50;
  if (maxAttendees < 2 || maxAttendees > 10000) fail('El maximo de asistentes debe estar entre 2 y 10000');

  const number = (value) => {
    const n = value != null && value !== '' ? Number.parseFloat(value) : null;
    return Number.isFinite(n) ? n : null;
  };
  // Solo enlaces web: nada de javascript: ni similares.
  let url = body.url?.trim() || null;
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;

  return {
    title,
    description: body.description?.trim() || null,
    event_date: eventDate.toISOString(),
    ends_at: endsAt,
    location,
    lat: number(body.lat),
    lng: number(body.lng),
    organization: body.organization?.trim() || null,
    url,
    price: number(body.price),
    additional_info: body.additional_info?.trim() || null,
    max_attendees: maxAttendees,
  };
}

async function storeEventCover(file, userId) {
  return storeImage({
    file,
    objectName: `event-covers/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fallbackMaxLength: 4500000,
  });
}

// Errores previstos (validación, plan, saldo) → respuesta. Devuelve true si
// ya se ha respondido.
function handleExpectedError(res, err) {
  if (err instanceof eventPromotion.PromotionInputError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  if (err?.code === 'INSUFFICIENT_FUNDS') {
    wallet.sendInsufficientFunds(res, err);
    return true;
  }
  if (freePromo.handleLimitError(res, err)) return true;
  return entitlements.handleEntitlementError(res, err);
}

// POST /api/community/events
router.post('/events', requireAuth, uploadEventCover, async (req, res) => {
  const userId = req.user.id;

  try {
    const categories = parseCategories(req.body.categories ?? req.body.category);
    if (categories.length > MAX_CATEGORIES) {
      return res.status(400).json({ error: `Puedes elegir hasta ${MAX_CATEGORIES} categorías` });
    }
    if (!categories.length) {
      return res.status(400).json({ error: 'Elige al menos una categoría para el evento' });
    }
    const fields = readEventFields(req.body);
    if (new Date(fields.ends_at || fields.event_date) < new Date()) {
      return res.status(400).json({ error: 'La fecha del evento ya ha pasado' });
    }
    let promo = eventPromotion.parsePromotion(req.body, categories);

    await ensurePublicProfile(req.user);

    // Todo evento pertenece a una comunidad (NOT NULL desde la fase 108).
    const communityId = req.body.community_id || null;
    if (!communityId) {
      return res.status(400).json({ error: 'Los eventos deben pertenecer a una comunidad' });
    }
    const { community, isAdmin } = await getCommunityAdminState(communityId, userId);
    if (!community) return res.status(404).json({ error: 'Comunidad no encontrada' });
    if (!isAdmin) {
      return res.status(403).json({ error: 'Solo el administrador puede publicar eventos en esta comunidad' });
    }
    await entitlements.assertCanCreateActivity(userId, communityId);

    promo = await eventPromotion.fitToAudience(promo, { creatorId: userId, communityId, categories });
    const paid = eventPromotion.isPaidPlan(promo.promotion_plan);
    const hold = paid
      ? eventPromotion.holdParams(promo, await wallet.getFreeUnits(userId, 'event')) : null;
    // Antes de subir la portada, para fallar rápido; la reserva real se hace
    // justo después de insertar el evento.
    if (hold) await freePromo.assertCanLaunch({ userId, amountCents: hold.amountCents });

    const coverImageUrl = req.file
      ? await storeEventCover(req.file, userId)
      : req.body.cover_image_url?.trim() || null;

    const { data: event, error } = await supabase
      .from('community_events')
      .insert({
        ...fields,
        ...promo,
        category: categories[0] || null,
        categories,
        cover_image_url: coverImageUrl,
        creator_id: userId,
        community_id: communityId,
      })
      .select()
      .single();
    if (error) throw error;

    if (hold) {
      try {
        await freePromo.reserve({ userId, targetId: event.id, hold });
      } catch (walletErr) {
        // Sin reserva no hay campaña: se deshace el evento recién creado.
        await supabase.from('community_events').delete().eq('id', event.id);
        throw walletErr;
      }
    }

    const { error: attendeeError } = await supabase
      .from('community_event_attendees')
      .upsert(
        { event_id: event.id, user_id: userId },
        { onConflict: 'event_id,user_id', ignoreDuplicates: true }
      );
    if (attendeeError) console.warn('[community] event creator auto-join error:', attendeeError);

    // Aviso a la comunidad con cualquier plan y, si es de pago, primer
    // reparto inmediato (dentro del horario de envío).
    eventPromotion.notifyCommunityOfEvent(event)
      .then(() => (paid ? runEventPromoPacingTick() : null))
      .catch(err => console.warn('[community] event push notification error:', err.message));

    res.status(201).json({ event });
  } catch (err) {
    if (handleExpectedError(res, err)) return;
    console.error('[community] POST /events error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al crear el evento') });
  }
});

const EVENT_OWNER_COLUMNS = 'id, title, location, creator_id, community_id, event_date, ends_at, created_at, cancelled_at, promotion_plan, notification_count, notification_sent_count, ultra_banner_views, categories, max_attendees, audience_interested_only, audience_center_lat, audience_center_lng, audience_radius_km';

// Carga un evento y comprueba que quien lo pide puede gestionarlo (su creador
// o un admin de la comunidad). Responde y devuelve null si no.
async function loadManagedEvent(req, res) {
  const { data: event, error } = await supabase
    .from('community_events').select(EVENT_OWNER_COLUMNS).eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!event) {
    res.status(404).json({ error: 'Evento no encontrado' });
    return null;
  }
  if (event.creator_id !== req.user.id) {
    const { isAdmin } = await getCommunityAdminState(event.community_id, req.user.id);
    if (!isAdmin) {
      res.status(403).json({ error: 'Solo los administradores pueden gestionar este evento' });
      return null;
    }
  }
  if (event.cancelled_at) {
    res.status(400).json({ error: 'El evento está cancelado' });
    return null;
  }
  if (new Date(event.ends_at || event.event_date) < new Date()) {
    res.status(400).json({ error: 'El evento ya ha finalizado' });
    return null;
  }
  return event;
}

async function getAttendeeIds(eventId) {
  const rows = await fetchAll(() => supabase
    .from('community_event_attendees').select('user_id')
    .eq('event_id', eventId).order('user_id'));
  return rows.map(r => r.user_id);
}

// PATCH /api/community/events/:id — editar los datos del evento. Si cambia
// la fecha o el lugar se avisa a los apuntados.
router.patch('/events/:id', requireAuth, uploadEventCover, async (req, res) => {
  try {
    const event = await loadManagedEvent(req, res);
    if (!event) return;

    const fields = readEventFields(req.body, { createdAt: event.created_at });
    const dateChanged = new Date(fields.event_date).getTime() !== new Date(event.event_date).getTime();
    if (dateChanged && new Date(event.event_date) < new Date()) {
      return res.status(400).json({ error: 'El evento ya ha empezado: no se puede cambiar la fecha de inicio' });
    }
    if (dateChanged && new Date(fields.event_date) < new Date()) {
      return res.status(400).json({ error: 'La nueva fecha debe ser futura' });
    }
    if (fields.ends_at && new Date(fields.ends_at) < new Date()) {
      return res.status(400).json({ error: 'La fecha fin debe ser futura' });
    }
    const attendeeIds = await getAttendeeIds(event.id);
    if (fields.max_attendees < attendeeIds.length) {
      return res.status(400).json({ error: `Ya hay ${attendeeIds.length} personas apuntadas: el máximo no puede ser menor` });
    }
    if (req.file) fields.cover_image_url = await storeEventCover(req.file, req.user.id);

    const { data: updated, error } = await supabase
      .from('community_events').update(fields).eq('id', event.id).select().single();
    if (error) throw error;

    const placeChanged = fields.location !== event.location;
    if (dateChanged || placeChanged) {
      const what = dateChanged && placeChanged ? 'la fecha y el lugar' : dateChanged ? 'la fecha' : 'el lugar';
      notifyUsers(supabase, attendeeIds, req.user.id, {
        title: `📅 Cambios en "${updated.title}"`,
        body: `Ha cambiado ${what} del evento. Revísalo para no perdértelo.`,
        url: `/community/event/${event.id}`,
        tag: `event-updated-${event.id}`,
      }).catch(err => console.warn('[community] aviso de cambios:', err.message));
    }

    res.json({ event: updated });
  } catch (err) {
    if (handleExpectedError(res, err)) return;
    console.error('[community] PATCH /events/:id error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al editar el evento') });
  }
});

// POST /api/community/events/:id/cancel — cancela el evento: corta la
// promoción (se cobra lo entregado y vuelve el resto) y avisa a los apuntados.
router.post('/events/:id/cancel', requireAuth, async (req, res) => {
  try {
    const event = await loadManagedEvent(req, res);
    if (!event) return;
    const reason = String(req.body?.reason || '').trim().slice(0, 300) || null;

    // El filtro evita que dos cancelaciones a la vez liquiden dos veces.
    const { data: updated, error } = await supabase
      .from('community_events')
      .update({
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason,
        promotion_plan: 'basic',
        notification_count: null,
      })
      .eq('id', event.id).is('cancelled_at', null)
      .select().maybeSingle();
    if (error) throw error;
    if (!updated) return res.status(400).json({ error: 'El evento ya estaba cancelado' });

    await eventPromotion.closeEventCampaign(event, 'event_cancelled')
      .catch(err => console.error('[community] liquidación al cancelar:', err.message));

    const attendeeIds = await getAttendeeIds(event.id);
    notifyUsers(supabase, attendeeIds, req.user.id, {
      title: `❌ Evento cancelado: ${event.title}`,
      body: reason || 'El organizador ha cancelado el evento.',
      url: `/community/event/${event.id}`,
      tag: `event-cancelled-${event.id}`,
    }).catch(err => console.warn('[community] aviso de cancelación:', err.message));

    res.json({ event: updated });
  } catch (err) {
    if (handleExpectedError(res, err)) return;
    console.error('[community] POST /events/:id/cancel error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al cancelar el evento') });
  }
});

// POST /api/community/events/:id/renew-promotion — empieza un ciclo nuevo:
// liquida y archiva el anterior, borra su histórico (los ya notificados
// vuelven a ser candidatos) y reserva el nuevo. El aviso a la comunidad solo
// se repite si hace más de 72 h del último; en Basic es lo único que hace la
// renovación, así que antes de ese plazo no se permite.
router.post('/events/:id/renew-promotion', requireAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    const event = await loadManagedEvent(req, res);
    if (!event) return;
    if (event.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el creador del evento puede renovar su promoción' });
    }
    if (!['basic', 'premium', 'ultra'].includes(req.body?.promotion_plan)) {
      return res.status(400).json({ error: 'Elige un plan de promoción válido' });
    }
    const categories = (event.categories || []).filter(Boolean);
    // Sin filtros en la petición se conservan los del evento.
    const keepFilters = req.body.audience_interested_only === undefined;
    let promo = eventPromotion.parsePromotion(
      keepFilters ? { ...event, ...req.body } : req.body, categories);
    const paid = eventPromotion.isPaidPlan(promo.promotion_plan);
    if (paid && new Date(event.event_date) <= new Date()) {
      return res.status(400).json({ error: 'El evento ya ha empezado: ya no se puede promocionar' });
    }

    const noticeAt = await eventPromotion.communityNoticeAvailableAt(event);
    const canNotifyCommunity = noticeAt <= new Date();
    if (!paid && !canNotifyCommunity) {
      return res.status(400).json({
        code: 'notice_cooldown',
        available_at: noticeAt.toISOString(),
        error: `Solo puedes volver a avisar a la comunidad cada ${eventPromotion.COMMUNITY_NOTICE_COOLDOWN_HOURS} horas.`,
      });
    }

    let hold = null;
    if (paid) {
      promo = await eventPromotion.fitToAudience(promo, { creatorId: userId, communityId: event.community_id, categories });
      hold = eventPromotion.holdParams(promo, await wallet.getFreeUnits(userId, 'event', event.id));
      const openHold = wallet.paymentsEnabled() ? await wallet.getOpenHold('event', event.id) : null;
      const banners = openHold ? await eventPromotion.countBillableBanners(event.id) : 0;
      await freePromo.assertCanLaunch({
        userId,
        amountCents: hold.amountCents,
        targetId: event.id,
        creditCents: wallet.previewRefundCents(openHold, event.notification_sent_count, banners),
      });
    }

    // Si algo falla entre cerrar y reservar, el evento queda en Basic: nunca
    // con promoción activa y sin reserva.
    const { error: resetError } = await supabase
      .from('community_events')
      .update({ promotion_plan: 'basic', notification_count: null })
      .eq('id', event.id);
    if (resetError) throw resetError;
    await eventPromotion.closeEventCampaign(event, 'renewed');
    await eventPromotion.resetEventCycle(event.id, { keepCommunityNotices: !canNotifyCommunity });
    if (hold) await freePromo.reserve({ userId, targetId: event.id, hold });

    const { data: updated, error: updateError } = await supabase
      .from('community_events')
      .update({ ...promo, notification_sent_count: 0, ultra_banner_views: 0, ultra_banner_clicks: 0 })
      .eq('id', event.id)
      .select()
      .single();
    if (updateError) throw updateError;

    (canNotifyCommunity
      ? eventPromotion.notifyCommunityOfEvent(event, { renewed: true })
      : Promise.resolve())
      .then(() => (paid ? runEventPromoPacingTick() : null))
      .catch(err => console.warn('[community] renew-promotion push error:', err.message));

    res.json({ event: updated });
  } catch (err) {
    if (handleExpectedError(res, err)) return;
    console.error('[community] POST /events/:id/renew-promotion error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al renovar la promoción') });
  }
});

// POST /api/community/events/:id/end-promotion — el evento pasa a Basic y se
// liquida al momento: se cobra lo entregado y el resto vuelve al saldo.
router.post('/events/:id/end-promotion', requireAuth, async (req, res) => {
  try {
    const event = await loadManagedEvent(req, res);
    if (!event) return;
    if (event.creator_id !== req.user.id) {
      return res.status(403).json({ error: 'Solo el creador del evento puede finalizar su promoción' });
    }
    if (!eventPromotion.isPaidPlan(event.promotion_plan)) {
      return res.status(400).json({ error: 'Este evento no tiene una promoción activa que finalizar' });
    }

    const { data: updated, error: updateError } = await supabase
      .from('community_events')
      .update({ promotion_plan: 'basic', notification_count: null })
      .eq('id', event.id)
      .select()
      .single();
    if (updateError) throw updateError;

    const settled = await eventPromotion.closeEventCampaign(event, 'ended_by_owner');
    res.json({ event: updated, charged_cents: settled?.charged_cents || 0, refunded_cents: settled?.refunded_cents || 0 });
  } catch (err) {
    if (handleExpectedError(res, err)) return;
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
      .select('id, max_attendees, event_date, ends_at, cancelled_at')
      .eq('id', id)
      .single();

    if (evErr || !event) return res.status(404).json({ error: 'Evento no encontrado' });
    if (event.cancelled_at) return res.status(400).json({ error: 'El evento está cancelado' });
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
      allMembers = await selectInChunks(communityIds, ids => db
        .from('community_members')
        .select('community_id, user_id, role')
        .in('community_id', ids)
        .order('community_id').order('user_id'));
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
      const activeRaffles = await fetchAll(() => supabase
        .from('community_raffles')
        .select('id, community_id')
        .is('drawn_at', null)
        .gt('ends_at', nowIso)
        .order('id'));
      activeRaffles.forEach(r => communitiesWithActiveRaffle.add(r.community_id));

      // community_events es pública (cualquiera puede ver eventos de
      // cualquier comunidad, sea o no miembro), pero se usa igualmente el
      // cliente de servicio aquí para no depender de la política RLS y
      // mantener el mismo criterio que la consulta de sorteos de arriba.
      const upcomingEvents = await fetchAll(() => supabase
        .from('community_events')
        .select('id, community_id')
        .is('cancelled_at', null)
        .or(`ends_at.gte.${nowIso},and(ends_at.is.null,event_date.gte.${nowIso})`)
        .order('id'));
      upcomingEvents.forEach(ev => communitiesWithUpcomingEvent.add(ev.community_id));
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

    const members = await fetchAll(() => db
      .from('community_members')
      .select('user_id, role, joined_at')
      .eq('community_id', id)
      .order('user_id'));
    const currentMembership = members.find(m => m.user_id === userId);

    let hasCollaborated = false;
    let collabAvailable = false;
    if (community.collab_amount_cents) {
      collabAvailable = await connect.canReceivePayments(community.creator_id);
      const { data: existingCollab } = await db
        .from('community_collaborations')
        .select('id')
        .eq('community_id', id)
        .eq('user_id', userId)
        .eq('status', 'paid')
        .limit(1);
      hasCollaborated = Boolean(existingCollab?.length);
    }

    const { data: events, error: eventsError } = await db
      .from('community_events')
      .select(`
        id, title, description, category, categories, event_date, ends_at, location, lat, lng, organization, cover_image_url,
        max_attendees, creator_id, community_id, created_at, cancelled_at,
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
        member_count: members.length,
        member_ids: members.map(m => m.user_id),
        admin_ids: members.filter(m => m.role === 'admin').map(m => m.user_id),
        current_user_role: community.creator_id === userId ? 'admin' : currentMembership?.role || null,
        is_member: Boolean(currentMembership),
        is_admin: community.creator_id === userId || currentMembership?.role === 'admin',
        has_collaborated: hasCollaborated,
        collab_available: collabAvailable,
      },
      ...splitEvents,
    });
  } catch (err) {
    console.error('[community] GET /communities/:id error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al obtener la comunidad') });
  }
});

const assertCanCollab = (userId) => entitlements.assertEnterprise(
  userId, 'collaborations', 'Recibir colaboraciones está incluido en Enterprise.');

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
    if (collabAmountCents) await assertCanCollab(userId);
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
    if (handleExpectedError(res, err)) return;
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
      await assertCanCollab(userId);
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
    if (handleExpectedError(res, err)) return;
    console.error('[community] PATCH /communities/:id error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al actualizar la comunidad') });
  }
});

// ── GET /api/community/communities/:id/raffle-audience — tamaño de audiencia
//    para la configuración de publicidad de un sorteo Light ────────────────
// Usuarios a los que puede llegar el banner (ni miembros, ni el creador, ni
// suscriptores sin anuncios) y cuántos comparten las categorías del sorteo
// (?categories=<JSON>; si no llegan, las de la comunidad).
router.get('/communities/:id/raffle-audience', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const { data: community, error } = await supabase
      .from('communities').select('id, categories').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!community) return res.status(404).json({ error: 'Comunidad no encontrada' });

    const categories = raffleLib.effectiveCategories(parseCategories(req.query.categories), community.categories);
    const [users, freeUnits, quota] = await Promise.all([
      raffleLib.getLightAudience({ communityId: id, creatorId: req.user.id }),
      wallet.getFreeUnits(req.user.id, 'raffle', req.query.raffle_id || null),
      freePromo.getStatus(req.user.id, req.query.raffle_id || null),
    ]);
    res.json({
      total: users.length,
      interested: categories.length ? users.filter(u => audience.matchesInterests(u, categories)).length : null,
      categories_defined: categories.length > 0,
      free_units: freeUnits,
      free_promo: quota,
    });
  } catch (err) {
    console.error('[community] GET /communities/:id/raffle-audience error:', err);
    res.status(500).json({ error: 'Error al calcular la audiencia' });
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

// Aportaciones voluntarias con Stripe (ver lib/connect.js).
async function loadCollabCommunity(req, res) {
  const { data: community, error } = await supabase
    .from('communities')
    .select('id, name, creator_id, collab_amount_cents')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) throw error;
  if (!community) res.status(404).json({ error: 'Comunidad no encontrada' });
  return community;
}

function collabError(res, err, fallback) {
  if (err.status >= 400 && err.status < 600) return res.status(err.status).json({ error: err.message });
  console.error('[community] aportaciones:', err);
  return res.status(500).json({ error: fallback });
}

// POST /api/community/communities/:id/collaborate → { url } de Checkout
router.post('/communities/:id/collaborate', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const community = await loadCollabCommunity(req, res);
    if (!community) return;
    if (!community.collab_amount_cents) {
      return res.status(400).json({ error: 'Esta comunidad no tiene colaboraciones habilitadas' });
    }
    const { data: membership } = await supabase
      .from('community_members')
      .select('role')
      .eq('community_id', community.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (!membership) return res.status(403).json({ error: 'Debes pertenecer a la comunidad para colaborar' });
    if (community.creator_id === userId || membership.role === 'admin') {
      return res.status(400).json({ error: 'El administrador no puede colaborar en su propia comunidad' });
    }
    res.json({ url: await connect.createCollaboration({ community, userId, baseUrl: appBaseUrl() }) });
  } catch (err) {
    collabError(res, err, 'No se pudo iniciar la aportación');
  }
});

// POST /api/community/communities/:id/collaborate/confirm — al volver de Checkout
router.post('/communities/:id/collaborate/confirm', requireAuth, async (req, res) => {
  try {
    const sessionId = req.body?.session_id;
    if (!sessionId || typeof sessionId !== 'string') return res.status(400).json({ error: 'Falta session_id' });
    const community = await loadCollabCommunity(req, res);
    if (!community) return;
    res.json(await connect.confirmCollaboration({ community, userId: req.user.id, sessionId }));
  } catch (err) {
    collabError(res, err, 'No se pudo confirmar la aportación');
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

    // Las anteriores a los pagos ('legacy') eran simbólicas: no hubo dinero.
    const collaborations = await fetchAll(() => supabase
      .from('community_collaborations')
      .select('id, amount_cents, created_at, user:users!community_collaborations_user_id_fkey(id, username)')
      .eq('community_id', id)
      .eq('status', 'paid')
      .order('created_at', { ascending: false }).order('id'));

    res.json({
      collaborations,
      total_cents: collaborations.reduce((sum, c) => sum + (c.amount_cents || 0), 0),
      count: collaborations.length,
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
        promotion_plan, notification_count, notification_sent_count, cancelled_at, cancel_reason,
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
// Banner del inicio, exclusivo del plan Ultra: el último evento Ultra que se
// le notificó al usuario en las últimas 24 h (o, si no tiene notificaciones
// activas, uno que le encaje). Ver lib/eventPromotion.js.
router.get('/notifications/today-event', requireAuth, async (req, res) => {
  try {
    const event = await eventPromotion.getUltraBannerEvent(req.user.id);
    res.json({
      event: event && {
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
      .select('id, title, event_date, cancelled_at, creator:users!community_events_creator_id_fkey(username)')
      .eq('id', id)
      .maybeSingle();

    if (eventErr) throw eventErr;
    if (!event) return res.status(404).json({ error: 'Evento no encontrado' });
    if (event.cancelled_at) return res.status(400).json({ error: 'El evento está cancelado' });
    await entitlements.assertVolt(userId, 'locator',
      'Crear un grupo del localizador está incluido en la suscripción Volt. Unirte si te invitan es gratis.');

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
    if (handleExpectedError(res, err)) return;
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
// Fase 119: agregación de likes por sorteo. Devuelve { likeCountByRaffle,
// likedRaffleIds } donde likedRaffleIds es el conjunto de ids que el
// usuario actual ha marcado con like — mismo patrón que
// community_event_likes/enrichEvents.
async function getRaffleLikeAggregates(raffleIds, currentUserId = null) {
  const likeCountByRaffle = {};
  const likedRaffleIds = new Set();
  if (!raffleIds.length) return { likeCountByRaffle, likedRaffleIds };
  const rows = await selectInChunks(raffleIds, ids => supabase
    .from('community_raffle_likes')
    .select('raffle_id, user_id')
    .in('raffle_id', ids)
    .order('raffle_id').order('user_id'));
  for (const row of rows) {
    likeCountByRaffle[row.raffle_id] = (likeCountByRaffle[row.raffle_id] || 0) + 1;
    if (currentUserId && row.user_id === currentUserId) {
      likedRaffleIds.add(row.raffle_id);
    }
  }
  return { likeCountByRaffle, likedRaffleIds };
}

// Fase 122 — carga los premios de un lote de sorteos, con los datos del
// ganador de cada uno. Map raffleId → array de premios. Los sorteos anteriores
// a la fase 122 no tienen filas y salen como [].
async function fetchRafflePrizes(raffleIds) {
  const map = new Map();
  const rows = await selectInChunks(raffleIds, ids => supabase
    .from('community_raffle_prizes')
    .select('id, raffle_id, position, title, image_url, value_cents, requires_goal, claim_status, claim_deadline, claimed_at, delivered_at, received_at, winner:winner_id(id, username, avatar_url)')
    .in('raffle_id', ids)
    .order('raffle_id').order('position'));
  for (const { raffle_id, ...prize } of rows) {
    if (!map.has(raffle_id)) map.set(raffle_id, []);
    map.get(raffle_id).push(prize);
  }
  return map;
}

const RAFFLE_COLUMNS = `
  id, community_id, creator_id, title, description, image_url,
  ends_at, drawn_at, created_at, tier, categories, banner_views_contracted,
  banner_interested_only, promo_ended_at, requires_entry, goal_cents,
  organizer_name, organizer_contact, rules_text, draw_commit, draw_seed, draw_entries,
  winner:winner_id(id, username, avatar_url)
`;

// Completa y serializa una lista de sorteos (filas de RAFFLE_COLUMNS).
async function serializeRaffles(raffles, userId) {
  const ids = raffles.map(r => r.id);
  const [bannerSentCounts, likes, prizesByRaffle, participation, raised] = await Promise.all([
    raffleLib.getBannerSentCounts(ids),
    getRaffleLikeAggregates(ids, userId),
    fetchRafflePrizes(ids),
    raffleLib.getParticipationInfo(raffles, userId),
    raffleLib.getRaisedByRaffle(raffles),
  ]);
  return raffles.map(r => serializeRaffle(r, {
    ...participation.get(r.id),
    currentUserId: userId,
    bannerViewsSent: bannerSentCounts[r.id] || 0,
    likeCount: likes.likeCountByRaffle[r.id] || 0,
    likedByMe: likes.likedRaffleIds.has(r.id),
    prizes: prizesByRaffle.get(r.id) || [],
    raisedCents: raised.get(r.id) ?? null,
  }));
}

function serializeRaffle(raffle, { participantCount, entered, isEligible, currentUserId, bannerViewsSent, likeCount, likedByMe, prizes = [], raisedCents = null }) {
  const tier = raffleLib.normalizeRaffleTier(raffle.tier);
  const tierMeta = raffleLib.RAFFLE_TIERS[tier];
  const isCreator = raffle.creator_id === currentUserId;

  // El estado de entrega de cada premio solo lo ven el organizador y quien
  // lo ha ganado.
  const prizeArray = [...prizes]
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map(p => {
      const isMine = Boolean(p.winner) && p.winner.id === currentUserId;
      return isCreator || isMine ? { ...p, is_mine: isMine } : {
        id: p.id,
        position: p.position,
        title: p.title,
        image_url: p.image_url,
        value_cents: p.value_cents,
        requires_goal: p.requires_goal,
        winner: p.winner,
        is_mine: false,
      };
    });

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
    prizes: prizeArray,
    is_drawn: !!raffle.drawn_at,
    // Ganador "principal": el del primer premio adjudicado o, en sorteos
    // anteriores a la fase 122, el único que había.
    winner: prizeArray.length ? (prizeArray.find(p => p.winner)?.winner || null) : (raffle.winner || null),
    participant_count: raffle.drawn_at && raffle.draw_entries != null ? raffle.draw_entries : participantCount ?? null,
    tier,
    tier_label: tierMeta.label,
    tier_rules: tierMeta.rules,
    price_cents: tierMeta.price_cents,
    banner_views_contracted: raffle.banner_views_contracted ?? null,
    banner_views_sent: bannerViewsSent ?? 0,
    like_count: likeCount ?? 0,
    liked_by_current_user: !!likedByMe,
    banner_interested_only: !!raffle.banner_interested_only,
    promo_ended_at: raffle.promo_ended_at || null,
    is_creator: isCreator,
    can_participate: !isCreator && !!isEligible,
    requires_entry: !!raffle.requires_entry,
    entered: !!entered,
    goal_cents: raffle.goal_cents ?? null,
    raised_cents: raffle.goal_cents ? raisedCents ?? 0 : null,
    organizer_name: raffle.organizer_name || null,
    organizer_contact: raffle.organizer_contact || null,
    rules_text: raffle.rules_text || null,
    draw_commit: raffle.draw_commit || null,
    draw_seed: raffle.drawn_at ? raffle.draw_seed || null : null,
  };
}

// Datos mínimos de la comunidad para las tarjetas de descubrimiento.
function withCommunity(serialized, rows) {
  return serialized.map((raffle, i) => {
    const c = rows[i].community;
    return {
      ...raffle,
      community: c ? {
        id: c.id,
        name: c.name,
        cover_image_url: c.cover_image_url,
        categories: Array.isArray(c.categories) ? c.categories : [],
      } : null,
    };
  });
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
// Incluye finalizados y sorteados; como mucho los 300 más recientes.
router.get('/raffles/ranking', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('community_raffles')
      .select(`${RAFFLE_COLUMNS}, community:community_id(id, name, cover_image_url, categories)`)
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw error;
    res.json({ raffles: withCommunity(await serializeRaffles(data || [], req.user.id), data || []) });
  } catch (err) {
    console.error('[community] GET /raffles/ranking', err);
    res.status(500).json({ error: 'Error al obtener el ranking de sorteos' });
  }
});

// ── GET /api/community/raffles — descubrimiento global de sorteos ──────────
// Sorteos activos de todas las comunidades ("Actividades → Sorteos"). Con el
// cliente de servicio, para mostrar también los de comunidades ajenas.
router.get('/raffles', requireAuth, async (req, res) => {
  try {
    const rows = await fetchAll(() => supabase
      .from('community_raffles')
      .select(`${RAFFLE_COLUMNS}, community:community_id(id, name, cover_image_url, categories)`)
      .is('drawn_at', null)
      .gt('ends_at', new Date().toISOString())
      .order('created_at', { ascending: false }).order('id'));
    res.json({ raffles: withCommunity(await serializeRaffles(rows, req.user.id), rows) });
  } catch (err) {
    console.error('[community] GET /raffles', err);
    res.status(500).json({ error: 'Error al obtener los sorteos' });
  }
});

// ── GET /api/community/communities/:id/raffles — listar sorteos ────────────
// Se ven también sin ser miembro (para animar a unirse).
router.get('/communities/:id/raffles', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('community_raffles')
      .select(RAFFLE_COLUMNS)
      .eq('community_id', req.params.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ raffles: await serializeRaffles(data || [], req.user.id) });
  } catch (err) {
    console.error('[community] GET /communities/:id/raffles', err);
    res.status(500).json({ error: 'Error al obtener los sorteos' });
  }
});

const PRIZE_MAX_PER_RAFFLE = 10;

// Valida los premios que manda el cliente: JSON con {title, value_cents,
// requires_goal, has_image, image_index}; image_index apunta a un fichero de
// req.files.prize_image.
function readPrizes(body, files) {
  const fail = (message) => { throw new eventPromotion.PromotionInputError(message); };
  let raw;
  try {
    raw = JSON.parse(body.prizes || '[]');
  } catch {
    fail('Los premios llegaron en formato inválido');
  }
  if (!Array.isArray(raw) || raw.length < 1) fail('Añade al menos un premio al sorteo');
  if (raw.length > PRIZE_MAX_PER_RAFFLE) fail(`Puedes añadir hasta ${PRIZE_MAX_PER_RAFFLE} premios por sorteo`);

  return raw.map((prize, i) => {
    const title = String(prize?.title || '').trim();
    if (!title || title.length > 120) fail(`Premio ${i + 1}: el nombre es obligatorio (máx. 120 caracteres)`);
    let valueCents = null;
    if (prize.value_cents != null && prize.value_cents !== '' && prize.value_cents !== false) {
      valueCents = Number.parseInt(prize.value_cents, 10);
      if (!Number.isFinite(valueCents) || valueCents < 0) fail(`Premio ${i + 1}: la valoración económica no es válida`);
    }
    let imageFile = null;
    if (prize.has_image) {
      imageFile = files[Number.parseInt(prize.image_index, 10)] || null;
      if (!imageFile) fail(`Premio ${i + 1}: falta la foto adjunta`);
    }
    return { title, value_cents: valueCents, requires_goal: prize.requires_goal === true, imageFile };
  });
}

function readBannerViews(value) {
  const views = Number.parseInt(value, 10);
  if (!Number.isFinite(views) || views < raffleLib.BANNER_VIEWS_MIN || views > raffleLib.BANNER_VIEWS_MAX) {
    throw new eventPromotion.PromotionInputError(
      `Elige cuántas visualizaciones quieres contratar (entre ${raffleLib.BANNER_VIEWS_MIN} y ${raffleLib.BANNER_VIEWS_MAX})`);
  }
  return views;
}

// Publicidad de un sorteo Light: visualizaciones (recortadas a la audiencia
// que existe) y reserva de saldo.
async function planLightCampaign({ body, communityId, userId, categories, targetId = null }) {
  const interestedOnly = String(body.banner_interested_only) === 'true';
  if (interestedOnly && !categories.length) {
    throw new eventPromotion.PromotionInputError('Ni el sorteo ni la comunidad tienen categorías de intereses definidas: no se puede filtrar por interesados');
  }
  const requested = freePromo.capUnits(readBannerViews(body.banner_views_contracted));
  const users = await raffleLib.getLightAudience({ communityId, creatorId: userId });
  const reachable = interestedOnly ? users.filter(u => audience.matchesInterests(u, categories)).length : users.length;
  const views = audience.clampContracted(requested, reachable);
  const unitPriceCents = RAFFLE_AD_PRICING.light.unitPriceCents;
  const freeUnits = await wallet.getFreeUnits(userId, 'raffle', targetId);
  return {
    interestedOnly,
    views,
    amountCents: Math.max(0, views - freeUnits) * unitPriceCents,
    hold: { userId, kind: 'raffle', plan: 'light', unitPriceCents, units: views, freeUnits },
  };
}

// Un organizador con un premio reclamado como no entregado no puede abrir
// más sorteos hasta resolverlo.
async function assertNoDisputedPrizes(userId) {
  const { count, error } = await supabase
    .from('community_raffle_prizes')
    .select('id, raffle:raffle_id!inner(creator_id)', { count: 'exact', head: true })
    .eq('claim_status', 'disputed').eq('raffle.creator_id', userId);
  if (error) throw error;
  if (count) {
    throw new entitlements.EntitlementError(
      'Tienes un premio reclamado por su ganador. Resuélvelo antes de crear otro sorteo.',
      { code: 'disputed_prize' });
  }
}

// Requisitos del sorteo Community: meta de aportaciones y, si hay pagos, que
// la comunidad pueda recibirlas.
async function readCommunityGoal({ body, prizes, community, userId }) {
  if (!wallet.paymentsEnabled()) return null;
  const fail = (message) => { throw new eventPromotion.PromotionInputError(message); };
  const goal = Number.parseInt(body.goal_cents, 10);
  if (!Number.isFinite(goal) || goal < 500 || goal > 1000000) fail('La meta debe estar entre 5 € y 10.000 €');
  if (!prizes.some(p => p.requires_goal)) fail('Marca al menos un premio extra, que se desbloquee al alcanzar la meta');
  if (!community.collab_amount_cents) fail('Activa antes las colaboraciones en los ajustes de la comunidad');
  if (!await connect.canReceivePayments(userId)) {
    throw new entitlements.EntitlementError(
      'Conecta antes tu cuenta de Stripe (en Saldo) para poder recibir aportaciones.', { code: 'connect_required' });
  }
  return goal;
}

// ── POST /api/community/communities/:id/raffles — crear sorteo ─────────────
// Solo el CREADOR de la comunidad (no vale con ser admin/moderador promovido).
router.post('/communities/:id/raffles', requireAuth, uploadRaffleAssets, async (req, res) => {
  const userId = req.user.id;
  const communityId = req.params.id;
  const { title, description, ends_at, tier } = req.body;

  try {
    if (!title?.trim()) return res.status(400).json({ error: 'El título es obligatorio' });
    if (!ends_at) return res.status(400).json({ error: 'La fecha de fin es obligatoria' });
    if (tier && !raffleLib.RAFFLE_TIER_KEYS.includes(tier)) {
      return res.status(400).json({ error: 'Tipo de sorteo no válido' });
    }
    // Sin pagos solo hay un tipo de sorteo, con promoción gratis opcional.
    const paymentsOn = wallet.paymentsEnabled();
    const raffleTier = paymentsOn ? raffleLib.normalizeRaffleTier(tier) : 'light';
    const wantsPromo = paymentsOn || Boolean(req.body.banner_views_contracted);

    const categories = parseCategories(req.body.categories);
    if (categories.length < 1) return res.status(400).json({ error: 'Elige al menos una categoría para el sorteo' });
    if (categories.length > MAX_CATEGORIES) {
      return res.status(400).json({ error: `Puedes elegir hasta ${MAX_CATEGORIES} categorías` });
    }

    const endsAt = new Date(ends_at);
    if (Number.isNaN(endsAt.getTime())) return res.status(400).json({ error: 'La fecha de fin no es válida' });
    if (endsAt <= new Date()) return res.status(400).json({ error: 'La fecha de fin debe ser en el futuro' });
    if (raffleTier === 'volt' && endsAt > new Date(Date.now() + raffleLib.VOLT_MAX_DURATION_DAYS * 24 * 3600 * 1000)) {
      return res.status(400).json({ error: `Los sorteos Volt pueden durar como máximo ${raffleLib.VOLT_MAX_DURATION_DAYS} días.` });
    }
    if (endsAt > addMonths(new Date(), 6)) {
      return res.status(400).json({ error: 'El sorteo puede durar como máximo 6 meses' });
    }

    const organizerName = String(req.body.organizer_name || '').trim();
    const organizerContact = String(req.body.organizer_contact || '').trim();
    if (organizerName.length < 3 || organizerName.length > 120) {
      return res.status(400).json({ error: 'Indica quién organiza el sorteo (nombre o razón social)' });
    }
    if (organizerContact.length < 5 || organizerContact.length > 120) {
      return res.status(400).json({ error: 'Indica un email o teléfono de contacto del organizador' });
    }
    if (String(req.body.organizer_accepts) !== 'true') {
      return res.status(400).json({ error: 'Debes aceptar que eres responsable del sorteo y de entregar los premios' });
    }

    const prizes = readPrizes(req.body, req.files?.prize_image || []);
    if (raffleTier !== 'community') prizes.forEach(p => { p.requires_goal = false; });
    if (prizes.every(p => p.requires_goal)) {
      return res.status(400).json({ error: 'Al menos un premio debe sortearse aunque no se alcance la meta' });
    }

    const { data: community } = await supabase
      .from('communities')
      .select('id, creator_id, name, categories, collab_amount_cents')
      .eq('id', communityId)
      .maybeSingle();
    if (!community) return res.status(404).json({ error: 'Comunidad no encontrada' });
    if (community.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el creador de la comunidad puede crear un sorteo' });
    }

    await assertNoDisputedPrizes(userId);
    if (raffleTier === 'community') {
      await entitlements.assertEnterprise(userId, 'community_raffle', 'Los sorteos Community están incluidos en Enterprise.');
    }
    await entitlements.assertCanCreateActivity(userId, communityId);
    if (raffleTier === 'volt') {
      const subscribers = await raffleLib.countVoltSubscribers(communityId);
      if (subscribers < raffleLib.VOLT_MIN_SUBSCRIBERS) {
        return res.status(400).json({
          code: 'volt_subscribers_required',
          error: `Para crear un sorteo Volt, tu comunidad necesita al menos ${raffleLib.VOLT_MIN_SUBSCRIBERS} miembros con suscripción Volt (ahora hay ${subscribers}).`,
        });
      }
    }
    const goalCents = raffleTier === 'community'
      ? await readCommunityGoal({ body: req.body, prizes, community, userId }) : null;
    if (!goalCents) prizes.forEach(p => { p.requires_goal = false; });

    const raffleCategories = raffleLib.effectiveCategories(categories, community.categories);
    const light = raffleTier === 'light' && wantsPromo
      ? await planLightCampaign({ body: req.body, communityId, userId, categories: raffleCategories }) : null;
    const feeCents = raffleTier === 'community' ? COMMUNITY_RAFFLE_FEE_CENTS : 0;
    if (light || feeCents) {
      await freePromo.assertCanLaunch({ userId, amountCents: (light?.amountCents || 0) + feeCents });
    }

    const coverFile = req.files?.image?.[0] || null;
    const imageUrl = coverFile ? await storeImage({
      file: coverFile,
      objectName: `raffle-images/${communityId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fallbackMaxLength: 6000000,
    }) : null;
    const prizeRows = [];
    for (let i = 0; i < prizes.length; i += 1) {
      const { imageFile, ...prize } = prizes[i];
      prizeRows.push({
        ...prize,
        position: i + 1,
        image_url: imageFile ? await storeImage({
          file: imageFile,
          objectName: `raffle-prizes/${communityId}/${i}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fallbackMaxLength: 6000000,
        }) : null,
      });
    }

    const secret = createDrawSecret();
    const fields = {
      community_id: communityId,
      creator_id: userId,
      title: title.trim(),
      description: description?.trim() || null,
      image_url: imageUrl,
      ends_at: endsAt.toISOString(),
      tier: raffleTier,
      categories,
      banner_views_contracted: light?.views ?? null,
      banner_interested_only: light?.interestedOnly ?? false,
      promo_ended_at: wantsPromo ? null : new Date().toISOString(),
      requires_entry: true,
      goal_cents: goalCents,
      organizer_name: organizerName,
      organizer_contact: organizerContact,
      draw_commit: secret.commit,
    };
    const { data: raffle, error } = await supabase
      .from('community_raffles')
      .insert({ ...fields, rules_text: buildRaffleRules({ raffle: fields, prizes: prizeRows, communityName: community.name }) })
      .select(RAFFLE_COLUMNS)
      .single();
    if (error) throw error;

    try {
      const { error: secretError } = await supabase
        .from('raffle_draw_secrets').insert({ raffle_id: raffle.id, seed: secret.seed });
      if (secretError) throw secretError;
      const { error: prizesError } = await supabase
        .from('community_raffle_prizes').insert(prizeRows.map(p => ({ ...p, raffle_id: raffle.id })));
      if (prizesError) throw prizesError;
      // El cobro, lo último: si falla algo antes no hay nada que devolver.
      if (light) await freePromo.reserve({ userId, targetId: raffle.id, hold: light.hold });
      if (feeCents) {
        await wallet.chargeFee({ userId, amountCents: feeCents, description: `Sorteo Community: ${raffle.title}` });
      }
    } catch (createError) {
      await supabase.from('community_raffles').delete().eq('id', raffle.id);
      throw createError;
    }

    raffleLib.announceRaffle({ raffle, communityName: community.name, categories: raffleCategories })
      .catch(err => console.warn('[community] aviso de sorteo:', err.message));

    const [serialized] = await serializeRaffles([raffle], userId);
    res.status(201).json({ raffle: serialized });
  } catch (err) {
    if (handleExpectedError(res, err)) return;
    console.error('[community] POST /communities/:id/raffles', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al crear el sorteo') });
  }
});

// ── Participar ─────────────────────────────────────────────────────────────

async function loadOpenRaffle(req, res) {
  const { data: raffle, error } = await supabase
    .from('community_raffles')
    .select('id, community_id, creator_id, tier, ends_at, drawn_at, requires_entry')
    .eq('id', req.params.raffleId).maybeSingle();
  if (error) throw error;
  if (!raffle) {
    res.status(404).json({ error: 'Sorteo no encontrado' });
    return null;
  }
  if (raffle.drawn_at || new Date(raffle.ends_at) <= new Date()) {
    res.status(400).json({ error: 'Este sorteo ya ha terminado' });
    return null;
  }
  return raffle;
}

// POST /api/community/raffles/:raffleId/entry — participar (gratis).
router.post('/raffles/:raffleId/entry', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const raffle = await loadOpenRaffle(req, res);
    if (!raffle) return;
    if (!raffle.requires_entry) return res.json({ entered: true });
    if (req.body?.accept_rules !== true) {
      return res.status(400).json({ error: 'Debes aceptar las bases y confirmar que eres mayor de 18 años' });
    }

    const [{ data: membership }, { data: user }] = await Promise.all([
      supabase.from('community_members').select('role')
        .eq('community_id', raffle.community_id).eq('user_id', userId).maybeSingle(),
      supabase.from('users').select('created_at').eq('id', userId).maybeSingle(),
    ]);
    if (!membership) return res.status(403).json({ error: 'Únete a la comunidad para participar' });
    if (membership.role === 'admin' || raffle.creator_id === userId) {
      return res.status(403).json({ error: 'El organizador y los administradores no pueden participar' });
    }
    const ageMs = Date.now() - new Date(user?.created_at || Date.now()).getTime();
    if (ageMs < raffleLib.MIN_ACCOUNT_AGE_HOURS * 3600 * 1000) {
      return res.status(403).json({ error: `Tu cuenta debe tener al menos ${raffleLib.MIN_ACCOUNT_AGE_HOURS} horas para participar` });
    }

    const { error } = await supabase.from('raffle_entries').upsert(
      { raffle_id: raffle.id, user_id: userId },
      { onConflict: 'raffle_id,user_id', ignoreDuplicates: true });
    if (error) throw error;
    res.json({ entered: true });
  } catch (err) {
    console.error('[community] POST /raffles/:raffleId/entry', err);
    res.status(500).json({ error: 'Error al participar en el sorteo' });
  }
});

// DELETE /api/community/raffles/:raffleId/entry — dejar de participar.
router.delete('/raffles/:raffleId/entry', requireAuth, async (req, res) => {
  try {
    const raffle = await loadOpenRaffle(req, res);
    if (!raffle) return;
    const { error } = await supabase.from('raffle_entries').delete()
      .eq('raffle_id', raffle.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ entered: false });
  } catch (err) {
    console.error('[community] DELETE /raffles/:raffleId/entry', err);
    res.status(500).json({ error: 'Error al salir del sorteo' });
  }
});

// ── Banner de sorteos ("avioneta") ─────────────────────────────────────────
// Se llama al entrar en el menú principal. Como mucho una por usuario cada 15
// minutos y una vez por sorteo. Prioridad: Community, Light, Volt; dentro de
// cada tipo, primero los de las comunidades del usuario y después, entre los
// que menos se han enseñado, los que encajan con sus intereses.
const BANNER_COOLDOWN_MS = 15 * 60 * 1000;

router.get('/raffle-banner', requireAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    const { data: lastShown, error: lastShownErr } = await supabase
      .from('raffle_banner_targets')
      .select('shown_at')
      .eq('user_id', userId)
      .not('shown_at', 'is', null)
      .order('shown_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastShownErr) throw lastShownErr;
    if (lastShown?.shown_at && Date.now() - new Date(lastShown.shown_at).getTime() < BANNER_COOLDOWN_MS) {
      return res.json({ banner: null });
    }

    const user = (await audience.loadAudience()).get(userId);
    if (!user) return res.json({ banner: null });

    const [raffles, seenRows, memberships] = await Promise.all([
      fetchAll(() => supabase
        .from('community_raffles')
        .select('id, community_id, creator_id, title, tier, image_url, categories, banner_views_contracted, banner_interested_only, created_at, community:community_id(id, name, categories)')
        .is('drawn_at', null)
        .is('promo_ended_at', null)
        .gt('ends_at', new Date().toISOString())
        .order('created_at').order('id')),
      fetchAll(() => supabase
        .from('raffle_banner_targets').select('raffle_id')
        .eq('user_id', userId).not('shown_at', 'is', null).order('raffle_id')),
      fetchAll(() => supabase
        .from('community_members').select('community_id').eq('user_id', userId).order('community_id')),
    ]);
    const seen = new Set(seenRows.map(r => r.raffle_id));
    const mine = new Set(memberships.map(m => m.community_id));

    const candidates = raffles.filter(r => !seen.has(r.id)).map(raffle => ({
      raffle,
      tier: raffleLib.normalizeRaffleTier(raffle.tier),
      isMember: mine.has(raffle.community_id),
      categories: raffleLib.effectiveCategories(raffle.categories, raffle.community?.categories),
    }));

    let picked = null;
    for (const tier of ['community', 'light', 'volt']) {
      const inTier = candidates.filter(c => c.tier === tier);
      const shownCounts = await raffleLib.getBannerSentCounts(inTier.map(c => c.raffle.id));
      const rows = inTier.filter(c => raffleLib.canSeeBanner({ ...c, user, shown: shownCounts[c.raffle.id] || 0 }));
      if (!rows.length) continue;

      picked = rows.find(c => c.isMember);
      if (!picked) {
        const ratioById = new Map(rows.map(c => [c.raffle.id,
          (shownCounts[c.raffle.id] || 0) / (c.raffle.banner_views_contracted || 1)]));
        picked = pickRaffleFromRatioGroups({
          sortedIds: rows.map(c => c.raffle.id).sort((a, b) => ratioById.get(a) - ratioById.get(b)),
          rowsById: new Map(rows.map(c => [c.raffle.id, c])),
          ratioById,
          matchesCategory: c => audience.matchesInterests(user, c.categories),
          isRestricted: () => false, // los no servibles ya se han quitado
          groupSize: BOOST_GROUP_SIZE,
        });
      }
      if (picked) break;
    }
    if (!picked) return res.json({ banner: null });

    const matched = picked.categories.length ? audience.matchesInterests(user, picked.categories) : null;
    if (!await raffleLib.claimBannerShown(picked.raffle.id, userId, matched)) {
      return res.json({ banner: null }); // otra petición simultánea lo ha enseñado
    }

    res.json({
      banner: {
        raffle_id: picked.raffle.id,
        community_id: picked.raffle.community_id,
        community_name: picked.raffle.community?.name || 'Comunidad',
        title: picked.raffle.title,
        tier: picked.tier,
        image_url: picked.raffle.image_url || null,
      },
    });
  } catch (err) {
    console.error('[community] GET /raffle-banner', err);
    res.status(500).json({ error: 'Error al obtener el banner de sorteos' });
  }
});

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
// Esto no infla la facturación de un sorteo Light: el push solo se manda a
// miembros de la comunidad, que en Light no tienen fila.
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
//
// Fase 126 — además de incrementar el contador (fast-path del
// dashboard), se inserta una fila en promo_metric_events para poder
// reconstruir la serie temporal. Los dos writes NO se hacen
// transaccionales — si uno falla, el otro se mantiene: el dashboard
// principal usa el contador y el gráfico usa el log, así una pequeña
// divergencia entre ellos es aceptable (ver comentario del schema).
router.post('/communities/:id/url-click', requireAuth, async (req, res) => {
  const communityId = req.params.id;
  try {
    const { error } = await supabase.rpc('increment_community_url_clicks', { p_id: communityId });
    if (error) throw error;
    // Fase 126 — log timestampeado para gráficos temporales.
    supabase.from('promo_metric_events')
      .insert({ kind: 'community_url_click', target_id: communityId, user_id: req.user.id })
      .then(({ error: logErr }) => {
        if (logErr) console.warn('[community] community_url_click log insert failed:', logErr.message);
      });
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
    // Fase 126 — log timestampeado para gráficos temporales.
    supabase.from('promo_metric_events')
      .insert({ kind: 'event_url_click', target_id: eventId, user_id: req.user.id })
      .then(({ error: logErr }) => {
        if (logErr) console.warn('[community] event_url_click log insert failed:', logErr.message);
      });
    res.status(204).end();
  } catch (err) {
    console.error('[community] POST /events/:id/url-click', err);
    res.status(204).end();
  }
});

// Fase 123 — click en el banner del menú principal (exclusivo Ultra).
// Se dispara desde HomePage.jsx cuando el usuario tapea el panel del
// evento notificado hoy. Contador ingenuo, no personas únicas — mismo
// criterio que url-click (fase 121): aquí se mide la tracción bruta
// del banner Ultra frente a los clicks de personas únicas de la
// notificación push que ya se cuentan en event_promo_notifications.
router.post('/events/:id/ultra-banner-click', requireAuth, async (req, res) => {
  const eventId = req.params.id;
  try {
    const { error } = await supabase.rpc('increment_event_ultra_banner_clicks', { p_id: eventId });
    if (error) throw error;
    // Fase 126 — log timestampeado para gráficos temporales.
    supabase.from('promo_metric_events')
      .insert({ kind: 'ultra_banner_click', target_id: eventId, user_id: req.user.id })
      .then(({ error: logErr }) => {
        if (logErr) console.warn('[community] ultra_banner_click log insert failed:', logErr.message);
      });
    res.status(204).end();
  } catch (err) {
    console.error('[community] POST /events/:id/ultra-banner-click', err);
    res.status(204).end();
  }
});


// ══════════════════════════════════════════════════════════════════════════
// Fase 112 — Fin y renovación de la publicidad de un sorteo
// ══════════════════════════════════════════════════════════════════════════

// Volt es gratis y tiene tope de banners: no hay nada que cerrar ni renovar.
const RAFFLE_LIFECYCLE_TIERS = new Set(['light', 'community']);

async function loadOwnRaffle(req, res) {
  const { data: raffle, error } = await supabase
    .from('community_raffles')
    .select('id, title, creator_id, community_id, tier, categories, created_at, ends_at, drawn_at, promo_ended_at, member_notice_at, banner_views_contracted, banner_interested_only')
    .eq('id', req.params.raffleId)
    .maybeSingle();
  if (error) throw error;
  const fail = (status, message) => { res.status(status).json({ error: message }); return null; };
  if (!raffle) return fail(404, 'Sorteo no encontrado');
  if (raffle.creator_id !== req.user.id) return fail(403, 'Solo el creador del sorteo puede gestionar su publicidad');
  if (!RAFFLE_LIFECYCLE_TIERS.has(raffleLib.normalizeRaffleTier(raffle.tier))) {
    return fail(400, 'Los sorteos Volt no tienen publicidad de pago.');
  }
  if (raffle.drawn_at) return fail(400, 'Este sorteo ya está sorteado');
  if (new Date(raffle.ends_at) <= new Date()) return fail(400, 'Este sorteo ya ha terminado');
  return raffle;
}

// Los miembros reciben como mucho un aviso del mismo sorteo cada 72 h.
function raffleNoticeAvailableAt(raffle) {
  const last = new Date(raffle.member_notice_at || raffle.created_at).getTime();
  return new Date(last + eventPromotion.COMMUNITY_NOTICE_COOLDOWN_HOURS * 3600 * 1000);
}

// Liquida lo enseñado y guarda el resumen del ciclo en el historial.
async function closeRaffleCampaign(raffle, reason) {
  const shown = await raffleLib.countRaffleShown(raffle.id);
  const { count: clicks } = await supabase
    .from('raffle_banner_targets').select('id', { count: 'exact', head: true })
    .eq('raffle_id', raffle.id).not('clicked_at', 'is', null);
  const settled = await wallet.settleCampaign({ kind: 'raffle', targetId: raffle.id, unitsDelivered: shown, reason });
  const { error } = await supabase.from('ad_campaign_history').insert({
    community_id: raffle.community_id,
    kind: 'raffle',
    target_id: raffle.id,
    title: raffle.title,
    plan: raffle.tier,
    contracted: raffle.banner_views_contracted,
    delivered: shown,
    clicks: clicks || 0,
    charged_cents: settled?.settled ? settled.charged_cents : await wallet.lastChargedCents('raffle', raffle.id),
    reason,
  });
  if (error) console.warn('[community] no se pudo archivar la campaña:', error.message);
  return settled;
}

// ── POST /api/community/raffles/:raffleId/end-promotion ────────────────────
// Deja de enseñar banners y liquida al momento. El sorteo sigue vivo.
router.post('/raffles/:raffleId/end-promotion', requireAuth, async (req, res) => {
  try {
    const raffle = await loadOwnRaffle(req, res);
    if (!raffle) return;
    const { data: updated, error } = await supabase
      .from('community_raffles')
      .update({ promo_ended_at: new Date().toISOString() })
      .eq('id', raffle.id)
      .is('promo_ended_at', null)
      .select('id, promo_ended_at')
      .maybeSingle();
    if (error) throw error;
    if (!updated) return res.status(400).json({ error: 'La publicidad de este sorteo ya está finalizada' });

    const settled = await closeRaffleCampaign(raffle, 'ended_by_owner');
    res.json({ raffle: updated, charged_cents: settled?.charged_cents || 0, refunded_cents: settled?.refunded_cents || 0 });
  } catch (err) {
    console.error('[community] POST /raffles/:raffleId/end-promotion error:', err);
    res.status(500).json({ error: 'Error al finalizar la publicidad del sorteo' });
  }
});

// ── POST /api/community/raffles/:raffleId/renew-promotion ──────────────────
// Ciclo nuevo: se archivan las métricas del anterior y quien ya vio el banner
// puede volver a verlo. Light contrata de nuevo; en Community solo repite el
// aviso a los miembros, como mucho cada 72 h.
router.post('/raffles/:raffleId/renew-promotion', requireAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    const raffle = await loadOwnRaffle(req, res);
    if (!raffle) return;
    const tier = raffleLib.normalizeRaffleTier(raffle.tier);
    const { data: community, error: commErr } = await supabase
      .from('communities').select('id, name, categories').eq('id', raffle.community_id).single();
    if (commErr || !community) return res.status(404).json({ error: 'Comunidad no encontrada' });
    const categories = raffleLib.effectiveCategories(raffle.categories, community.categories);

    const noticeAt = raffleNoticeAvailableAt(raffle);
    const canNotify = noticeAt <= new Date();
    if (tier === 'community' && !canNotify) {
      return res.status(400).json({
        code: 'notice_cooldown',
        available_at: noticeAt.toISOString(),
        error: `Solo puedes volver a avisar a la comunidad cada ${eventPromotion.COMMUNITY_NOTICE_COOLDOWN_HOURS} horas.`,
      });
    }

    // Todo se valida ANTES de liquidar o borrar nada.
    let light = null;
    if (tier === 'light') {
      light = await planLightCampaign({
        body: req.body || {}, communityId: raffle.community_id, userId, categories, targetId: raffle.id,
      });
      const openHold = wallet.paymentsEnabled() ? await wallet.getOpenHold('raffle', raffle.id) : null;
      const shown = openHold ? await raffleLib.countRaffleShown(raffle.id) : 0;
      await freePromo.assertCanLaunch({
        userId,
        amountCents: light.amountCents,
        targetId: raffle.id,
        creditCents: wallet.previewRefundCents(openHold, shown),
      });
    }

    // Mientras dura el cambio la promo queda cerrada: nunca activa sin reserva.
    if (!raffle.promo_ended_at) {
      const { error: closeErr } = await supabase
        .from('community_raffles').update({ promo_ended_at: new Date().toISOString() }).eq('id', raffle.id);
      if (closeErr) throw closeErr;
      await closeRaffleCampaign(raffle, 'renewed');
    }
    const { error: delErr } = await supabase
      .from('raffle_banner_targets').delete().eq('raffle_id', raffle.id);
    if (delErr) throw delErr;
    if (light) await freePromo.reserve({ userId, targetId: raffle.id, hold: light.hold });

    const { data: updated, error: updateErr } = await supabase
      .from('community_raffles')
      .update({
        promo_ended_at: null,
        banner_views_contracted: light?.views ?? null,
        banner_interested_only: light?.interestedOnly ?? false,
        ...(canNotify ? { member_notice_at: new Date().toISOString() } : {}),
      })
      .eq('id', raffle.id)
      .select('id, promo_ended_at, banner_views_contracted, banner_interested_only')
      .single();
    if (updateErr) throw updateErr;

    if (canNotify) {
      raffleLib.announceRaffle({ raffle, communityName: community.name, categories })
        .catch(err => console.warn('[community] aviso de renovación:', err.message));
    }
    res.json({ raffle: updated });
  } catch (err) {
    if (handleExpectedError(res, err)) return;
    console.error('[community] POST /raffles/:raffleId/renew-promotion error:', err);
    res.status(500).json({ error: 'Error al renovar la publicidad del sorteo' });
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

// Panel básico (sin Enterprise): sin desglose por intereses.
function withoutAdvanced(row) {
  return {
    ...row,
    interest: null,
    clicks: { total: row.clicks.total },
    ctr_interested: null,
    ctr_not_interested: null,
  };
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
        .select('id, title, event_date, ends_at, created_at, categories, promotion_plan, notification_count, notification_sent_count, audience_interested_only, audience_radius_km, url, url_click_count, ultra_banner_views, ultra_banner_clicks, cancelled_at')
        .eq('community_id', communityId)
        .order('event_date', { ascending: false }),
      supabase
        .from('community_raffles')
        .select('id, community_id, creator_id, title, tier, categories, ends_at, drawn_at, created_at, banner_views_contracted, banner_interested_only, promo_ended_at, member_notice_at, requires_entry, draw_entries, goal_cents')
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
    const [attendees, likes, participation, raised, plan, freeUnits] = await Promise.all([
      selectInChunks(eventIds, ids => supabase
        .from('community_event_attendees').select('event_id, user_id').in('event_id', ids)
        .order('event_id').order('user_id')),
      selectInChunks(eventIds, ids => supabase
        .from('community_event_likes').select('event_id, user_id').in('event_id', ids)
        .order('event_id').order('user_id')),
      raffleLib.getParticipationInfo(raffles, userId),
      raffleLib.getRaisedByRaffle(raffles),
      entitlements.getEntitlements(userId),
      wallet.getFreeUnits(userId, 'event'),
    ]);
    for (const row of attendees) {
      attendeesByEvent.set(row.event_id, (attendeesByEvent.get(row.event_id) || 0) + 1);
    }
    for (const row of likes) {
      likesByEvent.set(row.event_id, (likesByEvent.get(row.event_id) || 0) + 1);
    }

    // Campañas ya cerradas (renovadas o finalizadas), también de Enterprise.
    const { data: history, error: historyErr } = plan.isEnterprise
      ? await supabase
        .from('ad_campaign_history')
        .select('id, kind, target_id, title, plan, contracted, delivered, clicks, banner_views, charged_cents, reason, ended_at')
        .eq('community_id', communityId)
        .order('ended_at', { ascending: false })
        .limit(50)
      : { data: [] };
    if (historyErr) console.warn('[community] historial de campañas:', historyErr.message);

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
        cancelled: !!e.cancelled_at,
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
        // Fase 123 — banner del menú principal (exclusivo Ultra). Views
        // y clicks son contadores ingenuos (misma filosofía que
        // url_clicks arriba). El frontend solo los pinta si el plan es
        // Ultra — en Premium/Basic quedan en 0 y no aportan nada.
        ultra_banner_views:  Number(e.ultra_banner_views  || 0),
        ultra_banner_clicks: Number(e.ultra_banner_clicks || 0),
        ultra_banner_ctr:    rate(Number(e.ultra_banner_clicks || 0), Number(e.ultra_banner_views || 0)),
        // Flags de acción: se calculan aquí para que el cliente no replique
        // las reglas; la petición las vuelve a comprobar todas.
        can_end:   promoted && !started && !e.cancelled_at,
        can_renew: !started && !e.cancelled_at,
      };
    });

    const raffleRows = raffles.map(r => {
      const tier = raffleLib.normalizeRaffleTier(r.tier);
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

      const promoEndedAt = r.promo_ended_at || null;
      const ended = !!r.drawn_at || new Date(r.ends_at).getTime() <= now;
      const canManage = RAFFLE_LIFECYCLE_TIERS.has(tier) && !ended;

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
        tier_label: raffleLib.RAFFLE_TIERS[tier].label,
        categories: raffleCategories,
        ends_at: r.ends_at,
        drawn_at: r.drawn_at,
        ended,
        promo_ended_at: promoEndedAt,
        banner_interested_only: !!r.banner_interested_only,
        has_categories: hasEffectiveCategories,
        contracted,
        // Light: lo contratado que queda por enseñar. Volt y Community: los
        // miembros a los que aún no se les ha cruzado la avioneta.
        targets: contracted ?? targets,
        shown,
        pending: ended || promoEndedAt ? 0 : Math.max((contracted ?? targets) - shown, 0),
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
        participants: r.drawn_at && r.draw_entries != null
          ? r.draw_entries : participation.get(r.id)?.participantCount ?? null,
        goal_cents: r.goal_cents ?? null,
        raised_cents: r.goal_cents ? raised.get(r.id) ?? 0 : null,
        can_end:   canManage && !promoEndedAt,
        can_renew: canManage && (tier === 'light' || raffleNoticeAvailableAt(r) <= new Date()),
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
    const activeActivityCount = await entitlements.getActiveActivityCount(communityId);

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
        free_units: freeUnits,
        advanced: plan.isEnterprise,
        // Fase 121 — tope de actividades vivas (para el badge X/4) y
        // clicks acumulados a URLs externas.
        // Fase 125 — el agregado por evento (event_url_clicks) se
        // eliminó del summary porque servía de poco: ver cuál evento
        // trae más tráfico se hace en el detalle de cada uno (cada
        // fila lleva su propio url_clicks). Aquí solo queda el
        // acumulado de la URL de la comunidad, que sí es un dato
        // agregado natural (la comunidad tiene UNA URL, no N).
        active_activity_count: activeActivityCount,
        active_activity_limit: plan.isEnterprise
          ? entitlements.ACTIVE_ACTIVITY_LIMIT_PER_COMMUNITY : entitlements.FREE_ACTIVE_ACTIVITY_LIMIT,
        community_url_clicks: Number(community.url_click_count || 0),
      },
      events: plan.isEnterprise ? eventRows : eventRows.map(withoutAdvanced),
      raffles: plan.isEnterprise ? raffleRows : raffleRows.map(withoutAdvanced),
      history: history || [],
    });
  } catch (err) {
    console.error('[community] GET /communities/:id/dashboard', err);
    res.status(500).json({ error: err.message || 'Error al obtener el dashboard' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// Fase 126 — series temporales de métricas de publicidad
//
// Devuelve buckets [{ts, value}] de una métrica concreta de un evento,
// sorteo o comunidad, agrupados por un intervalo configurable. Se usa
// desde el gráfico temporal en el detalle del evento/sorteo del
// dashboard (CommunityDashboardEventPage / CommunityDashboardRafflePage).
//
// Query params:
//   entity_type: 'event' | 'raffle' | 'community'
//   entity_id:   UUID
//   metric:      depende de entity_type — ver METRIC_SOURCES abajo
//   interval:    '5m' | '15m' | '1h' | '6h' | '1d' | '1w'  (default '1h')
//   from, to:    ISO 8601 opcionales. Defaults:
//                 - from = created_at de la entidad
//                 - to   = ahora
//
// Solo lo puede pedir el creador de la comunidad — igual que el
// dashboard general (protege métricas que un participante no debería
// ver como personas únicas por bucket).
//
// Devuelve: {
//   entity_type, entity_id, metric, interval,
//   from, to,               // ISO, resueltos
//   bucket_seconds,         // tamaño del bucket en segundos (para el cliente)
//   buckets: [{ts, value}]  // ts ISO al INICIO del bucket, value integer
// }
//
// El servidor devuelve SOLO los buckets con datos > 0. El cliente
// rellena los huecos con 0 (más ligero, y sirve para calcular fácilmente
// el total del rango sumando `value`).
const BUCKET_SECONDS = {
  '5m':  5 * 60,
  '15m': 15 * 60,
  '1h':  60 * 60,
  '6h':  6 * 60 * 60,
  '1d':  24 * 60 * 60,
  '1w':  7 * 24 * 60 * 60,
};

// Mapeo métrica → dónde viven los timestamps.
//   table: tabla origen
//   ts_col: columna del timestamp del EVENTO (no del insert)
//   filter: función que construye .eq/.match adicionales sobre la query base
//   ts_not_null: si hay que exigir que ts_col no sea NULL (para
//                'clicked_at' / 'shown_at' que están vacíos si el evento
//                aún no ha ocurrido).
// Este objeto describe la superficie de métricas soportadas. Al añadir
// una nueva, actualizar también el switch de allowed metrics abajo y el
// CHECK del schema si es una del log.
const METRIC_SOURCES = {
  // Eventos ────────────────────────────────────────────────────────────
  event: {
    // Envíos de notificación push (community + promo). Fuente:
    // event_promo_notifications ya lo tiene tal cual con sent_at.
    sends: {
      table: 'event_promo_notifications', ts_col: 'sent_at',
      filter: (q, id) => q.eq('event_id', id),
    },
    // Clicks a la notificación push (personas únicas — clicked_at solo
    // se marca la primera vez, ver fase 111).
    clicks: {
      table: 'event_promo_notifications', ts_col: 'clicked_at',
      filter: (q, id) => q.eq('event_id', id), ts_not_null: true,
    },
    // Ultra banner (log timestampeado desde fase 126).
    banner_views: {
      table: 'promo_metric_events', ts_col: 'created_at',
      filter: (q, id) => q.eq('kind', 'ultra_banner_view').eq('target_id', id),
    },
    banner_clicks: {
      table: 'promo_metric_events', ts_col: 'created_at',
      filter: (q, id) => q.eq('kind', 'ultra_banner_click').eq('target_id', id),
    },
    // URL externa del evento (log timestampeado desde fase 126).
    url_clicks: {
      table: 'promo_metric_events', ts_col: 'created_at',
      filter: (q, id) => q.eq('kind', 'event_url_click').eq('target_id', id),
    },
  },
  // Sorteos ────────────────────────────────────────────────────────────
  raffle: {
    // Asignaciones de banner (a cuántas personas se les asignó).
    targets: {
      table: 'raffle_banner_targets', ts_col: 'created_at',
      filter: (q, id) => q.eq('raffle_id', id),
    },
    // Banners realmente mostrados.
    shown: {
      table: 'raffle_banner_targets', ts_col: 'shown_at',
      filter: (q, id) => q.eq('raffle_id', id), ts_not_null: true,
    },
    // Clicks al banner del sorteo.
    clicks: {
      table: 'raffle_banner_targets', ts_col: 'clicked_at',
      filter: (q, id) => q.eq('raffle_id', id), ts_not_null: true,
    },
  },
  // Comunidad ──────────────────────────────────────────────────────────
  // Métricas agregadas de TODA la comunidad. A diferencia de las de
  // event/raffle (que filtran por un entity_id concreto), aquí no hay
  // "entidad" que filtrar directamente en la tabla origen. Cada source
  // agregado declara un `resolveIds(supabase, communityId)` que hace un
  // fetch previo de los ids de eventos o sorteos de la comunidad, y el
  // filter recibe ESE array en vez del entity_id. El endpoint aplica
  // .in(col, ids) sobre la tabla origen. Si no hay eventos/sorteos aún,
  // el fetch devuelve [] y el endpoint corta antes con buckets vacíos
  // (nada que graficar).
  //
  // Todas estas métricas viven en las tablas ya existentes con
  // timestamps propios (event_promo_notifications, raffle_banner_targets)
  // así que la reconstrucción histórica arranca desde la primera
  // notificación / primer banner, sin depender de la fase 126.
  community: {
    // 🔗 Clicks al enlace de la comunidad — ya existía.
    url_clicks: {
      table: 'promo_metric_events', ts_col: 'created_at',
      filter: (q, id) => q.eq('kind', 'community_url_click').eq('target_id', id),
    },
    // 📤 Envíos push agregados de TODOS los eventos de la comunidad.
    event_sends: {
      table: 'event_promo_notifications', ts_col: 'sent_at',
      resolveIds: async (sup, communityId) => {
        const { data, error } = await sup.from('community_events').select('id').eq('community_id', communityId);
        if (error) throw error;
        return (data || []).map(e => e.id);
      },
      filter: (q, ids) => q.in('event_id', ids),
    },
    // 👆 Clicks push agregados de todos los eventos.
    event_clicks: {
      table: 'event_promo_notifications', ts_col: 'clicked_at',
      resolveIds: async (sup, communityId) => {
        const { data, error } = await sup.from('community_events').select('id').eq('community_id', communityId);
        if (error) throw error;
        return (data || []).map(e => e.id);
      },
      filter: (q, ids) => q.in('event_id', ids),
      ts_not_null: true,
    },
    // 📢 Banners de sorteo mostrados, agregado de todos los sorteos.
    raffle_shown: {
      table: 'raffle_banner_targets', ts_col: 'shown_at',
      resolveIds: async (sup, communityId) => {
        const { data, error } = await sup.from('community_raffles').select('id').eq('community_id', communityId);
        if (error) throw error;
        return (data || []).map(r => r.id);
      },
      filter: (q, ids) => q.in('raffle_id', ids),
      ts_not_null: true,
    },
    // 👆 Clicks a banner de sorteo, agregado de todos los sorteos.
    raffle_clicks: {
      table: 'raffle_banner_targets', ts_col: 'clicked_at',
      resolveIds: async (sup, communityId) => {
        const { data, error } = await sup.from('community_raffles').select('id').eq('community_id', communityId);
        if (error) throw error;
        return (data || []).map(r => r.id);
      },
      filter: (q, ids) => q.in('raffle_id', ids),
      ts_not_null: true,
    },
  },
};

router.get('/communities/:id/dashboard/timeseries', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const communityId = req.params.id;
  const {
    entity_type,
    entity_id,
    metric,
    interval = '1h',
    from: fromRaw,
    to: toRaw,
  } = req.query;

  try {
    // Permisos: solo el creador de la comunidad puede pedir esto.
    const { data: community, error: cErr } = await supabase
      .from('communities')
      .select('id, creator_id, created_at')
      .eq('id', communityId)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!community) return res.status(404).json({ error: 'Comunidad no encontrada' });
    if (community.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el creador puede consultar las series del dashboard' });
    }
    await entitlements.assertEnterprise(userId, 'dashboard', 'Los gráficos por fecha están incluidos en Enterprise.');

    const sources = METRIC_SOURCES[entity_type];
    if (!sources) return res.status(400).json({ error: `entity_type inválido: ${entity_type}` });
    const source = sources[metric];
    if (!source) return res.status(400).json({ error: `métrica no soportada para ${entity_type}: ${metric}` });
    const bucketSeconds = BUCKET_SECONDS[interval];
    if (!bucketSeconds) return res.status(400).json({ error: `intervalo inválido: ${interval}` });
    if (!entity_id) return res.status(400).json({ error: 'entity_id obligatorio' });

    // Resolver el rango [from, to]. `from` por defecto = created_at de
    // la entidad (para eventos y sorteos) o de la comunidad (para
    // métricas de comunidad). `to` por defecto = now.
    let defaultFrom = community.created_at;
    if (entity_type === 'event') {
      const { data: ev } = await supabase
        .from('community_events')
        .select('id, community_id, created_at')
        .eq('id', entity_id)
        .maybeSingle();
      if (!ev || ev.community_id !== communityId) {
        return res.status(404).json({ error: 'Evento no encontrado en esta comunidad' });
      }
      defaultFrom = ev.created_at;
    } else if (entity_type === 'raffle') {
      const { data: rf } = await supabase
        .from('community_raffles')
        .select('id, community_id, created_at')
        .eq('id', entity_id)
        .maybeSingle();
      if (!rf || rf.community_id !== communityId) {
        return res.status(404).json({ error: 'Sorteo no encontrado en esta comunidad' });
      }
      defaultFrom = rf.created_at;
    } else if (entity_type === 'community' && entity_id !== communityId) {
      // Consistencia: si es una métrica de comunidad, entity_id tiene
      // que coincidir con el communityId de la URL (para no permitir
      // pedir métricas de OTRA comunidad autenticándote como creador
      // de la tuya).
      return res.status(400).json({ error: 'entity_id no coincide con la comunidad' });
    }

    // Fase 128 — métricas agregadas de comunidad: se resuelven primero
    // los ids de las entidades hijas (eventos/sorteos de la comunidad)
    // y el filter opera con .in(col, ids). Si la comunidad aún no
    // tiene eventos/sorteos, cortocircuitamos con buckets vacíos — no
    // hay nada que graficar y evitamos un .in() con array vacío que en
    // PostgREST devolvería error.
    let filterArg = entity_id;
    if (typeof source.resolveIds === 'function') {
      filterArg = await source.resolveIds(supabase, communityId);
      if (!Array.isArray(filterArg) || filterArg.length === 0) {
        return res.json({
          entity_type, entity_id, metric, interval,
          from: (fromRaw ? new Date(fromRaw) : new Date(defaultFrom)).toISOString(),
          to:   (toRaw   ? new Date(toRaw)   : new Date()).toISOString(),
          bucket_seconds: bucketSeconds,
          buckets: [],
        });
      }
    }

    const from = fromRaw ? new Date(fromRaw) : new Date(defaultFrom);
    const to   = toRaw   ? new Date(toRaw)   : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      return res.status(400).json({ error: 'Rango de fechas inválido' });
    }

    // Todas las filas del rango, de 1000 en 1000: el agrupado se hace en JS.
    const rows = await fetchAll(() => {
      const query = source.filter(supabase.from(source.table).select(source.ts_col), filterArg)
        .gte(source.ts_col, from.toISOString())
        .lt(source.ts_col, to.toISOString())
        .order(source.ts_col);
      return source.ts_not_null ? query.not(source.ts_col, 'is', null) : query;
    });

    // Bucketing: alinea cada timestamp al inicio de su bucket usando
    // aritmética entera sobre epoch en ms. El bucket base es UTC (no
    // hay concepto de "día del usuario" aquí — el cliente pinta la
    // fecha en su zona horaria).
    const bucketMs = bucketSeconds * 1000;
    const counts = new Map();
    for (const row of rows) {
      const t = new Date(row[source.ts_col]).getTime();
      if (!Number.isFinite(t)) continue;
      const bucketStart = Math.floor(t / bucketMs) * bucketMs;
      counts.set(bucketStart, (counts.get(bucketStart) || 0) + 1);
    }
    const buckets = [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, value]) => ({ ts: new Date(ts).toISOString(), value }));

    res.json({
      entity_type, entity_id, metric, interval,
      from: from.toISOString(),
      to: to.toISOString(),
      bucket_seconds: bucketSeconds,
      buckets,
    });
  } catch (err) {
    if (handleExpectedError(res, err)) return;
    console.error('[community] GET /communities/:id/dashboard/timeseries', err);
    res.status(500).json({ error: err.message || 'Error al obtener las series temporales' });
  }
});

// ── POST /api/community/communities/:id/raffles/:raffleId/draw — sortear ───
// Solo el creador, y solo una vez pasada la fecha de fin (el cron lo hace
// igualmente al minuto).
router.post('/communities/:id/raffles/:raffleId/draw', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { id: communityId, raffleId } = req.params;

  try {
    const { data: raffle, error: fetchErr } = await supabase
      .from('community_raffles')
      .select('id, creator_id, ends_at, drawn_at')
      .eq('id', raffleId)
      .eq('community_id', communityId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!raffle) return res.status(404).json({ error: 'Sorteo no encontrado' });
    if (raffle.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el creador de la comunidad puede sortear' });
    }
    if (new Date(raffle.ends_at) > new Date()) {
      return res.status(400).json({ error: 'El sorteo todavía no ha terminado' });
    }

    // null = ya estaba sorteado (o lo acaba de hacer el cron): se devuelve
    // el resultado igualmente.
    const result = await drawRaffle(raffleId);
    if (result) {
      notifyRaffleDrawn({
        raffleId,
        communityId,
        title: result.raffle.title,
        creatorId: result.raffle.creator_id,
        eligibleIds: result.participantIds,
      }).catch(err => console.warn('[community] notifyRaffleDrawn:', err.message));
    }

    const { data: updated, error: refreshErr } = await supabase
      .from('community_raffles').select(RAFFLE_COLUMNS).eq('id', raffleId).single();
    if (refreshErr) throw refreshErr;
    const [serialized] = await serializeRaffles([updated], userId);
    res.json({ raffle: serialized });
  } catch (err) {
    console.error('[community] POST /communities/:id/raffles/:raffleId/draw', err);
    res.status(500).json({ error: 'Error al realizar el sorteo' });
  }
});

// ── GET /api/community/raffles/:raffleId/verification ──────────────────────
// Todo lo necesario para repetir el cálculo del sorteo (claves anónimas).
router.get('/raffles/:raffleId/verification', requireAuth, async (req, res) => {
  try {
    const { data: raffle, error } = await supabase
      .from('community_raffles')
      .select('id, drawn_at, draw_commit, draw_seed, draw_entries')
      .eq('id', req.params.raffleId).maybeSingle();
    if (error) throw error;
    if (!raffle?.drawn_at) return res.status(404).json({ error: 'El sorteo todavía no se ha celebrado' });
    res.json({
      raffle_id: raffle.id,
      commit: raffle.draw_commit,
      seed: raffle.draw_seed,
      entries: await getVerification(raffle.id),
      my_key: entryKey(raffle.id, req.user.id),
    });
  } catch (err) {
    console.error('[community] GET /raffles/:raffleId/verification', err);
    res.status(500).json({ error: 'Error al obtener la verificación' });
  }
});

// ── Entrega de premios ─────────────────────────────────────────────────────
// pending → claimed (el ganador acepta) → delivered (el organizador lo marca)
// → received (el ganador confirma). Si no llega: disputed, que impide al
// organizador abrir más sorteos hasta que el ganador confirme o un
// administrador de la app lo resuelva.
const DISPUTE_DAYS = 30;

async function loadPrize(req, res) {
  const { data: prize, error } = await supabase
    .from('community_raffle_prizes')
    .select('id, raffle_id, position, title, winner_id, claim_status, claim_deadline, claimed_at, delivered_at, previous_winners, raffle:raffle_id(id, title, creator_id, community_id, drawn_at)')
    .eq('id', req.params.prizeId).maybeSingle();
  if (error) throw error;
  if (!prize?.raffle?.drawn_at || !prize.winner_id) {
    res.status(404).json({ error: 'Premio no encontrado' });
    return null;
  }
  return prize;
}

// Cambia el estado solo si sigue siendo uno de los esperados.
async function movePrize(res, prize, from, patch) {
  const { data, error } = await supabase
    .from('community_raffle_prizes').update(patch)
    .eq('id', prize.id).in('claim_status', from)
    .select('id, claim_status, claim_deadline, claimed_at, delivered_at, received_at').maybeSingle();
  if (error) throw error;
  if (!data) res.status(400).json({ error: 'El estado del premio ha cambiado. Actualiza la página.' });
  return data;
}

function notifyPrize(userId, prize, title, body) {
  notifyUsers(supabase, [userId], null, {
    title,
    body,
    url: `/community/${prize.raffle.community_id}#raffle-${prize.raffle_id}`,
    tag: `raffle-prize-${prize.id}`,
  }).catch(err => console.warn('[community] aviso de premio:', err.message));
}

function prizeRoute(path, handler) {
  router.post(`/raffles/prizes/:prizeId/${path}`, requireAuth, async (req, res) => {
    try {
      const prize = await loadPrize(req, res);
      if (!prize) return;
      const result = await handler({
        req, res, prize,
        isWinner: prize.winner_id === req.user.id,
        isOrganizer: prize.raffle.creator_id === req.user.id,
      });
      if (result) res.json({ prize: result });
    } catch (err) {
      console.error(`[community] POST /raffles/prizes/:prizeId/${path}`, err);
      res.status(500).json({ error: 'Error al actualizar el premio' });
    }
  });
}

const forbidden = (res, message) => { res.status(403).json({ error: message }); return null; };
const badRequest = (res, message) => { res.status(400).json({ error: message }); return null; };

prizeRoute('claim', async ({ res, prize, isWinner }) => {
  if (!isWinner) return forbidden(res, 'Solo quien ha ganado puede aceptar el premio');
  if (prize.claim_deadline && new Date(prize.claim_deadline) < new Date()) {
    return badRequest(res, 'El plazo para aceptar el premio ha terminado');
  }
  const updated = await movePrize(res, prize, ['pending'], { claim_status: 'claimed', claimed_at: new Date().toISOString() });
  if (updated) notifyPrize(prize.raffle.creator_id, prize, '🎁 Premio aceptado', `Ya puedes entregar "${prize.title}" (${prize.raffle.title}).`);
  return updated;
});

prizeRoute('delivered', async ({ res, prize, isOrganizer }) => {
  if (!isOrganizer) return forbidden(res, 'Solo el organizador puede marcar la entrega');
  const updated = await movePrize(res, prize, ['claimed'], { claim_status: 'delivered', delivered_at: new Date().toISOString() });
  if (updated) notifyPrize(prize.winner_id, prize, '📦 Premio enviado', `El organizador ha marcado "${prize.title}" como entregado. Confírmalo cuando lo tengas.`);
  return updated;
});

prizeRoute('received', async ({ res, prize, isWinner }) => {
  if (!isWinner) return forbidden(res, 'Solo quien ha ganado puede confirmar la recepción');
  return movePrize(res, prize, ['claimed', 'delivered', 'disputed'], { claim_status: 'received', received_at: new Date().toISOString() });
});

prizeRoute('dispute', async ({ res, prize, isWinner }) => {
  if (!isWinner) return forbidden(res, 'Solo quien ha ganado puede reclamar');
  if (prize.delivered_at && Date.now() - new Date(prize.delivered_at).getTime() > DISPUTE_DAYS * 24 * 3600 * 1000) {
    return badRequest(res, `Solo se puede reclamar en los ${DISPUTE_DAYS} días siguientes a la entrega`);
  }
  const updated = await movePrize(res, prize, ['claimed', 'delivered'], { claim_status: 'disputed' });
  if (updated) notifyPrize(prize.raffle.creator_id, prize, '⚠️ Premio reclamado', `Quien ha ganado "${prize.title}" dice que no lo ha recibido. Hasta resolverlo no podrás crear más sorteos.`);
  return updated;
});

prizeRoute('redraw', async ({ res, prize, isOrganizer }) => {
  if (!isOrganizer) return forbidden(res, 'Solo el organizador puede volver a sortear el premio');
  if (prize.claim_status !== 'pending' || !prize.claim_deadline || new Date(prize.claim_deadline) > new Date()) {
    return badRequest(res, 'Solo se puede volver a sortear un premio cuyo plazo para aceptarlo ha terminado');
  }
  const result = await redrawPrize(prize);
  if (!result) return badRequest(res, 'El estado del premio ha cambiado. Actualiza la página.');
  if (result.winnerId) notifyPrize(result.winnerId, prize, '🎉 ¡Has ganado el sorteo!', `Has ganado "${prize.title}" en ${prize.raffle.title}. Acéptalo antes de 14 días.`);
  return { id: prize.id, has_winner: Boolean(result.winnerId) };
});

prizeRoute('resolve', async ({ req, res, prize }) => {
  const { data: me } = await supabase.from('users').select('is_admin').eq('id', req.user.id).maybeSingle();
  if (!me?.is_admin) return forbidden(res, 'No tienes permiso');
  return movePrize(res, prize, ['disputed'], { claim_status: 'received' });
});

module.exports = router;
