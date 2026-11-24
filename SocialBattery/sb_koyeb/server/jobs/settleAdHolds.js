// ─────────────────────────────────────────────────────────────────────────
// Liquidación automática de reservas de campañas (cron cada 10 min)
// ─────────────────────────────────────────────────────────────────────────
// Las rutas de finalizar/renovar/cancelar ya liquidan al momento. Este job
// cubre los finales "naturales", que no pasan por ninguna ruta:
//   * Evento: empieza (el reparto deja de enviar), se entrega todo lo
//     contratado, pasa a basic, se cancela o desaparece.
//   * Sorteo: se sortea, llega su ends_at, se cierra la promo, se enseñan
//     todos los banners contratados, o desaparece.
// Se cobra lo entregado a partir de las unidades gratis; el resto vuelve.

const supabase = require('../lib/supabase');
const { settleCampaign } = require('../lib/wallet');
const { countBillableBanners } = require('../lib/eventPromotion');
const { countRaffleShown } = require('../lib/raffles');
const { selectInChunks } = require('../lib/paginate');

async function settleEventHolds(holds) {
  if (!holds.length) return;
  const events = await selectInChunks(holds.map(h => h.target_id), ids => supabase
    .from('community_events')
    .select('id, event_date, cancelled_at, promotion_plan, notification_count, notification_sent_count')
    .in('id', ids).order('id'));
  const byId = new Map(events.map(e => [e.id, e]));
  const now = Date.now();

  for (const h of holds) {
    const e = byId.get(h.target_id);
    try {
      const banners = e && h.extra_unit_price_cents ? await countBillableBanners(e.id) : 0;
      const pushesDone = e?.notification_count && e.notification_sent_count >= e.notification_count;
      const bannersDone = !h.extra_unit_price_cents || banners >= h.units_contracted;
      let reason = null;
      if (!e) reason = 'event_missing';
      else if (e.cancelled_at) reason = 'event_cancelled';
      else if (new Date(e.event_date).getTime() <= now) reason = 'event_started';
      else if (e.promotion_plan !== 'premium' && e.promotion_plan !== 'ultra') reason = 'promotion_ended';
      // En Ultra se espera a los banners, que se siguen viendo después del push.
      else if (pushesDone && bannersDone) reason = 'fully_delivered';
      if (!reason) continue;
      await settleCampaign({
        kind: 'event', targetId: h.target_id,
        unitsDelivered: e?.notification_sent_count || 0,
        extraUnits: banners, reason,
      });
    } catch (err) {
      console.error(`[settle] event ${h.target_id}:`, err.message);
    }
  }
}

async function settleRaffleHolds(holds) {
  if (!holds.length) return;
  const raffles = await selectInChunks(holds.map(h => h.target_id), ids => supabase
    .from('community_raffles')
    .select('id, ends_at, drawn_at, promo_ended_at, banner_views_contracted')
    .in('id', ids).order('id'));
  const byId = new Map(raffles.map(r => [r.id, r]));
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
      await settleCampaign({ kind: 'raffle', targetId: h.target_id, unitsDelivered: shown, reason });
    } catch (err) {
      console.error(`[settle] raffle ${h.target_id}:`, err.message);
    }
  }
}

async function runSettleAdHoldsTick() {
  const { data: holds, error } = await supabase
    .from('ad_holds')
    .select('id, kind, target_id, units_contracted, extra_unit_price_cents')
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

module.exports = { runSettleAdHoldsTick };
