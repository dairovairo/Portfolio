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
  res.json({ user: data });
});

// PATCH /api/users/me — update profile
router.patch('/me', requireAuth, async (req, res) => {
  const { display_name, avatar_url, bio } = req.body;
  const updates = {};
  if (display_name !== undefined) updates.display_name = display_name.trim().slice(0, 40);
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
