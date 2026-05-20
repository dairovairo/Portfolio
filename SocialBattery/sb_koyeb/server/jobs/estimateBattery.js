const supabase = require('../lib/supabase');

/**
 * Fase 6 — Batería Estimada
 *
 * Runs every hour via cron. For each user who hasn't updated today:
 *   1. Checks if they have ≥2 entries in battery_history for this day_of_week
 *   2. Computes a weighted average biased toward:
 *      a) Entries recorded near the current hour  (proximity weight)
 *      b) More recent entries over older ones     (recency weight)
 *   3. Marks the user's battery_level as estimated (battery_is_estimated = true)
 *      and sets battery_updated_at = now so the UI shows "estimado hace Xmin"
 *
 * The UI displays: ⚡ ~67% estimado  with a yellow badge.
 * When the user manually updates their battery, battery_is_estimated resets to false.
 */
async function estimateBatteries() {
  const now = new Date();
  const dayOfWeek = now.getDay();      // 0 = Sunday … 6 = Saturday
  const currentHour = now.getHours();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  try {
    // ── 1. Find users who haven't updated today ──────────────────────────────
    const { data: staleUsers, error } = await supabase
      .from('users')
      .select('id')
      .or(`battery_updated_at.is.null,battery_updated_at.lt.${todayStart.toISOString()}`);

    if (error) { console.error('[ESTIMATE] Query error:', error); return; }
    if (!staleUsers?.length) { console.log('[ESTIMATE] No stale users found.'); return; }

    console.log(`[ESTIMATE] Checking ${staleUsers.length} stale users for day=${dayOfWeek} hour=${currentHour}...`);
    let estimated = 0;
    let skipped = 0;

    for (const user of staleUsers) {
      // ── 2. Get their history for this weekday ──────────────────────────────
      const { data: history } = await supabase
        .from('battery_history')
        .select('level, hour, recorded_at')
        .eq('user_id', user.id)
        .eq('day_of_week', dayOfWeek)
        .order('recorded_at', { ascending: false })
        .limit(50); // cap to avoid huge datasets

      // Need at least 2 data points to estimate
      if (!history || history.length < 2) { skipped++; continue; }

      // ── 3. Weighted average: hour proximity × recency ─────────────────────
      //
      //   hourWeight  = max(1, 12 − |entry.hour − currentHour|)
      //                 → peaks at 12 for the same hour, falls to 1 at ±11h
      //   recencyWeight = 1 / (index + 1)  (most recent = index 0 → weight 1)
      //   combined = hourWeight × recencyWeight
      //
      let weightedSum = 0;
      let totalWeight = 0;

      history.forEach((entry, idx) => {
        const hourDiff = Math.abs(entry.hour - currentHour);
        const hourWeight = Math.max(1, 12 - hourDiff);
        const recencyWeight = 1 / (idx + 1);
        const combined = hourWeight * recencyWeight;
        weightedSum += entry.level * combined;
        totalWeight += combined;
      });

      const estimatedLevel = Math.round(weightedSum / totalWeight);

      // ── 4. Update user ─────────────────────────────────────────────────────
      const { error: updateErr } = await supabase
        .from('users')
        .update({
          battery_level: estimatedLevel,
          battery_is_estimated: true,
          battery_updated_at: now.toISOString(), // lets the UI show "estimado ahora"
        })
        .eq('id', user.id);

      if (updateErr) {
        console.error(`[ESTIMATE] Failed to update user ${user.id}:`, updateErr);
      } else {
        estimated++;
      }
    }

    console.log(`[ESTIMATE] Done. Estimated: ${estimated}, skipped (no data): ${skipped}`);
  } catch (err) {
    console.error('[ESTIMATE] Unexpected error:', err);
  }
}

module.exports = { estimateBatteries };

