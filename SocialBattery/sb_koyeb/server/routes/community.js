const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { createImageUpload, storeImage } = require('../lib/imageUpload');
const { notifyUsers } = require('../lib/webpush');
const { parseReminderMinutes } = require('../lib/reminderLeadTime');
const { getNotificationDayKey } = require('../lib/notificationDay');
const { runEventPromoPacingTick } = require('../jobs/eventPromoPacing');

const eventCoverUpload = createImageUpload({ maxSizeMb: 3 });
const communityCoverUpload = createImageUpload({ maxSizeMb: 3 });
const eventUpdateImageUpload = createImageUpload({ maxSizeMb: 8 });

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

  return {
    community,
    membership,
    isAdmin: community.creator_id === userId || membership?.role === 'admin',
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
        id, title, description, category, event_date, ends_at, location, lat, lng, organization, cover_image_url,
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

// POST /api/community/events
router.post('/events', requireAuth, uploadEventCover, async (req, res) => {
  const { title, description, category, event_date, ends_at, location, lat, lng, max_attendees, community_id, organization, url, price, additional_info, promotion_plan, notification_count } = req.body;
  const userId = req.user.id;

  if (!title?.trim()) return res.status(400).json({ error: 'El titulo es obligatorio' });
  if (!event_date) return res.status(400).json({ error: 'La fecha es obligatoria' });
  const eventDate = new Date(event_date);
  if (Number.isNaN(eventDate.getTime())) {
    return res.status(400).json({ error: 'La fecha no es valida' });
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
        category: category?.trim() || null,
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
          const communityLabel = comm?.name ? `en "${comm.name}"` : 'en tu comunidad';
          console.log(`[NOTIF-CAP] evento ${event.id} ("${event.title}") es de comunidad ${communityId}: ${communityMemberIds.length} miembros a notificar SIEMPRE (excepción al tope diario).`);

          const notifiedUserIds = await notifyUsers(supabase, communityMemberIds, userId, {
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
        id, name, description, category, organization, creator_id, created_at,
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
        id, name, description, category, organization, creator_id, created_at,
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

    const { data: events, error: eventsError } = await db
      .from('community_events')
      .select(`
        id, title, description, category, event_date, ends_at, location, lat, lng, organization, cover_image_url,
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

  if (!name?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

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
        category: category?.trim() || null,
        organization: organization?.trim() || null,
        url: url?.trim() || null,
        cover_image_url: coverImageUrl,
        creator_id: userId,
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

// GET /api/community/events/:id
router.get('/events/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const db = getUserSupabase(req);

  try {
    const { data: event, error } = await db
      .from('community_events')
      .select(`
        id, title, description, category, event_date, ends_at, location, lat, lng, organization,
        cover_image_url, url, price, additional_info, max_attendees, creator_id, community_id, created_at,
        promotion_plan, notification_count,
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
      .select('id, title, organization, community:communities!community_events_community_id_fkey(organization)')
      .eq('id', claim.event_id)
      .maybeSingle();

    if (eventError || !event) return res.json({ event: null });

    res.json({
      event: {
        id: event.id,
        title: event.title,
        organization: event.organization || event.community?.organization || null,
      },
    });
  } catch (err) {
    console.error('[community] GET /notifications/today-event error:', err);
    res.status(500).json({ error: 'Error al comprobar el evento notificado hoy' });
  }
});

// GET /api/community/events/:id/updates
router.get('/events/:id/updates', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const { data: updates, error } = await supabase
      .from('event_updates')
      .select(`
        id, content, image_url, created_at, creator_id,
        creator:users!event_updates_creator_id_fkey(username, avatar_url)
      `)
      .eq('event_id', id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ updates: updates || [] });
  } catch (err) {
    console.error('[community] GET /events/:id/updates error:', err);
    res.status(500).json({ error: communityErrorMessage(err, 'Error al obtener actualizaciones') });
  }
});

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

    // ── Push notifications to all attendees (fire-and-forget) ────────────────
    if (eventFull) {
      const { data: attendees } = await supabase
        .from('community_event_attendees')
        .select('user_id')
        .eq('event_id', id)
        .neq('user_id', userId);

      if (attendees?.length) {
        const attendeeIds = attendees.map(a => a.user_id);
        const notifBody = hasContent
          ? hasContent.length > 80 ? hasContent.slice(0, 77) + '…' : hasContent
          : '📷 Se ha publicado una imagen';

        notifyUsers(supabase, attendeeIds, userId, {
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

module.exports = router;
