// ─────────────────────────────────────────────────────────────────────────
// Tarifas de publicidad on-demand (SocialBattery) — server mirror
// ─────────────────────────────────────────────────────────────────────────
// Espejo de client/src/lib/adPricing.js. Vive aquí para que, cuando se
// enchufe la pasarela de cobro (Stripe/Redsys), la facturación use
// exactamente los mismos números que el usuario vio al contratar. Hoy
// todavía no se factura nada (los cobros están comentados en varios
// sitios: 'de momento no hay cobro real'), pero cualquier ruta que
// necesite calcular importe (hold al empezar promoción, cobro al
// finalizar/renovar, etc.) debe importar de aquí — nunca reimplementar el
// cálculo, o el cliente y el server empezarán a discrepar.
//
// Convenio: solo se cobra por unidades REALMENTE entregadas
// (event_promo_notifications enviadas, raffle_banner_views mostradas), no
// por las contratadas. El pacing/asignación (eventPromoPacing.js /
// assignRaffleBannerTargets) tapa lo que exceda el pool disponible, y
// los umbrales de facturación (FREE_THRESHOLD = 200 en eventos, mínimo
// 500 banners en sorteos) hacen que campañas fallidas no se cobren en
// absoluto.
//
// CUALQUIER CAMBIO AQUÍ HAY QUE REPLICARLO EN
// client/src/lib/adPricing.js. Ver ese fichero para el racional de las
// tarifas por defecto (calibradas para que el mínimo contratable = precio
// estático que había antes en la UI).
// ─────────────────────────────────────────────────────────────────────────

const EVENT_AD_PRICING = {
  premium: {
    unitPriceCents: 2,
    unitLabel: 'notificación',
  },
  ultra: {
    unitPriceCents: 4,
    unitLabel: 'notificación',
  },
};

const RAFFLE_AD_PRICING = {
  light: {
    unitPriceCents: 2,
    unitLabel: 'visualización',
  },
};

function computeEventAdPriceCents(plan, units) {
  const tier = EVENT_AD_PRICING[plan];
  if (!tier) return 0;
  const n = Math.max(0, Math.floor(Number(units) || 0));
  return n * tier.unitPriceCents;
}

function computeRaffleAdPriceCents(tier, units) {
  const meta = RAFFLE_AD_PRICING[tier];
  if (!meta) return 0;
  const n = Math.max(0, Math.floor(Number(units) || 0));
  return n * meta.unitPriceCents;
}

module.exports = {
  EVENT_AD_PRICING,
  RAFFLE_AD_PRICING,
  computeEventAdPriceCents,
  computeRaffleAdPriceCents,
};
