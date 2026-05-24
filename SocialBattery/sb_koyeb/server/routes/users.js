const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase()) &&
               allowed.test(file.mimetype);
    cb(ok ? null : new Error('Only image files allowed'), ok);
  },
});

// POST /api/users/avatar — upload avatar to Supabase Storage
router.post('/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
  const fileName = `avatars/${req.user.id}${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(fileName, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: true,
    });

  if (uploadError) {
    // Fallback: store as base64 data URL (works without storage bucket)
    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;
    // Update avatar_url with data URL (keep it short for profile pictures)
    if (dataUrl.length > 100000) {
      return res.status(413).json({ error: 'Image too large for storage fallback' });
    }
    await supabase.from('users').update({ avatar_url: dataUrl }).eq('id', req.user.id);
    return res.json({ url: dataUrl });
  }

  const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);

  await supabase
    .from('users')
    .update({ avatar_url: publicUrl })
    .eq('id', req.user.id);

  res.json({ url: publicUrl });
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

// PATCH /api/users/me/privacy — sincroniza preferencias de privacidad
// Almacena en columnas de la tabla users (se añaden via migración SQL)
router.patch('/me/privacy', requireAuth, async (req, res) => {
  const { show_online, show_last_seen, read_receipts } = req.body;
  const updates = {};
  if (typeof show_online    === 'boolean') updates.privacy_show_online    = show_online;
  if (typeof show_last_seen === 'boolean') updates.privacy_show_last_seen = show_last_seen;
  if (typeof read_receipts  === 'boolean') updates.privacy_read_receipts  = read_receipts;

  if (Object.keys(updates).length === 0) {
    return res.json({ success: true });
  }

  await supabase.from('users').update(updates).eq('id', req.user.id);
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
  res.json({ users: data });
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
      privacy_show_online, privacy_show_last_seen, privacy_read_receipts,
      user_badges(badge_id, earned_at, badges(name, emoji, description, category))
    `)
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'User not found' });

  // Respetar privacidad: si el usuario no quiere mostrar última vez, la ocultamos
  if (data.privacy_show_last_seen === false) {
    data.last_seen_at = null;
  }
  // Si no quiere mostrar en línea, también ocultamos last_seen_at para que no se deduzca
  if (data.privacy_show_online === false) {
    data.last_seen_at = null;
  }

  // No exponer las columnas de privacidad internas al cliente
  const { privacy_show_online, privacy_show_last_seen, privacy_read_receipts, ...safeUser } = data;

  res.json({ user: safeUser, privacy_read_receipts: privacy_read_receipts ?? true });
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
  res.json({ user: data });
});

module.exports = router;
