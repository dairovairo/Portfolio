const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { checkOrganizerBadgeForUser } = require('../jobs/badges');
const { applyBatteryExpiry } = require('../lib/batteryExpiry');
const { notifyUsers, getMutedUserIds } = require('../lib/webpush');
const { createImageUpload, storeImage } = require('../lib/imageUpload');
const {
  DEFAULT_POOL_REMINDER_MINUTES,
  parseReminderMinutes,
} = require('../lib/reminderLeadTime');
const { addYears, addDays } = require('../lib/dateRangeLimits');

// Multer instance for pool chat image uploads (8 MB max) — same pattern as groups
const _poolImageUpload = createImageUpload({ maxSizeMb: 8 }).single('image');

// Multer instance for pool cover/banner uploads (3 MB max) — same pattern as community events
const poolCoverUpload = createImageUpload({ maxSizeMb: 3 });

function uploadPoolCover(req, res, next) {
  poolCoverUpload.single('cover')(req, res, err => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message || 'No se pudo subir la foto' });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns accepted friend IDs for a given user */
async function getFriendIds(userId) {
  const { data: friendships } = await supabase
    .from('friendships')
    .select('requester_id, addressee_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  if (!friendships?.length) return [];
  return friendships.map(f =>
    f.requester_id === userId ? f.addressee_id : f.requester_id
  );
}

/** Updates pool status to 'full' or 'open' based on participant count */
async function syncPoolStatus(poolId) {
  const { data: pool } = await supabase
    .from('hangout_pools')
    .select('max_people, status')
    .eq('id', poolId)
    .single();

  if (!pool || pool.status === 'cancelled' || pool.status === 'closed') return;

  // No limit → pool can never become 'full' automatically
  if (pool.max_people === null) {
    if (pool.status === 'full') {
      await supabase.from('hangout_pools').update({ status: 'open' }).eq('id', poolId);
    }
    return;
  }

  const { count } = await supabase
    .from('pool_participants')
    .select('*', { count: 'exact', head: true })
    .eq('pool_id', poolId);

  const newStatus = count >= pool.max_people ? 'full' : 'open';
  if (newStatus !== pool.status) {
    await supabase
      .from('hangout_pools')
      .update({ status: newStatus })
      .eq('id', poolId);
  }
}

/**
 * Checks whether userId is allowed to see/join poolId.
 * Returns true if:
 *   - user is the creator
 *   - pool is public AND creator is a friend
 *   - pool is private AND user is in the linked group OR explicitly invited
 */
async function canAccessPool(pool, userId, friendIds) {
  if (pool.creator_id === userId) return true;
  if (pool.is_public) return friendIds.includes(pool.creator_id);

  // Private: check group membership
  if (pool.group_id) {
    const { data: membership } = await supabase
      .from('friend_group_members')
      .select('user_id')
      .eq('group_id', pool.group_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (membership) return true;
  }

  // Private: check explicit invite
  const { data: invite } = await supabase
    .from('pool_invitees')
    .select('user_id')
    .eq('pool_id', pool.id)
    .eq('user_id', userId)
    .maybeSingle();
  return !!invite;
}

// Verifica que `messageId` pertenece a esta quedada (mismo patrón que
// findReplyTarget en routes/messages.js para las respuestas en DMs).
async function findPoolReplyTarget(messageId, poolId) {
  if (!messageId) return null;
  const { data } = await supabase
    .from('pool_messages')
    .select('id, sender_id')
    .eq('id', messageId)
    .eq('pool_id', poolId)
    .maybeSingle();
  return data || null;
}

/**
 * Broadcasts a new pool chat message to every participant's personal channel
 * (service key, bypasses RLS) so anyone with the app open gets an instant
 * in-app notification, plus a web-push for those who have the app closed.
 * Same pattern as broadcastGroupMessage in routes/groups.js.
 */
async function broadcastPoolChatMessage({ poolId, senderId, senderName, content, type }) {
  try {
    const [{ data: pool }, { data: participants }] = await Promise.all([
      supabase.from('hangout_pools').select('activity').eq('id', poolId).single(),
      supabase
        .from('pool_participants')
        .select('user_id')
        .eq('pool_id', poolId)
        .neq('user_id', senderId),
    ]);

    const activityLabel = pool?.activity || 'la quedada';
    const recipientIds = (participants || []).map(p => p.user_id);
    if (!recipientIds.length) return;

    const broadcastPayload = {
      pool_id:   poolId,
      activity:  activityLabel,
      sender_id: senderId,
      sender_name: senderName,
      content,
      type,
    };

    await Promise.allSettled(
      recipientIds.map(recipientId =>
        supabase
          .channel(`pool-chat-notif-${recipientId}`)
          .send({
            type: 'broadcast',
            event: 'new_pool_message',
            payload: broadcastPayload,
          })
      )
    );

    // No mandar el push a quien haya silenciado este chat de quedada en
    // concreto (fase 88) NI a quien tenga activado el silencio global de
    // "chat de quedadas" (users.mute_pool_chats, fase 91) — ese ajuste debe
    // aplicar tanto en foreground (useMessageNotifications) como en
    // background/app cerrada, y el push real es lo único que llega en ese
    // segundo caso, así que el filtro tiene que vivir aquí también.
    const [mutedIds, globallyMutedIds] = await Promise.all([
      getMutedUserIds(supabase, 'pool', poolId, recipientIds),
      getPoolChatMuteFilteredIds(recipientIds),
    ]);
    const pushRecipientIds = recipientIds.filter(
      id => !mutedIds.has(id) && !globallyMutedIds.has(id)
    );
    const previewText = type === 'image' ? '📷 Imagen' : content?.slice(0, 80) || '📩 Nuevo mensaje';
    await notifyUsers(supabase, pushRecipientIds, senderId, {
      title: `💬 ${activityLabel}`,
      body: `${senderName}: ${previewText}`,
      url: `/pools/${poolId}/chat`,
      tag: `pool-chat-${poolId}`,
    });
  } catch (err) {
    console.error('[POOLS] broadcastPoolChatMessage error:', err);
  }
}

// Devuelve el subconjunto de candidateIds que tiene activado el silencio
// global del chat de quedadas (users.mute_pool_chats, fase 91). A diferencia
// de getPoolMuteFilteredIds (que filtra la lista y la devuelve ya limpia),
// aquí devolvemos el Set de silenciados para poder combinarlo con
// getMutedUserIds en broadcastPoolChatMessage.
async function getPoolChatMuteFilteredIds(candidateIds) {
  if (!candidateIds.length) return new Set();
  try {
    const { data } = await supabase
      .from('users')
      .select('id')
      .in('id', candidateIds)
      .eq('mute_pool_chats', true);
    return new Set((data || []).map(u => u.id));
  } catch {
    return new Set();
  }
}

// Construye el resumen de una encuesta (recuentos por opción + voto propio)
// a partir de las opciones y las filas de pool_message_poll_votes de esa
// encuesta. Mismo criterio que buildPollSummary en routes/community.js.
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

/** Builds participant preview (up to 6) for the feed */
function buildParticipantPreview(rawParticipants) {
  return (rawParticipants || [])
    .slice(0, 6)
    .map(p => {
      const user = applyBatteryExpiry(p.user);
      return {
        id: user?.id,
        username: user?.username,
        avatar_url: user?.avatar_url,
        battery_level: user?.battery_level,
        mascot_preview_url: user?.mascot_preview_url,
        mascot_name: user?.mascot_name,
      };
    })
    .filter(p => p.id);
}

// Filtra el web-push (el aviso real, llega en foreground y background/app
// cerrada) para quien tenga activado "Silenciar nuevas quedadas" en
// Ajustes > Notificaciones (users.mute_new_pools, fase 90). El broadcast
// de Realtime (badge del dock) NO se filtra aquí — igual que el resto de
// mutes de la app, silenciar el aviso no oculta la quedada del badge.
// Función a nivel de módulo (antes vivía solo dentro de POST /, así que
// POST /:id/invite mandaba el mismo aviso de "te invitan a una quedada"
// sin pasar por el filtro — bug reportado: el toggle no silenciaba las
// invitaciones a quedadas ya existentes, solo las quedadas nuevas).
async function getPoolMuteFilteredIds(candidateIds) {
  if (!candidateIds.length) return [];
  try {
    const { data } = await supabase
      .from('users')
      .select('id')
      .in('id', candidateIds)
      .eq('mute_new_pools', true);
    const mutedIds = new Set((data || []).map(u => u.id));
    return candidateIds.filter(id => !mutedIds.has(id));
  } catch {
    return candidateIds;
  }
}

// ── GET /api/pools — feed visible to the current user ───────────────────────
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { filter = 'active', limit = 30, offset = 0 } = req.query;

  try {
    const friendIds = await getFriendIds(userId);

    // IDs de quedadas privadas donde el usuario ha sido invitado explícitamente
    // (pool_invitees) — se usa tanto para el filtro de visibilidad ('active')
    // como para el flag is_invited del badge de "te han invitado" en el cliente.
    const { data: myInvites } = await supabase
      .from('pool_invitees')
      .select('pool_id')
      .eq('user_id', userId);
    const myInvitedIds = new Set((myInvites || []).map(i => i.pool_id));

    let query = supabase
      .from('hangout_pools')
      .select(`
        id, activity, description, location_hint, scheduled_at, ends_at,
        max_people, is_public, group_id, status, created_at, creator_id, cover_image_url,
        creator:creator_id(id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at),
        pool_participants(
          joined_at, reminder_minutes_before,
          user:user_id(id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at, mascot_preview_url, mascot_name)
        )
      `)
      .order('scheduled_at', { ascending: true })
      .limit(parseInt(limit))
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (filter === 'mine') {
      query = query.eq('creator_id', userId);

    } else if (filter === 'joined') {
      const { data: myParticipations } = await supabase
        .from('pool_participants')
        .select('pool_id')
        .eq('user_id', userId);
      const poolIds = (myParticipations || []).map(p => p.pool_id);
      if (!poolIds.length) return res.json({ pools: [] });
      query = query.in('id', poolIds).neq('creator_id', userId);

    } else {
      // Active feed — correct visibility:
      // 1. Own pools
      // 2. Public pools where creator is a friend
      // 3. Private pools where user is in the linked group
      // 4. Private pools where user is explicitly invited
      query = query
        .gt('scheduled_at', new Date().toISOString())
        .in('status', ['open', 'full']);

      // Collect private pool IDs the user can access
      const privatePoolIds = new Set();

      // Via group membership
      const { data: myMemberships } = await supabase
        .from('friend_group_members')
        .select('group_id')
        .eq('user_id', userId);
      const myGroupIds = (myMemberships || []).map(m => m.group_id);

      if (myGroupIds.length) {
        const { data: groupPools } = await supabase
          .from('hangout_pools')
          .select('id')
          .in('group_id', myGroupIds)
          .eq('is_public', false);
        (groupPools || []).forEach(p => privatePoolIds.add(p.id));
      }

      // Via explicit invite
      myInvitedIds.forEach(id => privatePoolIds.add(id));

      // Build OR filter
      // - own pools
      // - public pools from friends
      // - private pools user has access to
      const orParts = [`creator_id.eq.${userId}`];

      if (friendIds.length) {
        orParts.push(`and(is_public.eq.true,creator_id.in.(${friendIds.join(',')}))`);
      }

      if (privatePoolIds.size) {
        orParts.push(`id.in.(${[...privatePoolIds].join(',')})`);
      }

      query = query.or(orParts.join(','));
    }

    const { data: pools, error } = await query;
    if (error) throw error;

    const enriched = (pools || []).map(pool => {
      const participants = pool.pool_participants || [];
      const participantCount = participants.length;
      const currentParticipant = participants.find(p => p.user?.id === userId);
      const hasJoined = Boolean(currentParticipant);
      const isCreator = pool.creator?.id === userId;
      return {
        ...pool,
        creator: applyBatteryExpiry(pool.creator),
        pool_participants: undefined,
        participant_count: participantCount,
        participants_preview: buildParticipantPreview(participants),
        has_joined: hasJoined,
        is_creator: isCreator,
        // Invitado explícitamente (pool_invitees) y aún sin unirse — dispara
        // el badge "te han invitado" en el tab Activos y en el dock inferior.
        is_invited: myInvitedIds.has(pool.id) && !isCreator && !hasJoined,
        spots_left: pool.max_people !== null ? pool.max_people - participantCount : null,
        current_user_reminder_minutes_before: hasJoined
          ? currentParticipant?.reminder_minutes_before || DEFAULT_POOL_REMINDER_MINUTES
          : null,
      };
    });

    res.json({ pools: enriched });
  } catch (err) {
    console.error('[POOLS] GET /', err);
    res.status(500).json({ error: 'Failed to fetch pools' });
  }
});

// ── GET /api/pools/calendar — quedadas del usuario para la vista de calendario
// Devuelve, sin paginar ni filtrar por fecha, todas las quedadas donde el
// usuario es el creador o se ha unido (pasadas y futuras), con los campos
// mínimos que necesita el calendario mensual (CalendarPage.jsx).
router.get('/calendar', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const { data: participations } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('user_id', userId);
    const participatingIds = (participations || []).map(p => p.pool_id);

    const orParts = [`creator_id.eq.${userId}`];
    if (participatingIds.length) orParts.push(`id.in.(${participatingIds.join(',')})`);

    const { data: pools, error } = await supabase
      .from('hangout_pools')
      .select('id, activity, scheduled_at, ends_at, status')
      .or(orParts.join(','));

    if (error) throw error;

    res.json({
      pools: (pools || []).map(p => ({
        id: p.id,
        title: p.activity,
        date: p.scheduled_at,
        ends_at: p.ends_at,
      })),
    });
  } catch (err) {
    console.error('[POOLS] GET /calendar', err);
    res.status(500).json({ error: 'Failed to fetch calendar pools' });
  }
});


// Cuenta las quedadas privadas donde el usuario ha sido invitado
// (pool_invitees) pero aún no se ha unido y la quedada sigue abierta/futura.
// Usado por PoolInviteNotificationsContext para el badge del dock inferior
// y del tab "Activos" cuando la página de Quedadas no está montada.
router.get('/invites/count', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const { data: invites } = await supabase
      .from('pool_invitees')
      .select('pool_id')
      .eq('user_id', userId);
    const poolIds = [...new Set((invites || []).map(i => i.pool_id))];
    if (!poolIds.length) return res.json({ count: 0 });

    const { data: joined } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('user_id', userId)
      .in('pool_id', poolIds);
    const joinedIds = new Set((joined || []).map(j => j.pool_id));
    const pendingIds = poolIds.filter(id => !joinedIds.has(id));
    if (!pendingIds.length) return res.json({ count: 0 });

    const { count } = await supabase
      .from('hangout_pools')
      .select('*', { count: 'exact', head: true })
      .in('id', pendingIds)
      .in('status', ['open', 'full'])
      .gt('scheduled_at', new Date().toISOString());

    res.json({ count: count || 0 });
  } catch (err) {
    console.error('[POOLS] GET /invites/count', err);
    res.status(500).json({ error: 'Failed to fetch invite count' });
  }
});

// ── GET /api/pools/notifications/count — nº de quedadas nuevas sin ver ──────
// Cuenta las quedadas creadas después de `since` (ISO timestamp) sobre las
// que el usuario ha recibido una notificación de creación — quedadas
// públicas de un amigo O quedadas privadas a las que se le ha invitado —
// y a las que aún no se ha unido.
//
// BUG (arreglado): el badge de "Quedadas" (dock inferior + tab "Activos")
// usaba /invites/count, que SOLO contaba invitaciones privadas
// (pool_invitees). Pero el servidor manda exactamente la misma
// notificación ("🎉 Fulano propone una quedada", ver broadcastToUsers más
// abajo) tanto para quedadas privadas con invitación como para quedadas
// públicas notificadas a los amigos del creador — y estas últimas nunca
// generan fila en pool_invitees, así que el badge nunca aparecía para
// ellas aunque la notificación sí llegara. Este endpoint sustituye a
// /invites/count como fuente del badge y cubre ambos casos.
router.get('/notifications/count', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const since = req.query.since;
  const sinceDate = since ? new Date(since) : null;
  if (!sinceDate || Number.isNaN(sinceDate.getTime())) {
    return res.json({ count: 0 });
  }

  try {
    const friendIds = await getFriendIds(userId);

    const { data: myInvites } = await supabase
      .from('pool_invitees')
      .select('pool_id')
      .eq('user_id', userId);
    const invitedIds = [...new Set((myInvites || []).map(i => i.pool_id))];

    const orParts = [];
    if (friendIds.length) {
      orParts.push(`and(is_public.eq.true,creator_id.in.(${friendIds.join(',')}))`);
    }
    if (invitedIds.length) {
      orParts.push(`id.in.(${invitedIds.join(',')})`);
    }
    if (!orParts.length) return res.json({ count: 0 });

    const { data: candidatePools, error } = await supabase
      .from('hangout_pools')
      .select('id')
      .neq('creator_id', userId)
      .gt('created_at', sinceDate.toISOString())
      .gt('scheduled_at', new Date().toISOString())
      .in('status', ['open', 'full'])
      .or(orParts.join(','));

    if (error) throw error;
    const candidateIds = (candidatePools || []).map(p => p.id);
    if (!candidateIds.length) return res.json({ count: 0 });

    const { data: joined } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('user_id', userId)
      .in('pool_id', candidateIds);
    const joinedIds = new Set((joined || []).map(j => j.pool_id));

    const count = candidateIds.filter(id => !joinedIds.has(id)).length;
    res.json({ count });
  } catch (err) {
    console.error('[POOLS] GET /notifications/count', err);
    res.status(500).json({ error: 'Failed to fetch notifications count' });
  }
});

// ── GET /api/pools/:id — single pool with full participant list ───────────────
router.get('/:id', requireAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    const { data: pool, error } = await supabase
      .from('hangout_pools')
      .select(`
        id, activity, description, location_hint, scheduled_at, ends_at,
        max_people, is_public, group_id, status, created_at, creator_id, cover_image_url,
        creator:creator_id(id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at, mascot_preview_url),
        pool_participants(
          joined_at, reminder_minutes_before,
          user:user_id(id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at, last_seen_at, mascot_preview_url)
        )
      `)
      .eq('id', req.params.id)
      .single();

    if (error || !pool) return res.status(404).json({ error: 'Pool not found' });

    const friendIds = await getFriendIds(userId);
    const allowed = await canAccessPool(pool, userId, friendIds);
    if (!allowed) return res.status(403).json({ error: 'No tienes acceso a este pool' });

    const participants = pool.pool_participants || [];
    const currentParticipant = participants.find(p => p.user?.id === userId);
    const hasJoined = Boolean(currentParticipant);
    const isCreator = pool.creator?.id === userId;

    // Full participant list for detail view
    const participantList = participants.map(p => {
      const user = applyBatteryExpiry(p.user);
      return {
        id: user?.id,
        username: user?.username,
        avatar_url: user?.avatar_url,
        battery_level: user?.battery_level,
        mascot_preview_url: user?.mascot_preview_url,
        last_seen_at: user?.last_seen_at,
        joined_at: p.joined_at,
      };
    }).filter(p => p.id);

    res.json({
      pool: {
        ...pool,
        creator: applyBatteryExpiry(pool.creator),
        pool_participants: undefined,
        participant_count: participants.length,
        participants: participantList,
        participants_preview: buildParticipantPreview(participants),
        has_joined: hasJoined,
        is_creator: isCreator,
        spots_left: pool.max_people !== null ? pool.max_people - participants.length : null,
        current_user_reminder_minutes_before: hasJoined
          ? currentParticipant?.reminder_minutes_before || DEFAULT_POOL_REMINDER_MINUTES
          : null,
      }
    });
  } catch (err) {
    console.error('[POOLS] GET /:id', err);
    res.status(500).json({ error: 'Failed to fetch pool' });
  }
});

// ── POST /api/pools — create a new pool ─────────────────────────────────────
router.post('/', requireAuth, uploadPoolCover, async (req, res) => {
  const userId = req.user.id;
  const {
    activity, description, location_hint, scheduled_at, ends_at,
    max_people = null, is_public = false,
    group_id = null,
    invited_user_ids = [],   // NEW: individual friend invites for private pools
  } = req.body;

  // req.body arrives as multipart/form-data (strings only) when a cover photo
  // is attached, or as JSON otherwise — normalize both shapes here.
  const isPublic = is_public === true || is_public === 'true';
  let invitedIds = invited_user_ids;
  if (typeof invitedIds === 'string') {
    try { invitedIds = JSON.parse(invitedIds); } catch { invitedIds = []; }
  }
  if (!Array.isArray(invitedIds)) invitedIds = [];

  if (!activity?.trim()) return res.status(400).json({ error: 'activity is required' });
  if (!scheduled_at) return res.status(400).json({ error: 'La fecha es obligatoria' });
  const startDate = new Date(scheduled_at);
  if (Number.isNaN(startDate.getTime())) {
    return res.status(400).json({ error: 'La fecha no es válida' });
  }
  if (startDate <= new Date()) {
    return res.status(400).json({ error: 'La fecha debe ser en el futuro' });
  }
  // La fecha de inicio no puede quedar a más de un año de la creación de la quedada.
  const maxPoolStartDate = addYears(new Date(), 1);
  if (startDate > maxPoolStartDate) {
    return res.status(400).json({ error: 'La fecha de inicio no puede ser más de un año después de la creación de la quedada' });
  }
  const location = location_hint?.trim();
  if (!location) return res.status(400).json({ error: 'location_hint is required' });

  let endDateIso = null;
  if (ends_at) {
    const endDate = new Date(ends_at);
    if (Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'La fecha fin no es válida' });
    }
    if (endDate <= startDate) {
      return res.status(400).json({ error: 'La fecha fin debe ser posterior al inicio' });
    }
    // La fecha de fin no puede quedar a más de un día de la fecha de inicio.
    const maxPoolEndDate = addDays(startDate, 1);
    if (endDate > maxPoolEndDate) {
      return res.status(400).json({ error: 'La fecha fin no puede ser más de un día después del inicio' });
    }
    endDateIso = endDate.toISOString();
  }

  // null = sin límite; otherwise must be between 2 and 50
  const maxPeople = (max_people === null || max_people === undefined || max_people === '')
    ? null
    : parseInt(max_people, 10);
  if (maxPeople !== null && (Number.isNaN(maxPeople) || maxPeople < 2 || maxPeople > 50)) {
    return res.status(400).json({ error: 'max_people must be between 2 and 50, or null for no limit' });
  }
  if (!isPublic && !group_id && (!invitedIds || invitedIds.length === 0)) {
    return res.status(400).json({ error: 'Un pool privado necesita al menos un grupo o un amigo invitado' });
  }

  try {
    let coverImageUrl = null;
    if (req.file) {
      coverImageUrl = await storeImage({
        file: req.file,
        objectName: `pool-covers/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fallbackMaxLength: 4500000,
      });
    }

    const { data: pool, error } = await supabase
      .from('hangout_pools')
      .insert({
        creator_id: userId,
        activity: activity.trim(),
        description: description?.trim() || null,
        location_hint: location,
        scheduled_at: startDate.toISOString(),
        ends_at: endDateIso,
        max_people: maxPeople,
        is_public: isPublic,
        group_id: group_id || null,
        cover_image_url: coverImageUrl,
        status: 'open',
      })
      .select(`
        id, activity, description, location_hint, scheduled_at, ends_at,
        max_people, is_public, status, created_at, cover_image_url,
        creator:creator_id(id, username, avatar_url, battery_level, mascot_preview_url, mascot_name)
      `)
      .single();

    if (error) throw error;

    // Auto-join creator
    await supabase
      .from('pool_participants')
      .insert({ pool_id: pool.id, user_id: userId });

    // Insert individual invitees (deduplicated, excluding creator)
    if (!isPublic && invitedIds?.length) {
      const uniqueInvites = [...new Set(invitedIds)]
        .filter(id => id !== userId)
        .map(uid => ({ pool_id: pool.id, user_id: uid }));
      if (uniqueInvites.length) {
        await supabase.from('pool_invitees').insert(uniqueInvites);
      }
    }

    const newBadgeId = await checkOrganizerBadgeForUser(userId).catch(() => null);

    // ── Push + Realtime broadcast (fire-and-forget) ──────────────────────────
    const creatorName = pool.creator?.username || 'Un amigo';
    const activityLabel = pool.activity.trim();
    const notifPayload = {
      title: `🎉 ${creatorName} propone una quedada`,
      body: `${activityLabel}${pool.location_hint ? ` · ${pool.location_hint}` : ''}`,
      url: `/pools?pool=${pool.id}`,
      tag: `new-pool-${pool.id}`,
    };

    // Broadcast a Realtime message to each recipient's personal channel so the
    // client gets an in-app notification instantly when the app is open/background.
    // This bypasses RLS entirely (service key) — same pattern as personal messages.
    async function broadcastToUsers(recipientIds) {
      const broadcastPayload = {
        pool_id:       pool.id,
        activity:      activityLabel,
        location_hint: pool.location_hint || null,
        creator_name:  creatorName,
        creator_id:    userId,
        is_public:     isPublic,
      };
      await Promise.allSettled(
        recipientIds.map(recipientId =>
          supabase
            .channel(`pool-notif-${recipientId}`)
            .send({
              type: 'broadcast',
              event: 'new_pool',
              payload: broadcastPayload,
            })
        )
      );
    }

    if (isPublic) {
      // Notify all accepted friends of the creator
      getFriendIds(userId).then(async friendIds => {
        const pushRecipientIds = await getPoolMuteFilteredIds(friendIds);
        await Promise.all([
          notifyUsers(supabase, pushRecipientIds, userId, notifPayload),
          broadcastToUsers(friendIds),
        ]);
      }).catch(() => {});
    } else {
      // Notify group members + individually invited friends
      const recipientIds = new Set();

      const notifyPrivate = async () => {
        if (group_id) {
          const { data: groupMembers } = await supabase
            .from('friend_group_members')
            .select('user_id')
            .eq('group_id', group_id)
            .neq('user_id', userId);
          (groupMembers || []).forEach(m => recipientIds.add(m.user_id));
        }
        if (invitedIds?.length) {
          invitedIds.forEach(id => { if (id !== userId) recipientIds.add(id); });
        }
        if (recipientIds.size) {
          const pushRecipientIds = await getPoolMuteFilteredIds([...recipientIds]);
          await Promise.all([
            notifyUsers(supabase, pushRecipientIds, userId, notifPayload),
            broadcastToUsers([...recipientIds]),
          ]);
        }
      };
      notifyPrivate().catch(() => {});
    }

    res.status(201).json({
      pool: {
        ...pool,
        participant_count: 1,
        participants_preview: [{
          id: userId,
          username: pool.creator?.username,
          avatar_url: pool.creator?.avatar_url,
          battery_level: pool.creator?.battery_level,
          mascot_preview_url: pool.creator?.mascot_preview_url,
          mascot_name: pool.creator?.mascot_name,
        }],
        has_joined: true,
        is_creator: true,
        spots_left: pool.max_people !== null ? pool.max_people - 1 : null,
        current_user_reminder_minutes_before: DEFAULT_POOL_REMINDER_MINUTES,
      },
      newBadges: newBadgeId ? [newBadgeId] : [],
    });
  } catch (err) {
    console.error('[POOLS] POST /', err);
    res.status(500).json({ error: 'Failed to create pool' });
  }
});

// ── POST /api/pools/:id/join — join a pool ───────────────────────────────────
router.post('/:id/join', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const poolId = req.params.id;

  try {
    const { data: pool, error: poolErr } = await supabase
      .from('hangout_pools')
      .select('id, status, max_people, creator_id, scheduled_at, is_public, group_id')
      .eq('id', poolId)
      .single();

    if (poolErr || !pool) return res.status(404).json({ error: 'Pool not found' });
    if (pool.status === 'cancelled') return res.status(400).json({ error: 'Pool was cancelled' });
    if (pool.status === 'closed') return res.status(400).json({ error: 'Pool is already closed' });
    if (new Date(pool.scheduled_at) <= new Date()) {
      return res.status(400).json({ error: 'Pool has already started' });
    }

    // Access check for private pools
    const friendIds = await getFriendIds(userId);
    const allowed = await canAccessPool(pool, userId, friendIds);
    if (!allowed) return res.status(403).json({ error: 'No tienes acceso a este pool' });

    const { count } = await supabase
      .from('pool_participants')
      .select('*', { count: 'exact', head: true })
      .eq('pool_id', poolId);

    if (count >= pool.max_people && pool.max_people !== null) {
      return res.status(400).json({ error: 'Pool is full' });
    }

    const { data: existing } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) return res.status(409).json({ error: 'Already joined this pool' });

    const { error: joinErr } = await supabase
      .from('pool_participants')
      .insert({ pool_id: poolId, user_id: userId });

    if (joinErr) throw joinErr;

    await syncPoolStatus(poolId);

    res.json({ success: true, message: '¡Te has unido al pool!' });
  } catch (err) {
    console.error('[POOLS] POST /:id/join', err);
    res.status(500).json({ error: 'Failed to join pool' });
  }
});

// ── DELETE /api/pools/:id/leave — leave a pool ──────────────────────────────
router.delete('/:id/leave', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const poolId = req.params.id;

  try {
    const { data: pool } = await supabase
      .from('hangout_pools')
      .select('creator_id, status')
      .eq('id', poolId)
      .single();

    if (!pool) return res.status(404).json({ error: 'Pool not found' });

    if (pool.creator_id === userId) {
      await supabase
        .from('hangout_pools')
        .update({ status: 'cancelled' })
        .eq('id', poolId);
      return res.json({ success: true, cancelled: true, message: 'Pool cancelado' });
    }

    const { error } = await supabase
      .from('pool_participants')
      .delete()
      .eq('pool_id', poolId)
      .eq('user_id', userId);

    if (error) throw error;

    await syncPoolStatus(poolId);

    res.json({ success: true, message: 'Has salido del pool' });
  } catch (err) {
    console.error('[POOLS] DELETE /:id/leave', err);
    res.status(500).json({ error: 'Failed to leave pool' });
  }
});

// ── GET /api/pools/:id/join-requests — solicitudes de invitación (privadas) ──
// Creador: ve todas las solicitudes pendientes propuestas por los miembros.
// Miembro (no creador): ve solo las solicitudes que él mismo ha propuesto.
router.get('/:id/join-requests', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const poolId = req.params.id;

  try {
    const { data: pool } = await supabase
      .from('hangout_pools')
      .select('id, creator_id, is_public')
      .eq('id', poolId)
      .single();

    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    if (pool.is_public) return res.status(400).json({ error: 'Este plan es público' });

    const isCreator = pool.creator_id === userId;

    if (!isCreator) {
      const { data: membership } = await supabase
        .from('pool_participants')
        .select('pool_id')
        .eq('pool_id', poolId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!membership) return res.status(403).json({ error: 'No tienes acceso a este plan' });
    }

    const [{ data: invitees }, { data: participants }] = await Promise.all([
      supabase.from('pool_invitees').select('user_id').eq('pool_id', poolId),
      supabase.from('pool_participants').select('user_id').eq('pool_id', poolId),
    ]);

    let requestsQuery = supabase
      .from('pool_join_requests')
      .select(`
        id, status, created_at,
        requested_user:requested_user_id(id, username, avatar_url),
        requested_by_user:requested_by(id, username, avatar_url)
      `)
      .eq('pool_id', poolId)
      .order('created_at', { ascending: false });

    requestsQuery = isCreator
      ? requestsQuery.eq('status', 'pending')
      : requestsQuery.eq('requested_by', userId);

    const { data: requests, error } = await requestsQuery;
    if (error) throw error;

    res.json({
      requests: requests || [],
      invited_user_ids: (invitees || []).map(i => i.user_id),
      participant_user_ids: (participants || []).map(p => p.user_id),
      is_creator: isCreator,
    });
  } catch (err) {
    console.error('[POOLS] GET /:id/join-requests', err);
    res.status(500).json({ error: 'Failed to fetch join requests' });
  }
});

// ── POST /api/pools/:id/invite — el creador invita directamente a un amigo ──
router.post('/:id/invite', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const poolId = req.params.id;
  const { user_id } = req.body;

  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  if (user_id === userId) return res.status(400).json({ error: 'No puedes invitarte a ti mismo' });

  try {
    const { data: pool } = await supabase
      .from('hangout_pools')
      .select('id, creator_id, is_public, activity, location_hint, status')
      .eq('id', poolId)
      .single();

    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    if (pool.creator_id !== userId) return res.status(403).json({ error: 'Solo el creador puede invitar' });
    if (pool.is_public) return res.status(400).json({ error: 'Este plan es público' });
    if (['cancelled', 'closed'].includes(pool.status)) {
      return res.status(400).json({ error: 'Este plan ya no está disponible' });
    }

    const friendIds = await getFriendIds(userId);
    if (!friendIds.includes(user_id)) {
      return res.status(400).json({ error: 'Solo puedes invitar a amigos' });
    }

    const [{ data: existingParticipant }, { data: existingInvite }] = await Promise.all([
      supabase.from('pool_participants').select('pool_id').eq('pool_id', poolId).eq('user_id', user_id).maybeSingle(),
      supabase.from('pool_invitees').select('pool_id').eq('pool_id', poolId).eq('user_id', user_id).maybeSingle(),
    ]);
    if (existingParticipant) return res.status(409).json({ error: 'Ya está apuntado a este plan' });
    if (existingInvite) return res.status(409).json({ error: 'Ya está invitado a este plan' });

    const { error } = await supabase.from('pool_invitees').insert({ pool_id: poolId, user_id });
    if (error) throw error;

    // Si el amigo ya había solicitado su propia invitación vía otro miembro,
    // marca esa solicitud como aceptada para que no quede huérfana.
    await supabase
      .from('pool_join_requests')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('pool_id', poolId)
      .eq('requested_user_id', user_id)
      .eq('status', 'pending');

    res.status(201).json({ success: true });

    // Notificación (fire-and-forget) — mismo patrón que al crear la quedada
    (async () => {
      try {
        const { data: creator } = await supabase.from('users').select('username').eq('id', userId).single();
        const creatorName = creator?.username || 'Un amigo';
        const pushRecipientIds = await getPoolMuteFilteredIds([user_id]);
        await Promise.all([
          notifyUsers(supabase, pushRecipientIds, userId, {
            title: `🤝 ${creatorName} te invita a una quedada`,
            body: `${pool.activity}${pool.location_hint ? ` · ${pool.location_hint}` : ''}`,
            url: `/pools?pool=${poolId}`,
            tag: `pool-invite-${poolId}`,
          }),
          supabase.channel(`pool-notif-${user_id}`).send({
            type: 'broadcast',
            event: 'new_pool',
            payload: {
              pool_id: poolId,
              activity: pool.activity,
              location_hint: pool.location_hint || null,
              creator_name: creatorName,
              creator_id: userId,
              is_public: false,
            },
          }),
        ]);
      } catch (e) {
        console.error('[POOLS] invite notify error:', e);
      }
    })();
  } catch (err) {
    console.error('[POOLS] POST /:id/invite', err);
    res.status(500).json({ error: 'Failed to invite user' });
  }
});

// ── POST /api/pools/:id/request-invite — un miembro propone invitar a un amigo ──
router.post('/:id/request-invite', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const poolId = req.params.id;
  const { user_id } = req.body;

  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  if (user_id === userId) return res.status(400).json({ error: 'No puedes solicitar tu propia invitación' });

  try {
    const { data: pool } = await supabase
      .from('hangout_pools')
      .select('id, creator_id, is_public, activity, status')
      .eq('id', poolId)
      .single();

    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    if (pool.is_public) return res.status(400).json({ error: 'Este plan es público' });
    if (pool.creator_id === userId) {
      return res.status(400).json({ error: 'Eres el creador — usa invitar directamente' });
    }
    if (['cancelled', 'closed'].includes(pool.status)) {
      return res.status(400).json({ error: 'Este plan ya no está disponible' });
    }

    const { data: membership } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!membership) return res.status(403).json({ error: 'Tienes que estar apuntado para solicitar invitaciones' });

    const friendIds = await getFriendIds(userId);
    if (!friendIds.includes(user_id)) {
      return res.status(400).json({ error: 'Solo puedes solicitar amigos tuyos' });
    }

    const [{ data: existingParticipant }, { data: existingInvite }] = await Promise.all([
      supabase.from('pool_participants').select('pool_id').eq('pool_id', poolId).eq('user_id', user_id).maybeSingle(),
      supabase.from('pool_invitees').select('pool_id').eq('pool_id', poolId).eq('user_id', user_id).maybeSingle(),
    ]);
    if (existingParticipant) return res.status(409).json({ error: 'Ya está apuntado a este plan' });
    if (existingInvite) return res.status(409).json({ error: 'Ya está invitado a este plan' });

    const { data: request, error } = await supabase
      .from('pool_join_requests')
      .upsert(
        {
          pool_id: poolId,
          requested_user_id: user_id,
          requested_by: userId,
          status: 'pending',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'pool_id,requested_user_id' }
      )
      .select('id, status, created_at')
      .single();

    if (error) throw error;

    res.status(201).json({ request });

    // Notifica al creador (fire-and-forget)
    (async () => {
      try {
        const [{ data: requester }, { data: target }] = await Promise.all([
          supabase.from('users').select('username').eq('id', userId).single(),
          supabase.from('users').select('username').eq('id', user_id).single(),
        ]);
        const requesterName = requester?.username || 'Un miembro';
        const targetName = target?.username || 'alguien';
        await Promise.all([
          notifyUsers(supabase, [pool.creator_id], userId, {
            title: '🙋 Nueva solicitud de invitación',
            body: `${requesterName} propone invitar a ${targetName} a "${pool.activity}"`,
            url: `/pools?pool=${poolId}`,
            tag: `pool-join-request-${poolId}`,
          }),
          supabase.channel(`pool-notif-${pool.creator_id}`).send({
            type: 'broadcast',
            event: 'pool_join_request',
            payload: {
              pool_id: poolId,
              activity: pool.activity,
              requester_name: requesterName,
              target_name: targetName,
            },
          }),
        ]);
      } catch (e) {
        console.error('[POOLS] request-invite notify error:', e);
      }
    })();
  } catch (err) {
    console.error('[POOLS] POST /:id/request-invite', err);
    res.status(500).json({ error: 'Failed to request invite' });
  }
});

// ── PATCH /api/pools/:id/join-requests/:requestId — aceptar/rechazar ────────
router.patch('/:id/join-requests/:requestId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const poolId = req.params.id;
  const { requestId } = req.params;
  const { status } = req.body;

  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be accepted or rejected' });
  }

  try {
    const { data: pool } = await supabase
      .from('hangout_pools')
      .select('id, creator_id, activity, location_hint, status')
      .eq('id', poolId)
      .single();

    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    if (pool.creator_id !== userId) return res.status(403).json({ error: 'Solo el creador puede gestionar solicitudes' });

    const { data: request, error: fetchErr } = await supabase
      .from('pool_join_requests')
      .select('id, requested_user_id, requested_by, status')
      .eq('id', requestId)
      .eq('pool_id', poolId)
      .single();

    if (fetchErr || !request) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (request.status !== 'pending') return res.status(409).json({ error: 'Esta solicitud ya fue gestionada' });

    const { error: updateErr } = await supabase
      .from('pool_join_requests')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', requestId);
    if (updateErr) throw updateErr;

    if (status === 'accepted') {
      const { data: existingInvite } = await supabase
        .from('pool_invitees')
        .select('pool_id')
        .eq('pool_id', poolId)
        .eq('user_id', request.requested_user_id)
        .maybeSingle();
      if (!existingInvite) {
        await supabase.from('pool_invitees').insert({ pool_id: poolId, user_id: request.requested_user_id });
      }
    }

    res.json({ success: true });

    // Notificación al amigo invitado, solo si se aceptó (fire-and-forget)
    if (status === 'accepted') {
      (async () => {
        try {
          const { data: creator } = await supabase.from('users').select('username').eq('id', userId).single();
          const creatorName = creator?.username || 'El organizador';
          const pushRecipientIds = await getPoolMuteFilteredIds([request.requested_user_id]);
          await Promise.all([
            notifyUsers(supabase, pushRecipientIds, userId, {
              title: `🤝 ${creatorName} te invita a una quedada`,
              body: `${pool.activity}${pool.location_hint ? ` · ${pool.location_hint}` : ''}`,
              url: `/pools?pool=${poolId}`,
              tag: `pool-invite-${poolId}`,
            }),
            supabase.channel(`pool-notif-${request.requested_user_id}`).send({
              type: 'broadcast',
              event: 'new_pool',
              payload: {
                pool_id: poolId,
                activity: pool.activity,
                location_hint: pool.location_hint || null,
                creator_name: creatorName,
                creator_id: userId,
                is_public: false,
              },
            }),
          ]);
        } catch (e) {
          console.error('[POOLS] join-request accept notify error:', e);
        }
      })();
    }
  } catch (err) {
    console.error('[POOLS] PATCH /:id/join-requests/:requestId', err);
    res.status(500).json({ error: 'Failed to update join request' });
  }
});

// ── PATCH /api/pools/:id — update pool (creator only) ────────────────────────
router.patch('/:id/reminder', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const poolId = req.params.id;
  const reminderMinutes = parseReminderMinutes(req.body?.reminder_minutes_before);

  if (reminderMinutes == null) {
    return res.status(400).json({ error: 'El aviso debe estar entre 10 minutos y 1 semana' });
  }

  try {
    const { data: pool, error: poolErr } = await supabase
      .from('hangout_pools')
      .select('id, scheduled_at, status')
      .eq('id', poolId)
      .single();

    if (poolErr || !pool) return res.status(404).json({ error: 'Pool not found' });
    if (pool.status === 'cancelled' || pool.status === 'closed') {
      return res.status(400).json({ error: 'No se puede cambiar el aviso de un pool cerrado' });
    }
    if (new Date(pool.scheduled_at) <= new Date()) {
      return res.status(400).json({ error: 'El pool ya ha empezado' });
    }

    const { data: participant } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!participant) return res.status(403).json({ error: 'Tienes que estar apuntado para ajustar el aviso' });

    const { data: updated, error } = await supabase
      .from('pool_participants')
      .update({ reminder_minutes_before: reminderMinutes })
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .select('reminder_minutes_before')
      .single();

    if (error) throw error;
    res.json({ reminder_minutes_before: updated.reminder_minutes_before });
  } catch (err) {
    console.error('[POOLS] PATCH /:id/reminder', err);
    res.status(500).json({ error: 'Failed to update pool reminder' });
  }
});

router.patch('/:id', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const poolId = req.params.id;
  const { activity, description, location_hint, scheduled_at, ends_at, max_people, is_public, status } = req.body;

  try {
    const { data: pool } = await supabase
      .from('hangout_pools')
      .select('creator_id, status, max_people, scheduled_at, created_at')
      .eq('id', poolId)
      .single();

    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    if (pool.creator_id !== userId) return res.status(403).json({ error: 'Not the creator' });

    const updates = {};
    if (activity !== undefined) updates.activity = activity.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (location_hint !== undefined) {
      const location = location_hint?.trim();
      if (!location) return res.status(400).json({ error: 'location_hint is required' });
      updates.location_hint = location;
    }
    if (scheduled_at !== undefined) {
      const startDate = new Date(scheduled_at);
      if (Number.isNaN(startDate.getTime())) {
        return res.status(400).json({ error: 'La fecha no es válida' });
      }
      // La fecha de inicio no puede quedar a más de un año de la creación de la quedada.
      const maxPoolStartDate = addYears(new Date(pool.created_at), 1);
      if (startDate > maxPoolStartDate) {
        return res.status(400).json({ error: 'La fecha de inicio no puede ser más de un año después de la creación de la quedada' });
      }
      updates.scheduled_at = startDate.toISOString();
    }
    if (ends_at !== undefined) {
      const referenceStart = new Date(updates.scheduled_at || pool.scheduled_at);
      if (ends_at === null || ends_at === '') {
        updates.ends_at = null;
      } else {
        const endDate = new Date(ends_at);
        if (Number.isNaN(endDate.getTime())) {
          return res.status(400).json({ error: 'La fecha fin no es válida' });
        }
        if (endDate <= referenceStart) {
          return res.status(400).json({ error: 'La fecha fin debe ser posterior al inicio' });
        }
        // La fecha de fin no puede quedar a más de un día de la fecha de inicio.
        const maxPoolEndDate = addDays(referenceStart, 1);
        if (endDate > maxPoolEndDate) {
          return res.status(400).json({ error: 'La fecha fin no puede ser más de un día después del inicio' });
        }
        updates.ends_at = endDate.toISOString();
      }
    }
    if (max_people !== undefined) {
      updates.max_people = (max_people === null || max_people === '')
        ? null
        : parseInt(max_people);
    }
    if (is_public !== undefined) updates.is_public = Boolean(is_public);
    if (status !== undefined && ['open', 'closed', 'cancelled'].includes(status)) {
      updates.status = status;
    }

    const { data: updated, error } = await supabase
      .from('hangout_pools')
      .update(updates)
      .eq('id', poolId)
      .select()
      .single();

    if (error) throw error;
    res.json({ pool: updated });
  } catch (err) {
    console.error('[POOLS] PATCH /:id', err);
    res.status(500).json({ error: 'Failed to update pool' });
  }
});

// ── DELETE /api/pools/:id — cancel pool (creator only) ───────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    const { data: pool } = await supabase
      .from('hangout_pools')
      .select('creator_id')
      .eq('id', req.params.id)
      .single();

    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    if (pool.creator_id !== userId) return res.status(403).json({ error: 'Not the creator' });

    await supabase
      .from('hangout_pools')
      .update({ status: 'cancelled' })
      .eq('id', req.params.id);

    res.json({ success: true });
  } catch (err) {
    console.error('[POOLS] DELETE /:id', err);
    res.status(500).json({ error: 'Failed to cancel pool' });
  }
});

// ── GET /api/pools/:id/messages — chat de la quedada ─────────────────────────
router.get('/:id/messages', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const poolId = req.params.id;
  const limit = parseInt(req.query.limit) || 60;

  try {
    // Solo los apuntados a la quedada pueden ver el chat
    const { data: membership } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Tienes que estar apuntado para ver el chat' });

    const { data, error } = await supabase
      .from('pool_messages')
      .select(`
        id, content, type, poll_options, created_at,
        liked_by, deleted_for_self, deleted_for_everyone, deleted_for_everyone_at, reply_to_id,
        reply_to:reply_to_id(id, sender_id, content, type, deleted_for_everyone, sender:sender_id(username)),
        sender:sender_id(id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at)
      `)
      .eq('pool_id', poolId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw error;

    // Adjunta el recuento de votos a los mensajes que son encuestas
    const pollMessages = (data || []).filter(m => m.type === 'poll');
    if (pollMessages.length) {
      const pollIds = pollMessages.map(m => m.id);
      const { data: voteRows } = await supabase
        .from('pool_message_poll_votes')
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

    // Fecha en la que este usuario vació el chat (solo afecta a su propia vista)
    const { data: clearData } = await supabase
      .from('pool_conversation_clears')
      .select('cleared_at')
      .eq('user_id', userId)
      .eq('pool_id', poolId)
      .maybeSingle();

    const pinnedMessage = await fetchPinnedPoolMessage(poolId, data || []);

    res.json({
      messages: (data || []).map(message => ({
        ...message,
        sender: applyBatteryExpiry(message.sender),
      })),
      cleared_at: clearData?.cleared_at || null,
      pinned_message: pinnedMessage,
    });
  } catch (err) {
    console.error('[POOLS] GET /:id/messages', err);
    res.status(500).json({ error: `Failed to fetch messages: ${err.message || err}` });
  }
});

// ── Helper: resuelve el mensaje fijado de una quedada (si lo hay) ───────────
async function fetchPinnedPoolMessage(poolId, loadedMessages = []) {
  const { data: pool } = await supabase
    .from('hangout_pools')
    .select('pinned_message_id, pinned_at, pinned_by:pinned_by(id, username, avatar_url)')
    .eq('id', poolId)
    .maybeSingle();

  if (!pool?.pinned_message_id) return null;

  const alreadyLoaded = loadedMessages.find(m => m.id === pool.pinned_message_id);
  let base = alreadyLoaded;
  if (!base) {
    const { data: msgRow } = await supabase
      .from('pool_messages')
      .select(`id, content, type, created_at, sender:sender_id(id, username, avatar_url)`)
      .eq('id', pool.pinned_message_id)
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
    pinned_at: pool.pinned_at,
    pinned_by: pool.pinned_by || null,
  };
}

// ── POST /api/pools/:id/messages/:messageId/pin — fijar mensaje (cualquier apuntado) ──
router.post('/:id/messages/:messageId/pin', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { id: poolId, messageId } = req.params;

  try {
    const { data: pool } = await supabase
      .from('hangout_pools')
      .select('id, creator_id')
      .eq('id', poolId)
      .maybeSingle();
    if (!pool) return res.status(404).json({ error: 'Pool not found' });

    const { data: membership } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!membership) {
      return res.status(403).json({ error: 'Tienes que estar apuntado para fijar mensajes' });
    }

    const { data: msg } = await supabase
      .from('pool_messages')
      .select('id')
      .eq('id', messageId)
      .eq('pool_id', poolId)
      .maybeSingle();
    if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' });

    const pinnedAt = new Date().toISOString();
    const { error } = await supabase
      .from('hangout_pools')
      .update({ pinned_message_id: messageId, pinned_by: userId, pinned_at: pinnedAt })
      .eq('id', poolId);
    if (error) throw error;

    res.json({ success: true, pinned_message_id: messageId, pinned_at: pinnedAt });
  } catch (err) {
    console.error('[POOLS] POST /:id/messages/:messageId/pin', err);
    res.status(500).json({ error: 'Failed to pin message' });
  }
});

// ── DELETE /api/pools/:id/pin — desfijar mensaje (cualquier apuntado) ───────
router.delete('/:id/pin', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const poolId = req.params.id;

  try {
    const { data: pool } = await supabase
      .from('hangout_pools')
      .select('id, creator_id')
      .eq('id', poolId)
      .maybeSingle();
    if (!pool) return res.status(404).json({ error: 'Pool not found' });

    const { data: membership } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!membership) {
      return res.status(403).json({ error: 'Tienes que estar apuntado para desfijar mensajes' });
    }

    const { error } = await supabase
      .from('hangout_pools')
      .update({ pinned_message_id: null, pinned_by: null, pinned_at: null })
      .eq('id', poolId);
    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('[POOLS] DELETE /:id/pin', err);
    res.status(500).json({ error: 'Failed to unpin message' });
  }
});

// ── POST /api/pools/:id/clear — vaciar chat de la quedada (solo para mí) ─────
router.post('/:id/clear', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const poolId = req.params.id;

  try {
    const { data: membership } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Tienes que estar apuntado para vaciar el chat' });

    const clearedAt = new Date().toISOString();
    const { error } = await supabase
      .from('pool_conversation_clears')
      .upsert(
        { user_id: userId, pool_id: poolId, cleared_at: clearedAt },
        { onConflict: 'user_id,pool_id' }
      );

    if (error) throw error;
    res.json({ success: true, cleared_at: clearedAt });
  } catch (err) {
    console.error('[POOLS] POST /:id/clear', err);
    res.status(500).json({ error: 'Failed to clear chat' });
  }
});

// ── POST /api/pools/:id/messages — enviar mensaje de texto al chat ──────────
router.post('/:id/messages', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const poolId = req.params.id;
  const { content, type = 'text', reply_to_id } = req.body;

  if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
  if (!['text'].includes(type)) return res.status(400).json({ error: 'Invalid type' });

  try {
    const { data: membership } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Tienes que estar apuntado para escribir en el chat' });

    const insertData = { pool_id: poolId, sender_id: userId, content: content.trim(), type };
    if (reply_to_id) {
      const target = await findPoolReplyTarget(reply_to_id, poolId);
      if (target) insertData.reply_to_id = target.id;
    }

    const { data, error } = await supabase
      .from('pool_messages')
      .insert(insertData)
      .select(`
        id, content, type, created_at, reply_to_id,
        reply_to:reply_to_id(id, sender_id, content, type, deleted_for_everyone, sender:sender_id(username)),
        sender:sender_id(id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at)
      `)
      .single();

    if (error) throw error;

    // Responde ya mismo, y difunde en segundo plano (fire-and-forget)
    res.status(201).json({
      message: {
        ...data,
        sender: applyBatteryExpiry(data.sender),
      },
    });

    const senderName = data.sender?.username || 'Alguien';
    broadcastPoolChatMessage({
      poolId,
      senderId: userId,
      senderName,
      content: data.content,
      type: data.type,
    }).catch(() => {});
  } catch (err) {
    console.error('[POOLS] POST /:id/messages', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ── PATCH /api/pools/:id/messages/:messageId/like — alternar "me gusta" ─────
router.patch('/:id/messages/:messageId/like', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { id: poolId, messageId } = req.params;

  try {
    const { data: membership } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Tienes que estar apuntado para ver el chat' });

    const { data: msg, error: fetchErr } = await supabase
      .from('pool_messages')
      .select('id, sender_id, deleted_for_everyone, liked_by')
      .eq('id', messageId)
      .eq('pool_id', poolId)
      .single();

    if (fetchErr || !msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.deleted_for_everyone) {
      return res.status(400).json({ error: 'No puedes reaccionar a un mensaje eliminado' });
    }

    const current = Array.isArray(msg.liked_by) ? msg.liked_by : [];
    const alreadyLiked = current.includes(userId);
    const nextLikedBy = alreadyLiked ? current.filter(id => id !== userId) : [...current, userId];

    const { data, error } = await supabase
      .from('pool_messages')
      .update({ liked_by: nextLikedBy })
      .eq('id', messageId)
      .select('id, liked_by')
      .single();

    if (error) throw error;
    res.json({ message: data });
  } catch (err) {
    console.error('[POOLS] PATCH /:id/messages/:messageId/like', err);
    res.status(500).json({ error: 'Failed to update like' });
  }
});

// ── PATCH /api/pools/:id/messages/:messageId — eliminar mensaje ─────────────
router.patch('/:id/messages/:messageId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { id: poolId, messageId } = req.params;
  const { scope } = req.body;

  if (!['me', 'everyone'].includes(scope)) {
    return res.status(400).json({ error: 'scope must be "me" or "everyone"' });
  }

  try {
    const { data: membership } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Tienes que estar apuntado para ver el chat' });

    const { data: msg, error: fetchErr } = await supabase
      .from('pool_messages')
      .select('id, sender_id, deleted_for_self')
      .eq('id', messageId)
      .eq('pool_id', poolId)
      .single();

    if (fetchErr || !msg) return res.status(404).json({ error: 'Message not found' });

    if (scope === 'everyone') {
      if (msg.sender_id !== userId) {
        return res.status(403).json({ error: 'Solo puedes eliminar para todos tus propios mensajes' });
      }
      const { data, error } = await supabase
        .from('pool_messages')
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
        .from('pool_messages')
        .update({ deleted_for_self: current })
        .eq('id', messageId)
        .select('id, deleted_for_self')
        .single();

      if (error) throw error;
      return res.json({ message: data });
    }
  } catch (err) {
    console.error('[POOLS] PATCH /:id/messages/:messageId', err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// ── POST /api/pools/:id/messages/image — enviar una imagen al chat ──────────
router.post('/:id/messages/image', requireAuth, (req, res, next) => {
  _poolImageUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  const userId = req.user.id;
  const poolId = req.params.id;

  if (!req.file) {
    return res.status(400).json({ error: 'Se requiere una imagen' });
  }

  try {
    const { data: membership } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Tienes que estar apuntado para escribir en el chat' });

    const imageUrl = await storeImage({
      file: req.file,
      bucket: 'chat-images',
      objectName: `pool/${poolId}/${Date.now()}`,
      fallbackMaxLength: 8_000_000,
    });

    const insertData = {
      pool_id: poolId,
      sender_id: userId,
      content: imageUrl,
      type: 'image',
    };
    if (req.body.reply_to_id) {
      const target = await findPoolReplyTarget(req.body.reply_to_id, poolId);
      if (target) insertData.reply_to_id = target.id;
    }

    const { data, error } = await supabase
      .from('pool_messages')
      .insert(insertData)
      .select(`
        id, content, type, created_at, reply_to_id,
        reply_to:reply_to_id(id, sender_id, content, type, deleted_for_everyone, sender:sender_id(username)),
        sender:sender_id(id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at)
      `)
      .single();

    if (error) throw error;

    res.status(201).json({
      message: {
        ...data,
        sender: applyBatteryExpiry(data.sender),
      },
    });

    const senderName = data.sender?.username || 'Alguien';
    broadcastPoolChatMessage({
      poolId,
      senderId: userId,
      senderName,
      content: data.content,
      type: 'image',
    }).catch(() => {});
  } catch (e) {
    console.error('[POOLS] image upload error:', e);
    return res.status(e.status || 500).json({ error: e.message || 'Error al subir la imagen' });
  }
});

// ── POST /api/pools/:id/polls — crear una encuesta en el chat ───────────────
// Cualquier apuntado a la quedada puede crear encuestas (a diferencia de las
// encuestas de eventos de comunidad, donde solo el organizador puede).
router.post('/:id/polls', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const poolId = req.params.id;
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
    const { data: membership } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Tienes que estar apuntado para crear una encuesta' });

    const { data, error } = await supabase
      .from('pool_messages')
      .insert({ pool_id: poolId, sender_id: userId, content: question, type: 'poll', poll_options: options })
      .select(`
        id, content, type, poll_options, created_at,
        sender:sender_id(id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at)
      `)
      .single();

    if (error) throw error;
    data.poll = buildPollSummary(options, [], userId);

    res.status(201).json({
      message: {
        ...data,
        sender: applyBatteryExpiry(data.sender),
      },
    });

    const senderName = data.sender?.username || 'Alguien';
    broadcastPoolChatMessage({
      poolId,
      senderId: userId,
      senderName,
      content: `📊 ${question}`,
      type: 'poll',
    }).catch(() => {});
  } catch (err) {
    console.error('[POOLS] POST /:id/polls', err);
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

// ── GET /api/pools/:id/messages/:messageId/poll — resumen de resultados ─────
// Usado por el cliente para refrescar solo esa encuesta cuando llega un
// evento realtime de votos.
router.get('/:id/messages/:messageId/poll', requireAuth, async (req, res) => {
  const poolId = req.params.id;
  const messageId = req.params.messageId;
  const userId = req.user.id;

  try {
    const { data: membership } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Tienes que estar apuntado para ver esta encuesta' });

    const { data: message, error: msgErr } = await supabase
      .from('pool_messages')
      .select('id, poll_options')
      .eq('id', messageId)
      .eq('pool_id', poolId)
      .eq('type', 'poll')
      .single();

    if (msgErr || !message) return res.status(404).json({ error: 'Encuesta no encontrada' });

    const { data: voteRows, error: votesErr } = await supabase
      .from('pool_message_poll_votes')
      .select('message_id, user_id, option_index')
      .eq('message_id', messageId);

    if (votesErr) throw votesErr;

    res.json({ poll: buildPollSummary(message.poll_options, voteRows || [], userId) });
  } catch (err) {
    console.error('[POOLS] GET /:id/messages/:messageId/poll', err);
    res.status(500).json({ error: 'Failed to fetch poll' });
  }
});

// ── POST /api/pools/:id/messages/:messageId/vote — votar (o cambiar voto) ───
router.post('/:id/messages/:messageId/vote', requireAuth, async (req, res) => {
  const poolId = req.params.id;
  const messageId = req.params.messageId;
  const userId = req.user.id;
  const optionIndex = Number(req.body?.optionIndex);

  try {
    const { data: membership } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!membership) return res.status(403).json({ error: 'Tienes que estar apuntado para votar' });

    const { data: message, error: msgErr } = await supabase
      .from('pool_messages')
      .select('id, poll_options')
      .eq('id', messageId)
      .eq('pool_id', poolId)
      .eq('type', 'poll')
      .single();

    if (msgErr || !message) return res.status(404).json({ error: 'Encuesta no encontrada' });

    const optionCount = Array.isArray(message.poll_options) ? message.poll_options.length : 0;
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= optionCount) {
      return res.status(400).json({ error: 'Opción no válida' });
    }

    const { error } = await supabase
      .from('pool_message_poll_votes')
      .upsert(
        { message_id: messageId, pool_id: poolId, user_id: userId, option_index: optionIndex, created_at: new Date().toISOString() },
        { onConflict: 'message_id,user_id' }
      );

    if (error) throw error;

    const { data: voteRows } = await supabase
      .from('pool_message_poll_votes')
      .select('message_id, user_id, option_index')
      .eq('message_id', messageId);

    res.json({ poll: buildPollSummary(message.poll_options, voteRows || [], userId) });
  } catch (err) {
    console.error('[POOLS] POST /:id/messages/:messageId/vote', err);
    res.status(500).json({ error: 'Failed to vote' });
  }
});

// ── DELETE /api/pools/:id/messages/:messageId/vote — quitar mi voto ─────────
router.delete('/:id/messages/:messageId/vote', requireAuth, async (req, res) => {
  const poolId = req.params.id;
  const messageId = req.params.messageId;
  const userId = req.user.id;

  try {
    const { data: message, error: msgErr } = await supabase
      .from('pool_messages')
      .select('id, poll_options')
      .eq('id', messageId)
      .eq('pool_id', poolId)
      .eq('type', 'poll')
      .single();

    if (msgErr || !message) return res.status(404).json({ error: 'Encuesta no encontrada' });

    const { error } = await supabase
      .from('pool_message_poll_votes')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId);

    if (error) throw error;

    const { data: voteRows } = await supabase
      .from('pool_message_poll_votes')
      .select('message_id, user_id, option_index')
      .eq('message_id', messageId);

    res.json({ poll: buildPollSummary(message.poll_options, voteRows || [], userId) });
  } catch (err) {
    console.error('[POOLS] DELETE /:id/messages/:messageId/vote', err);
    res.status(500).json({ error: 'Failed to remove vote' });
  }
});

module.exports = router;
