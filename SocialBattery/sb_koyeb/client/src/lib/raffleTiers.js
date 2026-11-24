// Aspecto de cada tipo de sorteo. Los textos están en i18n (raffle.tier_*);
// deben contar lo mismo que RAFFLE_TIERS en server/lib/raffles.js.
export const RAFFLE_TIERS = {
  light: { emoji: '🎫', border: 'border-amber-400/50', selected: 'border-amber-400/60 bg-amber-400/10' },
  volt: { emoji: '⚡', border: 'border-blue-400/50', selected: 'border-blue-400/60 bg-blue-400/10' },
  community: { emoji: '🤝', border: 'border-red-400/50', selected: 'border-red-400/60 bg-red-400/10' },
};
export const RAFFLE_TIER_KEYS = Object.keys(RAFFLE_TIERS);

export const raffleTier = (key) => RAFFLE_TIERS[key] || RAFFLE_TIERS.light;

// Iguales que en el servidor (server/lib/raffles.js y billingCatalog.js).
export const VOLT_MAX_DURATION_DAYS = 14;
export const VOLT_MIN_SUBSCRIBERS = 10;
export const VOLT_TICKETS = 3;
export const COMMUNITY_RAFFLE_FEE_CENTS = 1000;
export const PRIZE_MAX = 10;
export const MAX_MONTHS = 6;

export function localeTag(lang) {
  return { en: 'en-US', fr: 'fr-FR' }[lang] || 'es-ES';
}
