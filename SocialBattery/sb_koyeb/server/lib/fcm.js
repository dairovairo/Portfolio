/**
 * fcm.js — Envío de notificaciones push nativas Android/iOS vía Firebase
 * Cloud Messaging usando la SDK oficial `firebase-admin`.
 *
 * Env vars requeridas (Render/Koyeb):
 *   FIREBASE_PROJECT_ID    — p.ej. "socialbattery-abc123"
 *   FIREBASE_CLIENT_EMAIL  — firebase-adminsdk-...@proj.iam.gserviceaccount.com
 *   FIREBASE_PRIVATE_KEY   — clave privada (con \n literales, tal cual sale
 *                            del JSON del service account). El helper de
 *                            abajo los convierte a saltos reales.
 *
 * Si falta cualquiera de las tres, este módulo se desactiva en silencio (no
 * tumba el servidor) y notifyUsersFcm devuelve [] — así el push web sigue
 * funcionando aunque FCM no esté configurado todavía.
 *
 * Requiere la tabla `fcm_tokens` en Supabase:
 *   create table fcm_tokens (
 *     token       text primary key,
 *     user_id     uuid not null references users(id) on delete cascade,
 *     platform    text not null check (platform in ('android','ios','web')),
 *     created_at  timestamptz default now(),
 *     updated_at  timestamptz default now()
 *   );
 *   create index fcm_tokens_user_id_idx on fcm_tokens(user_id);
 */

let admin = null;
let messaging = null;
let configured = false;
let disabled = false;

function init() {
  if (configured || disabled) return;
  configured = true;

  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey    = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    console.warn('[fcm] FIREBASE_* env vars not set — native push disabled.');
    disabled = true;
    return;
  }

  // Render/Koyeb suelen guardar la clave con \n literales. Convertimos a
  // saltos reales — sin esto firebase-admin lanza "invalid PEM formatted
  // message" al arrancar.
  privateKey = privateKey.replace(/\\n/g, '\n');

  try {
    admin = require('firebase-admin');
  } catch {
    console.warn('[fcm] firebase-admin not installed — native push disabled. Run: npm install');
    disabled = true;
    return;
  }

  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      });
    }
    messaging = admin.messaging();
  } catch (err) {
    console.error('[fcm] init failed:', err.message);
    disabled = true;
  }
}

/**
 * Envía un push a una lista de tokens FCM. Devuelve los userIds únicos que
 * recibieron al menos un push OK, y limpia los tokens caducados / inválidos
 * de la tabla fcm_tokens.
 *
 * @param {object} supabase   — cliente supabase con service key
 * @param {Array<{ token: string, user_id: string }>} tokenRows
 * @param {{ title: string, body: string, url?: string, tag?: string }} payload
 * @returns {Promise<string[]>} userIds notificados con éxito
 */
async function sendToTokens(supabase, tokenRows, payload) {
  init();
  if (disabled || !messaging || !tokenRows?.length) return [];

  // FCM permite hasta 500 tokens por sendEachForMulticast. Chunkeamos.
  const CHUNK = 450;
  const chunks = [];
  for (let i = 0; i < tokenRows.length; i += CHUNK) chunks.push(tokenRows.slice(i, i + CHUNK));

  const invalidTokens = [];
  const successfulUserIds = new Set();

  for (const rows of chunks) {
    const message = {
      tokens: rows.map(r => r.token),
      // Usamos data-only en Android para que la app pueda personalizar la
      // navegación al tocar la notificación. Añadimos también `notification`
      // para que Android muestre el banner cuando la app está cerrada.
      notification: {
        title: payload.title || 'SocialBattery',
        body:  payload.body  || '',
      },
      data: {
        url: String(payload.url || '/'),
        tag: String(payload.tag || 'sb-notif'),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'sb_default',
          tag: String(payload.tag || 'sb-notif'),
          clickAction: 'FCM_PLUGIN_ACTIVITY', // Capacitor push plugin bridge
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'mutable-content': 1,
          },
        },
      },
    };

    let response;
    try {
      response = await messaging.sendEachForMulticast(message);
    } catch (err) {
      console.warn('[fcm] sendEachForMulticast error:', err.message);
      continue;
    }

    response.responses.forEach((res, idx) => {
      const row = rows[idx];
      if (res.success) {
        successfulUserIds.add(row.user_id);
      } else {
        const code = res.error?.code || '';
        // Tokens que ya no sirven — borrar de la tabla para no seguir
        // gastando cuota en cada envío.
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          invalidTokens.push(row.token);
        } else {
          console.warn(`[fcm] send fail (${code}):`, res.error?.message);
        }
      }
    });
  }

  if (invalidTokens.length) {
    supabase
      .from('fcm_tokens')
      .delete()
      .in('token', invalidTokens)
      .then(() => {})
      .catch(() => {});
  }

  return [...successfulUserIds];
}

/**
 * Envía un push nativo a una lista de userIds (todos sus dispositivos
 * registrados). Es el equivalente FCM de webpush.notifyUsers — mismos
 * argumentos para poder llamarlos en paralelo.
 *
 * @param {object} supabase
 * @param {string[]} userIds
 * @param {string|null} excludeId
 * @param {{ title: string, body: string, url?: string, tag?: string }} payload
 * @returns {Promise<string[]>} userIds notificados con éxito
 */
async function notifyUsersFcm(supabase, userIds, excludeId, payload) {
  init();
  if (disabled) return [];
  if (!userIds?.length) return [];

  const targetIds = userIds.filter(id => id !== excludeId);
  if (!targetIds.length) return [];

  try {
    const { data: tokens, error } = await supabase
      .from('fcm_tokens')
      .select('token, user_id')
      .in('user_id', targetIds);

    if (error || !tokens?.length) return [];
    return await sendToTokens(supabase, tokens, payload);
  } catch (err) {
    console.warn('[fcm] notifyUsersFcm error:', err.message);
    return [];
  }
}

/** Igual que notifyUsersFcm pero sin lista — a todos los tokens excepto uno. */
async function notifyAllUsersFcm(supabase, excludeId, payload) {
  init();
  if (disabled) return [];

  try {
    const query = supabase.from('fcm_tokens').select('token, user_id');
    const { data: tokens, error } = excludeId
      ? await query.neq('user_id', excludeId)
      : await query;

    if (error || !tokens?.length) return [];
    return await sendToTokens(supabase, tokens, payload);
  } catch (err) {
    console.warn('[fcm] notifyAllUsersFcm error:', err.message);
    return [];
  }
}

/** ¿Está la integración FCM lista para enviar? Útil para logs. */
function isFcmReady() {
  init();
  return !disabled && !!messaging;
}

module.exports = { notifyUsersFcm, notifyAllUsersFcm, sendToTokens, isFcmReady };
