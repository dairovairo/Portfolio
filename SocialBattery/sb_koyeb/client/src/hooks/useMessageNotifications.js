/**
 * useMessageNotifications
 *
 * Listens to Supabase realtime for new messages directed at the current user
 * (both personal and group) and fires a native browser/OS notification when:
 *   - The Notifications API is granted
 *   - The document is hidden  OR  the user is not on that specific chat
 *
 * This works on desktop, Android Chrome, and iOS 16.4+ (PWA installed).
 * No server-side changes needed — purely realtime-driven from the client.
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const ICON = '/icons/icon-192.png';
const BADGE = '/icons/badge-72.png';

/**
 * Request permission once per session, non-intrusively.
 * Returns true if already granted, does not prompt if denied.
 */
async function ensurePermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  // 'default' — ask once
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/**
 * Fire a native notification. Falls back gracefully if the API is unavailable.
 */
function fireNotification({ title, body, tag, navigateTo }) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    // Prefer service-worker-based notification (survives tab close, works on Android)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          body,
          icon: ICON,
          badge: BADGE,
          tag,
          renotify: true,
          data: { url: navigateTo || '/' },
        }).catch(() => {
          // Fallback: plain Notification constructor
          const n = new Notification(title, { body, icon: ICON, tag });
          if (navigateTo) n.onclick = () => { window.focus(); window.location.href = navigateTo; };
        });
      }).catch(() => {
        const n = new Notification(title, { body, icon: ICON, tag });
        if (navigateTo) n.onclick = () => { window.focus(); window.location.href = navigateTo; };
      });
    } else {
      const n = new Notification(title, { body, icon: ICON, tag });
      if (navigateTo) n.onclick = () => { window.focus(); window.location.href = navigateTo; };
    }
  } catch {
    // Silently ignore — notifications are a progressive enhancement
  }
}

/**
 * Decide if we should show a notification.
 * We skip it if the user is already looking at that exact chat.
 */
function shouldNotify(currentPath, chatPath) {
  // Always notify if tab is hidden
  if (document.hidden) return true;
  // Skip if already on that chat
  return !currentPath.startsWith(chatPath);
}

export function useMessageNotifications(profile) {
  const location = useLocation();
  const locationRef = useRef(location.pathname);
  useEffect(() => { locationRef.current = location.pathname; }, [location.pathname]);

  useEffect(() => {
    if (!profile?.id) return;

    let permissionGranted = false;
    ensurePermission().then(granted => { permissionGranted = granted; });

    // ── Personal messages ────────────────────────────────────────────────────
    const personalChannel = supabase
      .channel(`notif-personal-${profile.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `receiver_id=eq.${profile.id}`,
      }, async (payload) => {
        if (!permissionGranted) return;
        const msg = payload.new;
        if (msg.sender_id === profile.id) return; // ignore own messages

        const chatPath = `/messages/${msg.sender_id}`;
        if (!shouldNotify(locationRef.current, chatPath)) return;

        // Fetch sender display name for nicer notification
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

        fireNotification({
          title: senderName,
          body,
          tag: `msg-${msg.sender_id}`,
          navigateTo: chatPath,
        });
      })
      .subscribe();

    // ── Group messages ───────────────────────────────────────────────────────
    // Listen to all group_messages where the current user is a member.
    // We can't filter by group membership in realtime easily, so we listen
    // to sender_id != own and check membership client-side via a quick cache.
    const groupMembershipCache = new Set();
    let membershipLoaded = false;

    async function loadGroupMemberships() {
      try {
        const { data } = await supabase
          .from('friend_group_members')
          .select('group_id')
          .eq('user_id', profile.id);
        if (data) data.forEach(r => groupMembershipCache.add(r.group_id));
        membershipLoaded = true;
      } catch {}
    }
    loadGroupMemberships();

    const groupChannel = supabase
      .channel(`notif-groups-${profile.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'group_messages',
      }, async (payload) => {
        if (!permissionGranted) return;
        const msg = payload.new;
        if (msg.sender_id === profile.id) return; // own message

        // Only care about groups we belong to
        if (membershipLoaded && !groupMembershipCache.has(msg.group_id)) return;

        const chatPath = `/messages/group/${msg.group_id}`;
        if (!shouldNotify(locationRef.current, chatPath)) return;

        // Fetch group name and sender
        let groupName = 'Grupo';
        let senderName = 'Alguien';
        try {
          const [groupRes, senderRes] = await Promise.all([
            supabase.from('friend_groups').select('name').eq('id', msg.group_id).single(),
            supabase.from('users').select('display_name, username').eq('id', msg.sender_id).single(),
          ]);
          if (groupRes.data) groupName = groupRes.data.name;
          if (senderRes.data) senderName = senderRes.data.display_name || `@${senderRes.data.username}`;
        } catch {}

        fireNotification({
          title: groupName,
          body: `${senderName}: ${msg.content?.slice(0, 80) || '📩 Nuevo mensaje'}`,
          tag: `group-${msg.group_id}`,
          navigateTo: chatPath,
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(personalChannel);
      supabase.removeChannel(groupChannel);
    };
  }, [profile?.id]);
}
