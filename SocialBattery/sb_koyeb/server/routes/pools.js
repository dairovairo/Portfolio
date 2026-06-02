const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { checkOrganizerBadgeForUser } = require('../jobs/badges');
const { applyBatteryExpiry } = require('../lib/batteryExpiry');
const { notifyUsers } = require('../lib/webpush');
const {
  DEFAULT_POOL_REMINDER_MINUTES,
  parseReminderMinutes,
} = require('../lib/reminderLeadTime');

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

/** Builds participant preview (up to 6) for the feed */
function buildParticipantPreview(rawParticipants) {
  return (rawParticipants || [])
    .slice(0, 6)
    .map(p => {
      const user = applyBatteryExpiry(p.user);
      return {
        id: user?.id,
        display_name: user?.display_name,
        avatar_url: user?.avatar_url,
        battery_level: user?.battery_level,
      };
    })
    .filter(p => p.id);
}

// ── GET /api/pools — feed visible to the current user ───────────────────────
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { filter = 'active', limit = 30, offset = 0 } = req.query;

  try {
    const friendIds = await getFriendIds(userId);

    let query = supabase
      .from('hangout_pools')
      .select(`
        id, activity, description, location_hint, scheduled_at, ends_at,
        max_people, is_public, group_id, status, created_at, creator_id,
        creator:creator_id(id, username, display_name, avatar_url, battery_level, battery_is_estimated, battery_updated_at),
        pool_participants(
          joined_at, reminder_minutes_before,
          user:user_id(id, username, display_name, avatar_url, battery_level, battery_is_estimated, battery_updated_at)
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
      const { data: invites } = await supabase
        .from('pool_invitees')
        .select('pool_id')
        .eq('user_id', userId);
      (invites || []).forEach(i => privatePoolIds.add(i.pool_id));

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
        spots_left: pool.max_people - participantCount,
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

// ── GET /api/pools/:id — single pool with full participant list ───────────────
router.get('/:id', requireAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    const { data: pool, error } = await supabase
      .from('hangout_pools')
      .select(`
        id, activity, description, location_hint, scheduled_at, ends_at,
        max_people, is_public, group_id, status, created_at, creator_id,
        creator:creator_id(id, username, display_name, avatar_url, battery_level, battery_is_estimated, battery_updated_at),
        pool_participants(
          joined_at, reminder_minutes_before,
          user:user_id(id, username, display_name, avatar_url, battery_level, battery_is_estimated, battery_updated_at)
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
        display_name: user?.display_name,
        avatar_url: user?.avatar_url,
        battery_level: user?.battery_level,
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
        spots_left: pool.max_people - participants.length,
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
router.post('/', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const {
    activity, description, location_hint, scheduled_at, ends_at,
    max_people = 4, is_public = false,
    group_id = null,
    invited_user_ids = [],   // NEW: individual friend invites for private pools
  } = req.body;

  if (!activity?.trim()) return res.status(400).json({ error: 'activity is required' });
  if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at is required' });
  const startDate = new Date(scheduled_at);
  if (Number.isNaN(startDate.getTime())) {
    return res.status(400).json({ error: 'scheduled_at is not valid' });
  }
  if (startDate <= new Date()) {
    return res.status(400).json({ error: 'scheduled_at must be in the future' });
  }
  const location = location_hint?.trim();
  if (!location) return res.status(400).json({ error: 'location_hint is required' });

  let endDateIso = null;
  if (ends_at) {
    const endDate = new Date(ends_at);
    if (Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'ends_at is not valid' });
    }
    if (endDate <= startDate) {
      return res.status(400).json({ error: 'ends_at must be after scheduled_at' });
    }
    endDateIso = endDate.toISOString();
  }

  const maxPeople = parseInt(max_people, 10);
  if (Number.isNaN(maxPeople) || maxPeople < 2 || maxPeople > 50) {
    return res.status(400).json({ error: 'max_people must be between 2 and 50' });
  }
  if (!is_public && !group_id && (!invited_user_ids || invited_user_ids.length === 0)) {
    return res.status(400).json({ error: 'Un pool privado necesita al menos un grupo o un amigo invitado' });
  }

  try {
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
        is_public: Boolean(is_public),
        group_id: group_id || null,
        status: 'open',
      })
      .select(`
        id, activity, description, location_hint, scheduled_at, ends_at,
        max_people, is_public, status, created_at,
        creator:creator_id(id, username, display_name, avatar_url)
      `)
      .single();

    if (error) throw error;

    // Auto-join creator
    await supabase
      .from('pool_participants')
      .insert({ pool_id: pool.id, user_id: userId });

    // Insert individual invitees (deduplicated, excluding creator)
    if (!is_public && invited_user_ids?.length) {
      const uniqueInvites = [...new Set(invited_user_ids)]
        .filter(id => id !== userId)
        .map(uid => ({ pool_id: pool.id, user_id: uid }));
      if (uniqueInvites.length) {
        await supabase.from('pool_invitees').insert(uniqueInvites);
      }
    }

    const newBadgeId = await checkOrganizerBadgeForUser(userId).catch(() => null);

    // ── Push + Realtime broadcast (fire-and-forget) ──────────────────────────
    const creatorName = pool.creator?.display_name || pool.creator?.username || 'Un amigo';
    const activityLabel = pool.activity.trim();
    const notifPayload = {
      title: `🎉 ${creatorName} propone una quedada`,
      body: `${activityLabel}${pool.location_hint ? ` · ${pool.location_hint}` : ''}`,
      url: '/pools',
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
        is_public:     Boolean(is_public),
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

    if (is_public) {
      // Notify all accepted friends of the creator
      getFriendIds(userId).then(async friendIds => {
        await Promise.all([
          notifyUsers(supabase, friendIds, userId, notifPayload),
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
        if (invited_user_ids?.length) {
          invited_user_ids.forEach(id => { if (id !== userId) recipientIds.add(id); });
        }
        if (recipientIds.size) {
          await Promise.all([
            notifyUsers(supabase, [...recipientIds], userId, notifPayload),
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
          display_name: pool.creator?.display_name,
          avatar_url: pool.creator?.avatar_url,
        }],
        has_joined: true,
        is_creator: true,
        spots_left: pool.max_people - 1,
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

    if (count >= pool.max_people) {
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
      .select('creator_id, status, max_people, scheduled_at')
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
        return res.status(400).json({ error: 'scheduled_at is not valid' });
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
          return res.status(400).json({ error: 'ends_at is not valid' });
        }
        if (endDate <= referenceStart) {
          return res.status(400).json({ error: 'ends_at must be after scheduled_at' });
        }
        updates.ends_at = endDate.toISOString();
      }
    }
    if (max_people !== undefined) updates.max_people = parseInt(max_people);
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

module.exports = router;
