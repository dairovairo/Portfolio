const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { createImageUpload, storeImage } = require('../lib/imageUpload');
const { applyBatteryExpiry, applyBatteryExpiryToUsers } = require('../lib/batteryExpiry');

const upload = createImageUpload({ maxSizeMb: 2 });

function uploadAvatar(req, res, next) {
  upload.single('avatar')(req, res, err => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message || 'No se pudo subir la imagen' });
  });
}

// POST /api/users/avatar — upload avatar to Supabase Storage
router.post('/avatar', requireAuth, uploadAvatar, async (req, res) => {
  try {
    const url = await storeImage({
      file: req.file,
      objectName: `avatars/${req.user.id}`,
      fallbackMaxLength: 3000000,
    });

    const { error } = await supabase
      .from('users')
      .update({ avatar_url: url })
      .eq('id', req.user.id);

    if (error) throw error;

    res.json({ url });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'No se pudo subir la imagen' });
  }
});

// POST /api/users/push-subscribe — store push subscription
router.post('/push-subscribe', requireAuth, async (req, res) => {
  const { endpoint, p256dh, auth } = req.body;
  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: 'Missing subscription fields' });
  }

  await supabase.from('push_subscriptions').upsert({
    user_id: req.user.id,
    endpoint,
    p256dh,
    auth,
  }, { onConflict: 'user_id,endpoint' }).catch(() => {});

  res.json({ success: true });
});

// PATCH /api/users/me/seen — heartbeat for online status
router.patch('/me/seen', requireAuth, async (req, res) => {
  await supabase
    .from('users')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', req.user.id);
  res.json({ success: true });
});

// PATCH /api/users/me/go-offline — immediately mark user as offline (privacy: showOnline=false)
router.patch('/me/go-offline', requireAuth, async (req, res) => {
  // Set last_seen_at far in the past so presence checks return false immediately
  const farPast = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
  await supabase
    .from('users')
    .update({ last_seen_at: farPast })
    .eq('id', req.user.id);
  res.json({ success: true });
});

// GET /api/users/search?q=username
router.get('/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, username, display_name, avatar_url, bio, battery_level, battery_is_estimated, battery_updated_at, last_seen_at')
    .ilike('username', `%${q}%`)
    .neq('id', req.user.id)
    .limit(10);

  if (error) return res.status(500).json({ error: 'Search failed' });
  res.json({ users: applyBatteryExpiryToUsers(data) });
});

// GET /api/users/:id/stats — public stats for any user profile
router.get('/:id/stats', requireAuth, async (req, res) => {
  const targetId = req.params.id;

  try {
    const [friendsRes, createdRes, participationsRes, batteryRes, userRes] = await Promise.all([
      // Accepted friendships (both directions)
      supabase
        .from('friendships')
        .select('id', { count: 'exact', head: true })
        .or(`requester_id.eq.${targetId},addressee_id.eq.${targetId}`)
        .eq('status', 'accepted'),

      // Pools created by this user
      supabase
        .from('hangout_pools')
        .select('id', { count: 'exact', head: true })
        .eq('creator_id', targetId),

      // All pool_participants rows for this user (creator is auto-joined too)
      supabase
        .from('pool_participants')
        .select('pool_id', { count: 'exact', head: true })
        .eq('user_id', targetId),

      // Battery update count (service role bypasses RLS)
      supabase
        .from('battery_history')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', targetId),

      // member_since
      supabase
        .from('users')
        .select('created_at')
        .eq('id', targetId)
        .single(),
    ]);

    const poolsCreated       = createdRes.count ?? 0;
    const totalParticipations = participationsRes.count ?? 0;
    // Creator is auto-joined so subtract to get "joined others' pools"
    const poolsJoined        = Math.max(0, totalParticipations - poolsCreated);

    res.json({
      stats: {
        friends_count:   friendsRes.count ?? 0,
        pools_created:   poolsCreated,
        pools_joined:    poolsJoined,
        battery_updates: batteryRes.count ?? 0,
        member_since:    userRes.data?.created_at ?? null,
      },
    });
  } catch (e) {
    console.error('[USERS] GET /:id/stats', e);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/users/:id
router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select(`
      id, username, display_name, bio, avatar_url,
      battery_level, battery_is_estimated, battery_updated_at, last_seen_at, created_at,
      user_badges(badge_id, earned_at, badges(name, emoji, description, category))
    `)
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'User not found' });
  res.json({ user: applyBatteryExpiry(data) });
});

// PATCH /api/users/me — update profile
router.patch('/me', requireAuth, async (req, res) => {
  const { display_name, avatar_url, bio } = req.body;
  const updates = {};
  if (display_name !== undefined) updates.display_name = display_name.trim().slice(0, 20);
  if (avatar_url !== undefined) updates.avatar_url = avatar_url;
  if (bio !== undefined) updates.bio = bio ? bio.trim().slice(0, 160) : null;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Update failed' });
  res.json({ user: applyBatteryExpiry(data) });
});

module.exports = router;
