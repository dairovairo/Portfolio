import { api } from './api';

const EMBEDDED_VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
let runtimeVapidPublicKeyPromise = null;

async function getVapidPublicKey() {
  if (isUsableVapidKey(EMBEDDED_VAPID_PUBLIC_KEY)) return EMBEDDED_VAPID_PUBLIC_KEY;

  if (!runtimeVapidPublicKeyPromise) {
    runtimeVapidPublicKeyPromise = api.get('/users/push-config')
      .then(data => {
        if (isUsableVapidKey(data?.vapidPublicKey)) return data.vapidPublicKey;
        console.warn('[pushSubscription] VAPID_PUBLIC_KEY no esta configurada en el backend — push desactivado.');
        return null;
      })
      .catch(err => {
        console.warn('[pushSubscription] No se pudo obtener la VAPID public key del backend:', err.message);
        return null;
      });
  }

  return runtimeVapidPublicKeyPromise;
}

function isUsableVapidKey(key) {
  return Boolean(key && key !== 'your_vapid_public_key_here');
}

export async function ensurePushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();

  const vapidPublicKey = await getVapidPublicKey();
  if (!vapidPublicKey) return false;

  // Si ya existe una suscripcion en el navegador, comprobamos que este "pinneada"
  // a la MISMA clave publica VAPID que el backend esta usando ahora mismo. El
  // Push API vincula criptograficamente cada suscripcion a la applicationServerKey
  // con la que se creo: si el servidor firma despues con un par de claves VAPID
  // distinto (p. ej. porque antes no habia claves reales, o se regeneraron), el
  // servicio push (FCM/Mozilla) rechaza el envio en silencio (401/403), sin que
  // el navegador marque la suscripcion como caducada (eso solo pasa con 410/404).
  // Por eso no basta con reutilizar `sub` tal cual: hay que detectar el
  // desajuste de clave aqui y forzar un unsubscribe + resubscribe con la clave
  // correcta, o la suscripcion seguira "viva" pero nunca recibira nada.
  if (sub) {
    const currentKey = sub.options?.applicationServerKey
      ? arrayBufferToBase64Url(sub.options.applicationServerKey)
      : null;
    const keyMatches = currentKey && currentKey === stripPadding(vapidPublicKey);

    if (!keyMatches) {
      console.warn('[pushSubscription] La suscripcion existente no coincide con la VAPID public key actual del backend — renovando suscripcion.');
      try {
        await sub.unsubscribe();
      } catch (err) {
        console.warn('[pushSubscription] No se pudo desuscribir la suscripcion antigua:', err.message);
      }
      sub = null;
    }
  }

  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  await api.post('/users/push-subscribe', {
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  });

  console.info('[pushSubscription] Suscripcion push registrada en el backend.');
  return true;
}

function stripPadding(base64urlString) {
  return base64urlString.replace(/=+$/, '');
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)));
}

// Inversa de urlBase64ToUint8Array: convierte el ArrayBuffer que el navegador
// guarda como applicationServerKey de vuelta a base64url para poder comparar
// contra la VAPID public key (string base64url) que entrega el backend.
function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
