/**
 * reminders.js - Recordatorios de quedadas y eventos.
 *
 * Cada participante/asistente puede elegir cuantos minutos antes quiere recibir
 * el aviso. El rango valido es de 10 minutos a 1 semana. El job se ejecuta cada
 * minuto y usa una ventana de +/-30 segundos alrededor del instante elegido.
 */

const supabase = require('../lib/supabase');
const { notifyUsers } = require('../lib/webpush');
const {
  MIN_REMINDER_MINUTES,
  MAX_REMINDER_MINUTES,
  DEFAULT_POOL_REMINDER_MINUTES,
  DEFAULT_EVENT_REMINDER_MINUTES,
  formatReminderLead,
} = require('../lib/reminderLeadTime');

const REMINDER_WINDOW_MS = 60 * 1000;
const notifiedPools = new Set();  // `${poolId}:${userId}`
const notifiedEvents = new Set(); // `${eventId}:${userId}`

async function broadcastReminders(userIds, payload) {
  await Promise.allSettled(
    userIds.map(uid =>
      supabase
        .channel(`reminder-${uid}`)
        .send({ type: 'broadcast', event: 'reminder', payload })
    )
  );
}

function getSearchWindow(now = new Date()) {
  return {
    start: new Date(now.getTime() + (MIN_REMINDER_MINUTES * 60 * 1000) - (REMINDER_WINDOW_MS / 2)),
    end: new Date(now.getTime() + (MAX_REMINDER_MINUTES * 60 * 1000) + (REMINDER_WINDOW_MS / 2)),
  };
}

function normalizeReminderMinutes(value, fallback) {
  const minutes = Number.parseInt(value, 10);
  if (Number.isFinite(minutes) && minutes >= MIN_REMINDER_MINUTES && minutes <= MAX_REMINDER_MINUTES) {
    return minutes;
  }
  return fallback;
}

function isReminderDue(now, startDate, reminderMinutes) {
  const startMs = new Date(startDate).getTime();
  if (Number.isNaN(startMs)) return false;
  const reminderMs = reminderMinutes * 60 * 1000;
  const diff = startMs - now.getTime();
  return Math.abs(diff - reminderMs) <= REMINDER_WINDOW_MS / 2;
}

function groupDueRecipients({ rows, idPrefix, notifiedSet, now, startDate, defaultMinutes }) {
  const groups = new Map();

  for (const row of rows || []) {
    if (!row?.user_id) continue;
    const reminderMinutes = normalizeReminderMinutes(row.reminder_minutes_before, defaultMinutes);
    if (!isReminderDue(now, startDate, reminderMinutes)) continue;

    const key = `${idPrefix}:${row.user_id}`;
    if (notifiedSet.has(key)) continue;
    notifiedSet.add(key);

    if (!groups.has(reminderMinutes)) groups.set(reminderMinutes, []);
    groups.get(reminderMinutes).push(row.user_id);
  }

  return groups;
}

async function notifyPoolsStartingSoon() {
  const now = new Date();
  const { start, end } = getSearchWindow(now);

  try {
    const { data: pools, error } = await supabase
      .from('hangout_pools')
      .select(`
        id, activity, location_hint, scheduled_at,
        pool_participants(user_id, reminder_minutes_before)
      `)
      .in('status', ['open', 'full'])
      .gte('scheduled_at', start.toISOString())
      .lte('scheduled_at', end.toISOString());

    if (error) { console.error('[REMINDER] pool query error:', error); return; }
    if (!pools?.length) return;

    for (const pool of pools) {
      const groups = groupDueRecipients({
        rows: pool.pool_participants,
        idPrefix: pool.id,
        notifiedSet: notifiedPools,
        now,
        startDate: pool.scheduled_at,
        defaultMinutes: DEFAULT_POOL_REMINDER_MINUTES,
      });
      if (groups.size === 0) continue;

      const activityLabel = pool.activity || 'Tu quedada';
      const locationHint = pool.location_hint ? ` · ${pool.location_hint}` : '';

      for (const [minutes, userIds] of groups.entries()) {
        const leadLabel = formatReminderLead(minutes);
        const pushPayload = {
          title: `⏰ Tu quedada empieza en ${leadLabel}`,
          body: `${activityLabel}${locationHint}`,
          url: '/pools',
          tag: `pool-reminder-${pool.id}`,
        };

        const broadcastPayload = {
          type: 'pool',
          pool_id: pool.id,
          activity: activityLabel,
          location: pool.location_hint || null,
          minutes_left: minutes,
        };

        await Promise.all([
          notifyUsers(supabase, userIds, null, pushPayload),
          broadcastReminders(userIds, broadcastPayload),
        ]);

        console.log(`[REMINDER] Pool ${pool.id} ("${activityLabel}") - ${leadLabel} - ${userIds.length} participantes`);
      }
    }
  } catch (err) {
    console.error('[REMINDER] notifyPoolsStartingSoon error:', err);
  }
}

async function notifyEventsStartingSoon() {
  const now = new Date();
  const { start, end } = getSearchWindow(now);

  try {
    const { data: events, error } = await supabase
      .from('community_events')
      .select(`
        id, title, location, event_date, community_id,
        community_event_attendees(user_id, reminder_minutes_before)
      `)
      .gte('event_date', start.toISOString())
      .lte('event_date', end.toISOString());

    if (error) { console.error('[REMINDER] event query error:', error); return; }
    if (!events?.length) return;

    const dueEvents = [];
    const communityIds = new Set();

    for (const event of events) {
      const groups = groupDueRecipients({
        rows: event.community_event_attendees,
        idPrefix: event.id,
        notifiedSet: notifiedEvents,
        now,
        startDate: event.event_date,
        defaultMinutes: DEFAULT_EVENT_REMINDER_MINUTES,
      });
      if (groups.size === 0) continue;
      dueEvents.push({ event, groups });
      if (event.community_id) communityIds.add(event.community_id);
    }

    if (dueEvents.length === 0) return;

    const communityMap = {};
    if (communityIds.size) {
      const { data: comms } = await supabase
        .from('communities')
        .select('id, name')
        .in('id', [...communityIds]);
      (comms || []).forEach(c => { communityMap[c.id] = c.name; });
    }

    for (const { event, groups } of dueEvents) {
      const communityName = event.community_id ? communityMap[event.community_id] || null : null;
      const communityUrl = event.community_id ? `/community/${event.community_id}` : '/community';

      for (const [minutes, userIds] of groups.entries()) {
        const leadLabel = formatReminderLead(minutes);
        const pushPayload = {
          title: `📅 Tu evento empieza en ${leadLabel}`,
          body: event.location ? `${event.title} · ${event.location}` : event.title,
          url: communityUrl,
          tag: `event-reminder-${event.id}`,
        };

        const broadcastPayload = {
          type: 'event',
          event_id: event.id,
          title: event.title,
          location: event.location || null,
          community_name: communityName,
          community_id: event.community_id || null,
          minutes_left: minutes,
        };

        await Promise.all([
          notifyUsers(supabase, userIds, null, pushPayload),
          broadcastReminders(userIds, broadcastPayload),
        ]);

        console.log(`[REMINDER] Event ${event.id} ("${event.title}") - ${leadLabel} - ${userIds.length} asistentes`);
      }
    }
  } catch (err) {
    console.error('[REMINDER] notifyEventsStartingSoon error:', err);
  }
}

module.exports = { notifyPoolsStartingSoon, notifyEventsStartingSoon };
