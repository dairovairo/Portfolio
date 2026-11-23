// ─────────────────────────────────────────────────────────────────────────
// Catálogo de productos de pago — fuente de verdad del SERVIDOR.
// ─────────────────────────────────────────────────────────────────────────
// Los ids son los mismos en Stripe (se crean al vuelo con price_data, no hay
// que darlos de alta en Stripe) y en Google Play Console (ahí SÍ hay que
// crearlos a mano con exactamente estos ids — ver PAGOS_SETUP.md).
//
// El importe que se acredita SIEMPRE sale de aquí, nunca de lo que diga el
// cliente: si Play cobra 9,99 € por wallet_10 (precio local distinto) el
// saldo acreditado sigue siendo 10,00 €.

const WALLET_PACKS = {
  wallet_10:  { kind: 'wallet_topup', amountCents: 1000,  label: 'Saldo publicitario 10 €' },
  wallet_25:  { kind: 'wallet_topup', amountCents: 2500,  label: 'Saldo publicitario 25 €' },
  wallet_50:  { kind: 'wallet_topup', amountCents: 5000,  label: 'Saldo publicitario 50 €' },
  wallet_100: { kind: 'wallet_topup', amountCents: 10000, label: 'Saldo publicitario 100 €' },
  wallet_250: { kind: 'wallet_topup', amountCents: 25000, label: 'Saldo publicitario 250 €' },
};

const VOLT_PACKS = {
  volts_200:  { kind: 'volts', volts: 200,  amountCents: 99,  label: '200 Volts' },
  volts_500:  { kind: 'volts', volts: 500,  amountCents: 199, label: '500 Volts' },
  volts_2000: { kind: 'volts', volts: 2000, amountCents: 499, label: '2.000 Volts' },
  volts_5000: { kind: 'volts', volts: 5000, amountCents: 999, label: '5.000 Volts' },
};

// Suscripciones mensuales. En Play: producto de suscripción con este id y un
// base plan con id PLAY_BASE_PLAN_ID (renovación automática mensual).
const SUBSCRIPTIONS = {
  sub_volt:       { kind: 'subscription', amountCents: 199, label: 'Suscripción Volt',         flag: 'is_volt_subscriber' },
  sub_enterprise: { kind: 'subscription', amountCents: 499, label: 'SocialBattery Enterprise', flag: 'is_enterprise' },
};
const PLAY_BASE_PLAN_ID = 'monthly';

// Créditos semanales incluidos en la suscripción Volt ("150 créditos semanales").
const VOLT_SUB_WEEKLY_VOLTS = 150;
// Recompensa diaria por actualizar la batería (espejo de client/src/lib/currency.js).
const DAILY_BATTERY_REWARD = 25;

// Tarifa fija del sorteo Community (antes solo "informativa" en RAFFLE_TIERS).
const COMMUNITY_RAFFLE_FEE_CENTS = 500;

function findProduct(productId) {
  if (WALLET_PACKS[productId]) return { id: productId, ...WALLET_PACKS[productId] };
  if (VOLT_PACKS[productId]) return { id: productId, ...VOLT_PACKS[productId] };
  if (SUBSCRIPTIONS[productId]) return { id: productId, ...SUBSCRIPTIONS[productId] };
  return null;
}

function publicCatalog() {
  const map = (obj) => Object.entries(obj).map(([id, p]) => ({ id, ...p }));
  return {
    wallet_packs: map(WALLET_PACKS),
    volt_packs: map(VOLT_PACKS),
    subscriptions: map(SUBSCRIPTIONS).map(({ flag, ...rest }) => rest),
    play_base_plan_id: PLAY_BASE_PLAN_ID,
    community_raffle_fee_cents: COMMUNITY_RAFFLE_FEE_CENTS,
  };
}

module.exports = {
  WALLET_PACKS,
  VOLT_PACKS,
  SUBSCRIPTIONS,
  PLAY_BASE_PLAN_ID,
  VOLT_SUB_WEEKLY_VOLTS,
  DAILY_BATTERY_REWARD,
  COMMUNITY_RAFFLE_FEE_CENTS,
  findProduct,
  publicCatalog,
};
