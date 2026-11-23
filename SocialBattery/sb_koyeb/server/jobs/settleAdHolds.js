// ─────────────────────────────────────────────────────────────────────────
// Liquidación automática de reservas de campañas (cron cada 10 min)
// ─────────────────────────────────────────────────────────────────────────
// Las rutas de finalizar/renovar ya liquidan al momento. Este job cubre los
// finales "naturales", que no pasan por ninguna ruta:
//   * Evento: empieza (event_date <= ahora — el pacing deja de enviar), se
//     entrega todo lo contratado, pasa a basic, o desaparece.
//   * Sorteo: se sortea, llega su ends_at, se cierra la promo, se enseñan
//     todos los banners contratados, o desaparece.
// Se cobra lo entregado si se alcanzó el umbral; el resto vuelve al saldo.

const supabase = require('../lib/supabase');
const { settleCampaign } = require('../lib/wallet');
const { FREE_THRESHOLD } = require('./eventPromoPacing');

const RAFFLE_FREE_THRESHOLD = 200;

async function countRaffleShown(raffleId) {
  const { count, error } = await supabase
    .from('raffle_banner_targets')
    .select('*', { count: 'exact', head: true })
    .eq('raffle_id', raffleId)
    .not('shown_at', 'is', null);
  if (error) throw error;
  return count || 0;
}

async function settleEventHolds(holds) {
  if (!holds.length) return;
  const ids = holds.map(h => h.target_id);
  const { data: events, error } = await supabase
    .from('community_events')
    .select('id, event_date, promotion_plan, notification_count, notification_sent_count')
    .in('id', ids);
  if (error) throw error;
  const byId = new Map((events || []).map(e => [e.id, e]));
  const now = Date.now();

  for (const h of holds) {
    const e = byId.get(h.target_id);
    let reason = null;
    if (!e) reason = 'event_missing';
    else if (new Date(e.event_date).getTime() <= now) reason = 'event_started';
    else if (e.promotion_plan !== 'premium' && e.promotion_plan !== 'ultra') reason = 'promotion_ended';
    else if (e.notification_count && e.notification_sent_count >= e.notification_count) reason = 'fully_delivered';
    if (!reason) continue;
    try {
      await settleCampaign({
        kind: 'event', targetId: h.target_id,
        unitsDelivered: e?.notification_sent_count || 0,
        threshold: FREE_THRESHOLD, reason,
      });
    } catch (err) {
      console.error(`[settle] event ${h.target_id}:`, err.message);
    }
  }
}

async function settleRaffleHolds(holds) {
  if (!holds.length) return;
  const ids = holds.map(h => h.target_id);
  const { data: raffles, error } = await supabase
    .from('community_raffles')
    .select('id, ends_at, drawn_at, promo_ended_at, banner_views_contracted')
    .in('id', ids);
  if (error) throw error;
  const byId = new Map((raffles || []).map(r => [r.id, r]));
  const now = Date.now();

  for (const h of holds) {
    const r = byId.get(h.target_id);
    try {
      const shown = r ? await countRaffleShown(r.id) : 0;
      let reason = null;
      if (!r) reason = 'raffle_missing';
      else if (r.drawn_at) reason = 'raffle_drawn';
      else if (new Date(r.ends_at).getTime() <= now) reason = 'raffle_ended';
      else if (r.promo_ended_at) reason = 'promotion_ended';
      else if (r.banner_views_contracted && shown >= r.banner_views_contracted) reason = 'fully_delivered';
      if (!reason) continue;
      await settleCampaign({
        kind: 'raffle', targetId: h.target_id, unitsDelivered: shown,
        threshold: RAFFLE_FREE_THRESHOLD, reason,
      });
    } catch (err) {
      console.error(`[settle] raffle ${h.target_id}:`, err.message);
    }
  }
}

async function runSettleAdHoldsTick() {
  const { data: holds, error } = await supabase
    .from('ad_holds')
    .select('id, kind, target_id')
    .eq('status', 'held')
    .limit(500);
  if (error) {
    // Migración phase134 sin ejecutar: nada que hacer.
    if (/ad_holds|does not exist|schema cache/i.test(error.message)) return;
    throw error;
  }
  if (!holds?.length) return;
  await settleEventHolds(holds.filter(h => h.kind === 'event'));
  await settleRaffleHolds(holds.filter(h => h.kind === 'raffle'));
}

module.exports = { runSettleAdHoldsTick, countRaffleShown, RAFFLE_FREE_THRESHOLD };
