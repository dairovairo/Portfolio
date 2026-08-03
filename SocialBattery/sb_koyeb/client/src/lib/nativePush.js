/**
 * nativePush.js — Registro FCM cuando la app corre dentro del WebView de
 * Capacitor (Android/iOS). En navegador web normal es no-op: la lógica de
 * pushSubscription.js sigue usando Web Push (VAPID) como antes.
 *
 * El plugin @capacitor/push-notifications se carga con `import()` dinámico
 * SOLO cuando isNativeApp() es true, así el bundle web normal no arrastra
 * el código del plugin. Este import es necesario porque Capacitor NO
 * rellena window.Capacitor.Plugins.PushNotifications hasta que el JS
 * wrapper llama a registerPlugin('PushNotifications', ...) desde el bundle
 * del cliente — sin este import, checkPermissions/register nunca se
 * ejecutan y fcm_tokens queda vacía aunque el permiso esté concedido.
 */

import { api } from './api';

// Prefijo consistente para grepear en adb logcat: `adb logcat | grep SBFCM`
const LOG = '[SBFCM]';

// Marcador de versión — lo pinchamos en cada beacon para saber si el JS
// corriendo en el móvil es el nuevo o cacheado del anterior deploy.
const JS_BUILD = 'fcm-v3-beacons';

let listenersRegistered = false;
let cachedPlugin = null;

// Guardamos el detalle del último intento para poder mostrarlo en la UI.
let lastResult = { step: 'not-attempted', ok: false };
function record(step, extra = {}) {
  lastResult = { step, at: new Date().toISOString(), ...extra };
  // Fire-and-forget beacon al backend para diagnóstico sin adb.
  try {
    fetch((import.meta.env.VITE_API_URL || '/api') + '/debug/fcm-attempt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step,
        platform: nativePlatform(),
        jsBuild: JS_BUILD,
        ...extra,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
  return lastResult;
}
export function getLastFcmResult() { return lastResult; }

// Boot beacon: en cuanto se importa este módulo desde dentro del wrapper
// nativo, avisa al backend "estoy vivo, este JS está corriendo". Nos dice
// si el móvil ya tiene el bundle nuevo. NO depende de que se ejecute
// ensureNativePush(), así descartamos "el hook no me llama" de las causas.
if (typeof window !== 'undefined') {
  setTimeout(() => {
    try {
      const isNative = isNativeApp();
      if (!isNative) return; // solo desde móvil
      fetch((import.meta.env.VITE_API_URL || '/api') + '/debug/fcm-attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'module-loaded',
          platform: nativePlatform(),
          jsBuild: JS_BUILD,
          hint: 'nativePush.js se ha cargado en el WebView — el bundle es el nuevo.',
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }, 500);
}

/** ¿Estamos dentro del wrapper nativo de Capacitor? */
export function isNativeApp() {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
  if (typeof cap.getPlatform === 'function') return cap.getPlatform() !== 'web';
  return false;
}

/** Plataforma nativa: 'android' | 'ios' | 'web' */
export function nativePlatform() {
  if (typeof window === 'undefined') return 'web';
  const cap = window.Capacitor;
  if (!cap?.getPlatform) return 'web';
  return cap.getPlatform();
}

async function loadPushPlugin() {
  if (cachedPlugin) return cachedPlugin;
  if (!isNativeApp()) {
    console.log(LOG, 'loadPushPlugin skipped: not a native app');
    return null;
  }
  try {
    console.log(LOG, 'loading @capacitor/push-notifications module...');
    const mod = await import('@capacitor/push-notifications');
    cachedPlugin = mod.PushNotifications || null;
    console.log(LOG, 'plugin loaded, has methods:', !!cachedPlugin?.checkPermissions);
    return cachedPlugin;
  } catch (e) {
    console.error(LOG, 'FAILED to load @capacitor/push-notifications:', e?.message || e);
    return null;
  }
}

export async function ensureNativePush() {
  console.log(LOG, 'ensureNativePush() called. isNativeApp=', isNativeApp(), 'platform=', nativePlatform());

  if (!isNativeApp()) { record('not-native'); return false; }

  const PushNotifications = await loadPushPlugin();
  if (!PushNotifications) {
    console.warn(LOG, 'plugin not available, aborting');
    record('plugin-load-failed', { hint: 'Render no ha redeployado el frontend con @capacitor/push-notifications, o el WebView tiene JS cacheado. Borra caché de la app y reabre.' });
    return false;
  }

  try {
    let perm = await PushNotifications.checkPermissions();
    console.log(LOG, 'checkPermissions result:', JSON.stringify(perm));

    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      console.log(LOG, 'requesting permission...');
      perm = await PushNotifications.requestPermissions();
      console.log(LOG, 'requestPermissions result:', JSON.stringify(perm));
    }

    if (perm.receive !== 'granted') {
      console.warn(LOG, 'permission not granted, aborting. state=', perm.receive);
      record('permission-denied', { permission: perm.receive, hint: 'Ajustes de Android → Apps → SocialBattery → Notificaciones → activa.' });
      return false;
    }

    if (!listenersRegistered) {
      listenersRegistered = true;
      console.log(LOG, 'registering event listeners');

      PushNotifications.addListener('registration', async (token) => {
        const preview = String(token?.value || '').slice(0, 20) + '...';
        console.log(LOG, 'REGISTRATION event fired. token=', preview);

        if (!token?.value) {
          console.warn(LOG, 'registration event with empty token, skip');
          record('empty-token');
          return;
        }

        try {
          console.log(LOG, 'POST /users/fcm-register (platform=' + nativePlatform() + ')');
          const res = await api.post('/users/fcm-register', {
            token: token.value,
            platform: nativePlatform(),
          });
          console.log(LOG, 'fcm-register response:', JSON.stringify(res));
          record('registered-ok', { tokenPreview: preview, backendResponse: res });
        } catch (e) {
          console.error(LOG, 'fcm-register FAILED:', e?.message || e);
          record('backend-post-failed', { tokenPreview: preview, error: String(e?.message || e), hint: 'El móvil obtuvo el token FCM pero el POST al backend petó. Revisa VITE_API_URL en Render (debe apuntar al backend de Railway).' });
        }
      });

      PushNotifications.addListener('registrationError', (err) => {
        console.error(LOG, 'REGISTRATION_ERROR event:', JSON.stringify(err));
        record('fcm-registration-error', { error: JSON.stringify(err), hint: 'Firebase no ha podido dar un token FCM. Suele ser: google-services.json corrupto, o el móvil sin Google Play Services actualizados.' });
      });

      PushNotifications.addListener('pushNotificationReceived', (n) => {
        console.log(LOG, 'notification received (foreground):', n?.title);
      });

      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const url = action?.notification?.data?.url;
        console.log(LOG, 'notification tapped, url=', url);
        if (url && typeof window !== 'undefined') {
          try { window.location.assign(url); } catch {}
        }
      });
    }

    console.log(LOG, 'calling PushNotifications.register()');
    record('register-called', { permission: perm.receive });
    await PushNotifications.register();
    console.log(LOG, 'register() resolved OK (token will arrive via registration event)');
    return true;
  } catch (e) {
    console.error(LOG, 'ensureNativePush threw:', e?.message || e);
    record('exception', { error: String(e?.message || e) });
    return false;
  }
}

export async function getNativePermissionStatus() {
  if (!isNativeApp()) return 'default';
  const PushNotifications = await loadPushPlugin();
  if (!PushNotifications) return 'default';
  try {
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'granted') return 'granted';
    if (perm.receive === 'denied')  return 'denied';
    return 'default';
  } catch {
    return 'default';
  }
}
