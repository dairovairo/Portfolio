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

// Canal de Android por el que el servidor envía los push (server/lib/fcm.js y
// AndroidManifest.xml usan este mismo id). Si no existe, Android cae al canal
// genérico, sin banner emergente.
const CHANNEL_ID = 'sb_default';

let listenersRegistered = false;
let cachedPlugin = null;

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

/**
 * Devuelve `{ PushNotifications }` (o null) — NUNCA el plugin a pelo.
 *
 * Los plugins de Capacitor son Proxies que responden a cualquier propiedad,
 * incluida `then`. Si una función async hace `return plugin`, la Promise lo
 * trata como "thenable", llama a `plugin.then(...)` como si fuera un método
 * nativo y se queda colgada para siempre, sin error. Envolviéndolo en un
 * objeto plano se evita.
 */
async function loadPushPlugin() {
  if (cachedPlugin) return { PushNotifications: cachedPlugin };
  if (!isNativeApp()) {
    return null;
  }
  try {
    const mod = await import('@capacitor/push-notifications');
    cachedPlugin = mod.PushNotifications || null;
    return cachedPlugin ? { PushNotifications: cachedPlugin } : null;
  } catch (e) {
    console.error(LOG, 'FAILED to load @capacitor/push-notifications:', e?.message || e);
    return null;
  }
}

/**
 * Pide permiso, crea el canal y registra el token FCM en el backend.
 * @returns {Promise<boolean>} true si hay permiso y se ha lanzado el registro
 */
export async function ensureNativePush() {
  if (!isNativeApp()) return false;

  const { PushNotifications } = (await loadPushPlugin()) || {};
  if (!PushNotifications) return false;

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') {
      console.warn(LOG, 'permission not granted:', perm.receive);
      return false;
    }

    if (nativePlatform() === 'android') {
      await PushNotifications.createChannel({
        id: CHANNEL_ID,
        name: 'SocialBattery',
        importance: 4, // HIGH: banner emergente + sonido
        visibility: 0, // PRIVATE: oculta el contenido en la pantalla de bloqueo
        vibration: true,
      }).catch(e => console.warn(LOG, 'createChannel failed:', e?.message || e));
    }

    if (!listenersRegistered) {
      listenersRegistered = true;

      PushNotifications.addListener('registration', async (token) => {
        if (!token?.value) return;
        try {
          await api.post('/users/fcm-register', {
            token: token.value,
            platform: nativePlatform(),
          });
        } catch (e) {
          console.error(LOG, 'fcm-register failed:', e?.message || e);
        }
      });

      PushNotifications.addListener('registrationError', (err) => {
        console.error(LOG, 'registration error:', JSON.stringify(err));
      });

      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const url = action?.notification?.data?.url;
        if (!url || typeof window === 'undefined') return;
        // App.jsx navega sin recargar; si nadie recoge el evento, recarga.
        const unhandled = window.dispatchEvent(new CustomEvent('sb-notification-click', {
          detail: { url },
          cancelable: true,
        }));
        if (unhandled) {
          try { window.location.assign(url); } catch {}
        }
      });
    }

    await PushNotifications.register();
    return true;
  } catch (e) {
    console.error(LOG, 'ensureNativePush failed:', e?.message || e);
    return false;
  }
}

export async function getNativePermissionStatus() {
  if (!isNativeApp()) return 'default';
  const { PushNotifications } = (await loadPushPlugin()) || {};
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
