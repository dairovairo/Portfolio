/**
 * webpush.js
 *
 * Wrapper around the web-push library.
 * Initialised once with the VAPID keys from env; exposes a single
 * sendGroupMessageNotif() helper used by the groups route.
 *
 * If VAPID keys are not configured the module stubs itself out so
 * the server still starts in dev without push support.
 */

const webpush = require('web-push');
const supabase = require('./supabase');

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL } = process.env;

const vapidReady = VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_EMAIL;

if (vapidReady) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('[webpush] VAPID keys not configured — push notifications disabled');
}

/**
 * Sends a Web Push notification to all members of a group except the sender.
 *
 * @param {object} opts
 * @param {string} opts.groupId
 * @param {string} opts.senderId   — excluded from recipients
 * @param {string} opts.groupName
 * @param {string} opts.senderName
 * @param {string} opts.content    — raw message text
 */
async function sendGroupMessageNotif({ groupId, senderId, groupName, senderName, content }) {
  if (!vapidReady) return;

  try {
    // 1. Get all group members except the sender
    const { data: members, error: mErr } = await supabase
      .from('friend_group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .neq('user_id', senderId);

    if (mErr || !members?.length) return;

    const memberIds = members.map(m => m.user_id);

    // 2. Fetch their push subscriptions
    const { data: subs, error: sErr } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .in('user_id', memberIds);

    if (sErr || !subs?.length) return;

    // 3. Build the notification payload
    const payload = JSON.stringify({
      title: groupName,
      body: `${senderName}: ${content.slice(0, 100)}`,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: `group-${groupId}`,
      data: { url: `/messages/group/${groupId}` },
    });

    // 4. Send to each subscription; silently drop invalid/expired ones
    const sends = subs.map(sub =>
      webpush
        .sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
        .catch(async err => {
          // 410 Gone = subscription expired/unsubscribed → remove it
          if (err.statusCode === 410) {
            await supabase
              .from('push_subscriptions')
              .delete()
              .eq('endpoint', sub.endpoint)
              .catch(() => {});
          }
          // Other errors are non-fatal — log only in debug
          console.debug('[webpush] send failed:', err.statusCode, sub.endpoint?.slice(0, 40));
        })
    );

    await Promise.allSettled(sends);
  } catch (e) {
    // Push is non-fatal — never let it break the message response
    console.warn('[webpush] sendGroupMessageNotif error:', e.message);
  }
}

module.exports = { sendGroupMessageNotif, vapidReady, VAPID_PUBLIC_KEY };
