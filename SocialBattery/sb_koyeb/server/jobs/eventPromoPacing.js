/**
 * eventPromoPacing.js — Reparto gradual de notificaciones Premium/Ultra.
 *
 * Antes (fase 68): al publicar un evento premium/ultra se disparaban de
 * golpe todas las notificaciones contratadas (fire-and-forget), sin tope
 * de frecuencia por usuario ni reparto entre eventos concurrentes.
 *
 * Ahora (fase 69): este job corre cada pocos minutos y, en cada pasada:
 *
 *   1. Aplica un tope de 1 notificación promocional (premium/ultra) por
 *      usuario y día, contando TODOS los eventos activos a la vez — un
 *      usuario ya notificado hoy (de cualquier evento) queda fuera del
 *      resto de eventos hasta el día siguiente.
 *
 *   2. Reparte el "cupo" de usuarios disponibles ese tick entre los
 *      eventos activos con dos prioridades:
 *
 *        Tier A (anti-inanición): eventos que AÚN no llegan a las 200
 *        notificaciones mínimas (umbral de cobro, ver fase de UI). Se
 *        ordenan por fecha de inicio más cercana primero, y si quedan
 *        pocas horas para empezar y siguen por debajo de 200, se les
 *        permite un "chunk" de emergencia más grande para intentar
 *        llegar al mínimo antes de que arranque el evento.
 *
 *        Tier B (crecimiento uniforme): eventos que ya superaron las 200,
 *        ordenados por ratio enviadas/contratadas ascendente — así el
 *        evento más rezagado recibe cupo primero en cada tick, y todos
 *        los eventos activos avanzan a la vez en vez de que uno agote el
 *        cupo mientras otros no reciben nada.
 *
 *   3. Dentro de un mismo tick, un usuario asignado a un evento no puede
 *      ser asignado también a otro (se reserva en memoria antes de
 *      escribir en BD).
 *
 *   4. Un evento deja de recibir envíos en cuanto arranca (event_date <=
 *      ahora); notification_sent_count queda fijado en ese momento, que
 *      es la base para la facturación (cuando se implemente el cobro).
 *
 * Nota: esto asume una única instancia de servidor corriendo el cron (caso
 * típico de un hobby project en Koyeb). Si en el futuro hay varias
 * instancias, el incremento de notification_sent_count debería moverse a
 * una función SQL atómica (o RPC) para evitar carreras.
 */

const supabase = require('../lib/supabase');
const { sendPushToSubscription } = require('../lib/webpush');

const FREE_THRESHOLD = 200;          // umbral mínimo para poder cobrar (ver UI)
const BASE_CHUNK_PER_TICK = 50;      // cupo "normal" que puede recibir un evento por tick
const EMERGENCY_WINDOW_MS = 3 * 60 * 60 * 1000; // últimas 3h antes de empezar: modo emergencia
const SUBS_PAGE_SIZE = 1000;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Trae TODAS las suscripciones push, agrupadas por usuario (un usuario puede
 * tener varios dispositivos), excluyendo a quien ya se ha notificado hoy.
 * Devuelve un array barajado de { userId, subs: [...] }.
 */
async function fetchEligiblePool(excludeUserIds) {
  const usersMap = new Map();
  let offset = 0;

  while (true) {
    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('user_id, endpoint, p256dh, auth')
      .range(offset, offset + SUBS_PAGE_SIZE - 1);

    if (error || !subs?.length) break;

    for (const sub of subs) {
      if (excludeUserIds.has(sub.user_id)) continue;
      if (!usersMap.has(sub.user_id)) usersMap.set(sub.user_id, { userId: sub.user_id, subs: [] });
      usersMap.get(sub.user_id).subs.push(sub);
    }

    if (subs.length < SUBS_PAGE_SIZE) break;
    offset += SUBS_PAGE_SIZE;
  }

  return shuffle([...usersMap.values()]);
}

function buildPayload(event) {
  if (event.promotion_plan === 'ultra') {
    return {
      title: '🚀 Evento destacado: ' + event.title,
      body:  `${event.location ? event.location + ' · ' : ''}¡No te lo pierdas!`,
      url:   `/community/event/${event.id}`,
      tag:   `ultra-event-${event.id}`,
    };
  }
  return {
    title: '⚡ Nuevo evento Premium: ' + event.title,
    body:  `${event.location ? event.location + ' · ' : ''}¡Échale un vistazo!`,
    url:   `/community/event/${event.id}`,
    tag:   `premium-event-${event.id}`,
  };
}

/**
 * Envía la notificación a un grupo de usuarios ya seleccionado para un
 * evento concreto, registra el envío en event_promo_notifications y
 * actualiza el contador notification_sent_count del evento.
 */
async function dispatchToEvent(event, users) {
  if (!users.length) return 0;

  const payload = buildPayload(event);
  const expiredEndpoints = [];
  const successfulUserIds = [];

  await Promise.allSettled(
    users.map(async (u) => {
      let anySuccess = false;
      await Promise.allSettled(
        u.subs.map(async (sub) => {
          const result = await sendPushToSubscription(sub, payload);
          if (result?.expired) expiredEndpoints.push(sub.endpoint);
          else if (result) anySuccess = true;
        })
      );
      if (anySuccess) successfulUserIds.push(u.userId);
    })
  );

  if (expiredEndpoints.length) {
    supabase
      .from('push_subscriptions')
      .delete()
      .in('endpoint', expiredEndpoints)
      .then(() => {})
      .catch(() => {});
  }

  if (!successfulUserIds.length) return 0;

  const { error: logError } = await supabase
    .from('event_promo_notifications')
    .upsert(
      successfulUserIds.map(userId => ({ event_id: event.id, user_id: userId })),
      { onConflict: 'event_id,user_id', ignoreDuplicates: true }
    );
  if (logError) {
    console.error('[PROMO-PACING] error registrando envíos:', logError);
  }

  const { error: updateError } = await supabase
    .from('community_events')
    .update({ notification_sent_count: event.notification_sent_count + successfulUserIds.length })
    .eq('id', event.id);
  if (updateError) {
    console.error('[PROMO-PACING] error actualizando contador:', updateError);
  }

  return successfulUserIds.length;
}

async function runEventPromoPacingTick() {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  try {
    // 1. Eventos premium/ultra activos (no empezados) que aún no llegan a lo contratado
    const { data: events, error: eventsError } = await supabase
      .from('community_events')
      .select('id, title, location, community_id, creator_id, promotion_plan, notification_count, notification_sent_count, event_date')
      .in('promotion_plan', ['premium', 'ultra'])
      .gt('event_date', now.toISOString())
      .not('notification_count', 'is', null);

    if (eventsError) {
      console.error('[PROMO-PACING] error consultando eventos:', eventsError);
      return { ok: false, step: 'events_query', error: eventsError.message };
    }

    const pending = (events || []).filter(e => e.notification_sent_count < e.notification_count);
    if (!pending.length) {
      return { ok: true, reason: 'no_pending_events', activePremiumUltraEvents: (events || []).length };
    }

    // 2. Tope diario global: usuarios ya notificados HOY (de cualquier evento)
    //    NOTA: sin .range()/.limit() Supabase/PostgREST corta en 1000 filas por
    //    defecto de forma silenciosa (data.length === 1000, sin error). Se pagina
    //    explícitamente para que el tope siga siendo correcto según crece el uso.
    const notifiedToday = [];
    {
      let offset = 0;
      while (true) {
        const { data: page, error: notifiedError } = await supabase
          .from('event_promo_notifications')
          .select('user_id')
          .gte('sent_at', todayStart.toISOString())
          .range(offset, offset + SUBS_PAGE_SIZE - 1);
        if (notifiedError) {
          console.error('[PROMO-PACING] error consultando log diario:', notifiedError);
          return { ok: false, step: 'daily_log_query', error: notifiedError.message };
        }
        notifiedToday.push(...(page || []));
        if (!page || page.length < SUBS_PAGE_SIZE) break;
        offset += SUBS_PAGE_SIZE;
      }
    }
    const notifiedTodaySet = new Set(notifiedToday.map(r => r.user_id));

    // 3. Historial completo por evento (para no repetir usuario en el mismo evento)
    const eventIds = pending.map(e => e.id);
    const everNotified = [];
    {
      let offset = 0;
      while (true) {
        const { data: page } = await supabase
          .from('event_promo_notifications')
          .select('event_id, user_id')
          .in('event_id', eventIds)
          .range(offset, offset + SUBS_PAGE_SIZE - 1);
        everNotified.push(...(page || []));
        if (!page || page.length < SUBS_PAGE_SIZE) break;
        offset += SUBS_PAGE_SIZE;
      }
    }
    const everNotifiedByEvent = new Map();
    (everNotified || []).forEach(r => {
      if (!everNotifiedByEvent.has(r.event_id)) everNotifiedByEvent.set(r.event_id, new Set());
      everNotifiedByEvent.get(r.event_id).add(r.user_id);
    });

    // 4. Miembros de comunidad (ya notificados aparte al publicar, siempre se excluyen)
    const communityIds = [...new Set(pending.filter(e => e.community_id).map(e => e.community_id))];
    const communityMembersByCommunity = new Map();
    if (communityIds.length) {
      const { data: members } = await supabase
        .from('community_members')
        .select('community_id, user_id')
        .in('community_id', communityIds);
      (members || []).forEach(m => {
        if (!communityMembersByCommunity.has(m.community_id)) communityMembersByCommunity.set(m.community_id, new Set());
        communityMembersByCommunity.get(m.community_id).add(m.user_id);
      });
    }

    // 5. Cupo disponible este tick: usuarios con push activo, sin notificar hoy
    let available = await fetchEligiblePool(notifiedTodaySet);
    const eligiblePoolSize = available.length;
    if (!available.length) {
      return {
        ok: true,
        reason: 'no_eligible_users',
        pendingEvents: pending.length,
        notifiedTodayCount: notifiedTodaySet.size,
        hint: 'Todos los usuarios con push activo ya fueron notificados hoy, o no hay ninguna suscripción push registrada (push_subscriptions vacía).',
      };
    }

    // 6. Priorización: Tier A (bajo mínimo, más urgentes primero) + Tier B (más rezagados primero)
    const urgent = pending
      .filter(e => e.notification_sent_count < FREE_THRESHOLD)
      .sort((a, b) => new Date(a.event_date) - new Date(b.event_date));

    const steady = pending
      .filter(e => e.notification_sent_count >= FREE_THRESHOLD)
      .sort((a, b) => (a.notification_sent_count / a.notification_count) - (b.notification_sent_count / b.notification_count));

    const priorityOrder = [...urgent, ...steady];

    // 7. Reparto en memoria (sin duplicar usuarios entre eventos en el mismo tick)
    const assignments = [];

    for (const event of priorityOrder) {
      if (!available.length) break;

      const remainingToThreshold = Math.max(0, FREE_THRESHOLD - event.notification_sent_count);
      const remainingToCap = event.notification_count - event.notification_sent_count;
      const timeLeftMs = new Date(event.event_date).getTime() - now.getTime();
      const isEmergency = remainingToThreshold > 0 && timeLeftMs < EMERGENCY_WINDOW_MS;

      const chunkTarget = isEmergency
        ? Math.min(remainingToThreshold, remainingToCap)
        : Math.min(BASE_CHUNK_PER_TICK, remainingToCap);

      if (chunkTarget <= 0) continue;

      const communityMemberCount = event.community_id ? (communityMembersByCommunity.get(event.community_id)?.size || 0) : 0;
      const excludeSet = new Set([
        event.creator_id,
        ...(event.community_id ? communityMembersByCommunity.get(event.community_id) || [] : []),
        ...(everNotifiedByEvent.get(event.id) || []),
      ]);

      const chosen = [];
      const rest = [];
      for (const candidate of available) {
        if (chosen.length < chunkTarget && !excludeSet.has(candidate.userId)) {
          chosen.push(candidate);
        } else {
          rest.push(candidate);
        }
      }

      if (chosen.length) {
        assignments.push({ event, users: chosen, communityMemberCount, chunkTarget, isEmergency });
        available = rest;
      } else {
        assignments.push({ event, users: [], communityMemberCount, chunkTarget, isEmergency, skippedNoCandidates: true });
      }
    }

    // 8. Ejecutar envíos
    const results = [];
    for (const { event, users, communityMemberCount, chunkTarget, isEmergency, skippedNoCandidates } of assignments) {
      const sent = users.length ? await dispatchToEvent(event, users) : 0;
      if (sent > 0) {
        console.log(`[PROMO-PACING] Evento ${event.id} ("${event.title}") +${sent} envíos (${event.notification_sent_count + sent}/${event.notification_count})`);
      }
      results.push({
        eventId: event.id,
        title: event.title,
        communityId: event.community_id,
        communityMembersExcluded: communityMemberCount,
        chunkTarget,
        isEmergency,
        sent,
        skippedNoCandidates: !!skippedNoCandidates,
        totalSentSoFar: event.notification_sent_count + sent,
        totalContracted: event.notification_count,
      });
    }

    return {
      ok: true,
      pendingEvents: pending.length,
      eligiblePoolSize,
      notifiedTodayCount: notifiedTodaySet.size,
      results,
    };
  } catch (err) {
    console.error('[PROMO-PACING] runEventPromoPacingTick error:', err);
    return { ok: false, step: 'unexpected_exception', error: err.message };
  }
}

module.exports = { runEventPromoPacingTick };
