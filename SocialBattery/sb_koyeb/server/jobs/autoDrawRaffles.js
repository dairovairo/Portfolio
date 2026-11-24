const supabase = require('../lib/supabase');
const { drawRaffle } = require('../lib/raffleDraw');
const { notifyRaffleDrawn } = require('../lib/raffleNotifications');

// ─────────────────────────────────────────────────────────────────────────
// Sorteo automático al llegar la fecha de fin (cron cada minuto)
// ─────────────────────────────────────────────────────────────────────────
// Usa la misma función que el botón "Sortear" del organizador. Un sorteo sin
// participantes se cierra igualmente, con los premios sin adjudicar.

async function runAutoDrawTick() {
  const { data: due, error } = await supabase
    .from('community_raffles')
    .select('id')
    .lte('ends_at', new Date().toISOString())
    .is('drawn_at', null)
    .order('ends_at')
    .limit(200);
  if (error) throw error;

  let drawn = 0;
  let failed = 0;
  for (const { id } of due || []) {
    try {
      const result = await drawRaffle(id);
      if (!result) continue;
      drawn += 1;
      notifyRaffleDrawn({
        raffleId: id,
        communityId: result.raffle.community_id,
        title: result.raffle.title,
        creatorId: result.raffle.creator_id,
        eligibleIds: result.participantIds,
      }).catch(err => console.warn(`[CRON] autoDrawRaffles notif ${id}:`, err.message));
    } catch (err) {
      // Queda con drawn_at a null: el próximo tick lo reintenta.
      failed += 1;
      console.error(`[CRON] autoDrawRaffles: sorteo ${id} falló:`, err.message);
    }
  }
  if (drawn || failed) console.log(`[CRON] autoDrawRaffles: ${drawn} sorteados, ${failed} fallados`);
  return { drawn, failed };
}

module.exports = { runAutoDrawTick };
