/**
 * useMessageNotifications
 *
 * Listens to Supabase realtime for new messages directed at the current user
 * (both personal and group) and fires a native browser/OS notification when:
 *   - The Notifications API is granted
 *   - The document is hidden  OR  the user is not on that specific chat
 *   - The relevant notification toggles are NOT muted
 *
 * Notification settings are read live from SettingsContext on each event,
 * so toggling a setting takes effect immediately without remounting.
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const ICON = '/icons/icon-192.png';
const BADGE = '/icons/badge-72.png';

async function ensurePermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function fireNotification({ title, body, tag, navigateTo }) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
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
  } catch { /* progressive enhancement — fail silently */ }
}

function shouldNotify(currentPath, chatPath) {
  if (document.hidden) return true;
  return !currentPath.startsWith(chatPath);
}

/**
 * @param {object} profile  - current user profile from AuthContext
 * @param {object} settings - notification settings from SettingsContext
 *   { muteAllNotifications, mutePersonalChats, muteGroupChats, muteBatteryChanges }
 */
export function useMessageNotifications(profile, settings) {
  const location = useLocation();
  const locationRef = useRef(location.pathname);
  // Keep a live ref to settings so realtime callbacks always read the latest value
  // without needing to re-subscribe every time a toggle changes.
  const settingsRef = useRef(settings);

  useEffect(() => { locationRef.current = location.pathname; }, [location.pathname]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

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

    // ── Group messages ───────────────────────────────────────────────────────
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
        const s = settingsRef.current;
        if (s.muteAllNotifications || s.muteGroupChats) return;

        const msg = payload.new;
        if (msg.sender_id === profile.id) return;
        if (membershipLoaded && !groupMembershipCache.has(msg.group_id)) return;

        const chatPath = `/messages/group/${msg.group_id}`;
        if (!shouldNotify(locationRef.current, chatPath)) return;

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

    // ── Battery changes ───────────────────────────────────────────────────────
    // Listens for friend battery updates. Uses muteBatteryChanges toggle.
    // Only fires if the user is NOT on the home feed (they'd see it anyway).
    const batteryChannel = supabase
      .channel(`notif-battery-${profile.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
        // We can't filter by friendship here, so we do a quick friendship check client-side
      }, async (payload) => {
        if (!permissionGranted) return;
        const s = settingsRef.current;
        if (s.muteAllNotifications || s.muteBatteryChanges) return;

        const updated = payload.new;
        const old = payload.old;

        // Only react to actual battery_level changes
        if (updated.battery_level === old?.battery_level) return;
        if (updated.id === profile.id) return; // ignore own changes

        // Check if this person is a friend
        try {
          const { data } = await supabase
            .from('friendships')
            .select('id')
            .or(
              `and(user_id.eq.${profile.id},friend_id.eq.${updated.id}),` +
              `and(user_id.eq.${updated.id},friend_id.eq.${profile.id})`
            )
            .eq('status', 'accepted')
            .maybeSingle();

          if (!data) return; // not a friend
        } catch { return; }

        // Only notify if not already on the home feed
        if (!document.hidden && locationRef.current === '/') return;

        const name = updated.display_name || `@${updated.username}` || 'Un amigo';
        const level = updated.battery_level ?? '?';
        const emoji = level >= 70 ? '⚡' : level >= 40 ? '🔋' : '🪫';

        fireNotification({
          title: `${name} actualizó su batería`,
          body: `${emoji} ${level}% de energía social`,
          tag: `battery-${updated.id}`,
          navigateTo: '/',
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(personalChannel);
      supabase.removeChannel(groupChannel);
      supabase.removeChannel(batteryChannel);
    };
  }, [profile?.id]);
}
