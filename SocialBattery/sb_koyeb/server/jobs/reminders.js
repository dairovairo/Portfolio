/**
 * reminders.js — Recordatorios de quedadas y eventos de comunidad.
 *
 * • Quedadas  : cron cada minuto. Notifica a los participantes cuando
 *               quedan exactamente 10 minutos para que empiece la quedada.
 *
 * • Eventos   : cron cada hora. Notifica a los asistentes cuando quedan
 *               exactamente 24 horas para que empiece el evento.
 *
 * Ambos usan:
 *   1. web-push  → llega aunque la app esté cerrada (requiere suscripción VAPID).
 *   2. Broadcast → canal Realtime personal `reminder-{userId}` para notificación
 *                  instantánea cuando la app está abierta o en background.
 *
 * Idempotencia: guardamos los IDs ya notificados en Sets en memoria durante
 * la vida del proceso. La ventana de búsqueda es estrecha (±30 s / ±30 min)
 * para que un reinicio del proceso solo pierda como máximo una ventana.
 */

const supabase    = require('../lib/supabase');
const { notifyUsers } = require('../lib/webpush');

// ── Memoria de IDs ya notificados (evita duplicados dentro del proceso) ───────
const notifiedPools  = new Set(); // pool IDs
const notifiedEvents = new Set(); // event IDs

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Emite un broadcast Realtime al canal personal `reminder-{userId}` de cada
 * destinatario. El cliente escucha este canal y dispara la notificación local.
 */
async function broadcastReminders(userIds, payload) {
  await Promise.allSettled(
    userIds.map(uid =>
      supabase
        .channel(`reminder-${uid}`)
        .send({ type: 'broadcast', event: 'reminder', payload })
    )
  );
}

// ── Job 1: quedadas a 10 minutos ──────────────────────────────────────────────

async function notifyPoolsStartingSoon() {
  const now      = new Date();
  // Ventana: [now + 9m30s, now + 10m30s] — cubre la ejecución del cron cada minuto
  const windowStart = new Date(now.getTime() + 9.5  * 60 * 1000);
  const windowEnd   = new Date(now.getTime() + 10.5 * 60 * 1000);

  try {
    // Pools abiertas/llenas que empiezan en la ventana de 10 minutos
    const { data: pools, error } = await supabase
      .from('hangout_pools')
      .select(`
        id, activity, location_hint, scheduled_at,
        creator:creator_id(display_name, username)
      `)
      .in('status', ['open', 'full'])
      .gte('scheduled_at', windowStart.toISOString())
      .lte('scheduled_at', windowEnd.toISOString());

    if (error) { console.error('[REMINDER] pool query error:', error); return; }
    if (!pools?.length) return;

    for (const pool of pools) {
      if (notifiedPools.has(pool.id)) continue;
      notifiedPools.add(pool.id);

      // Obtener todos los participantes
      const { data: participants } = await supabase
        .from('pool_participants')
        .select('user_id')
        .eq('pool_id', pool.id);

      if (!participants?.length) continue;

      const userIds     = participants.map(p => p.user_id);
      const activityLabel = pool.activity || 'Tu quedada';
      const locationHint  = pool.location_hint ? ` · ${pool.location_hint}` : '';

      const pushPayload = {
        title: `⏰ Tu quedada empieza en 10 minutos`,
        body:  `${activityLabel}${locationHint}`,
        url:   '/pools',
        tag:   `pool-reminder-${pool.id}`,
      };

      const broadcastPayload = {
        type:        'pool',
        pool_id:     pool.id,
        activity:    activityLabel,
        location:    pool.location_hint || null,
        minutes_left: 10,
      };

      await Promise.all([
        notifyUsers(supabase, userIds, null /* no excluir a nadie */, pushPayload),
        broadcastReminders(userIds, broadcastPayload),
      ]);

      console.log(`[REMINDER] Pool ${pool.id} ("${activityLabel}") — notificados ${userIds.length} participantes`);
    }
  } catch (err) {
    console.error('[REMINDER] notifyPoolsStartingSoon error:', err);
  }
}

// ── Job 2: eventos a 24 horas (de comunidad o sin comunidad) ─────────────────

async function notifyEventsStartingSoon() {
  const now         = new Date();
  // Ventana: [now + 23h30m, now + 24h30m] — cubre la ejecución del cron cada hora
  // Ventana de 1 hora centrada en las 24h exactas: [now+23h, now+25h]
  // Ventana ±30 min centrada en 24 h exactas — una sola ejecución del cron
  // por evento. El Set notifiedEvents evita duplicados en caso de reinicio.
  const windowStart = new Date(now.getTime() + 23.5 * 60 * 60 * 1000);
  const windowEnd   = new Date(now.getTime() + 24.5 * 60 * 60 * 1000);

  console.log(`[REMINDER] Event check — now: ${now.toISOString()}, window: [${windowStart.toISOString()} → ${windowEnd.toISOString()}]`);

  try {
    // Traer todos los eventos en la ventana — con o sin comunidad.
    const { data: events, error } = await supabase
      .from('community_events')
      .select('id, title, location, event_date, community_id')
      .gte('event_date', windowStart.toISOString())
      .lte('event_date', windowEnd.toISOString());

    if (error) { console.error('[REMINDER] event query error:', error); return; }
    console.log(`[REMINDER] Events in window: ${events?.length ?? 0}`);
    if (!events?.length) return;

    // Resolver nombres de comunidades en un solo query
    const communityIds = [...new Set(events.map(e => e.community_id).filter(Boolean))];
    const communityMap = {};
    if (communityIds.length) {
      const { data: comms } = await supabase
        .from('communities')
        .select('id, name')
        .in('id', communityIds);
      (comms || []).forEach(c => { communityMap[c.id] = c.name; });
    }

    for (const event of events) {
      if (notifiedEvents.has(event.id)) continue;
      notifiedEvents.add(event.id);

      // Obtener asistentes confirmados
      const { data: attendees } = await supabase
        .from('community_event_attendees')
        .select('user_id')
        .eq('event_id', event.id);

      console.log(`[REMINDER]   Event ${event.id} "${event.title}" — attendees: ${attendees?.length ?? 0}`);
      if (!attendees?.length) continue;

      const userIds       = attendees.map(a => a.user_id);
      const communityName = event.community_id ? communityMap[event.community_id] || null : null;
      const communityUrl  = event.community_id ? `/community/${event.community_id}` : '/community';

      // Título de la notificación diferenciado: con o sin comunidad
      const pushTitle = communityName
        ? `📅 Mañana tienes un evento en ${communityName}`
        : `📅 Mañana tienes un evento en tu agenda`;

      const pushPayload = {
        title: pushTitle,
        body:  event.location ? `${event.title} · ${event.location}` : event.title,
        url:   communityUrl,
        tag:   `event-reminder-${event.id}`,
      };

      const broadcastPayload = {
        type:           'event',
        event_id:       event.id,
        title:          event.title,
        location:       event.location || null,
        community_name: communityName,   // null si no tiene comunidad
        community_id:   event.community_id || null,
        hours_left:     24,
      };

      await Promise.all([
        notifyUsers(supabase, userIds, null, pushPayload),
        broadcastReminders(userIds, broadcastPayload),
      ]);

      console.log(`[REMINDER] Event ${event.id} ("${event.title}") — notificados ${userIds.length} asistentes`);
    }
  } catch (err) {
    console.error('[REMINDER] notifyEventsStartingSoon error:', err);
  }
}

module.exports = { notifyPoolsStartingSoon, notifyEventsStartingSoon };
