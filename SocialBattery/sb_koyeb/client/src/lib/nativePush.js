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

let listenersRegistered = false;
let cachedPlugin = null;

/** ¿Estamos dentro del wrapper nativo de Capacitor? */
export function isNativeApp() {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  if (!cap) return false;
  // isNativePlatform() es la API pública; getPlatform() como fallback.
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
 * Carga el plugin bajo demanda. El import dinámico dispara internamente
 * registerPlugin('PushNotifications', ...) del wrapper, que es lo que hace
 * que las llamadas a los métodos bajen al bridge nativo.
 */
async function loadPushPlugin() {
  if (cachedPlugin) return cachedPlugin;
  if (!isNativeApp()) return null;
  try {
    const mod = await import('@capacitor/push-notifications');
    cachedPlugin = mod.PushNotifications || null;
    return cachedPlugin;
  } catch (e) {
    console.warn('[nativePush] failed to load @capacitor/push-notifications:', e);
    return null;
  }
}

/**
 * Pide permiso de notificaciones en el dispositivo nativo y arranca el
 * registro con FCM/APNs. Devuelve true si el usuario aceptó (o ya lo tenía
 * concedido) y estamos correctamente registrados.
 */
export async function ensureNativePush() {
  if (!isNativeApp()) return false;

  const PushNotifications = await loadPushPlugin();
  if (!PushNotifications) {
    console.warn('[nativePush] PushNotifications plugin not available.');
    return false;
  }

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return false;

    // Registrar listeners una única vez por sesión de la app.
    if (!listenersRegistered) {
      listenersRegistered = true;

      // El token FCM (Android) / APNs (iOS) llega en 'registration'. Lo
      // mandamos al backend para poder enviarle push a este dispositivo.
      PushNotifications.addListener('registration', async (token) => {
        try {
          await api.post('/users/fcm-register', {
            token: token?.value,
            platform: nativePlatform(),
          });
          console.log('[nativePush] FCM token registered:', String(token?.value || '').slice(0, 12) + '...');
        } catch (e) {
          console.warn('[nativePush] fcm-register failed:', e);
        }
      });

      PushNotifications.addListener('registrationError', (err) => {
        console.warn('[nativePush] registration error:', err);
      });

      // Notificación recibida con la app en foreground: navegar si trae URL.
      PushNotifications.addListener('pushNotificationReceived', (n) => {
        // El sistema no muestra banner cuando estás dentro de la app; el
        // hook useMessageNotifications ya se encarga de esas notificaciones
        // vía Supabase Realtime, así que aquí no hacemos nada extra.
        void n;
      });

      // El usuario tocó una notificación (llegada por FCM con app cerrada
      // o en background). Navegamos a la URL si viene en el payload.data.
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const url = action?.notification?.data?.url;
        if (url && typeof window !== 'undefined') {
          try {
            window.location.assign(url);
          } catch {}
        }
      });
    }

    await PushNotifications.register();
    return true;
  } catch (e) {
    console.warn('[nativePush] ensureNativePush failed:', e);
    return false;
  }
}

/** Estado del permiso nativo (para pintar el toggle en Ajustes). */
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
