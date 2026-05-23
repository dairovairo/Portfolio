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
 *
 * Fix 2025 — Bug #1: Battery notifications were firing on every UPDATE to the
 * users table (including last_seen_at presence updates) even when battery_level
 * had not changed. Now we track the last notified level per friend and only
 * fire when the value actually differs.
 *
 * Fix 2025 — Bug #2: Group message notifications were never delivered because
 * per-group filters on RLS-protected tables fail silently in Supabase
 * postgres_changes. Replaced with a single filterless channel (identical
 * pattern to MessagesInboxPage which works correctly) and check group
 * membership in the callback via a pre-loaded Set.
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

      // Group IDs the user belongs to (as a Set for O(1) lookup in callback)
      const groupIdSet = new Set();
      // Also keep group metadata (name) cached to avoid async lookups on each event
      const groupNameCache = {};
      try {
        const { data } = await supabase
          .from('friend_group_members')
          .select('group_id')
          .eq('user_id', profile.id);
        (data || []).forEach(r => groupIdSet.add(r.group_id));
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

      // ── 4. Group messages — single filterless channel (required for RLS) ───
      //
      // BUG FIX: Using per-group channels with filter: group_id=eq.UUID fails
      // silently on RLS-protected tables in Supabase postgres_changes.
      // The correct pattern (same as MessagesInboxPage) is a single channel
      // with NO filter; RLS ensures only accessible rows are delivered.
      // We then check group membership via groupIdSet in the callback.
      if (groupIdSet.size > 0) {
        const groupCh = supabase
          .channel(`notif-groups-${profile.id}`)
          .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'group_messages',
          }, async (payload) => {
            const s = settingsRef.current;
            if (s.muteAllNotifications || s.muteGroupChats) return;

            const msg = payload.new;
            if (!msg?.group_id) return;
            if (msg.sender_id === profile.id) return;

            // Only notify for groups the user belongs to
            if (!groupIdSet.has(msg.group_id)) return;

            const chatPath = `/messages/group/${msg.group_id}`;
            if (!shouldNotify(locationRef.current, chatPath)) return;

            // Use cached group name if available, otherwise fetch once and cache
            let groupName  = groupNameCache[msg.group_id] || 'Grupo';
            let senderName = 'Alguien';
            try {
              const promises = [
                supabase.from('users').select('display_name, username').eq('id', msg.sender_id).single(),
              ];
              if (!groupNameCache[msg.group_id]) {
                promises.push(
                  supabase.from('friend_groups').select('name').eq('id', msg.group_id).single()
                );
              }
              const results = await Promise.all(promises);
              if (results[0].data) senderName = results[0].data.display_name || `@${results[0].data.username}`;
              if (results[1]?.data) {
                groupName = results[1].data.name;
                groupNameCache[msg.group_id] = groupName;
              }
            } catch {}

            fireNotification({
              title: groupName,
              body:  `${senderName}: ${msg.content?.slice(0, 80) || '📩 Nuevo mensaje'}`,
              tag:   `group-${msg.group_id}`,
              navigateTo: chatPath,
            });
          })
          .subscribe();
        channels.push(groupCh);
      }

      // ── 5. Battery changes ──────────────────────────────────────────────────
      // BUG FIX: The users table is updated on every presence heartbeat
      // (last_seen_at), causing the same battery notification to fire
      // repeatedly even when battery_level has not changed.
      // We now track the last notified level per friend and only fire
      // when the value is different from the previously notified level.
      if (friendIds.size > 0) {
        // Map<friendId, lastNotifiedLevel> — persists across events
        const lastNotifiedLevel = new Map();

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
            if (!updated?.id || !updated?.battery_level) return;
            if (updated.id === profile.id) return;
            if (!friendIds.has(updated.id)) return;

            const newLevel = updated.battery_level;

            // Skip if the level has not actually changed since last notification
            if (lastNotifiedLevel.get(updated.id) === newLevel) return;

            // Skip if the user is already on the home feed
            if (!document.hidden && locationRef.current === '/') return;

            // Record the notified level before firing
            lastNotifiedLevel.set(updated.id, newLevel);

            const name  = updated.display_name || `@${updated.username}` || 'Un amigo';
            const emoji = newLevel >= 70 ? '⚡' : newLevel >= 40 ? '🔋' : '🪫';

            fireNotification({
              title: `${name} actualizó su batería`,
              body:  `${emoji} ${newLevel}% de energía social`,
              tag:   `battery-${updated.id}`,
              navigateTo: '/',
            });
          })
          .subscribe();
        channels.push(batteryCh);
      }
    }

    setup();

    return () => {
      cancelled = true;
      channels.forEach(ch => supabase.removeChannel(ch));
    };
  }, [profile?.id]);
}
