// ─────────────────────────────────────────────────────────────────────────
// Tarifas de publicidad on-demand (SocialBattery)
// ─────────────────────────────────────────────────────────────────────────
// Fuente única de verdad para el precio dinámico de:
//   · Eventos Premium / Ultra (EventAdConfigPage) — se contratan
//     notificaciones push (500–50.000).
//   · Sorteos Light (RaffleAdAudiencePage) — se contratan visualizaciones
//     de banner (1.000–100.000).
//
// El modelo es CPM puro: cada plan tiene un precio por unidad (céntimos
// por notificación / por visualización) y el importe se calcula
// linealmente: unidades * precio_unitario. El precio se muestra en
// tiempo real bajo el slider — al arrastrar el aforo, el importe sube o
// baja acorde.
//
// Convenio de cobro (ya existente en el código, ver eventPromoPacing.js y
// RaffleAdAudiencePage.jsx):
//   · Solo se cobra por lo REALMENTE entregado — si la audiencia es
//     menor que lo contratado, se factura sobre lo que se pudo enviar,
//     no sobre el total contratado.
//   · Si no se llega al umbral mínimo de entregas (FREE_THRESHOLD en
//     eventos = 200, CHARGE_MIN en sorteos = 500), no se cobra nada.
//
// Calibración de tarifas por defecto — pensadas para que el importe
// del mínimo contratable coincida con los precios estáticos que había
// antes en la UI (para no cambiar expectativas de usuarios existentes):
//   · Premium 500 notif  = 10 € → 2 céntimos/notificación (20 € CPM)
//   · Ultra   500 notif  = 20 € → 4 céntimos/notificación (40 € CPM)
//   · Light  1000 views  = 20 € → 2 céntimos/visualización (20 € CPM)
//
// Este fichero está espejado en server/lib/adPricing.js — cualquier
// cambio aquí (tarifas o cálculo) hay que replicarlo allí también, o la
// facturación (cuando se enchufe la pasarela) discrepará de lo que el
// usuario vio en pantalla.
// ─────────────────────────────────────────────────────────────────────────

// Tarifas por unidad, en céntimos. Cambiar aquí = cambiar en todo el
// cliente (el server tiene su propia copia sincronizada).
export const EVENT_AD_PRICING = {
  premium: {
    unitPriceCents: 2,          // 0,02 € por notificación (20 € CPM)
    unitLabel: 'notificación',
  },
  ultra: {
    unitPriceCents: 4,          // 0,04 € por notificación (40 € CPM)
    unitLabel: 'notificación',
  },
};

export const RAFFLE_AD_PRICING = {
  light: {
    unitPriceCents: 2,          // 0,02 € por visualización (20 € CPM)
    unitLabel: 'visualización',
  },
};

// ── Cálculo puro ────────────────────────────────────────────────────────
// Devuelve el importe (en céntimos) para `units` unidades del plan.
// Los cálculos se hacen en enteros para evitar la deriva de coma flotante
// típica del euro/céntimo (ej. 0.1 + 0.2 !== 0.3). El input `units` se
// normaliza a entero no negativo — cualquier ruido se corta a 0.

export function computeEventAdPriceCents(plan, units) {
  const tier = EVENT_AD_PRICING[plan];
  if (!tier) return 0;
  const n = Math.max(0, Math.floor(Number(units) || 0));
  return n * tier.unitPriceCents;
}

export function computeRaffleAdPriceCents(tier, units) {
  const meta = RAFFLE_AD_PRICING[tier];
  if (!meta) return 0;
  const n = Math.max(0, Math.floor(Number(units) || 0));
  return n * meta.unitPriceCents;
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
