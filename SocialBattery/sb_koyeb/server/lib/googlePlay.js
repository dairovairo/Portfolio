// ─────────────────────────────────────────────────────────────────────────
// Verificación de compras de Google Play (Google Play Developer API v3).
// ─────────────────────────────────────────────────────────────────────────
// Nunca se acredita nada con lo que diga el cliente: la app manda el
// purchaseToken y aquí se le pregunta a Google si esa compra existe, es de
// este paquete y de este producto, y está pagada.
//
// Credenciales: una cuenta de servicio de Google Cloud invitada en Play
// Console (Usuarios y permisos → "Ver datos financieros" + "Gestionar
// pedidos y suscripciones"), con la "Google Play Android Developer API"
// habilitada en su proyecto de Cloud. Se puede reutilizar la de Firebase:
//   GOOGLE_PLAY_CLIENT_EMAIL / GOOGLE_PLAY_PRIVATE_KEY
//   (si faltan, se usan FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY)
//   GOOGLE_PLAY_PACKAGE_NAME (por defecto com.socialbattery.app)

const { GoogleAuth } = require('google-auth-library');
const { normalizePrivateKey } = require('./serviceAccountKey');

const PACKAGE_NAME = process.env.GOOGLE_PLAY_PACKAGE_NAME || 'com.socialbattery.app';
const BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';

let authClientPromise = null;

function isConfigured() {
  return Boolean(
    (process.env.GOOGLE_PLAY_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL) &&
    (process.env.GOOGLE_PLAY_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY)
  );
}

function getClient() {
  if (!authClientPromise) {
    const clientEmail = process.env.GOOGLE_PLAY_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = normalizePrivateKey(process.env.GOOGLE_PLAY_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY);
    const auth = new GoogleAuth({
      credentials: { client_email: clientEmail, private_key: privateKey },
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    authClientPromise = auth.getClient();
  }
  return authClientPromise;
}

async function call(method, path, data) {
  if (!isConfigured()) {
    const e = new Error('Google Play no está configurado en el servidor');
    e.status = 503;
    throw e;
  }
  const client = await getClient();
  try {
    const res = await client.request({ url: `${BASE}/${PACKAGE_NAME}${path}`, method, data });
    return res.data;
  } catch (err) {
    const status = err?.response?.status;
    const detail = err?.response?.data?.error?.message || err.message;
    const e = new Error(`Google Play API ${status || ''}: ${detail}`);
    e.status = status === 404 || status === 400 || status === 410 ? 400 : 502;
    e.playStatus = status;
    throw e;
  }
}

const enc = encodeURIComponent;

// Compra única (consumible). purchaseState: 0 comprado, 1 cancelado, 2 pendiente.
async function getProductPurchase(productId, purchaseToken) {
  return call('GET', `/purchases/products/${enc(productId)}/tokens/${enc(purchaseToken)}`);
}

// Consumir = marcar como entregado (también cuenta como acknowledge) y
// permitir volver a comprar el mismo pack.
async function consumeProductPurchase(productId, purchaseToken) {
  return call('POST', `/purchases/products/${enc(productId)}/tokens/${enc(purchaseToken)}:consume`);
}

async function getSubscription(purchaseToken) {
  return call('GET', `/purchases/subscriptionsv2/tokens/${enc(purchaseToken)}`);
}

async function acknowledgeSubscription(productId, purchaseToken) {
  return call('POST', `/purchases/subscriptions/${enc(productId)}/tokens/${enc(purchaseToken)}:acknowledge`, {});
}

// SUBSCRIPTION_STATE_* → estado normalizado para la tabla subscriptions.
function normalizeSubState(state) {
  switch (state) {
    case 'SUBSCRIPTION_STATE_ACTIVE': return 'active';
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD': return 'in_grace';
    case 'SUBSCRIPTION_STATE_ON_HOLD': return 'on_hold';
    case 'SUBSCRIPTION_STATE_PAUSED': return 'paused';
    case 'SUBSCRIPTION_STATE_CANCELED': return 'canceled'; // cancelada pero pagada hasta expiryTime
    case 'SUBSCRIPTION_STATE_EXPIRED': return 'expired';
    case 'SUBSCRIPTION_STATE_PENDING': return 'pending';
    default: return 'unknown';
  }
}

module.exports = {
  PACKAGE_NAME,
  isConfigured,
  getProductPurchase,
  consumeProductPurchase,
  getSubscription,
  acknowledgeSubscription,
  normalizeSubState,
};
