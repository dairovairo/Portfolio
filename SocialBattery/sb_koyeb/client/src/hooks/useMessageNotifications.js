/**
 * useMessageNotifications
 *
 * Fixes applied:
 * - Group channels: one Supabase channel per group_id (with filter).
 *   Without a filter, Supabase postgres_changes ignores RLS-protected rows.
 * - Battery channel: preloads friend IDs into a Set at startup instead of
 *   doing an async DB query per event. Uses correct column names
 *   (requester_id / addressee_id).
 * - Settings are read via a live ref so toggling takes effect immediately
 *   without remounting.
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ensurePushSubscription } from '../lib/pushSubscription';

const ICON  = '/icons/icon-192.png';
const BADGE = '/icons/badge-72.png';

// ── permission ────────────────────────────────────────────────────────────────

async function ensurePermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied')  return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

// ── fire ──────────────────────────────────────────────────────────────────────

function fireNotification({ title, body, tag, navigateTo }) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = {
    body,
    icon: ICON,
    badge: BADGE,
    tag,
    renotify: true,
    data: { url: navigateTo || '/' },
  };
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then(reg => reg.showNotification(title, opts))
        .catch(() => fallbackNotif(title, opts, navigateTo));
    } else {
      fallbackNotif(title, opts, navigateTo);
    }
  } catch { /* progressive enhancement */ }
}

function fallbackNotif(title, opts, navigateTo) {
  try {
    const n = new Notification(title, opts);
    if (navigateTo) n.onclick = () => { window.focus(); window.location.href = navigateTo; };
  } catch {}
}

// ── should notify ─────────────────────────────────────────────────────────────

function shouldNotify(currentPath, chatPath) {
  if (document.hidden) return true;
  return !currentPath.startsWith(chatPath);
}

// ── mute por conversación ─────────────────────────────────────────────────
// Lee el mismo localStorage que gestionan isConversationMuted/setConversationMuted
// en SettingsContext.jsx — no hace falta pasarlo por props porque solo se
// consulta en el momento de decidir si se dispara la notificación.
function isConvMuted(type, id) {
  if (!id) return false;
  try { return localStorage.getItem(`sb-mute-conv-${type}-${id}`) === 'true'; } catch { return false; }
}

function formatReminderLead(minutes) {
  const value = Number.parseInt(minutes, 10);
  if (value >= 24 * 60 && value % (24 * 60) === 0) {
    const days = value / (24 * 60);
    return days === 1 ? '1 dia' : `${days} dias`;
  }
  if (value >= 60 && value % 60 === 0) {
    const hours = value / 60;
    return hours === 1 ? '1 hora' : `${hours} horas`;
  }
  return value === 1 ? '1 minuto' : `${value || 10} minutos`;
}

// ── main hook ─────────────────────────────────────────────────────────────────

export function useMessageNotifications(profile, settings) {
  const location   = useLocation();
  const locationRef = useRef(location.pathname);
  const settingsRef = useRef(settings);

  useEffect(() => { locationRef.current = location.pathname; }, [location.pathname]);
  useEffect(() => { settingsRef.current = settings; },         [settings]);

  useEffect(() => {
    if (!profile?.id) return;

    let cancelled = false;
    const channels = [];

    async function setup() {
      // ── 1. Request permission ───────────────────────────────────────────────
      const permissionGranted = await ensurePermission();
      if (!permissionGranted || cancelled) return;
      ensurePushSubscription().catch(() => {});

      // ── 2. Preload data we'll need for filtering ────────────────────────────

      // Friend IDs (using correct column names: requester_id / addressee_id)
      const friendIds = new Set();
      try {
        const { data } = await supabase
          .from('friendships')
          .select('requester_id, addressee_id')
          .eq('status', 'accepted')
          .or(`requester_id.eq.${profile.id},addressee_id.eq.${profile.id}`);
        (data || []).forEach(f => {
          friendIds.add(f.requester_id === profile.id ? f.addressee_id : f.requester_id);
        });
      } catch (e) { console.warn('[notif] could not load friends:', e); }

      if (cancelled) return;

      // ── 3. Personal messages ────────────────────────────────────────────────
      const personalCh = supabase
        .channel(`notif-personal-${profile.id}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${profile.id}`,
        }, async (payload) => {
          const s = settingsRef.current;
          if (s.muteAllNotifications || s.mutePersonalChats) return;

          const msg = payload.new;
          if (msg.sender_id === profile.id) return;

          const chatPath = `/messages/${msg.sender_id}`;
          if (!shouldNotify(locationRef.current, chatPath)) return;

          let senderName = 'Alguien';
          try {
            const { data } = await supabase
              .from('users')
              .select('username')
              .eq('id', msg.sender_id)
              .single();
            if (data) senderName = `@${data.username}`;
          } catch {}

          const body = msg.type === 'hangout_request'
            ? `${senderName} te propone una quedada 🤝`
            : msg.content?.slice(0, 100) || '📩 Nuevo mensaje';

          fireNotification({ title: senderName, body, tag: `msg-${msg.sender_id}`, navigateTo: chatPath });
        })
        .subscribe();
      channels.push(personalCh);

      // ── 3b. Message likes — broadcast per-user channel ──────────────────────
      // The server broadcasts to `msg-like-notif-{userId}` (service key, no RLS)
      // whenever someone likes a message this user sent — same instant-notify
      // pattern as new_group_message / new_pool below. Reuses the personal-chat
      // mute toggle since a like happens inside a 1:1 conversation.
      const likeCh = supabase
        .channel(`msg-like-notif-${profile.id}`)
        .on('broadcast', { event: 'message_liked' }, (msg) => {
          const s = settingsRef.current;
          if (s.muteAllNotifications || s.mutePersonalChats) return;

          const data = msg.payload;
          if (!data?.liker_id) return;

          const chatPath = `/messages/${data.liker_id}`;
          if (!shouldNotify(locationRef.current, chatPath)) return;

          fireNotification({
            title: data.liker_name || 'Alguien',
            body:  '❤️ Le ha gustado tu mensaje',
            tag:   `like-${data.message_id}`,
            navigateTo: chatPath,
          });
        })
        .subscribe();
      channels.push(likeCh);

      // ── 4. Group messages — broadcast per-user channel ──────────────────────
      // The server broadcasts to `group-msg-notif-{userId}` for every group
      // member using the service key (no RLS), exactly like the pools pattern.
      // This replaces the previous per-group postgres_changes approach, which
      // silently dropped events whenever RLS policies blocked the realtime rows.
      const groupMsgBroadcastCh = supabase
        .channel(`group-msg-notif-${profile.id}`)
        .on('broadcast', { event: 'new_group_message' }, (msg) => {
          const s = settingsRef.current;
          if (s.muteAllNotifications || s.muteGroupChats) return;

          const data = msg.payload;
          if (!data?.group_id) return;
          if (data.sender_id === profile.id) return;
          if (isConvMuted('group', data.group_id)) return;

          const chatPath = `/messages/group/${data.group_id}`;
          if (!shouldNotify(locationRef.current, chatPath)) return;

          const groupName  = data.group_name  || 'Grupo';
          const senderName = data.sender_name || 'Alguien';
          const body = data.type === 'image'
            ? `${senderName}: 📷 Imagen`
            : `${senderName}: ${data.content?.slice(0, 80) || '📩 Nuevo mensaje'}`;

          fireNotification({
            title:      groupName,
            body,
            tag:        `group-${data.group_id}`,
            navigateTo: chatPath,
          });
        })
        .subscribe();
      channels.push(groupMsgBroadcastCh);

      // ── 4b. Pool chat messages — broadcast per-user channel ──────────────────
      // El servidor emite un broadcast a `pool-chat-notif-{userId}` para cada
      // apuntado a la quedada usando la service key (sin RLS), mismo patrón
      // que los mensajes de grupo.
      const poolMsgBroadcastCh = supabase
        .channel(`pool-chat-notif-${profile.id}`)
        .on('broadcast', { event: 'new_pool_message' }, (msg) => {
          const data = msg.payload;
          if (!data?.pool_id) return;
          if (data.sender_id === profile.id) return;

          const chatPath = `/pools/${data.pool_id}/chat`;

          // Emite un evento global para que el badge de "Quedadas" (dock,
          // panel de la quedada y botón de chat) se actualice al instante,
          // independientemente de si las notificaciones push están silenciadas.
          window.dispatchEvent(new CustomEvent('sb-pool-message', { detail: data }));

          const s = settingsRef.current;
          if (s.muteAllNotifications || s.mutePoolChats) return;
          if (isConvMuted('pool', data.pool_id)) return;
          if (!shouldNotify(locationRef.current, chatPath)) return;

          const activityLabel = data.activity || 'la quedada';
          const senderName = data.sender_name || 'Alguien';
          const body = data.type === 'image'
            ? `${senderName}: 📷 Imagen`
            : `${senderName}: ${data.content?.slice(0, 80) || '📩 Nuevo mensaje'}`;

          fireNotification({
            title:      `💬 ${activityLabel}`,
            body,
            tag:        `pool-chat-${data.pool_id}`,
            navigateTo: chatPath,
          });
        })
        .subscribe();
      channels.push(poolMsgBroadcastCh);

      // ── 4c. Community chat messages — broadcast per-user channel ────────────
      // El servidor emite un broadcast a `community-msg-notif-{userId}` para
      // cada miembro de la comunidad (broadcastCommunityMessage en
      // server/routes/community.js), mismo patrón que grupos y quedadas.
      const communityMsgBroadcastCh = supabase
        .channel(`community-msg-notif-${profile.id}`)
        .on('broadcast', { event: 'new_community_message' }, (msg) => {
          const data = msg.payload;
          if (!data?.community_id) return;
          if (data.sender_id === profile.id) return;

          const s = settingsRef.current;
          if (s.muteAllNotifications || s.muteCommunityChats) return;
          if (isConvMuted('community', data.community_id)) return;

          const chatPath = `/messages/community/${data.community_id}`;
          if (!shouldNotify(locationRef.current, chatPath)) return;

          const communityName = data.community_name || 'Comunidad';
          const senderName = data.sender_name || 'Alguien';
          const body = data.type === 'image'
            ? `${senderName}: 📷 Imagen`
            : `${senderName}: ${data.content?.slice(0, 80) || '📩 Nuevo mensaje'}`;

          fireNotification({
            title:      communityName,
            body,
            tag:        `community-${data.community_id}`,
            navigateTo: chatPath,
          });
        })
        .subscribe();
      channels.push(communityMsgBroadcastCh);

      // ── 4d. Sniffer check-ins — broadcast per-user channel ──────────────────
      // El servidor emite un broadcast a `sniffer-checkin-notif-{userId}` para
      // cada apuntado de la quedada cuando otro marca "Estoy dentro" del
      // círculo verde (broadcastSnifferCheckin en server/routes/pools.js),
      // mismo patrón que grupos/quedadas/comunidad. El web-push real (mismo
      // evento, para segundo plano/app cerrada) ya se manda desde el propio
      // servidor filtrado por mute_pool_sniffer.
      const snifferCheckinCh = supabase
        .channel(`sniffer-checkin-notif-${profile.id}`)
        .on('broadcast', { event: 'sniffer_checkin' }, (msg) => {
          const s = settingsRef.current;
          if (s.muteAllNotifications || s.muteSnifferCheckins) return;

          const data = msg.payload;
          if (!data?.pool_id) return;
          if (data.checked_in_user_id === profile.id) return;

          const snifferPath = `/pools/${data.pool_id}/sniffer`;
          if (!shouldNotify(locationRef.current, snifferPath)) return;

          const activityLabel = data.activity || 'la quedada';
          const username = data.checked_in_username || 'Alguien';

          fireNotification({
            title:      `📍 ${activityLabel}`,
            body:       `${username} se ha registrado en el círculo`,
            tag:        `sniffer-${data.pool_id}`,
            navigateTo: snifferPath,
          });
        })
        .subscribe();
      channels.push(snifferCheckinCh);

      // ── 5. Battery changes ──────────────────────────────────────────────────
      // Listen to updates on the users table and filter by preloaded friend IDs.
      // We cache battery_updated_at per friend so we only notify when the battery
      // was actually saved — not on presence heartbeats or other row updates.
      if (friendIds.size > 0) {
        // Preload the current battery_updated_at for each friend so we can
        // detect real changes vs. presence-triggered no-op updates.
        const batteryTimestampCache = new Map();
        try {
          const { data: friendRows } = await supabase
            .from('users')
            .select('id, battery_updated_at')
            .in('id', [...friendIds]);
          (friendRows || []).forEach(row => {
            batteryTimestampCache.set(row.id, row.battery_updated_at);
          });
        } catch (e) { console.warn('[notif] could not preload battery timestamps:', e); }

        const batteryCh = supabase
          .channel(`notif-battery-${profile.id}`)
          .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'users',
          }, (payload) => {
            const s = settingsRef.current;
            if (s.muteAllNotifications || s.muteBatteryChanges) return;

            const updated = payload.new;
            if (!updated?.id) return;
            if (updated.id === profile.id) return;
            if (!friendIds.has(updated.id)) return;

            // Only notify if battery_updated_at actually changed — this filters
            // out presence heartbeats, last_seen_at updates, and other row writes
            // that don't touch the battery.
            const previousTimestamp = batteryTimestampCache.get(updated.id);
            const newTimestamp = updated.battery_updated_at;
            if (!newTimestamp || newTimestamp === previousTimestamp) return;

            // Update the cache so repeated updates at the same timestamp don't re-notify
            batteryTimestampCache.set(updated.id, newTimestamp);

            if (!updated.battery_level && updated.battery_level !== 0) return;

            // Skip if the user is already on the home feed
            if (!document.hidden && locationRef.current === '/') return;

            const name  = `@${updated.username}` || 'Un amigo';
            const level = updated.battery_level;
            const emoji = level >= 70 ? '⚡' : level >= 40 ? '🔋' : '🪫';

            fireNotification({
              title: `${name} actualizó su batería`,
              body:  `${emoji} ${level}% de energía social`,
              tag:   `battery-${updated.id}`,
              navigateTo: '/',
            });
          })
          .subscribe();
        channels.push(batteryCh);
      }

      // ── 6 & 7. Quedadas (públicas de amigos + invitaciones privadas) ──────────
      // BUG #1 (arreglado): esto disparaba una notificación local (fireNotification)
      // cada vez que llegaba el broadcast 'new_pool' / 'pool_join_request' — pero
      // el servidor YA envía un webpush real para ese mismo evento en paralelo
      // (ver notifyUsers + broadcastToUsers en server/routes/pools.js), y ese
      // push llega igual con la app en foreground o background/cerrada. El
      // resultado eran 2 notificaciones por cada invitación a una quedada. Se
      // quitó fireNotification de aquí; el push del servidor es ahora la única
      // notificación del sistema para este evento.
      //
      // BUG #2 (arreglado): este es el ÚNICO sitio del cliente que debe abrir el
      // canal `pool-notif-{userId}` — Supabase reutiliza el canal si el topic ya
      // existe, así que abrir un SEGUNDO canal con el mismo nombre en otro
      // componente (como se probó en PoolInviteNotificationsContext) reutiliza
      // este mismo objeto y su segundo .subscribe() rompe la suscripción
      // entera (ni el badge ni nada más vuelve a recibir eventos). En vez de
      // eso, este handler emite un evento de window para que otros
      // componentes (el badge del dock) se enteren sin tocar Supabase.
      const poolBroadcastCh = supabase
        .channel(`pool-notif-${profile.id}`)
        .on('broadcast', { event: 'new_pool' }, (msg) => {
          window.dispatchEvent(new CustomEvent('sb-pool-invite', { detail: msg.payload }));
        })
        .subscribe();
      channels.push(poolBroadcastCh);

      // ── 8. Recordatorios de quedadas y eventos de comunidad ─────────────────
      // El servidor emite un broadcast al canal personal `reminder-{userId}` con
      // la service key justo antes de que empiece la quedada (10 min) o el evento
      // (24 h). El cliente lo recibe aquí y dispara la notificación local.
      const reminderCh = supabase
        .channel(`reminder-${profile.id}`)
        .on('broadcast', { event: 'reminder' }, (msg) => {
          const s = settingsRef.current;
          if (s.muteAllNotifications) return;

          const data = msg.payload;
          if (!data?.type) return;

          if (data.type === 'pool') {
            if (s.mutePoolReminders) return;

            const leadMinutes = data.minutes_left || 10;
            const leadLabel = formatReminderLead(leadMinutes);
            const poolPath = `/pools?pool=${data.pool_id}`;
            if (!document.hidden && locationRef.current === '/pools') return;
            const poolBody = data.location ? `${data.activity} · ${data.location}` : data.activity;
            fireNotification({
              title: `⏰ Tu quedada empieza en ${leadLabel}`,
              body:  poolBody,
              tag:   `pool-reminder-${data.pool_id}-${leadMinutes}`,
              navigateTo: poolPath,
            });
          } else if (data.type === 'event') {
            if (s.muteEventReminders) return;

            const leadMinutes = data.minutes_left || (data.hours_left ? data.hours_left * 60 : 24 * 60);
            const leadLabel = formatReminderLead(leadMinutes);
            const eventPath = `/community/event/${data.event_id}`;
            if (!document.hidden && locationRef.current === eventPath) return;
            const eventBody = data.location ? `${data.title} · ${data.location}` : data.title;
            fireNotification({
              title: `📅 Tu evento empieza en ${leadLabel}`,
              body:  eventBody,
              tag:   `event-reminder-${data.event_id}-${leadMinutes}`,
              navigateTo: eventPath,
            });
          }
        })
        .subscribe();
      channels.push(reminderCh);
    }

    setup();

    return () => {
      cancelled = true;
      channels.forEach(ch => supabase.removeChannel(ch));
    };
  }, [profile?.id]);
}
