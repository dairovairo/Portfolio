const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

// POST /api/auth/profile — called after Supabase signup to create public profile
router.post('/profile', requireAuth, async (req, res) => {
  const { username, display_name, bio, avatar_url, initial_battery } = req.body;
  const userId = req.user.id;

  if (!username || username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }

  // Check username uniqueness, but allow the same user to retry onboarding.
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('username', username.trim().toLowerCase())
    .maybeSingle();

  if (existing && existing.id !== userId) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const batteryLevel = typeof initial_battery === 'number'
    ? Math.max(0, Math.min(100, initial_battery))
    : 50;

  const { data, error } = await supabase
    .from('users')
    .upsert({
      id: userId,
      username: username.trim().toLowerCase(),
      display_name: (display_name || username).trim(),
      bio: bio ? bio.trim().slice(0, 160) : null,
      avatar_url: avatar_url || null,
      battery_level: batteryLevel,
      battery_updated_at: new Date().toISOString(),
      onboarding_done: true,
    })
    .select()
    .single();

  if (error) {
    console.error('Profile creation error:', error);
    return res.status(500).json({ error: 'Failed to create profile' });
  }

  // Record initial battery once. A lost response can make the client retry this route.
  if (!existing) {
    await supabase.from('battery_history').insert({
      user_id: userId,
      level: batteryLevel,
      day_of_week: new Date().getDay(),
      hour: new Date().getHours(),
    }).catch(() => {});
  }

  res.status(201).json({ user: data });
});

// GET /api/auth/me — get current user profile
router.get('/me', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*, user_badges(badge_id, earned_at, badges(*))')
    .eq('id', req.user.id)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Profile not found. Please complete setup.' });
  }

  res.json({ user: data });
});

module.exports = router;
