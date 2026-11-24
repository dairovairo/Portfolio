// ─────────────────────────────────────────────────────────────────────────
// Aportaciones a comunidades (Stripe Connect)
// ─────────────────────────────────────────────────────────────────────────
// El dinero va directamente a la cuenta de Stripe (Standard) del creador de
// la comunidad: cargos directos y sin comisión de SocialBattery. Aportar es
// voluntario y no da nada a cambio (ni contenido, ni papeletas).
//
// Cada cobro se registra una sola vez por payment_ref (PaymentIntent), tanto
// si llega por el webhook como al volver el navegador de Checkout.

const supabase = require('./supabase');
const { getStripe, isConfigured } = require('./stripeClient');
const { paymentsEnabled } = require('./wallet');

const MIN_AMOUNT_CENTS = 99; // CHECK de community_collaborations

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function getAccountRow(userId) {
  const { data, error } = await supabase
    .from('creator_payout_accounts').select('user_id, stripe_account_id, charges_enabled')
    .eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function saveChargesEnabled(accountId, enabled) {
  const { error } = await supabase
    .from('creator_payout_accounts')
    .update({ charges_enabled: enabled, updated_at: new Date().toISOString() })
    .eq('stripe_account_id', accountId);
  if (error) throw error;
}

async function canReceivePayments(userId) {
  if (!paymentsEnabled() || !isConfigured()) return false;
  return Boolean((await getAccountRow(userId))?.charges_enabled);
}

/** Estado de la cuenta, consultado a Stripe. */
async function getStatus(userId) {
  const available = paymentsEnabled() && isConfigured();
  const row = available ? await getAccountRow(userId) : null;
  if (!row) return { available, connected: false, charges_enabled: false };
  const account = await getStripe().accounts.retrieve(row.stripe_account_id);
  if (Boolean(account.charges_enabled) !== row.charges_enabled) {
    await saveChargesEnabled(row.stripe_account_id, Boolean(account.charges_enabled));
  }
  return { available, connected: true, charges_enabled: Boolean(account.charges_enabled) };
}

/** Enlace de Stripe para crear o completar la cuenta. */
async function startOnboarding(userId, returnUrl) {
  if (!paymentsEnabled()) throw httpError(503, 'Los pagos todavía no están activados');
  const stripe = getStripe();
  let accountId = (await getAccountRow(userId))?.stripe_account_id;
  if (!accountId) {
    const account = await stripe.accounts.create({ type: 'standard', metadata: { user_id: userId } });
    const { error } = await supabase.from('creator_payout_accounts').upsert(
      { user_id: userId, stripe_account_id: account.id }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (error) throw error;
    accountId = (await getAccountRow(userId)).stripe_account_id;
  }
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: `${returnUrl}?connect=retry`,
    return_url: `${returnUrl}?connect=done`,
  });
  return link.url;
}

/** Sesión de Checkout en la cuenta del creador. */
async function createCollaboration({ community, userId, baseUrl }) {
  if (!paymentsEnabled()) throw httpError(503, 'Las aportaciones todavía no están disponibles');
  const row = await getAccountRow(community.creator_id);
  if (!row?.charges_enabled) throw httpError(400, 'Esta comunidad todavía no puede recibir aportaciones');

  const metadata = { kind: 'collaboration', community_id: community.id, user_id: userId };
  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    locale: 'auto',
    client_reference_id: userId,
    metadata,
    payment_intent_data: { metadata },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: community.collab_amount_cents,
        product_data: { name: `Aportación voluntaria a ${community.name}` },
      },
    }],
    success_url: `${baseUrl}/community/${community.id}?collab=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/community/${community.id}?collab=cancel`,
  }, { stripeAccount: row.stripe_account_id });
  return session.url;
}

/**
 * Registra una aportación pagada. `accountId` es la cuenta donde se ha
 * cobrado: tiene que ser la del creador de esa comunidad.
 */
async function recordCollaboration(session, accountId) {
  const meta = session.metadata || {};
  if (meta.kind !== 'collaboration' || session.payment_status !== 'paid') return { recorded: false };
  const ref = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (!ref || !meta.community_id || !meta.user_id) return { recorded: false };

  const { data: community, error } = await supabase
    .from('communities').select('id, creator_id').eq('id', meta.community_id).maybeSingle();
  if (error) throw error;
  if (!community) return { recorded: false };
  const row = await getAccountRow(community.creator_id);
  if (row?.stripe_account_id !== accountId) {
    console.warn(`[connect] aportación ${ref} ignorada: la cuenta no es la del creador`);
    return { recorded: false };
  }

  const { error: insertError } = await supabase.from('community_collaborations').upsert({
    community_id: community.id,
    user_id: meta.user_id,
    amount_cents: session.amount_total,
    status: 'paid',
    payment_ref: ref,
    stripe_account_id: accountId,
  }, { onConflict: 'payment_ref', ignoreDuplicates: true });
  if (insertError) throw insertError;
  return { recorded: true };
}

/** Confirmación al volver de Checkout (redundante con el webhook). */
async function confirmCollaboration({ community, userId, sessionId }) {
  const row = await getAccountRow(community.creator_id);
  if (!row) throw httpError(404, 'Aportación no encontrada');
  const session = await getStripe().checkout.sessions.retrieve(
    sessionId, {}, { stripeAccount: row.stripe_account_id });
  if (session.metadata?.user_id !== userId || session.metadata?.community_id !== community.id) {
    throw httpError(403, 'Esta sesión de pago no es tuya');
  }
  return recordCollaboration(session, row.stripe_account_id);
}

async function applyRefund(charge, accountId) {
  const ref = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!ref) return;
  const left = charge.amount - (charge.amount_refunded || 0);
  const { error } = await supabase
    .from('community_collaborations')
    .update(left >= MIN_AMOUNT_CENTS ? { amount_cents: left } : { status: 'refunded' })
    .eq('payment_ref', ref).eq('stripe_account_id', accountId);
  if (error) throw error;
}

/**
 * Eventos de las cuentas conectadas (event.account). Estas cuentas las
 * controlan sus dueños, así que aquí NUNCA se acredita saldo, Volts ni
 * suscripciones: solo aportaciones.
 */
async function handleConnectEvent(event) {
  const object = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await recordCollaboration(object, event.account);
      break;
    case 'charge.refunded':
      await applyRefund(object, event.account);
      break;
    case 'account.updated':
      await saveChargesEnabled(event.account, Boolean(object.charges_enabled));
      break;
    case 'account.application.deauthorized':
      await saveChargesEnabled(event.account, false);
      break;
    default:
  }
}

module.exports = {
  canReceivePayments,
  getStatus,
  startOnboarding,
  createCollaboration,
  confirmCollaboration,
  recordCollaboration,
  handleConnectEvent,
};
