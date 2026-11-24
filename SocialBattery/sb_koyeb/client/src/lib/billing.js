// ─────────────────────────────────────────────────────────────────────────
// Compras: Stripe Checkout en la web, Google Play Billing en la app Android.
// ─────────────────────────────────────────────────────────────────────────
// Google Play exige su propio sistema de cobro para bienes digitales dentro
// de una app (saldo publicitario, Volts, suscripciones), así que en la app
// nativa NUNCA se abre Stripe. En ambos casos el servidor verifica el pago
// con el proveedor antes de acreditar nada.
//
// OJO (ver nativePush.js): los plugins de Capacitor son Proxies "thenables";
// nunca se devuelven directamente desde una función async — siempre dentro
// de un objeto.

import { api } from './api';
import { isNativeApp } from './nativePush';
import { PAYMENTS_ENABLED } from './features';

export const PLAY_BASE_PLAN_ID = 'monthly';
const SUBSCRIPTION_IDS = new Set(['sub_volt', 'sub_enterprise']);

let pluginPromise = null;
function loadPlugin() {
  if (!pluginPromise) {
    pluginPromise = import('@capgo/native-purchases')
      .then((m) => ({ NativePurchases: m.NativePurchases, PURCHASE_TYPE: m.PURCHASE_TYPE }))
      .catch((err) => {
        pluginPromise = null;
        throw err;
      });
  }
  return pluginPromise;
}

export function formatEuros(cents, lang = 'es') {
  const tag = lang === 'en' ? 'en-IE' : lang === 'fr' ? 'fr-FR' : 'es-ES';
  return new Intl.NumberFormat(tag, { style: 'currency', currency: 'EUR' }).format((Number(cents) || 0) / 100);
}

// Precios locales de Play (p.ej. "9,99 €" o "$10.99"). Devuelve {} en web o
// si Play no responde — la UI cae entonces al precio en euros del catálogo.
export async function getStorePrices(productIds) {
  if (!PAYMENTS_ENABLED || !isNativeApp() || !productIds?.length) return {};
  try {
    const { NativePurchases, PURCHASE_TYPE } = await loadPlugin();
    const subs = productIds.filter((id) => SUBSCRIPTION_IDS.has(id));
    const inapp = productIds.filter((id) => !SUBSCRIPTION_IDS.has(id));
    const out = {};
    if (inapp.length) {
      const { products } = await NativePurchases.getProducts({ productIdentifiers: inapp, productType: PURCHASE_TYPE.INAPP });
      for (const p of products || []) out[p.identifier] = p.priceString;
    }
    if (subs.length) {
      const { products } = await NativePurchases.getProducts({ productIdentifiers: subs, productType: PURCHASE_TYPE.SUBS });
      for (const p of products || []) out[p.planIdentifier || p.identifier] = p.priceString;
    }
    return out;
  } catch (err) {
    console.warn('[billing] getStorePrices failed:', err?.message || err);
    return {};
  }
}

async function purchaseWithPlay(productId, userId) {
  const { NativePurchases, PURCHASE_TYPE } = await loadPlugin();
  const isSub = SUBSCRIPTION_IDS.has(productId);
  const tx = await NativePurchases.purchaseProduct({
    productIdentifier: productId,
    productType: isSub ? PURCHASE_TYPE.SUBS : PURCHASE_TYPE.INAPP,
    ...(isSub ? { planIdentifier: PLAY_BASE_PLAN_ID } : {}),
    // Liga la compra a la cuenta (Play la devuelve como obfuscatedAccountId
    // y el servidor comprueba que coincide). Es un UUID interno, no PII.
    appAccountToken: userId,
    // El servidor consume la compra DESPUÉS de acreditarla. Si la consumiera
    // el plugin antes y la verificación fallase, el pago se perdería.
    isConsumable: false,
  });
  const token = tx?.purchaseToken || tx?.transactionId;
  if (!token) throw new Error('Google Play no devolvió el comprobante de la compra');
  return api.post('/payments/play/verify', { product_id: productId, purchase_token: token });
}

// Punto de entrada único. En web redirige a Stripe (no vuelve); en la app
// resuelve con el resultado de la verificación del servidor.
export async function startPurchase(productId, { userId, returnPath = '/wallet' } = {}) {
  if (isNativeApp()) {
    return purchaseWithPlay(productId, userId);
  }
  const { url } = await api.post('/payments/stripe/checkout', { product_id: productId, return_path: returnPath });
  window.location.assign(url);
  return new Promise(() => {}); // la página se va a Stripe
}

// Compras de Play que se pagaron pero no llegaron a verificarse (app cerrada
// a mitad, sin red...). Play las sigue listando hasta que se consumen, así
// que al abrir el monedero/tienda se reenvían al servidor (idempotente).
export async function recoverPendingPlayPurchases() {
  if (!PAYMENTS_ENABLED || !isNativeApp()) return 0;
  try {
    const { NativePurchases, PURCHASE_TYPE } = await loadPlugin();
    let recovered = 0;
    for (const type of [PURCHASE_TYPE.INAPP, PURCHASE_TYPE.SUBS]) {
      const { purchases } = await NativePurchases.getPurchases({ productType: type });
      for (const p of purchases || []) {
        const token = p.purchaseToken;
        if (!token || !p.productIdentifier) continue;
        try {
          await api.post('/payments/play/verify', { product_id: p.productIdentifier, purchase_token: token });
          recovered++;
        } catch (err) {
          console.warn('[billing] recover failed for', p.productIdentifier, err?.message);
        }
      }
    }
    return recovered;
  } catch (err) {
    console.warn('[billing] recoverPendingPlayPurchases failed:', err?.message || err);
    return 0;
  }
}

// Al volver de Stripe Checkout (?checkout=success&session_id=...) se confirma
// el pago con el servidor para que el saldo aparezca al momento. Devuelve
// 'success' | 'cancel' | null y limpia la URL.
export async function handleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('checkout');
  if (!status) return null;
  const sessionId = params.get('session_id');
  const clean = window.location.pathname;
  window.history.replaceState(null, '', clean);
  if (status === 'success' && sessionId) {
    try { await api.post('/payments/stripe/confirm', { session_id: sessionId }); }
    catch (err) { console.warn('[billing] stripe confirm failed:', err?.message); }
    return 'success';
  }
  return status === 'cancel' ? 'cancel' : null;
}

export async function manageSubscriptions() {
  if (isNativeApp()) {
    const { NativePurchases } = await loadPlugin();
    await NativePurchases.manageSubscriptions();
    return;
  }
  const { url } = await api.post('/payments/stripe/portal', {});
  window.location.assign(url);
}

// Saldo de Volts en servidor. `seed` = saldo que había en localStorage, para
// migrarlo la primera vez (el servidor lo acota).
export async function fetchServerVolts(seed) {
  const q = Number.isFinite(seed) ? `?seed=${Math.max(0, Math.floor(seed))}` : '';
  return api.get(`/payments/volts${q}`);
}

export function spendServerVolts(amount) {
  return api.post('/payments/volts/spend', { amount });
}

export function claimServerDailyVolts(seed) {
  return api.post('/payments/volts/daily', Number.isFinite(seed) ? { seed } : {});
}

export function isInsufficientFunds(err) {
  return err?.code === 'INSUFFICIENT_FUNDS' || err?.status === 402;
}
