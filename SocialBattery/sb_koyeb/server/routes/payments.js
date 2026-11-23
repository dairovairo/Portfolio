// ─────────────────────────────────────────────────────────────────────────
// /api/payments — monedero, Volts, compras (Stripe en web, Play en la app)
// ─────────────────────────────────────────────────────────────────────────
const express = require('express');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const {
  findProduct, publicCatalog, VOLT_SUB_WEEKLY_VOLTS, DAILY_BATTERY_REWARD,
} = require('../lib/billingCatalog');
const billing = require('../lib/billing');
const wallet = require('../lib/wallet');
const stripeClient = require('../lib/stripeClient');
const play = require('../lib/googlePlay');

const router = express.Router();

function sendError(res, err, fallback) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error('[payments]', fallback, err);
  res.status(status).json({ error: status >= 500 && !err.status ? fallback : err.message });
}

function appBaseUrl() {
  const explicit = process.env.PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const first = (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
  return first.replace(/\/$/, '');
}

const RETURN_PATHS = new Set(['/wallet', '/shop']);

// ── Catálogo (público) ──────────────────────────────────────────────────────
router.get('/catalog', (req, res) => {
  res.json({
    ...publicCatalog(),
    payments_enabled: wallet.paymentsEnabled(),
    providers: { stripe: stripeClient.isConfigured(), google_play: play.isConfigured() },
  });
});

// ── Estado del usuario ──────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const [walletRes, txRes, holdsRes, subsRes, userRes] = await Promise.all([
      supabase.from('wallets').select('balance_cents').eq('user_id', userId).maybeSingle(),
      supabase.from('wallet_transactions')
        .select('id, type, amount_cents, balance_after, description, created_at')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(30),
      supabase.from('ad_holds')
        .select('id, kind, target_id, plan, units_contracted, amount_cents, created_at')
        .eq('user_id', userId).eq('status', 'held').order('created_at', { ascending: false }),
      supabase.from('subscriptions')
        .select('id, provider, product_id, status, current_period_end, auto_renew')
        .eq('user_id', userId).order('updated_at', { ascending: false }),
      supabase.from('users').select('is_volt_subscriber, is_enterprise').eq('id', userId).maybeSingle(),
    ]);
    for (const r of [walletRes, txRes, holdsRes, subsRes, userRes]) if (r.error) throw r.error;

    const held = (holdsRes.data || []).reduce((s, h) => s + Number(h.amount_cents), 0);
    const subs = (subsRes.data || []).map(s => ({ ...s, active: billing.isSubscriptionActive(s) }));

    res.json({
      balance_cents: Number(walletRes.data?.balance_cents || 0),
      held_cents: held,
      holds: holdsRes.data || [],
      transactions: txRes.data || [],
      subscriptions: subs,
      is_volt_subscriber: Boolean(userRes.data?.is_volt_subscriber),
      is_enterprise: Boolean(userRes.data?.is_enterprise),
      payments_enabled: wallet.paymentsEnabled(),
    });
  } catch (err) {
    sendError(res, err, 'Error al cargar tu saldo');
  }
});

// ── Volts (moneda de la mascota) ───────────────────────────────────────────
// GET devuelve el saldo; si el usuario aún no tiene fila se crea sembrando
// lo que la app tenía en localStorage (?seed=N, acotado a 5000 en SQL).
// Además entrega los créditos semanales de la suscripción Volt.
router.get('/volts', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const seed = Number.parseInt(req.query.seed, 10);
    const { data: balance, error } = await supabase.rpc('volts_init', {
      p_user: userId, p_seed: Number.isFinite(seed) ? seed : 150,
    });
    if (error) throw error;

    let volts = Number(balance);
    let weeklyGranted = false;
    const { data: u } = await supabase.from('users').select('is_volt_subscriber').eq('id', userId).maybeSingle();
    if (u?.is_volt_subscriber) {
      const { data: g, error: gErr } = await supabase.rpc('volts_weekly_grant', { p_user: userId, p_amount: VOLT_SUB_WEEKLY_VOLTS });
      if (!gErr && g) { volts = Number(g.volts); weeklyGranted = Boolean(g.granted); }
    }
    res.json({ volts, weekly_granted: weeklyGranted, weekly_amount: VOLT_SUB_WEEKLY_VOLTS });
  } catch (err) {
    sendError(res, err, 'Error al cargar tus Volts');
  }
});

router.post('/volts/spend', requireAuth, async (req, res) => {
  const amount = Number.parseInt(req.body?.amount, 10);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return res.status(400).json({ error: 'Cantidad no válida' });
  }
  try {
    const { data, error } = await supabase.rpc('volts_add', { p_user: req.user.id, p_delta: -amount });
    if (error) {
      if (/INSUFFICIENT_VOLTS/.test(error.message)) {
        return res.status(402).json({ code: 'INSUFFICIENT_VOLTS', error: 'No tienes Volts suficientes' });
      }
      throw error;
    }
    res.json({ volts: Number(data) });
  } catch (err) {
    sendError(res, err, 'Error al gastar Volts');
  }
});

router.post('/volts/daily', requireAuth, async (req, res) => {
  try {
    // Primera vez: crear la fila sembrando el saldo local (como GET /volts).
    const seed = Number.parseInt(req.body?.seed, 10);
    const { error: initErr } = await supabase.rpc('volts_init', {
      p_user: req.user.id, p_seed: Number.isFinite(seed) ? seed : 150,
    });
    if (initErr) throw initErr;
    const { data, error } = await supabase.rpc('volts_claim_daily', { p_user: req.user.id, p_amount: DAILY_BATTERY_REWARD });
    if (error) throw error;
    res.json({ claimed: Boolean(data?.claimed), volts: Number(data?.volts || 0), reward: DAILY_BATTERY_REWARD });
  } catch (err) {
    sendError(res, err, 'Error al reclamar la recompensa');
  }
});

// ── Stripe (web) ────────────────────────────────────────────────────────────
async function ensureStripeCustomer(stripe, user) {
  const { data: row } = await supabase.from('users').select('stripe_customer_id').eq('id', user.id).maybeSingle();
  if (row?.stripe_customer_id) return row.stripe_customer_id;
  const customer = await stripe.customers.create({
    email: user.email || undefined,
    metadata: { user_id: user.id },
  });
  await supabase.from('users').update({ stripe_customer_id: customer.id }).eq('id', user.id);
  return customer.id;
}

router.post('/stripe/checkout', requireAuth, async (req, res) => {
  const product = findProduct(req.body?.product_id);
  if (!product) return res.status(400).json({ error: 'Producto desconocido' });
  const returnPath = RETURN_PATHS.has(req.body?.return_path) ? req.body.return_path : '/wallet';
  try {
    const stripe = stripeClient.getStripe();
    const customer = await ensureStripeCustomer(stripe, req.user);
    const base = appBaseUrl();
    const metadata = { user_id: req.user.id, product_id: product.id };
    const isSub = product.kind === 'subscription';

    const session = await stripe.checkout.sessions.create({
      mode: isSub ? 'subscription' : 'payment',
      customer,
      client_reference_id: req.user.id,
      metadata,
      locale: 'auto',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: product.amountCents,
          product_data: { name: product.label },
          ...(isSub ? { recurring: { interval: 'month' } } : {}),
        },
      }],
      ...(isSub
        ? { subscription_data: { metadata } }
        : { payment_intent_data: { metadata } }),
      success_url: `${base}${returnPath}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}${returnPath}?checkout=cancel`,
    });
    res.json({ url: session.url });
  } catch (err) {
    sendError(res, err, 'No se pudo iniciar el pago');
  }
});

// Confirmación desde el navegador al volver de Checkout. Es redundante con el
// webhook (y ambos son idempotentes): así el saldo aparece al instante aunque
// el webhook tarde o no esté configurado.
router.post('/stripe/confirm', requireAuth, async (req, res) => {
  const sessionId = req.body?.session_id;
  if (!sessionId || typeof sessionId !== 'string') return res.status(400).json({ error: 'Falta session_id' });
  try {
    const stripe = stripeClient.getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const owner = session.metadata?.user_id || session.client_reference_id;
    if (owner !== req.user.id) return res.status(403).json({ error: 'Esta sesión de pago no es tuya' });
    const result = await billing.fulfillCheckoutSession(session);
    res.json(result);
  } catch (err) {
    sendError(res, err, 'No se pudo confirmar el pago');
  }
});

// Portal de cliente de Stripe: gestionar/cancelar suscripciones, facturas.
router.post('/stripe/portal', requireAuth, async (req, res) => {
  try {
    const stripe = stripeClient.getStripe();
    const customer = await ensureStripeCustomer(stripe, req.user);
    const portal = await stripe.billingPortal.sessions.create({
      customer, return_url: `${appBaseUrl()}/wallet`,
    });
    res.json({ url: portal.url });
  } catch (err) {
    sendError(res, err, 'No se pudo abrir la gestión de suscripciones');
  }
});

// Montado en index.js ANTES de express.json() (necesita el body crudo para
// verificar la firma).
async function stripeWebhookHandler(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !stripeClient.isConfigured()) return res.status(503).send('stripe not configured');
  let event;
  try {
    event = stripeClient.getStripe().webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch (err) {
    console.warn('[payments] stripe webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  try {
    await billing.handleStripeEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('[payments] stripe webhook handler error:', event.type, err);
    // 500 => Stripe reintenta más tarde (todo es idempotente).
    res.status(500).send('handler error');
  }
}

// ── Google Play (app Android) ──────────────────────────────────────────────
router.post('/play/verify', requireAuth, async (req, res) => {
  try {
    const result = await billing.verifyPlayPurchase({
      userId: req.user.id,
      productId: req.body?.product_id,
      purchaseToken: req.body?.purchase_token,
    });
    res.json(result);
  } catch (err) {
    sendError(res, err, 'No se pudo verificar la compra');
  }
});

module.exports = router;
module.exports.stripeWebhookHandler = stripeWebhookHandler;
