// Cliente de Stripe perezoso: si STRIPE_SECRET_KEY no está definida, el
// servidor arranca igual y las rutas de Stripe responden 503.
let stripe = null;

function isConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function getStripe() {
  if (!isConfigured()) {
    const e = new Error('Los pagos con tarjeta no están configurados todavía');
    e.status = 503;
    throw e;
  }
  if (!stripe) {
    const Stripe = require('stripe');
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

module.exports = { isConfigured, getStripe };
