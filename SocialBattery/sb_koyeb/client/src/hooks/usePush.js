import { useState, useEffect } from 'react';
import { ensurePushSubscription } from '../lib/pushSubscription';
import { isNativeApp, getNativePermissionStatus } from '../lib/nativePush';

export function usePush() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (isNativeApp()) {
        const status = await getNativePermissionStatus();
        if (!cancelled) {
          setPermission(status);
          setSubscribed(status === 'granted');
        }
        return;
      }

      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setSubscribed(!!sub);
      } catch {}
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const requestPermission = async () => {
    if (isNativeApp()) {
      const ok = await ensurePushSubscription();
      const status = await getNativePermissionStatus();
      setPermission(status);
      setSubscribed(ok);
      return ok;
    }

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
