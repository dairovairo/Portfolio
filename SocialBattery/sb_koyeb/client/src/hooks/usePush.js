import { useState, useEffect } from 'react';
import { api } from '../lib/api';

/**
 * usePush
 *
 * Gestiona el ciclo completo de Web Push:
 *   1. Solicita permiso de notificaciones al usuario.
 *   2. Obtiene la clave pública VAPID del servidor.
 *   3. Crea la suscripción PushManager con esa clave.
 *   4. Envía el endpoint al backend para que pueda mandar pushes.
 *
 * La clave pública se pide al servidor (/api/groups/vapid-public-key) para que
 * el cliente no tenga que tener la clave hardcodeada ni en variables de entorno.
 */
export function usePush() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [subscribed, setSubscribed] = useState(false);

  // Comprobar si ya hay suscripción activa al montar
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
      // 1. Obtener la clave pública VAPID del servidor
      const { key: vapidPublicKey } = await api.get('/groups/vapid-public-key');
      if (!vapidPublicKey) {
        console.warn('[usePush] VAPID public key not available from server');
        return;
      }

      // 2. Crear la suscripción con la clave real
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      // 3. Guardar en el backend
      const json = sub.toJSON();
      await api.post('/users/push-subscribe', {
        endpoint: json.endpoint,
        p256dh:   json.keys?.p256dh,
        auth:     json.keys?.auth,
      }).catch(() => {}); // Non-fatal

      setSubscribed(true);
    } catch (e) {
      console.warn('[usePush] subscribe failed:', e);
    }
  };

  return { permission, subscribed, requestPermission };
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)));
}
