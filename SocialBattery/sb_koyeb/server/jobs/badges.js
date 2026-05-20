const supabase = require('../lib/supabase');

/**
 * FASE 7 — Badge Catalog & Detection Engine
 * ─────────────────────────────────────────
 * Each badge entry includes:
 *   id          — matches badges.id in DB
 *   check()     — fast synchronous check (context-based)
 *   checkAsync() — optional async check (DB queries needed)
 */

// ── Context-based checks (instant, no DB) ───────────────────────────────────

const INSTANT_CHECKS = [
  {
    id: 'night_owl',
    check: (_, { hour }) => hour >= 22 || hour < 2,
  },
  {
    id: 'early_bird',
    check: (_, { hour }) => hour >= 6 && hour < 9,
  },
  {
    id: 'low_battery_hero',
    check: (_, { level }) => level <= 10,
  },
  {
    id: 'fully_charged',
    check: (_, { level }) => level === 100,
  },
  {
    id: 'weekend_warrior',
    check: (_, { dayOfWeek }) => dayOfWeek === 0 || dayOfWeek === 6,
  },
];

// ── Async checks (require DB queries) ───────────────────────────────────────

async function checkStreakBadge(userId) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const { data: history } = await supabase
    .from('battery_history')
    .select('recorded_at')
    .eq('user_id', userId)
    .gte('recorded_at', sevenDaysAgo.toISOString());

  if (!history) return false;

  const uniqueDays = new Set(
    history.map(h => new Date(h.recorded_at).toDateString())
  );

  return uniqueDays.size >= 7;
}

async function checkIntrovertBadge(userId) {
  // 10+ distinct days with battery < 30%
  const { data: history } = await supabase
    .from('battery_history')
    .select('recorded_at')
    .eq('user_id', userId)
    .lt('level', 30);

  if (!history?.length) return false;

  const uniqueDays = new Set(
    history.map(h => new Date(h.recorded_at).toDateString())
  );

  return uniqueDays.size >= 10;
}

async function checkSocialButterflyBadge(userId) {
  // 10+ distinct days with battery > 80%
  const { data: history } = await supabase
    .from('battery_history')
    .select('recorded_at')
    .eq('user_id', userId)
    .gt('level', 80);

  if (!history?.length) return false;

  const uniqueDays = new Set(
    history.map(h => new Date(h.recorded_at).toDateString())
  );

  return uniqueDays.size >= 10;
}

async function checkOrganizerBadge(userId) {
  const { count } = await supabase
    .from('hangout_pools')
    .select('*', { count: 'exact', head: true })
    .eq('creator_id', userId);

  return (count || 0) >= 5;
}

async function checkConnectorBadge(userId) {
  const { count } = await supabase
    .from('friendships')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  return (count || 0) >= 10;
}

// ── Award helper ─────────────────────────────────────────────────────────────

async function awardBadge(userId, badgeId) {
  const { data, error } = await supabase
    .from('user_badges')
    .insert({ user_id: userId, badge_id: badgeId, earned_at: new Date().toISOString() })
    .select('badge_id, earned_at')
    .single();

  if (error) {
    // Duplicate = already earned, not a real error
    if (error.code === '23505') return null;
    console.error(`[BADGE] Insert error for ${badgeId}:`, error.message);
    return null;
  }

  console.log(`[BADGE] 🏅 User ${userId} earned: ${badgeId}`);
  return data;
}

// ── Main entry: called after every battery update ────────────────────────────

/**
 * Checks all badge conditions for a user after a battery update.
 * Returns array of newly earned badge IDs (to surface in the API response).
 */
async function checkAndAwardBadges(userId, level, hour, dayOfWeek) {
  const newlyEarned = [];

  try {
    // Get badges already earned (to skip re-checking)
    const { data: existing } = await supabase
      .from('user_badges')
      .select('badge_id')
      .eq('user_id', userId);

    const earned = new Set(existing?.map(b => b.badge_id) || []);
    const context = { level, hour, dayOfWeek };

    // ── Instant checks ───────────────────────────────────────────────────────
    for (const badge of INSTANT_CHECKS) {
      if (!earned.has(badge.id) && badge.check(userId, context)) {
        const result = await awardBadge(userId, badge.id);
        if (result) {
          earned.add(badge.id);
          newlyEarned.push(badge.id);
        }
      }
    }

    // ── Async checks ─────────────────────────────────────────────────────────
    const asyncChecks = [
      { id: 'consistent_7',     fn: () => checkStreakBadge(userId) },
      { id: 'introvert_proud',  fn: () => checkIntrovertBadge(userId) },
      { id: 'social_butterfly', fn: () => checkSocialButterflyBadge(userId) },
    ];

    await Promise.all(
      asyncChecks.map(async ({ id, fn }) => {
        if (earned.has(id)) return;
        try {
          const qualifies = await fn();
          if (qualifies) {
            const result = await awardBadge(userId, id);
            if (result) newlyEarned.push(id);
          }
        } catch (e) {
          console.error(`[BADGE] Async check failed for ${id}:`, e.message);
        }
      })
    );

  } catch (err) {
    console.error('[BADGE] checkAndAwardBadges error:', err.message);
  }

  return newlyEarned;
}

/**
 * Checks organizer_5 badge after pool creation.
 * Returns the badge ID if newly earned, otherwise null.
 */
async function checkOrganizerBadgeForUser(userId) {
  try {
    const { data: existing } = await supabase
      .from('user_badges')
      .select('badge_id')
      .eq('user_id', userId)
      .eq('badge_id', 'organizer_5')
      .maybeSingle();

    if (existing) return null; // already earned

    const qualifies = await checkOrganizerBadge(userId);
    if (qualifies) {
      const result = await awardBadge(userId, 'organizer_5');
      return result ? 'organizer_5' : null;
    }
  } catch (err) {
    console.error('[BADGE] checkOrganizerBadgeForUser error:', err.message);
  }
  return null;
}

/**
 * Checks connector badge after a new friendship is accepted.
 * Both users are checked (both might hit 10 friends).
 * Returns array of { userId, badgeId } for newly earned badges.
 */
async function checkConnectorBadgeForUsers(userIdA, userIdB) {
  const newlyEarned = [];

  for (const userId of [userIdA, userIdB]) {
    try {
      const { data: existing } = await supabase
        .from('user_badges')
        .select('badge_id')
        .eq('user_id', userId)
        .eq('badge_id', 'connector')
        .maybeSingle();

      if (existing) continue;

      const qualifies = await checkConnectorBadge(userId);
      if (qualifies) {
        const result = await awardBadge(userId, 'connector');
        if (result) newlyEarned.push({ userId, badgeId: 'connector' });
      }
    } catch (err) {
      console.error('[BADGE] checkConnectorBadgeForUsers error:', err.message);
    }
  }

  return newlyEarned;
}

module.exports = {
  checkAndAwardBadges,
  checkOrganizerBadgeForUser,
  checkConnectorBadgeForUsers,
};
