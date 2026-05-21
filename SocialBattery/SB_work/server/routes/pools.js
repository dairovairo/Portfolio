const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { checkOrganizerBadgeForUser } = require('../jobs/badges');

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

// ── GET /api/pools — feed visible to the current user ───────────────────────
// Shows: pools from friends + public pools + own pools
// Filters: upcoming, not cancelled/closed
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { filter = 'active', limit = 20, offset = 0 } = req.query;

  try {
    const friendIds = await getFriendIds(userId);

    let query = supabase
      .from('hangout_pools')
      .select(`
        id, activity, description, location_hint, scheduled_at,
        max_people, is_public, status, created_at,
        creator:creator_id(id, username, display_name, avatar_url, battery_level, battery_is_estimated),
        pool_participants(user_id)
      `)
      .order('scheduled_at', { ascending: true })
      .limit(parseInt(limit))
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (filter === 'mine') {
      query = query.eq('creator_id', userId);
    } else if (filter === 'joined') {
      // Pools where I'm a participant (but not creator)
      const { data: myParticipations } = await supabase
        .from('pool_participants')
        .select('pool_id')
        .eq('user_id', userId);
      const poolIds = (myParticipations || []).map(p => p.pool_id);
      if (!poolIds.length) return res.json({ pools: [] });
      query = query.in('id', poolIds).neq('creator_id', userId);
    } else {
      // Active feed: upcoming pools from friends + public + own
      query = query
        .gt('scheduled_at', new Date().toISOString())
        .in('status', ['open', 'full']);

      if (friendIds.length) {
        // Pools visible to user (own + friend's + public)
        query = query.or(
          `creator_id.eq.${userId},is_public.eq.true,creator_id.in.(${friendIds.join(',')})`
        );
      } else {
        query = query.or(`creator_id.eq.${userId},is_public.eq.true`);
      }
    }

    const { data: pools, error } = await query;
    if (error) throw error;

    // Enrich: add participant count + whether current user has joined
    const enriched = (pools || []).map(pool => {
      const participants = pool.pool_participants || [];
      const participantCount = participants.length;
      const hasJoined = participants.some(p => p.user_id === userId);
      const isCreator = pool.creator?.id === userId;
      return {
        ...pool,
        pool_participants: undefined, // don't send raw list
        participant_count: participantCount,
        has_joined: hasJoined,
        is_creator: isCreator,
        spots_left: pool.max_people - participantCount,
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
        id, activity, description, location_hint, scheduled_at,
        max_people, is_public, status, created_at,
        creator:creator_id(id, username, display_name, avatar_url, battery_level, battery_is_estimated),
        pool_participants(
          joined_at,
          user:user_id(id, username, display_name, avatar_url, battery_level, battery_is_estimated)
        )
      `)
      .eq('id', req.params.id)
      .single();

    if (error || !pool) return res.status(404).json({ error: 'Pool not found' });

    const participants = pool.pool_participants || [];
    const hasJoined = participants.some(p => p.user?.id === userId);
    const isCreator = pool.creator?.id === userId;

    res.json({
      pool: {
        ...pool,
        participant_count: participants.length,
        has_joined: hasJoined,
        is_creator: isCreator,
        spots_left: pool.max_people - participants.length,
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
  const { activity, description, location_hint, scheduled_at, max_people = 4, is_public = false, group_id = null } = req.body;

  if (!activity?.trim()) return res.status(400).json({ error: 'activity is required' });
  if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at is required' });
  if (new Date(scheduled_at) <= new Date()) {
    return res.status(400).json({ error: 'scheduled_at must be in the future' });
  }
  if (max_people < 2 || max_people > 50) {
    return res.status(400).json({ error: 'max_people must be between 2 and 50' });
  }

  try {
    const { data: pool, error } = await supabase
      .from('hangout_pools')
      .insert({
        creator_id: userId,
        activity: activity.trim(),
        description: description?.trim() || null,
        location_hint: location_hint?.trim() || null,
        scheduled_at,
        max_people: parseInt(max_people),
        is_public: Boolean(is_public),
        group_id: group_id || null,
        status: 'open',
      })
      .select(`
        id, activity, description, location_hint, scheduled_at,
        max_people, is_public, status, created_at,
        creator:creator_id(id, username, display_name, avatar_url)
      `)
      .single();

    if (error) throw error;

    // Auto-join creator
    await supabase
      .from('pool_participants')
      .insert({ pool_id: pool.id, user_id: userId });

    // Check badge: organizer_5 (5+ pools created) — using shared badge engine
    const newBadgeId = await checkOrganizerBadgeForUser(userId).catch(() => null);

    res.status(201).json({
      pool: {
        ...pool,
        participant_count: 1,
        has_joined: true,
        is_creator: true,
        spots_left: pool.max_people - 1,
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
    // Get pool with current count
    const { data: pool, error: poolErr } = await supabase
      .from('hangout_pools')
      .select('id, status, max_people, creator_id, scheduled_at')
      .eq('id', poolId)
      .single();

    if (poolErr || !pool) return res.status(404).json({ error: 'Pool not found' });
    if (pool.status === 'cancelled') return res.status(400).json({ error: 'Pool was cancelled' });
    if (pool.status === 'closed') return res.status(400).json({ error: 'Pool is already closed' });
    if (new Date(pool.scheduled_at) <= new Date()) {
      return res.status(400).json({ error: 'Pool has already started' });
    }

    // Check current count
    const { count } = await supabase
      .from('pool_participants')
      .select('*', { count: 'exact', head: true })
      .eq('pool_id', poolId);

    if (count >= pool.max_people) {
      return res.status(400).json({ error: 'Pool is full' });
    }

    // Check already joined
    const { data: existing } = await supabase
      .from('pool_participants')
      .select('pool_id')
      .eq('pool_id', poolId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) return res.status(409).json({ error: 'Already joined this pool' });

    // Join
    const { error: joinErr } = await supabase
      .from('pool_participants')
      .insert({ pool_id: poolId, user_id: userId });

    if (joinErr) throw joinErr;

    // Sync pool status
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
    // Get pool to check if user is creator
    const { data: pool } = await supabase
      .from('hangout_pools')
      .select('creator_id, status')
      .eq('id', poolId)
      .single();

    if (!pool) return res.status(404).json({ error: 'Pool not found' });

    if (pool.creator_id === userId) {
      // Creator leaving = cancel the pool
      await supabase
        .from('hangout_pools')
        .update({ status: 'cancelled' })
        .eq('id', poolId);
      return res.json({ success: true, cancelled: true, message: 'Pool cancelado' });
    }

    // Remove participant
    const { error } = await supabase
      .from('pool_participants')
      .delete()
      .eq('pool_id', poolId)
      .eq('user_id', userId);

    if (error) throw error;

    // Sync status (might go from 'full' back to 'open')
    await syncPoolStatus(poolId);

    res.json({ success: true, message: 'Has salido del pool' });
  } catch (err) {
    console.error('[POOLS] DELETE /:id/leave', err);
    res.status(500).json({ error: 'Failed to leave pool' });
  }
});

// ── PATCH /api/pools/:id — update pool (creator only) ────────────────────────
router.patch('/:id', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const poolId = req.params.id;
  const { activity, description, location_hint, scheduled_at, max_people, is_public, status } = req.body;

  try {
    // Verify ownership
    const { data: pool } = await supabase
      .from('hangout_pools')
      .select('creator_id, status, max_people')
      .eq('id', poolId)
      .single();

    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    if (pool.creator_id !== userId) return res.status(403).json({ error: 'Not the creator' });

    const updates = {};
    if (activity !== undefined) updates.activity = activity.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (location_hint !== undefined) updates.location_hint = location_hint?.trim() || null;
    if (scheduled_at !== undefined) updates.scheduled_at = scheduled_at;
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
