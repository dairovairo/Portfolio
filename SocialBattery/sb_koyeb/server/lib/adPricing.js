// ─────────────────────────────────────────────────────────────────────────
// Tarifas de publicidad (SocialBattery) — server mirror
// ─────────────────────────────────────────────────────────────────────────
// Espejo de client/src/lib/adPricing.js (test/adPricing.test.js comprueba que
// no diverjan). Cualquier ruta que calcule un importe debe importarlo de aquí.
//
//   · Evento Premium: 2 cts por notificación entregada.
//   · Evento Ultra: 2 cts por notificación entregada + 1 ct por banner de
//     inicio que alguien VE de verdad.
//   · Sorteo Light: 2 cts por visualización del banner.
//
// Las FREE_UNITS primeras entregas de cada campaña son gratis (y los primeros
// FREE_UNITS banners). Se reserva el máximo y al liquidar se devuelve todo lo
// que no se haya entregado.
// ─────────────────────────────────────────────────────────────────────────

const FREE_UNITS = 50;
const MIN_UNITS = 100;
const UNITS_STEP = 100;

const EVENT_AD_PRICING = {
  premium: { unitPriceCents: 2, bannerPriceCents: 0, unitLabel: 'notificación' },
  ultra: { unitPriceCents: 2, bannerPriceCents: 1, unitLabel: 'notificación' },
};

const RAFFLE_AD_PRICING = {
  light: { unitPriceCents: 2, unitLabel: 'visualización' },
};

function billableUnits(units, freeUnits) {
  const n = Math.max(0, Math.floor(Number(units) || 0));
  const free = Math.max(0, Math.floor(Number(freeUnits) || 0));
  return Math.max(0, n - free);
}

/** Importe máximo de la campaña: lo que se reserva al contratarla. */
function computeEventAdPriceCents(plan, units, freeUnits = FREE_UNITS) {
  const tier = EVENT_AD_PRICING[plan];
  if (!tier) return 0;
  return billableUnits(units, freeUnits) * (tier.unitPriceCents + tier.bannerPriceCents);
}

function computeRaffleAdPriceCents(tier, units, freeUnits = FREE_UNITS) {
  const meta = RAFFLE_AD_PRICING[tier];
  if (!meta) return 0;
  return billableUnits(units, freeUnits) * meta.unitPriceCents;
}

/** Importe de lo ya entregado. */
function computeEventChargeCents(plan, pushes, banners, freeUnits = FREE_UNITS) {
  const tier = EVENT_AD_PRICING[plan];
  if (!tier) return 0;
  return billableUnits(pushes, freeUnits) * tier.unitPriceCents
       + billableUnits(banners, freeUnits) * tier.bannerPriceCents;
}

module.exports = {
  FREE_UNITS,
  MIN_UNITS,
  UNITS_STEP,
  EVENT_AD_PRICING,
  RAFFLE_AD_PRICING,
  computeEventAdPriceCents,
  computeRaffleAdPriceCents,
  computeEventChargeCents,
};
