import { useState, useEffect } from 'react';
import { api } from '../lib/api';

// La applicationServerKey debe coincidir con VAPID_PUBLIC_KEY del server.
// Configúrala en client/.env como VITE_VAPID_PUBLIC_KEY.
const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY ||
  // Clave de demo — reemplazar con la real si no se usa la variable de entorno
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

export function usePush() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [subscribed, setSubscribed] = useState(false);

  // Check if SW is ready and we already have a subscription
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    navigator.serviceWorker.ready.then(reg => {
      reg.pushManager.getSubscription().then(sub => {
        setSubscribed(!!sub);
      });
    });
  }, []);

  const requestPermission = async () => {
    if (!('Notification' in window)) return false;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      await subscribe();
      return true;
    }
    return false;
  };

  const subscribe = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const json = sub.toJSON();
      await api.post('/users/push-subscribe', {
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
      }).catch(() => {}); // Non-fatal
      setSubscribed(true);
    } catch (e) {
      console.warn('Push subscribe failed:', e);
    }
  };

  return { permission, subscribed, requestPermission };
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)));
}
