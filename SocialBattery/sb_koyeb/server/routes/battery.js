const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { checkAndAwardBadges } = require('../jobs/badges');
const { applyBatteryExpiryToUsers } = require('../lib/batteryExpiry');

const USER_SUMMARY_FIELDS = 'id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at, last_seen_at';

// PATCH /api/battery — update battery level
router.patch('/', requireAuth, async (req, res) => {
  const { level } = req.body;
  const userId = req.user.id;

  if (typeof level !== 'number' || level < 0 || level > 100) {
    return res.status(400).json({ error: 'Level must be a number between 0 and 100' });
  }

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const hour = now.getHours();

  // Update user's current battery
  const { data: user, error: updateError } = await supabase
    .from('users')
    .update({
      battery_level: level,
      battery_updated_at: now.toISOString(),
      battery_is_estimated: false,
    })
    .eq('id', userId)
    .select(USER_SUMMARY_FIELDS)
    .single();

  if (updateError) {
    console.error('Battery update error:', updateError);
    return res.status(500).json({ error: 'Failed to update battery' });
  }

  // Log to history
  await supabase.from('battery_history').insert({
    user_id: userId,
    level,
    day_of_week: dayOfWeek,
    hour,
    recorded_at: now.toISOString(),
  });

  // Check badge eligibility — await so we can return new badges
  let newBadgeIds = [];
  try {
    newBadgeIds = await checkAndAwardBadges(userId, level, hour, dayOfWeek);
  } catch (e) {
    console.error('[BATTERY] Badge check failed:', e);
  }

  // If new badges earned, fetch their full details for the response
  let newBadges = [];
  if (newBadgeIds.length > 0) {
    const { data: badgeDetails } = await supabase
      .from('badges')
      .select('id, name, emoji, description, category')
      .in('id', newBadgeIds);
    newBadges = badgeDetails || [];
  }

  res.json({ user, newBadges });
});

// GET /api/battery/history — own battery history
router.get('/history', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('battery_history')
    .select('level, day_of_week, hour, recorded_at')
    .eq('user_id', req.user.id)
    .order('recorded_at', { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: 'Failed to fetch history' });
  res.json({ history: data });
});

// GET /api/battery/friends — friends' current battery levels
router.get('/friends', requireAuth, async (req, res) => {
  const userId = req.user.id;

  // Get accepted friend IDs
  const { data: friendships } = await supabase
    .from('friendships')
    .select('requester_id, addressee_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  if (!friendships?.length) {
    return res.json({ friends: [] });
  }

  const friendIds = friendships.map(f =>
    f.requester_id === userId ? f.addressee_id : f.requester_id
  );

  const { data: friends, error } = await supabase
    .from('users')
    .select('id, username, avatar_url, battery_level, battery_is_estimated, battery_updated_at, last_seen_at, mascot_preview_url')
    .in('id', friendIds)
    .order('battery_level', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch friends' });
  const normalizedFriends = applyBatteryExpiryToUsers(friends)
    .sort((a, b) => (b.battery_level ?? -1) - (a.battery_level ?? -1));
  res.json({ friends: normalizedFriends });
});

module.exports = router;
