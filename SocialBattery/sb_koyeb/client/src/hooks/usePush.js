import { useState, useEffect } from 'react';
import { ensurePushSubscription } from '../lib/pushSubscription';

export function usePush() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [subscribed, setSubscribed] = useState(false);

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
    if (result !== 'granted') return false;
    return subscribe();
  };

  const subscribe = async () => {
    try {
      const ok = await ensurePushSubscription();
      setSubscribed(ok);
      return ok;
    } catch (e) {
      console.warn('Push subscribe failed:', e);
      return false;
    }
  };

  return { permission, subscribed, requestPermission };
}
