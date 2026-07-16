/**
 * eventPromoPacing.js — Reparto gradual de notificaciones Premium/Ultra.
 *
 * Antes (fase 68): al publicar un evento premium/ultra se disparaban de
 * golpe todas las notificaciones contratadas (fire-and-forget), sin tope
 * de frecuencia por usuario ni reparto entre eventos concurrentes.
 *
 * Ahora (fase 69, revisada): este job corre cada pocos minutos y, en
 * cada pasada:
 *
 *   1. Aplica un tope de 1 notificación promocional (premium/ultra) por
 *      usuario y día, contando TODOS los eventos activos a la vez — un
 *      usuario ya notificado hoy (de cualquier evento) queda fuera del
 *      resto de eventos hasta el día siguiente.
 *
 *   2. Ordena TODOS los eventos activos por ratio
 *      notification_sent_count/notification_count ascendente (peor primero,
 *      "más rezagados") y los procesa en GRUPOS FIJOS de BOOST_GROUP_SIZE=3
 *      (compartido con el banner volador de sorteos Light/Volt, ver
 *      lib/adaptiveBoost.js):
 *
 *        - Se procesa el grupo de los 3 con peor ratio. Cada evento del
 *          grupo intenta reservar hasta BASE_CHUNK_PER_TICK usuarios del
 *          pool disponible del tick, con dos sub-rondas dentro del grupo:
 *          filtro duro (audience_interested_only) primero para que no se
 *          queden sin candidatos coincidentes, relleno normal después.
 *
 *        - Si el grupo consumió al menos 1 usuario, este tick termina ahí.
 *          El resto de grupos esperan al siguiente tick (5 min).
 *
 *        - Si el grupo consumió 0 (caso típico: los 3 son
 *          audience_interested_only y ningún candidato del pool coincide
 *          categoría con ninguno de los 3) el pool queda intacto → pasamos
 *          al SIGUIENTE grupo de 3 en el ranking por ratio, y así hasta
 *          que un grupo consuma o se agoten los eventos activos.
 *
 *      La métrica del ratio ya prioriza sola: un evento imminente y poco
 *      enviado tiene peor ratio que uno lejano y bien enviado → va antes
 *      de forma natural. Un evento con más volumen contratado también
 *      sale antes con mismo nº enviado. Premium y Ultra compiten en la
 *      misma cola sin distinción.
 *
 *   3. Dentro de un mismo tick, un usuario asignado a un evento no puede
 *      ser asignado también a otro (se reserva en memoria antes de
 *      escribir en BD).
 *
 *   4. Un evento deja de recibir envíos en cuanto arranca (event_date <=
 *      ahora); notification_sent_count queda fijado en ese momento, que
 *      es la base para la facturación (cuando se implemente el cobro).
 *      El mínimo de cobro (FREE_THRESHOLD) se sigue exportando para el
 *      bloqueo de renovación en community.js, pero NO influye en el
 *      reparto — la métrica del ratio ya empuja hacia arriba a los que
 *      no han llegado.
 *
 * Fase 70: el tope diario ("¿a quién ya se le notificó hoy?") se reserva
 * ahora con una operación atómica de Postgres (INSERT ... ON CONFLICT DO
 * NOTHING sobre user_daily_notification_claims, UNIQUE por (user_id,
 * claim_date)), inmune a que corran 1, 2 o N instancias del cron a la vez.
 * El incremento de notification_sent_count usa igualmente un UPDATE
 * atómico vía RPC (increment_event_notification_sent_count) en vez de un
 * read-then-write en JS. Ver supabase_schema_phase70_atomic_daily_notification_cap.sql.
 *
 * Fase actual: simplificación del reparto.
 *   - Se retira el "boost" de prioridad por intereses (Ronda 1 que daba
 *     preferencia a candidatos con users.interests ∩ event.categories dentro
 *     del grupo "necesitado"): diluía el valor del filtro
 *     audience_interested_only — como los eventos SIN filtro ya acababan
 *     llegando principalmente a interesados por el boost, pagar por el
 *     filtro duro no aportaba prácticamente nada.
 *   - Se retira el split Tier A / Tier B y el chunk de emergencia
 *     (isEmergency/EMERGENCY_WINDOW_MS): añadían capas encima del ratio
 *     para empujar a los eventos por debajo del mínimo de cobro, pero el
 *     propio ratio ya los empuja arriba (poco enviado + volumen contratado
 *     alto = ratio bajo = primero en la cola). El FREE_THRESHOLD queda
 *     solo para bloqueo de renovación (community.js), no para pacing.
 *   - Se retira el reparto simultáneo a TODOS los eventos activos en cada
 *     tick: ahora los eventos se procesan en GRUPOS FIJOS de 3
 *     (BOOST_GROUP_SIZE, compartido con sorteos), en ranking ascendente
 *     por ratio. Si el primer grupo consume pool, este tick termina; si
 *     no consume nada (todos filter-only sin matches en pool), se pasa
 *     al siguiente grupo de 3. Recursivo hasta que un grupo consuma o
 *     se agoten los eventos.
 *
 *   La única palanca para dirigir publicidad por categorías es
 *   audience_interested_only (filtro duro, opcional en premium/ultra); sin
 *   él, el reparto es uniforme sobre el pool disponible del tick. Premium
 *   y Ultra no tienen prioridad entre sí — solo compiten vía la métrica
 *   del ratio, nunca por promotion_plan.
 */

const supabase = require('../lib/supabase');
const { sendPushToSubscription } = require('../lib/webpush');
const { getNotificationDayKey } = require('../lib/notificationDay');
const { INSTANCE_ID } = require('../lib/instanceId');
const { BOOST_GROUP_SIZE } = require('../lib/adaptiveBoost');

const FREE_THRESHOLD = 200;          // umbral mínimo de cobro — SOLO usado por community.js para bloqueo de renovación, no para pacing
const BASE_CHUNK_PER_TICK = 50;      // cupo máximo que puede recibir un evento por tick
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

    // 5b. Priorización: una única métrica, ratio enviadas/contratadas
    //     ascendente (peor ratio primero). No hay split Tier A/Tier B ni
    //     chunk de emergencia — la métrica ya prioriza sola: un evento
    //     imminente y poco enviado tiene peor ratio que uno lejano y bien
    //     enviado, así que va antes de forma natural. Premium y Ultra
    //     compiten aquí en igualdad de condiciones — el plan contratado no
    //     da prioridad de por sí, solo influye vía la métrica (más volumen
    //     contratado = ratio peor para mismo nº enviado).
    const allByRatio = pending
      .slice()
      .sort((a, b) => (a.notification_sent_count / a.notification_count) - (b.notification_sent_count / b.notification_count));

    // 6. Fase 105 — filtro "solo intereses" por evento (hard filter). Se
    //    cargan los intereses de los candidatos vivos solo si algún evento
    //    de este tick lo necesita para cruzarlos (audience_interested_only).
    //    Sin esa opción, el reparto es uniforme sobre el pool disponible.
    //    Se carga UNA SOLA VEZ para todo el tick (todos los grupos de 3
    //    posibles), no por grupo — el pool de candidatos es el mismo en
    //    memoria y no vale la pena re-consultar por cada iteración.
    const anyInterestedOnly = allByRatio.some(e => e.audience_interested_only);
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

    // 7. Reparto en memoria (sin duplicar usuarios entre eventos en el mismo tick).
    //
    // Se procesan los eventos en GRUPOS FIJOS de BOOST_GROUP_SIZE=3, en
    // orden ascendente de ratio (peor primero). Por cada grupo:
    //
    //   a) Ronda 1 (filtro duro): eventos con audience_interested_only
    //      reservan primero a sus candidatos coincidentes. Van antes que el
    //      resto porque su restricción es dura — si un evento sin filtro
    //      les quita a los coincidentes, no tienen fallback en Ronda 2
    //      (interestsFilter descarta al resto, se quedan a cero).
    //
    //   b) Ronda 2 (relleno normal): con lo que sobra del pool, cada
    //      evento del grupo rellena el cupo que le quede. El filtro duro
    //      se sigue respetando por seguridad.
    //
    //   c) Si el grupo asigna al menos 1 usuario, este tick termina ahí
    //      — el resto de grupos esperan al siguiente tick del cron (5 min).
    //      Con chunks de BASE_CHUNK_PER_TICK por evento, un solo grupo
    //      normalmente ya consume el pool que puede consumir hoy sin
    //      pasarse del tope diario de 1 push/usuario.
    //
    //   d) Si el grupo asigna 0 usuarios (caso típico: los 3 son
    //      audience_interested_only y en el pool no hay candidatos que
    //      coincidan categoría con ninguno de los 3), NO se ha gastado
    //      pool → se pasa al SIGUIENTE grupo de 3 en el ranking por
    //      ratio, y se intenta con ellos. Y así sucesivamente hasta que
    //      un grupo consuma o se agoten los eventos.
    const allAssignments = [];
    for (let start = 0; start < allByRatio.length; start += BOOST_GROUP_SIZE) {
      const group = allByRatio.slice(start, start + BOOST_GROUP_SIZE);
      const eventMeta = [];
      for (const event of group) {
        const remainingToCap = event.notification_count - event.notification_sent_count;
        const chunkTarget = Math.min(BASE_CHUNK_PER_TICK, remainingToCap);
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

        eventMeta.push({ event, remaining: chunkTarget, excludeSet, interestsFilter, chosen: [] });
      }

      // Ronda 1 del grupo: filtros duros primero.
      for (const meta of eventMeta) {
        if (!meta.interestsFilter || meta.remaining <= 0 || !available.length) continue;
        const matched = [];
        const rest = [];
        for (const candidate of available) {
          const isMatch = matched.length < meta.remaining &&
            !meta.excludeSet.has(candidate.userId) &&
            meta.interestsFilter(candidate.userId);
          (isMatch ? matched : rest).push(candidate);
        }
        if (matched.length) {
          meta.chosen.push(...matched);
          meta.remaining -= matched.length;
          available = rest;
        }
      }

      // Ronda 2 del grupo: relleno normal del cupo restante.
      for (const meta of eventMeta) {
        if (meta.remaining <= 0 || !available.length) continue;
        const chosen = [];
        const rest = [];
        for (const candidate of available) {
          const passes = chosen.length < meta.remaining &&
            !meta.excludeSet.has(candidate.userId) &&
            (!meta.interestsFilter || meta.interestsFilter(candidate.userId));
          (passes ? chosen : rest).push(candidate);
        }
        if (chosen.length) {
          meta.chosen.push(...chosen);
          available = rest;
        }
      }

      const groupAssignments = eventMeta
        .filter(meta => meta.chosen.length)
        .map(meta => ({ event: meta.event, users: meta.chosen }));

      if (groupAssignments.length) {
        // El grupo consumió pool → este tick termina aquí. El resto de
        // grupos esperan al siguiente tick del cron.
        allAssignments.push(...groupAssignments);
        break;
      }
      // Grupo con 0 asignaciones → pool intacto, siguiente grupo de 3.
    }

    const assignments = allAssignments;

    // 8. Ejecutar envíos
    for (const { event, users } of assignments) {
      await dispatchToEvent(event, users, dayKey);
    }
  } catch (err) {
    console.error('[PROMO-PACING] runEventPromoPacingTick error:', err);
  }
}

module.exports = { runEventPromoPacingTick, FREE_THRESHOLD };
