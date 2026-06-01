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

      // Group IDs the user belongs to
      const groupIds = [];
      try {
        const { data } = await supabase
          .from('friend_group_members')
          .select('group_id')
          .eq('user_id', profile.id);
        (data || []).forEach(r => groupIds.push(r.group_id));
      } catch (e) { console.warn('[notif] could not load groups:', e); }

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
              .select('display_name, username')
              .eq('id', msg.sender_id)
              .single();
            if (data) senderName = data.display_name || `@${data.username}`;
          } catch {}

          const body = msg.type === 'hangout_request'
            ? `${senderName} te propone una quedada 🤝`
            : msg.content?.slice(0, 100) || '📩 Nuevo mensaje';

          fireNotification({ title: senderName, body, tag: `msg-${msg.sender_id}`, navigateTo: chatPath });
        })
        .subscribe();
      channels.push(personalCh);

      // ── 4. Group messages — one channel per group (required for RLS) ────────
      for (const groupId of groupIds) {
        const ch = supabase
          .channel(`notif-group-${profile.id}-${groupId}`)
          .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'group_messages',
            filter: `group_id=eq.${groupId}`,
          }, async (payload) => {
            const s = settingsRef.current;
            if (s.muteAllNotifications || s.muteGroupChats) return;

            const msg = payload.new;
            if (msg.sender_id === profile.id) return;

            const chatPath = `/messages/group/${groupId}`;
            if (!shouldNotify(locationRef.current, chatPath)) return;

            let groupName  = 'Grupo';
            let senderName = 'Alguien';
            try {
              const [groupRes, senderRes] = await Promise.all([
                supabase.from('friend_groups').select('name').eq('id', groupId).single(),
                supabase.from('users').select('display_name, username').eq('id', msg.sender_id).single(),
              ]);
              if (groupRes.data)  groupName  = groupRes.data.name;
              if (senderRes.data) senderName = senderRes.data.display_name || `@${senderRes.data.username}`;
            } catch {}

            fireNotification({
              title: groupName,
              body:  `${senderName}: ${msg.content?.slice(0, 80) || '📩 Nuevo mensaje'}`,
              tag:   `group-${groupId}`,
              navigateTo: chatPath,
            });
          })
          .subscribe();
        channels.push(ch);
      }

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

            const name  = updated.display_name || `@${updated.username}` || 'Un amigo';
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
      // El servidor emite un broadcast al canal personal `pool-notif-{userId}`
      // con la service key (sin RLS), cubriendo ambos casos: pool pública de amigo
      // y pool privada donde el usuario está invitado individualmente o via grupo.
      const poolBroadcastCh = supabase
        .channel(`pool-notif-${profile.id}`)
        .on('broadcast', { event: 'new_pool' }, (msg) => {
          const s = settingsRef.current;
          if (s.muteAllNotifications) return;

          const pool = msg.payload;
          if (!pool?.pool_id) return;
          if (pool.creator_id === profile.id) return;

          if (!document.hidden && locationRef.current === '/pools') return;

          const creatorName = pool.creator_name || 'Un amigo';
          const title = pool.is_public
            ? `🎉 ${creatorName} propone una quedada`
            : `🤝 ${creatorName} te invita a una quedada`;

          fireNotification({
            title,
            body: `${pool.activity}${pool.location_hint ? ` · ${pool.location_hint}` : ''}`,
            tag: `pool-${pool.pool_id}`,
            navigateTo: '/pools',
          });
        })
        .subscribe();
      channels.push(poolBroadcastCh);
    }

    setup();

    return () => {
      cancelled = true;
      channels.forEach(ch => supabase.removeChannel(ch));
    };
  }, [profile?.id]);
}