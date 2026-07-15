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
 * Fase 70: el tope diario ("¿a quién ya se le notificó hoy?") se reserva
 * ahora con una operación atómica de Postgres (INSERT ... ON CONFLICT DO
 * NOTHING sobre user_daily_notification_claims, UNIQUE por (user_id,
 * claim_date)), inmune a que corran 1, 2 o N instancias del cron a la vez.
 * El incremento de notification_sent_count usa igualmente un UPDATE
 * atómico vía RPC (increment_event_notification_sent_count) en vez de un
 * read-then-write en JS. Ver supabase_schema_phase70_atomic_daily_notification_cap.sql.
 */

const supabase = require('../lib/supabase');
const { sendPushToSubscription } = require('../lib/webpush');
const { getNotificationDayKey } = require('../lib/notificationDay');
const { INSTANCE_ID } = require('../lib/instanceId');

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
 * Reserva atómicamente el hueco del día para un grupo de candidatos.
 *
 * INSERT ... ON CONFLICT (user_id, claim_date) DO NOTHING vía Supabase
 * upsert(ignoreDuplicates: true) + select(): PostgREST lo traduce en un
 * INSERT ... ON CONFLICT DO NOTHING RETURNING *, y una fila que choca con
 * la UNIQUE simplemente no aparece en el RETURNING. Esto es atómico a
 * nivel de Postgres pase lo que pase en la app: da igual que 1, 2 o N
 * instancias/ticks intenten reservar al mismo usuario el mismo día a la
 * vez, como mucho una gana la fila. Devuelve solo los userIds que
 * consiguieron la reserva (los "ganadores" de este intento).
 */
async function claimDailySlots(userIds, eventId, dayKey) {
  if (!userIds.length) return new Set();

  const { data: claimed, error } = await supabase
    .from('user_daily_notification_claims')
    .upsert(
      userIds.map(userId => ({ user_id: userId, claim_date: dayKey, event_id: eventId })),
      { onConflict: 'user_id,claim_date', ignoreDuplicates: true }
    )
    .select('user_id');

  if (error) {
    console.error('[PROMO-PACING] error reservando hueco diario:', error);
    return new Set();
  }

  return new Set((claimed || []).map(r => r.user_id));
}

/**
 * Libera (best-effort) la reserva diaria de usuarios a los que no se les
 * pudo enviar ningún push (p.ej. suscripciones caducadas), para no
 * "gastarles" el hueco del día en un envío que nunca llegó. Como cada
 * instancia solo borra reservas que ella misma acaba de ganar, no reabre
 * ninguna carrera.
 */
async function releaseUnusedClaims(userIds, dayKey) {
  if (!userIds.length) return;
  const { error } = await supabase
    .from('user_daily_notification_claims')
    .delete()
    .eq('claim_date', dayKey)
    .in('user_id', userIds);
  if (error) {
    console.warn('[PROMO-PACING] error liberando reservas no usadas:', error);
  }
}

/**
 * Envía la notificación a un grupo de usuarios ya seleccionado para un
 * evento concreto. Reserva primero el hueco diario de forma atómica (solo
 * se envía a quien gana la reserva), registra el envío en
 * event_promo_notifications y actualiza notification_sent_count del
 * evento con un incremento atómico en BD.
 */
async function dispatchToEvent(event, users, dayKey) {
  if (!users.length) return 0;

  // 1) Reservar el hueco del día ANTES de enviar nada: así, aunque haya
  //    varias instancias corriendo a la vez, solo una puede "ganar" a cada
  //    usuario para hoy — es la operación atómica que cierra la carrera.
  const claimedIds = await claimDailySlots(users.map(u => u.userId), event.id, dayKey);
  const claimedUsers = users.filter(u => claimedIds.has(u.userId));
  if (!claimedUsers.length) return 0;

  const payload = buildPayload(event);
  const expiredEndpoints = [];
  const successfulUserIds = [];

  await Promise.allSettled(
    claimedUsers.map(async (u) => {
      let anySuccess = false;
      await Promise.allSettled(
        u.subs.map(async (sub) => {
          const result = await sendPushToSubscription(sub, payload);
          if (result?.expired) expiredEndpoints.push(sub.endpoint);
          else if (result?.success) anySuccess = true;
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

  // 2) A quien se le reservó el hueco pero no recibió ningún push, se le
  //    libera la reserva para que pueda optar a otro evento hoy mismo.
  const successfulSet = new Set(successfulUserIds);
  const failedUserIds = claimedUsers
    .map(u => u.userId)
    .filter(userId => !successfulSet.has(userId));
  if (failedUserIds.length) {
    releaseUnusedClaims(failedUserIds, dayKey).catch(() => {});
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

  const { data: newCount, error: updateError } = await supabase.rpc('increment_event_notification_sent_count', {
    p_event_id: event.id,
    p_delta: successfulUserIds.length,
  });
  if (updateError) {
    console.error('[PROMO-PACING] error actualizando contador:', updateError);
  } else {
    console.log(`[PROMO-PACING][pid:${INSTANCE_ID}] Evento ${event.id} ("${event.title}") +${successfulUserIds.length} envíos (${newCount}/${event.notification_count})`);
  }

  return successfulUserIds.length;
}

async function runEventPromoPacingTick() {
  const now = new Date();
  const dayKey = getNotificationDayKey(now);

  try {
    // 1. Eventos premium/ultra activos (no empezados) que aún no llegan a lo contratado
    const { data: events, error: eventsError } = await supabase
      .from('community_events')
      .select('id, title, location, community_id, creator_id, promotion_plan, notification_count, notification_sent_count, event_date, audience_interested_only, categories')
      .in('promotion_plan', ['premium', 'ultra'])
      .gt('event_date', now.toISOString())
      .not('notification_count', 'is', null);

    if (eventsError) { console.error('[PROMO-PACING] error consultando eventos:', eventsError); return; }

    const pending = (events || []).filter(e => e.notification_sent_count < e.notification_count);
    if (!pending.length) return;

    // 2. Tope diario global: usuarios con el hueco de hoy ya reservado (de
    //    cualquier evento, o del aviso inmediato de comunidad). Esto es solo
    //    un PRE-FILTRO para no malgastar cupo del reparto en memoria en
    //    candidatos que ya sabemos ocupados — la autoridad real que cierra
    //    la carrera es el INSERT ... ON CONFLICT DO NOTHING atómico dentro
    //    de dispatchToEvent (claimDailySlots), no esta lectura.
    const { data: claimedToday, error: notifiedError } = await supabase
      .from('user_daily_notification_claims')
      .select('user_id')
      .eq('claim_date', dayKey);
    if (notifiedError) {
      // Si user_daily_notification_claims no existe (migración fase70 no
      // ejecutada) o SUPABASE_SERVICE_KEY no es la service_role real, esta
      // consulta falla y CORTAMOS el tick entero aquí — no se envía nada,
      // no se "salta" el tope. Si en producción ves eventos premium/ultra
      // que nunca reciben push, este es el primer log a buscar.
      console.error('[NOTIF-CAP][PROMO-PACING] ⚠️ error consultando reservas de hoy (revisar migración fase70 / SUPABASE_SERVICE_KEY):', notifiedError);
      return;
    }
    const notifiedTodaySet = new Set((claimedToday || []).map(r => r.user_id));
    console.log(`[NOTIF-CAP][PROMO-PACING][pid:${INSTANCE_ID}] tick ${dayKey}: ${pending.length} eventos pendientes, ${notifiedTodaySet.size} usuarios ya con hueco de hoy reservado (excluidos de este tick).`);

    // 2b. Usuarios con "Silenciar recomendaciones de eventos de otras
    //     comunidades" activado (users.mute_event_recommendations, fase 92).
    //     Este pool de reparto (fetchEligiblePool más abajo) YA excluye a
    //     los miembros de la comunidad del propio evento (ver excludeSet más
    //     abajo, línea "...communityMembersByCommunity..."), así que lo que
    //     queda aquí es exactamente el alcance hacia gente de OTRAS
    //     comunidades (o sin comunidad) — el caso que este ajuste debe
    //     silenciar.
    const { data: mutedRecommendationRows, error: mutedRecError } = await supabase
      .from('users')
      .select('id')
      .eq('mute_event_recommendations', true);
    if (mutedRecError) {
      console.warn('[PROMO-PACING] error consultando mute_event_recommendations:', mutedRecError.message);
    }
    const mutedRecommendationIds = new Set((mutedRecommendationRows || []).map(r => r.id));
    console.log(`[NOTIF-CAP][PROMO-PACING] ${mutedRecommendationIds.size} usuarios con recomendaciones de eventos silenciadas (excluidos del reparto).`);

    // 3. Historial completo por evento (para no repetir usuario en el mismo evento)
    const eventIds = pending.map(e => e.id);
    const { data: everNotified } = await supabase
      .from('event_promo_notifications')
      .select('event_id, user_id')
      .in('event_id', eventIds);
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

    // 5. Cupo disponible este tick: usuarios con push activo, sin notificar
    //    hoy y sin las recomendaciones de eventos silenciadas.
    const excludedFromPool = new Set([...notifiedTodaySet, ...mutedRecommendationIds]);
    let available = await fetchEligiblePool(excludedFromPool);
    if (!available.length) return;

    // 5b. Fase 105 — filtro "solo intereses" por evento. Si algún evento
    //     de este tick lo tiene activado, cargamos una sola vez el mapa
    //     userId → Set(interests) para todos los candidatos vivos y
    //     después, en el reparto por evento, se descartan los candidatos
    //     que no compartan ninguna categoría con las del evento
    //     (users.interests ∩ event.categories). Sin el flag, el reparto
    //     sigue como antes (todo el pool notificable).
    const anyInterestedOnly = pending.some(e => e.audience_interested_only);
    const interestsByUser = new Map();
    if (anyInterestedOnly) {
      const candidateIds = available.map(c => c.userId);
      const CHUNK = 500;
      for (let i = 0; i < candidateIds.length; i += CHUNK) {
        const slice = candidateIds.slice(i, i + CHUNK);
        const { data: rows, error: interestsErr } = await supabase
          .from('users')
          .select('id, interests')
          .in('id', slice);
        if (interestsErr) {
          console.warn('[PROMO-PACING] error cargando intereses para filtro por intereses:', interestsErr.message);
          break;
        }
        (rows || []).forEach(r => {
          interestsByUser.set(r.id, new Set((r.interests || []).filter(Boolean)));
        });
      }
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

      const excludeSet = new Set([
        event.creator_id,
        ...(event.community_id ? communityMembersByCommunity.get(event.community_id) || [] : []),
        ...(everNotifiedByEvent.get(event.id) || []),
      ]);

      // Fase 105: si el evento contrató "solo intereses", el candidato
      // además tiene que compartir alguna categoría con el evento
      // (users.interests ∩ event.categories no vacío). Si el evento no
      // tiene categorías, no hay con qué cruzar y nadie pasa este filtro
      // — mismo criterio que el frontend (interested=0 sin categorías).
      const eventCategories = new Set((event.categories || []).filter(Boolean));
      const interestsFilter = event.audience_interested_only
        ? (userId) => {
            if (!eventCategories.size) return false;
            const userInterests = interestsByUser.get(userId);
            if (!userInterests || !userInterests.size) return false;
            for (const cat of userInterests) if (eventCategories.has(cat)) return true;
            return false;
          }
        : null;

      const chosen = [];
      const rest = [];
      for (const candidate of available) {
        const passes = !excludeSet.has(candidate.userId) &&
          (!interestsFilter || interestsFilter(candidate.userId));
        if (chosen.length < chunkTarget && passes) {
          chosen.push(candidate);
        } else {
          rest.push(candidate);
        }
      }

      if (chosen.length) {
        assignments.push({ event, users: chosen });
        available = rest;
      }
    }

    // 8. Ejecutar envíos
    for (const { event, users } of assignments) {
      await dispatchToEvent(event, users, dayKey);
    }
  } catch (err) {
    console.error('[PROMO-PACING] runEventPromoPacingTick error:', err);
  }
}

module.exports = { runEventPromoPacingTick, FREE_THRESHOLD };
