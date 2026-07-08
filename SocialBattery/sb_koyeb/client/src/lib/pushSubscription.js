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

  if (!sub) {
    const vapidPublicKey = await getVapidPublicKey();
    if (!vapidPublicKey) return false;

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

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)));
}
