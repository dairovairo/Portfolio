const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { checkConnectorBadgeForUsers } = require('../jobs/badges');
const { applyBatteryExpiry, applyBatteryExpiryToUsers } = require('../lib/batteryExpiry');

// POST /api/friends/request — send friend request
router.post('/request', requireAuth, async (req, res) => {
  const { addressee_id } = req.body;
  const requesterId = req.user.id;

  if (!addressee_id) return res.status(400).json({ error: 'addressee_id is required' });
  if (addressee_id === requesterId) return res.status(400).json({ error: "Can't add yourself" });

  // Check if friendship already exists in any direction
  const { data: existing } = await supabase
    .from('friendships')
    .select('id, status')
    .or(
      `and(requester_id.eq.${requesterId},addressee_id.eq.${addressee_id}),` +
      `and(requester_id.eq.${addressee_id},addressee_id.eq.${requesterId})`
    )
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: 'Friendship already exists', status: existing.status });
  }

  const { data, error } = await supabase
    .from('friendships')
    .insert({ requester_id: requesterId, addressee_id, status: 'pending' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Failed to send request' });
  res.status(201).json({ friendship: data });
});

// PATCH /api/friends/request/:id — accept or reject
router.patch('/request/:id', requireAuth, async (req, res) => {
  const { status } = req.body;

  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be accepted or rejected' });
  }

  const { data, error } = await supabase
    .from('friendships')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('addressee_id', req.user.id)
    .select()
    .single();

  if (error || !data) return res.status(404).json({ error: 'Request not found' });

  // If accepted, check connector badge for both users
  if (status === 'accepted') {
    checkConnectorBadgeForUsers(data.requester_id, req.user.id).catch(console.error);
  }

  res.json({ friendship: data });
});

// GET /api/friends/requests — pending incoming requests
router.get('/requests', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('friendships')
    .select(`
      id, created_at,
      requester:requester_id(id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at, last_seen_at)
    `)
    .eq('addressee_id', req.user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch requests' });
  const requests = (data || []).map(request => ({
    ...request,
    requester: applyBatteryExpiry(request.requester),
  }));
  res.json({ requests });
});

// GET /api/friends — list accepted friends
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.id;

  const { data, error } = await supabase
    .from('friendships')
    .select(`
      id,
      requester:requester_id(id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at, last_seen_at),
      addressee:addressee_id(id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at, last_seen_at)
    `)
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  if (error) return res.status(500).json({ error: 'Failed to fetch friends' });

  // Flatten: return the friend (not me)
  const friends = applyBatteryExpiryToUsers((data || []).map(f =>
    f.requester?.id === userId ? f.addressee : f.requester
  ))
    .filter(Boolean)
    .sort((a, b) => (b.battery_level ?? -1) - (a.battery_level ?? -1));

  res.json({ friends });
});

// GET /api/friends/status/:userId — get friendship status with a specific user
router.get('/status/:userId', requireAuth, async (req, res) => {
  const myId = req.user.id;
  const { userId } = req.params;

  if (myId === userId) return res.json({ status: 'self' });

  const { data } = await supabase
    .from('friendships')
    .select('id, status, requester_id, addressee_id')
    .or(
      `and(requester_id.eq.${myId},addressee_id.eq.${userId}),` +
      `and(requester_id.eq.${userId},addressee_id.eq.${myId})`
    )
    .maybeSingle();

  if (!data) return res.json({ status: null, friendshipId: null });

  if (data.status === 'accepted') {
    return res.json({ status: 'accepted', friendshipId: data.id });
  }
  if (data.status === 'pending') {
    const status = data.requester_id === myId ? 'sent' : 'pending';
    return res.json({ status, friendshipId: data.id });
  }
  return res.json({ status: data.status, friendshipId: data.id });
});

// DELETE /api/friends/:friendId — remove friend
router.delete('/:friendId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { friendId } = req.params;

  const { error } = await supabase
    .from('friendships')
    .delete()
    .or(
      `and(requester_id.eq.${userId},addressee_id.eq.${friendId}),` +
      `and(requester_id.eq.${friendId},addressee_id.eq.${userId})`
    );

  if (error) return res.status(500).json({ error: 'Failed to remove friend' });
  res.json({ success: true });
});

module.exports = router;
