/**
 * eventPromoPacing.js — Reparto de las notificaciones Premium/Ultra.
 *
 * Corre cada 5 minutos (y al publicar o renovar una promoción), solo de 10:00
 * a 21:00 hora peninsular. En cada pasada:
 *
 *   1. Público: usuarios con push (web o app nativa) que no hayan silenciado
 *      las recomendaciones, no tengan suscripción sin anuncios y no hayan
 *      recibido ya hoy una notificación promocional (tope de 1 por usuario y
 *      día entre TODOS los eventos).
 *
 *   2. Eventos: los que empiezan en los próximos 21 días y no han agotado lo
 *      contratado. Se ordenan por urgencia y equidad (ver rankEvents), no por
 *      "% entregado": con el porcentaje, quien contrataba 50.000 iba siempre
 *      por detrás y por tanto siempre primero, y dejaba sin nada a quien
 *      contrataba 500.
 *
 *   3. Se procesan en grupos de BOOST_GROUP_SIZE hasta asignar TICK_TARGET
 *      usuarios: primero los eventos con filtro duro (intereses/ubicación),
 *      que no tienen plan B, y luego el resto con preferencia por intereses
 *      en común (lib/promoDistribution.js). Premium y Ultra compiten igual.
 *
 * Concurrencia: el tope diario se reserva con INSERT ... ON CONFLICT DO
 * NOTHING sobre user_daily_notification_claims (UNIQUE user_id+claim_date),
 * así que da igual cuántas instancias corran a la vez. Se cobra únicamente
 * cada fila nueva de event_promo_notifications, es decir, por usuarios
 * distintos a los que el push llegó de verdad.
 */

const supabase = require('../lib/supabase');
const { sendPushToSubscription } = require('../lib/webpush');
const { sendToTokens } = require('../lib/fcm');
const { getNotificationDayKey, isPromoSendingTime } = require('../lib/notificationDay');
const { INSTANCE_ID } = require('../lib/instanceId');
const { BOOST_GROUP_SIZE } = require('../lib/adaptiveBoost');
const { assignCandidatesBidirectional, makeInterestClassifier } = require('../lib/promoDistribution');
const { fetchAll, selectInChunks, chunk } = require('../lib/paginate');
const { loadAudience, canReceivePromoPush, makeEventHardFilter } = require('../lib/audience');

const BASE_CHUNK_PER_TICK = 50;   // máximo por evento y pasada
const TICK_TARGET = 150;          // usuarios a asignar por pasada
const PROMO_WINDOW_DAYS = 21;     // no se gasta público en eventos lejanos
const URGENT_HOURS = 72;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Orden de reparto: primero los que empiezan en menos de 72 h; después, el
 * que menos haya enviado HOY (equidad entre anunciantes, contraten lo que
 * contraten); a igualdad, el que antes empieza.
 */
function rankEvents(events, sentTodayById, now = new Date()) {
  const urgentBefore = now.getTime() + URGENT_HOURS * 3600 * 1000;
  const key = (e) => {
    const start = new Date(e.event_date).getTime();
    return { urgent: start <= urgentBefore ? 0 : 1, today: sentTodayById.get(e.id) || 0, start };
  };
  return events
    .map(e => ({ e, k: key(e) }))
    .sort((a, b) => a.k.urgent - b.k.urgent || a.k.today - b.k.today || a.k.start - b.k.start)
    .map(x => x.e);
}

// ?src=promo — marca de atribución (fase 111): EventDetailPage registra el
// click contra event_promo_notifications (POST /events/:id/ad-click).
function buildPayload(event) {
  const where = event.location ? `${event.location} · ` : '';
  if (event.promotion_plan === 'ultra') {
    return {
      title: '🚀 Evento destacado: ' + event.title,
      body: `${where}¡No te lo pierdas!`,
      url: `/community/event/${event.id}?src=promo`,
      tag: `ultra-event-${event.id}`,
    };
  }
  return {
    title: '⚡ Evento recomendado: ' + event.title,
    body: `${where}¡Échale un vistazo!`,
    url: `/community/event/${event.id}?src=promo`,
    tag: `premium-event-${event.id}`,
  };
}

/** Reserva atómica del hueco del día. Devuelve quién lo ha conseguido. */
async function claimDailySlots(userIds, eventId, dayKey) {
  const { data, error } = await supabase
    .from('user_daily_notification_claims')
    .upsert(
      userIds.map(userId => ({ user_id: userId, claim_date: dayKey, event_id: eventId })),
      { onConflict: 'user_id,claim_date', ignoreDuplicates: true }
    )
    .select('user_id');
  if (error) {
    console.error('[PROMO-PACING] error reservando hueco diario:', error.message);
    return new Set();
  }
  return new Set((data || []).map(r => r.user_id));
}

/** Libera el hueco de quien no ha recibido nada (best-effort). */
async function releaseUnusedClaims(userIds, dayKey) {
  for (const ids of chunk(userIds)) {
    const { error } = await supabase
      .from('user_daily_notification_claims')
      .delete()
      .eq('claim_date', dayKey)
      .in('user_id', ids);
    if (error) console.warn('[PROMO-PACING] error liberando reservas:', error.message);
  }
}

/**
 * Envía a cada usuario por un solo canal: la app nativa si la tiene y, si no
 * llega, el navegador. Devuelve los userIds a los que les ha llegado.
 */
async function sendToUsers(userIds, payload) {
  const tokens = await selectInChunks(userIds, ids => supabase
    .from('fcm_tokens').select('token, user_id').in('user_id', ids).order('token'));
  const delivered = new Set(await sendToTokens(supabase, tokens, payload));

  const pending = userIds.filter(id => !delivered.has(id));
  const subs = await selectInChunks(pending, ids => supabase
    .from('push_subscriptions').select('user_id, endpoint, p256dh, auth')
    .in('user_id', ids).order('endpoint'));

  const expired = [];
  await Promise.allSettled(subs.map(async sub => {
    const result = await sendPushToSubscription(sub, payload);
    if (result?.expired) expired.push(sub.endpoint);
    else if (result?.success) delivered.add(sub.user_id);
  }));
  for (const endpoints of chunk(expired, 50)) {
    const { error } = await supabase.from('push_subscriptions').delete().in('endpoint', endpoints);
    if (error) console.warn('[PROMO-PACING] error borrando suscripciones caducadas:', error.message);
  }
  return [...delivered];
}

async function dispatchToEvent(event, userIds, dayKey, isInterested = null) {
  if (!userIds.length) return 0;

  const claimed = await claimDailySlots(userIds, event.id, dayKey);
  const targets = userIds.filter(id => claimed.has(id));
  if (!targets.length) return 0;

  let delivered = [];
  try {
    delivered = await sendToUsers(targets, buildPayload(event));
  } finally {
    const ok = new Set(delivered);
    await releaseUnusedClaims(targets.filter(id => !ok.has(id)), dayKey);
  }
  if (!delivered.length) return 0;

  // Solo se cobran las filas NUEVAS: si alguien ya estaba en el histórico del
  // evento, el upsert no la devuelve y no cuenta.
  const { data: logged, error: logError } = await supabase
    .from('event_promo_notifications')
    .upsert(
      delivered.map(userId => ({
        event_id: event.id,
        user_id: userId,
        ad_source: 'promo',
        matched_interest: isInterested ? isInterested(userId) : null,
      })),
      { onConflict: 'event_id,user_id', ignoreDuplicates: true }
    )
    .select('user_id');
  if (logError) {
    console.error('[PROMO-PACING] error registrando envíos:', logError.message);
    return 0;
  }
  if (!logged?.length) return 0;

  const { data: newCount, error: updateError } = await supabase.rpc('increment_event_notification_sent_count', {
    p_event_id: event.id,
    p_delta: logged.length,
  });
  if (updateError) console.error('[PROMO-PACING] error actualizando contador:', updateError.message);
  else console.log(`[PROMO-PACING][pid:${INSTANCE_ID}] Evento ${event.id} ("${event.title}") +${logged.length} envíos (${newCount}/${event.notification_count})`);

  return logged.length;
}

/** Reparto en memoria (puro). Devuelve [{ event, users }]. */
function assignUsers({ rankedEvents, users, interestsByUser, excludeByEvent, target = TICK_TARGET }) {
  let available = users;
  const assignments = [];
  let assigned = 0;

  for (let start = 0; start < rankedEvents.length && assigned < target && available.length; start += BOOST_GROUP_SIZE) {
    const metas = rankedEvents.slice(start, start + BOOST_GROUP_SIZE).map(event => ({
      event,
      remaining: Math.min(BASE_CHUNK_PER_TICK, event.notification_count - event.notification_sent_count),
      excludeSet: excludeByEvent.get(event.id) || new Set(),
      hardFilter: makeEventHardFilter(event),
      eventCategories: new Set((event.categories || []).filter(Boolean)),
      chosen: [],
    }));

    for (const meta of metas) {
      if (!meta.hardFilter) continue;
      const rest = [];
      for (const candidate of available) {
        if (meta.remaining > 0 && !meta.excludeSet.has(candidate.userId) && meta.hardFilter(candidate.user)) {
          meta.chosen.push(candidate);
          meta.remaining -= 1;
        } else {
          rest.push(candidate);
        }
      }
      available = rest;
    }

    available = assignCandidatesBidirectional({
      candidates: available,
      eventMetas: metas.filter(m => !m.hardFilter),
      interestsByUser,
    });

    for (const meta of metas) {
      if (!meta.chosen.length) continue;
      assigned += meta.chosen.length;
      assignments.push(meta);
    }
  }
  return assignments;
}

let running = false;

async function runEventPromoPacingTick() {
  const now = new Date();
  if (running || !isPromoSendingTime(now)) return;
  running = true;
  try {
    const dayKey = getNotificationDayKey(now);
    const windowEnd = new Date(now.getTime() + PROMO_WINDOW_DAYS * 24 * 3600 * 1000);

    const events = await fetchAll(() => supabase
      .from('community_events')
      .select('id, title, location, community_id, creator_id, promotion_plan, notification_count, notification_sent_count, event_date, audience_interested_only, categories, audience_center_lat, audience_center_lng, audience_radius_km')
      .in('promotion_plan', ['premium', 'ultra'])
      .gt('event_date', now.toISOString())
      .lte('event_date', windowEnd.toISOString())
      .is('cancelled_at', null)
      .not('notification_count', 'is', null)
      .order('id'));
    const pending = events.filter(e => e.notification_sent_count < e.notification_count);
    if (!pending.length) return;

    const eventIds = pending.map(e => e.id);
    const communityIds = pending.map(e => e.community_id);
    const [audience, claimedToday, history, members] = await Promise.all([
      loadAudience({ fresh: true }),
      // Solo es un pre-filtro: la reserva atómica de claimDailySlots manda.
      fetchAll(() => supabase
        .from('user_daily_notification_claims').select('user_id')
        .eq('claim_date', dayKey).order('user_id')),
      selectInChunks(eventIds, ids => supabase
        .from('event_promo_notifications').select('event_id, user_id, sent_at, ad_source')
        .in('event_id', ids).order('event_id').order('user_id')),
      selectInChunks(communityIds, ids => supabase
        .from('community_members').select('community_id, user_id')
        .in('community_id', ids).order('community_id').order('user_id')),
    ]);

    const membersByCommunity = new Map();
    for (const m of members) {
      if (!membersByCommunity.has(m.community_id)) membersByCommunity.set(m.community_id, []);
      membersByCommunity.get(m.community_id).push(m.user_id);
    }
    const excludeByEvent = new Map(pending.map(e => [
      e.id, new Set([e.creator_id, ...(membersByCommunity.get(e.community_id) || [])]),
    ]));
    const sentToday = new Map();
    for (const h of history) {
      excludeByEvent.get(h.event_id)?.add(h.user_id);
      if (h.ad_source === 'promo' && h.sent_at && getNotificationDayKey(new Date(h.sent_at)) === dayKey) {
        sentToday.set(h.event_id, (sentToday.get(h.event_id) || 0) + 1);
      }
    }

    const busy = new Set(claimedToday.map(r => r.user_id));
    const users = [];
    const interestsByUser = new Map();
    for (const user of audience.values()) {
      if (busy.has(user.id) || !canReceivePromoPush(user)) continue;
      users.push({ userId: user.id, user });
      interestsByUser.set(user.id, user.interests);
    }
    if (!users.length) return;

    const assignments = assignUsers({
      rankedEvents: rankEvents(pending, sentToday, now),
      users: shuffle(users),
      interestsByUser,
      excludeByEvent,
    });

    for (const { event, chosen, eventCategories } of assignments) {
      try {
        await dispatchToEvent(
          event, chosen.map(c => c.userId), dayKey,
          makeInterestClassifier(eventCategories, interestsByUser));
      } catch (err) {
        console.error(`[PROMO-PACING] evento ${event.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[PROMO-PACING] runEventPromoPacingTick error:', err.message || err);
  } finally {
    running = false;
  }
}

module.exports = { runEventPromoPacingTick, rankEvents, assignUsers, PROMO_WINDOW_DAYS };
