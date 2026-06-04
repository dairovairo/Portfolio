/**
 * webpush.js — Thin wrapper around the `web-push` library.
 *
 * Requires the following environment variables (set them in server/.env):
 *
 *   VAPID_PUBLIC_KEY   — Base64url-encoded VAPID public key
 *   VAPID_PRIVATE_KEY  — Base64url-encoded VAPID private key
 *   VAPID_SUBJECT      — mailto: or https: contact URI  (e.g. mailto:admin@yourdomain.com)
 *
 * Generate a new key-pair once with:
 *   node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(k);"
 *
 * Then update VITE_VAPID_PUBLIC_KEY in client/.env (and the applicationServerKey
 * in client/src/hooks/usePush.js) to match VAPID_PUBLIC_KEY.
 *
 * NOTE: The default keys below are TEST-ONLY placeholders and will NOT produce
 * real push messages. Replace them with your own generated pair.
 */

let webpush = null;
let configured = false;

function init() {
  if (configured) return;
  configured = true;

  try {
    webpush = require('web-push');
  } catch {
    console.warn('[webpush] web-push not installed — push notifications disabled. Run: npm install');
    return;
  }

  const publicKey  = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject    = process.env.VAPID_SUBJECT || 'mailto:admin@socialbattery.app';

  if (!publicKey || !privateKey) {
    console.warn('[webpush] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push notifications disabled.');
    webpush = null;
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
}

/**
 * Send a push notification to a single push subscription row from the DB.
 * @param {{ endpoint: string, p256dh: string, auth: string }} sub
 * @param {{ title: string, body: string, url?: string, tag?: string }} payload
 */
async function sendPushToSubscription(sub, payload) {
  init();
  if (!webpush) return;

  const pushPayload = JSON.stringify({
    title: payload.title || 'SocialBattery',
    body:  payload.body  || '',
    icon:  '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag:   payload.tag  || 'community-event',
    url:   payload.url  || '/community',
  });

  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      pushPayload,
      { TTL: 86400 } // 24 h
    );
  } catch (err) {
    // 410 Gone = subscription expired / revoked → caller should delete it
    if (err.statusCode === 410 || err.statusCode === 404) {
      return { expired: true, endpoint: sub.endpoint };
    }
    console.warn('[webpush] sendNotification error:', err.statusCode || err.message);
  }
  return { expired: false };
}


/**
 * Send a push notification to a list of user IDs, excluding one user.
 * Handles subscription lookup and expired endpoint cleanup automatically.
 *
 * @param {object} supabase
 * @param {string[]} userIds     — recipients
 * @param {string}   excludeId  — user to exclude (e.g. the creator)
 * @param {{ title: string, body: string, url?: string, tag?: string }} payload
 */
async function notifyUsers(supabase, userIds, excludeId, payload) {
  init();
  if (!webpush) return;
  if (!userIds?.length) return;

  try {
    const targetIds = userIds.filter(id => id !== excludeId);
    if (!targetIds.length) return;

    const { data: subs, error: subsErr } = await supabase
      .from('push_subscriptions')
      .select('user_id, endpoint, p256dh, auth')
      .in('user_id', targetIds);

    if (subsErr || !subs?.length) return;

    const expiredEndpoints = [];
    await Promise.allSettled(
      subs.map(async sub => {
        const result = await sendPushToSubscription(sub, payload);
        if (result?.expired) expiredEndpoints.push(sub.endpoint);
      })
    );

    if (expiredEndpoints.length) {
      supabase
        .from('push_subscriptions')
        .delete()
        .in('endpoint', expiredEndpoints)
        .then(() => {})
        .catch(() => {});
    }
  } catch (err) {
    console.warn('[webpush] notifyUsers error:', err.message);
  }
}

/**
 * Send a push notification to all push-subscribed members of a community,
 * excluding the event creator.
 * Now delegates subscription fan-out to notifyUsers.
 *
 * @param {object} supabase
 * @param {string} communityId
 * @param {string} creatorId  — excluded from notifications
 * @param {{ title: string, body: string, url?: string, tag?: string }} payload
 */
async function notifyCommunityMembers(supabase, communityId, creatorId, payload) {
  init();
  if (!webpush) return;

  try {
    const { data: members, error: membersErr } = await supabase
      .from('community_members')
      .select('user_id')
      .eq('community_id', communityId)
      .neq('user_id', creatorId);

    if (membersErr || !members?.length) return;

    const memberIds = members.map(m => m.user_id);
    await notifyUsers(supabase, memberIds, creatorId, payload);
  } catch (err) {
    console.warn('[webpush] notifyCommunityMembers error:', err.message);
  }
}

/**
 * Send a push notification to up to `limit` randomly-selected users that have
 * an active push subscription, excluding `excludeId` (typically the creator).
 *
 * Production limits:
 *   premium → 5 000 unique recipients
 *   ultra   → 20 000 unique recipients
 *
 * During testing these numbers are set to 1 (premium) and 2 (ultra) in
 * community.js so you can verify the fan-out without spamming real users.
 *
 * @param {object} supabase
 * @param {string} excludeId  — user to skip
 * @param {number} limit      — max recipients (use 5000 / 20000 in production)
 * @param {{ title: string, body: string, url?: string, tag?: string }} payload
 */
async function notifyUpToNUsers(supabase, excludeId, limit, payload) {
  init();
  if (!webpush) return;
  if (!limit || limit < 1) return;

  try {
    // Pull at most `limit` subscriptions (server-side cap), excluding creator.
    // Supabase does not support ORDER BY RANDOM() via the JS client, so we
    // fetch `limit` rows ordered by insertion time and shuffle client-side.
    // For very large limits (5 000 / 20 000) this is still a single query.
    const { data: subs, error: subsErr } = await supabase
      .from('push_subscriptions')
      .select('user_id, endpoint, p256dh, auth')
      .neq('user_id', excludeId)
      .limit(limit * 2); // overfetch so shuffle gives a better spread

    if (subsErr || !subs?.length) return;

    // Fisher-Yates shuffle then take `limit` items
    for (let i = subs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [subs[i], subs[j]] = [subs[j], subs[i]];
    }
    const recipients = subs.slice(0, limit);

    const expiredEndpoints = [];
    await Promise.allSettled(
      recipients.map(async sub => {
        const result = await sendPushToSubscription(sub, payload);
        if (result?.expired) expiredEndpoints.push(sub.endpoint);
      })
    );

    if (expiredEndpoints.length) {
      supabase
        .from('push_subscriptions')
        .delete()
        .in('endpoint', expiredEndpoints)
        .then(() => {})
        .catch(() => {});
    }

    console.log(`[webpush] notifyUpToNUsers: sent to ${recipients.length} / ${limit} requested (plan cap)`);
  } catch (err) {
    console.warn('[webpush] notifyUpToNUsers error:', err.message);
  }
}

/**
 * Send a push notification to every user that has an active push subscription
 * (regardless of community membership). Used for Ultra promotion events.
 *
 * @param {object} supabase
 * @param {string} excludeId  — user to exclude (the creator)
 * @param {{ title: string, body: string, url?: string, tag?: string }} payload
 */
async function notifyAllUsers(supabase, excludeId, payload) {
  init();
  if (!webpush) return;

  try {
    // Fetch all push subscriptions except the creator's
    const { data: subs, error: subsErr } = await supabase
      .from('push_subscriptions')
      .select('user_id, endpoint, p256dh, auth')
      .neq('user_id', excludeId);

    if (subsErr || !subs?.length) return;

    const expiredEndpoints = [];
    await Promise.allSettled(
      subs.map(async sub => {
        const result = await sendPushToSubscription(sub, payload);
        if (result?.expired) expiredEndpoints.push(sub.endpoint);
      })
    );

    if (expiredEndpoints.length) {
      supabase
        .from('push_subscriptions')
        .delete()
        .in('endpoint', expiredEndpoints)
        .then(() => {})
        .catch(() => {});
    }
  } catch (err) {
    console.warn('[webpush] notifyAllUsers error:', err.message);
  }
}

module.exports = { notifyUsers, notifyCommunityMembers, notifyAllUsers, notifyUpToNUsers };
