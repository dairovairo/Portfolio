/**
 * nativeAuth.js — Login OAuth (Google/Apple) dentro de la app nativa de
 * Capacitor. En navegador web normal no se usa: AuthContext sigue con el
 * signInWithOAuth de siempre (redirige la ventana entera).
 *
 * Por qué hace falta: Google bloquea el login OAuth dentro de WebViews
 * embebidos, así que Capacitor abre la pantalla de Google en el navegador
 * del sistema. Con redirectTo = window.location.origin el callback volvía a
 * https://socialbattery.pro EN CHROME, la sesión se quedaba en Chrome y la
 * app seguía sin sesión (y por tanto sin registro FCM).
 *
 * Flujo nativo:
 *   1. signInWithOAuth con skipBrowserRedirect y redirectTo = deep link
 *      com.socialbattery.app://login-callback (debe estar en Supabase →
 *      Auth → URL Configuration → Redirect URLs).
 *   2. Abrimos la URL de Google en una Custom Tab (@capacitor/browser).
 *   3. Supabase redirige al deep link → Android abre la app (intent-filter en
 *      AndroidManifest) → evento appUrlOpen → guardamos la sesión en el
 *      cliente de Supabase del WebView → onAuthStateChange dispara SIGNED_IN.
 */

import { supabase } from './supabase';
import { isNativeApp } from './nativePush';

export const NATIVE_AUTH_REDIRECT = 'com.socialbattery.app://login-callback';

const LOG = '[SBAUTH]';

// IMPORTANTE: nunca devolver un plugin de Capacitor "a pelo" desde una
// función async o un .then(): los plugins son Proxies con `then` y la
// Promise se queda colgada para siempre (ver loadPushPlugin en nativePush.js).
// Por eso siempre van envueltos en un objeto plano.
let pluginsPromise = null;
function loadPlugins() {
  if (!pluginsPromise) {
    pluginsPromise = Promise.all([
      import('@capacitor/app'),
      import('@capacitor/browser'),
    ]).then(([appMod, browserMod]) => ({ App: appMod.App, Browser: browserMod.Browser }));
  }
  return pluginsPromise;
}

let lastHandledUrl = null;

async function handleAuthCallback(url) {
  if (!url || !url.startsWith(NATIVE_AUTH_REDIRECT)) return;
  // getLaunchUrl() y appUrlOpen pueden entregar la misma URL: solo una vez.
  if (url === lastHandledUrl) return;
  lastHandledUrl = url;

  const { Browser } = await loadPlugins();
  try { await Browser.close(); } catch { /* en Android puede no estar abierta */ }

  let parsed;
  try { parsed = new URL(url); } catch (e) {
    console.error(LOG, 'callback URL no parseable:', e?.message || e);
    return;
  }
  const query = parsed.searchParams;
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));

  const errorDescription = query.get('error_description') || hash.get('error_description');
  if (errorDescription) {
    console.error(LOG, 'OAuth error:', errorDescription);
    try { window.alert(`No se pudo iniciar sesión: ${errorDescription}`); } catch {}
    return;
  }

  // Flujo PKCE (?code=...) o implícito (#access_token=...&refresh_token=...),
  // según el flowType del cliente de Supabase. Soportamos ambos.
  const code = query.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) console.error(LOG, 'exchangeCodeForSession falló:', error.message);
    return;
  }

  const access_token = hash.get('access_token');
  const refresh_token = hash.get('refresh_token');
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) console.error(LOG, 'setSession falló:', error.message);
    return;
  }

  console.warn(LOG, 'callback sin code ni tokens:', parsed.search, parsed.hash ? '(hash presente)' : '');
}

let initialized = false;

/** Engancha el listener de deep links. Idempotente; no-op fuera de la app nativa. */
export async function initNativeAuth() {
  if (initialized || !isNativeApp()) return;
  initialized = true;
  try {
    const { App } = await loadPlugins();
    App.addListener('appUrlOpen', ({ url }) => {
      handleAuthCallback(url).catch(e => console.error(LOG, 'appUrlOpen handler:', e?.message || e));
    });
    // Si Android mató la app mientras estaba la Custom Tab abierta, el deep
    // link la relanza en frío y no llega appUrlOpen: lo leemos de aquí.
    const launch = await App.getLaunchUrl();
    if (launch?.url) await handleAuthCallback(launch.url);
  } catch (e) {
    initialized = false;
    console.error(LOG, 'initNativeAuth falló:', e?.message || e);
  }
}

/** signInWithOAuth para la app nativa: Custom Tab + deep link de vuelta. */
export async function signInWithOAuthNative(provider, options = {}) {
  await initNativeAuth();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      ...options,
      redirectTo: NATIVE_AUTH_REDIRECT,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('Supabase no devolvió la URL de login');
  const { Browser } = await loadPlugins();
  await Browser.open({ url: data.url });
  return data;
}
