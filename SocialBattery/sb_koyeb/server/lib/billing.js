// ─────────────────────────────────────────────────────────────────────────
// Lógica de cumplimiento de pagos (compartida por rutas, webhook y cron).
// ─────────────────────────────────────────────────────────────────────────
const supabase = require('./supabase');
const { findProduct, SUBSCRIPTIONS } = require('./billingCatalog');
const play = require('./googlePlay');
const { getStripe } = require('./stripeClient');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

// Acredita un producto de compra única (recarga de saldo o pack de Volts).
// Idempotente por (provider, providerRef).
async function creditOneTimeProduct({ userId, provider, providerRef, product, raw }) {
  if (product.kind === 'wallet_topup') {
    return rpc('wallet_topup', {
      p_user: userId, p_provider: provider, p_ref: providerRef, p_product: product.id,
      p_amount: product.amountCents, p_currency: 'eur', p_raw: raw || null,
    });
  }
  if (product.kind === 'volts') {
    return rpc('volts_purchase', {
      p_user: userId, p_provider: provider, p_ref: providerRef, p_product: product.id,
      p_volts: product.volts, p_amount: product.amountCents, p_raw: raw || null,
    });
  }
  throw httpError(400, 'Producto no válido para compra única');
}

// ── Suscripciones ─────────────────────────────────────────────────────────

function isSubscriptionActive(sub, now = Date.now()) {
  const notExpired = !sub.current_period_end || new Date(sub.current_period_end).getTime() > now;
  if (sub.provider === 'stripe') {
    return ['active', 'trialing', 'past_due'].includes(sub.status) && notExpired;
  }
  // Play: "canceled" = no se renovará, pero está pagada hasta expiryTime.
  return ['active', 'in_grace', 'canceled'].includes(sub.status) && notExpired;
}

// Recalcula users.is_volt_subscriber / is_enterprise a partir de la tabla
// subscriptions. Solo se llama para usuarios que tienen alguna fila (para
// no pisar flags puestos a mano por un admin a usuarios sin suscripción).
async function recomputeEntitlements(userId) {
  const { data: subs, error } = await supabase
    .from('subscriptions')
    .select('provider, product_id, status, current_period_end')
    .eq('user_id', userId);
  if (error) throw error;
  const active = new Set((subs || []).filter(s => isSubscriptionActive(s)).map(s => s.product_id));
  const update = {};
  for (const [productId, meta] of Object.entries(SUBSCRIPTIONS)) {
    update[meta.flag] = active.has(productId);
  }
  const { error: upErr } = await supabase.from('users').update(update).eq('id', userId);
  if (upErr) throw upErr;
  return update;
}

async function upsertSubscription(row) {
  const { error } = await supabase
    .from('subscriptions')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'provider,provider_ref' });
  if (error) throw error;
  await recomputeEntitlements(row.user_id);
}

// ── Google Play ───────────────────────────────────────────────────────────

async function verifyPlayPurchase({ userId, productId, purchaseToken }) {
  const product = findProduct(productId);
  if (!product) throw httpError(400, 'Producto desconocido');
  if (!purchaseToken || typeof purchaseToken !== 'string') throw httpError(400, 'Falta purchaseToken');

  if (product.kind === 'subscription') {
    const sub = await play.getSubscription(purchaseToken);
    const line = (sub.lineItems || []).find(l => l.productId === productId) || (sub.lineItems || [])[0];
    if (!line || line.productId !== productId) throw httpError(400, 'La suscripción no corresponde a este producto');
    const owner = sub.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    if (owner && owner !== userId) throw httpError(403, 'Esta suscripción pertenece a otra cuenta');

    const status = play.normalizeSubState(sub.subscriptionState);
    if (status === 'pending') throw httpError(409, 'El pago de la suscripción está pendiente');

    if (sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING' && status !== 'expired') {
      try { await play.acknowledgeSubscription(productId, purchaseToken); }
      catch (err) { console.warn('[billing] play acknowledge failed:', err.message); }
    }

    // Upgrade/downgrade o re-suscripción: el token anterior deja de valer.
    if (sub.linkedPurchaseToken) {
      await supabase.from('subscriptions')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('provider', 'google_play').eq('provider_ref', sub.linkedPurchaseToken);
    }

    await upsertSubscription({
      user_id: userId,
      provider: 'google_play',
      provider_ref: purchaseToken,
      product_id: productId,
      status,
      current_period_end: line.expiryTime || null,
      auto_renew: Boolean(line.autoRenewingPlan?.autoRenewEnabled),
      raw: sub,
    });
    return { kind: 'subscription', product_id: productId, status };
  }

  const purchase = await play.getProductPurchase(productId, purchaseToken);
  if (purchase.purchaseState === 2) throw httpError(409, 'El pago está pendiente; se acreditará cuando Google lo confirme');
  if (purchase.purchaseState !== 0) throw httpError(400, 'La compra está cancelada o reembolsada');
  if (purchase.obfuscatedExternalAccountId && purchase.obfuscatedExternalAccountId !== userId) {
    throw httpError(403, 'Esta compra pertenece a otra cuenta');
  }

  const result = await creditOneTimeProduct({
    userId, provider: 'google_play', providerRef: purchaseToken, product,
    raw: { orderId: purchase.orderId, purchaseTimeMillis: purchase.purchaseTimeMillis, purchaseType: purchase.purchaseType ?? null, regionCode: purchase.regionCode },
  });

  // Consumir para que se pueda volver a comprar el mismo pack. Si falla no
  // pasa nada: el crédito ya es idempotente y la app reintenta al abrir.
  if (purchase.consumptionState !== 1) {
    try { await play.consumeProductPurchase(productId, purchaseToken); }
    catch (err) { console.warn('[billing] play consume failed:', err.message); }
  }
  return { kind: product.kind, product_id: productId, ...result };
}

// Re-consulta a Google las suscripciones de Play que caducan pronto (o ya
// han caducado) para recoger renovaciones, cancelaciones e impagos.
async function refreshPlaySubscriptions() {
  if (!play.isConfigured()) return;
  const soon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('subscriptions')
    .select('user_id, provider_ref, product_id, status')
    .eq('provider', 'google_play')
    .neq('status', 'expired')
    .lt('current_period_end', soon)
    .limit(200);
  if (error) { console.warn('[billing] refreshPlaySubscriptions query:', error.message); return; }
  for (const s of data || []) {
    try {
      await verifyPlayPurchase({ userId: s.user_id, productId: s.product_id, purchaseToken: s.provider_ref });
    } catch (err) {
      console.warn(`[billing] refresh play sub ${s.provider_ref.slice(0, 12)}…:`, err.message);
      if (err.playStatus === 410 || err.playStatus === 404) {
        await supabase.from('subscriptions').update({ status: 'expired' })
          .eq('provider', 'google_play').eq('provider_ref', s.provider_ref);
        await recomputeEntitlements(s.user_id).catch(() => {});
      }
    }
  }
}

// Red de seguridad para Stripe (si se pierde un webhook): quien tenga una
// suscripción ya vencida se recalcula.
async function expireLapsedSubscriptions() {
  const now = new Date().toISOString();
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('subscriptions').select('user_id')
    .lt('current_period_end', now).gt('current_period_end', since);
  if (error) return;
  const ids = [...new Set((data || []).map(r => r.user_id))];
  for (const id of ids) await recomputeEntitlements(id).catch(() => {});
}

// ── Stripe ────────────────────────────────────────────────────────────────

function stripePeriodEnd(sub) {
  const ts = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return ts ? new Date(ts * 1000).toISOString() : null;
}

async function syncStripeSubscription(sub, fallbackUserId, fallbackProductId) {
  const userId = sub.metadata?.user_id || fallbackUserId;
  const productId = sub.metadata?.product_id || fallbackProductId;
  if (!userId || !SUBSCRIPTIONS[productId]) {
    console.warn('[billing] stripe subscription without user/product metadata:', sub.id);
    return;
  }
  await upsertSubscription({
    user_id: userId,
    provider: 'stripe',
    provider_ref: sub.id,
    product_id: productId,
    status: sub.status,
    current_period_end: stripePeriodEnd(sub),
    auto_renew: !sub.cancel_at_period_end,
    raw: { id: sub.id, status: sub.status, cancel_at_period_end: sub.cancel_at_period_end, customer: sub.customer },
  });
}

async function fulfillCheckoutSession(session) {
  const userId = session.metadata?.user_id || session.client_reference_id;
  const product = findProduct(session.metadata?.product_id);
  if (!userId || !product) {
    console.warn('[billing] checkout session without user/product:', session.id);
    return { fulfilled: false };
  }
  if (session.mode === 'subscription') {
    if (!session.subscription) return { fulfilled: false };
    const sub = typeof session.subscription === 'string'
      ? await getStripe().subscriptions.retrieve(session.subscription)
      : session.subscription;
    await syncStripeSubscription(sub, userId, product.id);
    return { fulfilled: true, kind: 'subscription' };
  }
  if (session.payment_status !== 'paid') return { fulfilled: false, pending: true };
  const ref = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || session.id;
  const result = await creditOneTimeProduct({
    userId, provider: 'stripe', providerRef: ref, product,
    raw: { session_id: session.id, amount_total: session.amount_total, currency: session.currency },
  });
  return { fulfilled: true, kind: product.kind, ...result };
}

async function handleStripeRefund(charge) {
  const ref = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!ref) return;
  const { data: payment } = await supabase
    .from('payments').select('id, user_id, kind, amount_cents, status, product_id')
    .eq('provider', 'stripe').eq('provider_ref', ref).maybeSingle();
  if (!payment || payment.status === 'refunded' || !payment.user_id) return;
  await supabase.from('payments').update({ status: 'refunded' }).eq('id', payment.id);
  if (payment.kind === 'wallet_topup') {
    const refunded = Math.min(Number(charge.amount_refunded || payment.amount_cents), payment.amount_cents);
    await rpc('wallet_adjust', { p_user: payment.user_id, p_amount: -refunded, p_description: 'Reembolso de recarga (Stripe)' });
  } else if (payment.kind === 'volts') {
    const product = findProduct(payment.product_id);
    if (product?.volts) {
      // Si ya se los ha gastado, se queda a 0 (no se puede ir a negativo).
      const { data: v } = await supabase.from('user_volts').select('balance').eq('user_id', payment.user_id).maybeSingle();
      const take = Math.min(product.volts, Number(v?.balance || 0));
      if (take > 0) await rpc('volts_add', { p_user: payment.user_id, p_delta: -take });
    }
  }
}

async function handleStripeEvent(event) {
  const obj = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await fulfillCheckoutSession(obj);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncStripeSubscription(obj);
      break;
    case 'invoice.paid': {
      const subId = typeof obj.subscription === 'string' ? obj.subscription
        : obj.parent?.subscription_details?.subscription || null;
      if (subId) {
        const sub = await getStripe().subscriptions.retrieve(subId);
        await syncStripeSubscription(sub);
        if (sub.metadata?.user_id && obj.amount_paid > 0) {
          await supabase.from('payments').upsert({
            user_id: sub.metadata.user_id, provider: 'stripe', provider_ref: obj.id,
            product_id: sub.metadata.product_id || 'subscription', kind: 'subscription',
            amount_cents: obj.amount_paid, currency: obj.currency || 'eur',
          }, { onConflict: 'provider,provider_ref', ignoreDuplicates: true });
        }
      }
      break;
    }
    case 'charge.refunded':
      await handleStripeRefund(obj);
      break;
    default:
      break;
  }
}

module.exports = {
  httpError,
  creditOneTimeProduct,
  isSubscriptionActive,
  recomputeEntitlements,
  verifyPlayPurchase,
  refreshPlaySubscriptions,
  expireLapsedSubscriptions,
  fulfillCheckoutSession,
  handleStripeEvent,
};
