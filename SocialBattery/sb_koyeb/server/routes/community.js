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

// POST /api/community/events
router.post('/events', requireAuth, uploadEventCover, async (req, res) => {
  const { title, description, category, event_date, ends_at, location, lat, lng, max_attendees, community_id, organization, url, price, additional_info, promotion_plan, notification_count } = req.body;
  const userId = req.user.id;

  const categories = parseCategories(req.body.categories ?? category);
  if (categories.length > MAX_CATEGORIES) {
    return res.status(400).json({ error: `Puedes elegir hasta ${MAX_CATEGORIES} categorías` });
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

  try {
    await ensurePublicProfile(req.user);

    const communityId = community_id || null;
    if (communityId) {
      const { community, isAdmin } = await getCommunityAdminState(communityId, userId);
      if (!community) return res.status(404).json({ error: 'Comunidad no encontrada' });
      if (!isAdmin) {
        return res.status(403).json({ error: 'Solo el administrador puede publicar eventos en esta comunidad' });
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
            url:   `/community/event/${event.id}`,
            tag:   `community-event-${event.id}`,
          });

          console.log(`[NOTIF-CAP] evento ${event.id}: push de comunidad entregado a ${notifiedUserIds?.length || 0}/${communityMemberIds.length} miembros.`);

          if (notifiedUserIds?.length) {
            const { error: logError } = await supabase
              .from('event_promo_notifications')
              .upsert(
                notifiedUserIds.map(uid => ({ event_id: event.id, user_id: uid })),
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
      .select('id, title, location, creator_id, community_id, event_date, ends_at, promotion_plan, notification_sent_count')
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
            url:   `/community/event/${event.id}`,
            tag:   `community-event-${event.id}`,
          });

          console.log(`[NOTIF-CAP] renovación evento ${event.id}: push de comunidad entregado a ${notifiedUserIds?.length || 0}/${communityMemberIds.length} miembros.`);

          if (notifiedUserIds?.length) {
            const { error: logError } = await supabase
              .from('event_promo_notifications')
              .upsert(
                notifiedUserIds.map(uid => ({ event_id: event.id, user_id: uid })),
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
      .select('id, title, organization, cover_image_url, community:communities!community_events_community_id_fkey(organization)')
      .eq('id', claim.event_id)
      .maybeSingle();

    if (eventError || !event) return res.json({ event: null });

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
      .select('user_id, status, created_at, responded_at, lat, lng, location_updated_at, user:user_id(id, username, avatar_url)')
      .eq('group_id', group.id)
      .order('created_at', { ascending: true });

    if (membersErr) throw membersErr;

    const myMember = (members || []).find(m => m.user_id === userId);

    res.json({
      group: {
        id: group.id,
        creator_id: group.creator_id,
        is_creator: group.creator_id === userId,
        my_status: myMember?.status || null,
        members: members || [],
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
function uploadRaffleImage(req, res, next) {
  raffleImageUpload.single('image')(req, res, err => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message || 'No se pudo subir la foto' });
  });
}

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

// ── Reparto del banner volador (avioneta con pancarta "¡Sorteo nuevo!") ────
// Aplica a los tiers 'light' y 'volt' (los dos que incluyen banner en el
// menú principal, ver RAFFLE_TIER_OPTIONS en CommunityDetailPage.jsx).
// En 'light' se reparte a una selección aleatoria de tamaño
// banner_views_contracted (capCount). En 'volt' no hay número contratado
// ("al número de usuarios disponibles"): se reparte a TODOS los usuarios
// disponibles (capCount = null), y su entrega está sujeta a que antes se
// agote el reparto pendiente de Light — ver hasPendingLightBannerBacklog
// y GET /raffle-banner más abajo.
//
// A cada usuario solo le puede llegar UN banner volador a la vez: si ya es
// target pendiente (shown_at IS NULL) de OTRO sorteo (de cualquier tier),
// se excluye de esta nueva asignación. Solo vuelve a ser candidato una vez
// se le muestre (y consuma) el banner que ya tenía pendiente.
async function assignRaffleBannerTargets(raffleId, creatorId, capCount) {
  try {
    const { data: pendingRows, error: pendingErr } = await supabase
      .from('raffle_banner_targets')
      .select('user_id')
      .is('shown_at', null);
    if (pendingErr) throw pendingErr;
    const alreadyPendingIds = new Set((pendingRows || []).map(r => r.user_id));

    const { data: allUsers, error } = await supabase
      .from('users')
      .select('id')
      .neq('id', creatorId);
    if (error) throw error;

    const pool = (allUsers || []).map(u => u.id).filter(id => !alreadyPendingIds.has(id));
    // Fisher–Yates para una selección aleatoria sin sesgo.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const targetIds = capCount != null ? pool.slice(0, Math.min(capCount, pool.length)) : pool;
    if (!targetIds.length) return;

    const rows = targetIds.map(userId => ({ raffle_id: raffleId, user_id: userId }));
    const { error: insertErr } = await supabase.from('raffle_banner_targets').insert(rows);
    if (insertErr) throw insertErr;
  } catch (err) {
    console.error('[community] assignRaffleBannerTargets error:', err);
  }
}

// ¿Queda reparto de banner Light pendiente en CUALQUIER sorteo activo (de
// cualquier comunidad)? El reparto de Light tiene preferencia absoluta
// sobre Volt (ver copy "📶 Las apariciones de banners publicitarios tienen
// preferencia en sorteos Light frente a sorteos Volt" en el modal de
// creación): mientras quede algún target Light sin mostrar, no se sirve
// ningún banner Volt a nadie, aunque ese target pendiente no sea del
// usuario que está consultando en ese momento.
async function hasPendingLightBannerBacklog() {
  const now = new Date().toISOString();
  const { data: activeLightRaffles, error } = await supabase
    .from('community_raffles')
    .select('id')
    .eq('tier', 'light')
    .is('drawn_at', null)
    .gt('ends_at', now);
  if (error) throw error;

  const raffleIds = (activeLightRaffles || []).map(r => r.id);
  if (!raffleIds.length) return false;

  const { data: pendingTargets, error: targetsErr } = await supabase
    .from('raffle_banner_targets')
    .select('id')
    .in('raffle_id', raffleIds)
    .is('shown_at', null)
    .limit(1);
  if (targetsErr) throw targetsErr;

  return (pendingTargets || []).length > 0;
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

function serializeRaffle(raffle, { participantCount, currentUserId, isEligible, bannerViewsSent } = {}) {
  const tier = normalizeRaffleTier(raffle.tier);
  const tierMeta = RAFFLE_TIERS[tier];
  const hasBanner = tier === 'light' || tier === 'volt';
  return {
    id: raffle.id,
    community_id: raffle.community_id,
    title: raffle.title,
    description: raffle.description,
    image_url: raffle.image_url,
    ends_at: raffle.ends_at,
    created_at: raffle.created_at,
    drawn_at: raffle.drawn_at,
    winner: raffle.winner || null,
    participant_count: participantCount ?? null,
    tier,
    tier_label: tierMeta.label,
    tier_rules: tierMeta.rules,
    price_cents: tierMeta.price_cents,
    banner_views_contracted: raffle.banner_views_contracted ?? null,
    banner_views_sent: hasBanner ? (bannerViewsSent ?? 0) : null,
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
        ends_at, drawn_at, created_at, tier, banner_views_contracted,
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
      .filter(r => ['light', 'volt'].includes(normalizeRaffleTier(r.tier)))
      .map(r => r.id);
    const bannerSentCounts = await getBannerSentCounts(bannerRaffleIds);

    res.json({
      raffles: raffles.map(r => {
        const tier = normalizeRaffleTier(r.tier);
        const eligibleIds = eligibleByTier[tier] || [];
        return serializeRaffle(r, {
          participantCount: eligibleIds.length,
          currentUserId: userId,
          isEligible: eligibleIds.includes(userId),
          bannerViewsSent: bannerSentCounts[r.id] || 0,
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
router.post('/communities/:id/raffles', requireAuth, uploadRaffleImage, async (req, res) => {
  const userId = req.user.id;
  const communityId = req.params.id;
  const { title, description, ends_at, tier, banner_views_contracted } = req.body;

  if (!title?.trim()) return res.status(400).json({ error: 'El título es obligatorio' });
  if (!ends_at) return res.status(400).json({ error: 'La fecha de fin es obligatoria' });
  if (tier && !RAFFLE_TIER_KEYS.includes(tier)) {
    return res.status(400).json({ error: 'Tipo de sorteo no válido' });
  }
  const raffleTier = normalizeRaffleTier(tier);

  const endsAtDate = new Date(ends_at);
  if (Number.isNaN(endsAtDate.getTime())) {
    return res.status(400).json({ error: 'La fecha de fin no es válida' });
  }
  if (endsAtDate <= new Date()) {
    return res.status(400).json({ error: 'La fecha de fin debe ser en el futuro' });
  }

  // Sorteo Light: visualizaciones de banner a contratar, entre BANNER_VIEWS_MIN
  // y BANNER_VIEWS_MAX (mismo rango que notification_count en eventos
  // Premium/Ultra — ver POST /community/events más arriba).
  const BANNER_VIEWS_MIN = 500;
  const BANNER_VIEWS_MAX = 50000;
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
      .select('id, creator_id')
      .eq('id', communityId)
      .maybeSingle();

    if (!community) return res.status(404).json({ error: 'Comunidad no encontrada' });
    if (community.creator_id !== userId) {
      return res.status(403).json({ error: 'Solo el creador de la comunidad puede crear un sorteo' });
    }

    let imageUrl = null;
    if (req.file) {
      imageUrl = await storeImage({
        file: req.file,
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
        banner_views_contracted: resolvedBannerViews,
      })
      .select('id, community_id, creator_id, title, description, image_url, ends_at, drawn_at, created_at, tier, banner_views_contracted')
      .single();

    if (error) throw error;

    if (raffleTier === 'light' && resolvedBannerViews) {
      await assignRaffleBannerTargets(data.id, userId, resolvedBannerViews);
    } else if (raffleTier === 'volt') {
      await assignRaffleBannerTargets(data.id, userId, null);
    }

    const eligibleIds = await getEligibleRaffleMembers(communityId, raffleTier);
    res.status(201).json({
      raffle: serializeRaffle({ ...data, winner: null }, {
        participantCount: eligibleIds.length,
        currentUserId: userId,
        isEligible: eligibleIds.includes(userId),
        bannerViewsSent: 0,
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
// Light todavía activo, y en tal caso lo consume (shown_at = ahora) para
// que no se le vuelva a mostrar. Se llama al entrar en el menú principal.
router.get('/raffle-banner', requireAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    const { data: pending, error } = await supabase
      .from('raffle_banner_targets')
      .select(`
        id, created_at,
        raffle:raffle_id(
          id, community_id, title, ends_at, drawn_at, tier,
          community:community_id(id, name)
        )
      `)
      .eq('user_id', userId)
      .is('shown_at', null)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Solo cuentan sorteos que siguen activos (no sorteados ni terminados);
    // si el sorteo ya terminó, se descarta sin mostrarlo pero tampoco se
    // "gasta" la visualización de otro sorteo por error.
    const now = new Date();
    const activeRows = (pending || []).filter(row => {
      const raffle = row.raffle;
      return raffle && !raffle.drawn_at && new Date(raffle.ends_at) > now;
    });

    // 1) Máxima prioridad: si el usuario tiene un banner Light pendiente,
    //    es ese el que se sirve, sin más comprobaciones.
    let candidate = activeRows.find(row => normalizeRaffleTier(row.raffle.tier) === 'light');

    // 2) Si no, se busca un banner Volt pendiente para este usuario, pero
    //    solo se sirve si YA NO queda ningún reparto Light pendiente en
    //    ningún sorteo activo de toda la app (prioridad global de Light).
    if (!candidate) {
      const voltCandidate = activeRows.find(row => normalizeRaffleTier(row.raffle.tier) === 'volt');
      if (voltCandidate && !(await hasPendingLightBannerBacklog())) {
        candidate = voltCandidate;
      }
    }

    if (!candidate) return res.json({ banner: null });

    await supabase
      .from('raffle_banner_targets')
      .update({ shown_at: now.toISOString() })
      .eq('id', candidate.id);

    res.json({
      banner: {
        raffle_id: candidate.raffle.id,
        community_id: candidate.raffle.community_id,
        community_name: candidate.raffle.community?.name || 'Comunidad',
        title: candidate.raffle.title,
        tier: normalizeRaffleTier(candidate.raffle.tier),
      },
    });
  } catch (err) {
    console.error('[community] GET /raffle-banner', err);
    res.status(500).json({ error: err.message || 'Failed to fetch raffle banner' });
  }
});

// ── POST /api/community/communities/:id/raffles/:raffleId/draw — sortear ───
// Solo el creador, y solo una vez pasada la fecha de fin.
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

    const winnerId = eligibleIds[Math.floor(Math.random() * eligibleIds.length)];

    const { data: updated, error: updateErr } = await supabase
      .from('community_raffles')
      .update({ winner_id: winnerId, drawn_at: new Date().toISOString() })
      .eq('id', raffleId)
      .select(`
        id, community_id, creator_id, title, description, image_url,
        ends_at, drawn_at, created_at, tier,
        winner:winner_id(id, username, avatar_url)
      `)
      .single();

    if (updateErr) throw updateErr;

    const bannerSentCounts = await getBannerSentCounts(
      ['light', 'volt'].includes(raffleTier) ? [raffleId] : []
    );

    res.json({
      raffle: serializeRaffle(updated, {
        participantCount: eligibleIds.length,
        currentUserId: userId,
        isEligible: eligibleIds.includes(userId),
        bannerViewsSent: bannerSentCounts[raffleId] || 0,
      }),
    });
  } catch (err) {
    console.error('[community] POST /communities/:id/raffles/:raffleId/draw', err);
    res.status(500).json({ error: err.message || 'Failed to draw raffle winner' });
  }
});


module.exports = router;
