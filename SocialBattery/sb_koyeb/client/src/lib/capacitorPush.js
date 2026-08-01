import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { api } from './api';

// This module is the native counterpart to pushSubscription.js (Web Push):
// it only does anything inside the Capacitor-wrapped Android/iOS app (see
// mobile/), where FCM is what reaches the app when it's backgrounded or
// fully closed — the browser Push API used by pushSubscription.js/sw.js is
// not reliably delivered in the background by Android's WebView.

let initialized = false;

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

/**
 * Requests notification permission, registers the device with FCM, and
 * sends the resulting token to the server. Safe to call multiple times —
 * only runs once per app session. No-op outside the native app.
 */
export async function initCapacitorPush() {
  if (!isNativeApp() || initialized) return;
  initialized = true;

  PushNotifications.addListener('registration', token => {
    api.post('/users/fcm-register', { token: token.value, platform: Capacitor.getPlatform() })
      .catch(e => console.warn('[capacitorPush] fcm-register failed:', e));
  });

  PushNotifications.addListener('registrationError', err => {
    console.warn('[capacitorPush] registration error:', err);
  });

  // Notification tapped (app backgrounded or closed) — tell the app to
  // navigate, mirroring the 'sb-notification-click' postMessage that sw.js
  // sends for Web Push (see App.jsx).
  PushNotifications.addListener('pushNotificationActionPerformed', action => {
    const url = action.notification?.data?.url;
    if (url) {
      window.dispatchEvent(new CustomEvent('sb-notification-click', { detail: { url } }));
    }
  });

  try {
    // Android 8+ silently drops any notification whose channelId doesn't
    // exist — the server (server/lib/fcm.js) always sends channelId
    // 'default', so that channel has to exist before the first message
    // arrives. No-op on iOS (channels are an Android-only concept).
    if (Capacitor.getPlatform() === 'android') {
      await PushNotifications.createChannel({
        id: 'default',
        name: 'General',
        description: 'Recordatorios de quedadas, eventos y mensajes',
        importance: 5,
        visibility: 1,
        vibration: true,
      }).catch(e => console.warn('[capacitorPush] createChannel failed:', e));
    }

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return;

    await PushNotifications.register();
  } catch (e) {
    console.warn('[capacitorPush] permission/register failed:', e);
  }
}
