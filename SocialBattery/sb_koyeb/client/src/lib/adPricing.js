// ─────────────────────────────────────────────────────────────────────────
// Tarifas de publicidad (SocialBattery)
// ─────────────────────────────────────────────────────────────────────────
// Espejo de server/lib/adPricing.js (server/test/adPricing.test.js comprueba
// que no diverjan): aquí solo sirve para enseñar el precio.
//
//   · Evento Premium: 2 cts por notificación entregada.
//   · Evento Ultra: 2 cts por notificación entregada + 1 ct por banner de
//     inicio que alguien VE de verdad.
//   · Sorteo Light: 2 cts por visualización del banner.
//
// Las FREE_UNITS primeras entregas de cada campaña son gratis (y los primeros
// FREE_UNITS banners). Se reserva el máximo y se devuelve lo no entregado.
// ─────────────────────────────────────────────────────────────────────────

export const FREE_UNITS = 50;
export const MIN_UNITS = 100;
export const UNITS_STEP = 100;

export const EVENT_AD_PRICING = {
  premium: { unitPriceCents: 2, bannerPriceCents: 0, unitLabel: 'notificación' },
  ultra: { unitPriceCents: 2, bannerPriceCents: 1, unitLabel: 'notificación' },
};

export const RAFFLE_AD_PRICING = {
  light: { unitPriceCents: 2, unitLabel: 'visualización' },
};

function billableUnits(units, freeUnits) {
  const n = Math.max(0, Math.floor(Number(units) || 0));
  const free = Math.max(0, Math.floor(Number(freeUnits) || 0));
  return Math.max(0, n - free);
}

/** Importe máximo de la campaña: lo que se reserva al contratarla. */
export function computeEventAdPriceCents(plan, units, freeUnits = FREE_UNITS) {
  const tier = EVENT_AD_PRICING[plan];
  if (!tier) return 0;
  return billableUnits(units, freeUnits) * (tier.unitPriceCents + tier.bannerPriceCents);
}

export function computeRaffleAdPriceCents(tier, units, freeUnits = FREE_UNITS) {
  const meta = RAFFLE_AD_PRICING[tier];
  if (!meta) return 0;
  return billableUnits(units, freeUnits) * meta.unitPriceCents;
}

/** Importe de lo ya entregado. */
export function computeEventChargeCents(plan, pushes, banners, freeUnits = FREE_UNITS) {
  const tier = EVENT_AD_PRICING[plan];
  if (!tier) return 0;
  return billableUnits(pushes, freeUnits) * tier.unitPriceCents
       + billableUnits(banners, freeUnits) * tier.bannerPriceCents;
}

// ── Formateo € (es-ES) ──────────────────────────────────────────────────
// Un formateador único centralizado — todos los precios que se
// enseñan al usuario pasan por aquí para que el estilo sea consistente
// (separador de miles ., decimal ,). Usa Intl.NumberFormat y cae a un
// formateo manual si el entorno no lo soporta (ancient WebViews).

const _eurFormatter = (() => {
  try {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return null;
  }
})();

export function formatEurFromCents(cents) {
  const n = Number(cents) || 0;
  const euros = n / 100;
  if (_eurFormatter) return _eurFormatter.format(euros);
  // Fallback: dos decimales fijos, separador español manual.
  const sign = euros < 0 ? '-' : '';
  const abs = Math.abs(euros).toFixed(2);
  const [intPart, decPart] = abs.split('.');
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${withThousands},${decPart} €`;
}
