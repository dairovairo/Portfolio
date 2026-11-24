// Lógica pura de cobro: devolución al liquidar y estado de suscripciones.
process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_KEY ||= 'test';
const test = require('node:test');
const assert = require('node:assert');
const { previewRefundCents } = require('../lib/wallet');
const { isSubscriptionActive } = require('../lib/billing');
const { findProduct } = require('../lib/billingCatalog');

const hold = { amount_cents: 1900, unit_price_cents: 2, units_contracted: 1000, free_units: 50 };

test('refund: las unidades gratis no se cobran', () => {
  assert.strictEqual(previewRefundCents(hold, 50), 1900);
  assert.strictEqual(previewRefundCents(hold, 150), 1900 - 200);
});
test('refund: nunca se cobra más de lo contratado', () => {
  assert.strictEqual(previewRefundCents(hold, 5000), 0);
});
test('refund: sin reserva => 0', () => {
  assert.strictEqual(previewRefundCents(null, 400), 0);
});

const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();
test('subs: Play cancelada pero pagada sigue activa hasta expiry', () => {
  assert.ok(isSubscriptionActive({ provider: 'google_play', status: 'canceled', current_period_end: future }));
  assert.ok(!isSubscriptionActive({ provider: 'google_play', status: 'canceled', current_period_end: past }));
});
test('subs: Stripe canceled = terminada', () => {
  assert.ok(!isSubscriptionActive({ provider: 'stripe', status: 'canceled', current_period_end: future }));
  assert.ok(isSubscriptionActive({ provider: 'stripe', status: 'active', current_period_end: future }));
});
test('catálogo: importes acreditados salen del servidor', () => {
  assert.strictEqual(findProduct('wallet_25').amountCents, 2500);
  assert.strictEqual(findProduct('volts_2000').volts, 2000);
  assert.strictEqual(findProduct('hack_1000000'), null);
});
