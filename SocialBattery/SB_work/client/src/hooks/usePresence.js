import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';

const ONLINE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Returns true if a user was last seen within the threshold
 */
export function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
}

/**
 * Global presence manager: broadcasts heartbeats and tracks other users' presence.
 * Used once at the app level (in AuthContext or App).
 */
export function usePresenceBroadcast(userId) {
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!userId) return;

    // Immediately mark online
    api.patch('/users/me/seen').catch(() => {});

    // Heartbeat every 90 seconds
    intervalRef.current = setInterval(() => {
      api.patch('/users/me/seen').catch(() => {});
    }, 90_000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [userId]);
}

/**
 * Hook to check if a specific user is online.
 * Subscribes to realtime updates for that user.
 */
export function useUserOnline(targetUserId) {
  const [lastSeen, setLastSeen] = useState(null);

  useEffect(() => {
    if (!targetUserId) return;

    const channel = supabase
      .channel(`presence-${targetUserId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
        filter: `id=eq.${targetUserId}`,
      }, (payload) => {
        if (payload.new?.last_seen_at) {
          setLastSeen(payload.new.last_seen_at);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [targetUserId]);

  return { lastSeen, online: isOnline(lastSeen) };
}

/**
 * Hook to get online status for a list of friend IDs.
 * Uses a single Realtime subscription on the users table.
 */
export function useFriendsOnline(friends) {
  const [onlineMap, setOnlineMap] = useState({});

  // Initialize from current data
  useEffect(() => {
    if (!friends?.length) return;
    const map = {};
    friends.forEach(f => {
      map[f.id] = isOnline(f.last_seen_at);
    });
    setOnlineMap(map);
  }, [friends]);

  // Realtime updates
  useEffect(() => {
    if (!friends?.length) return;

    const channel = supabase
      .channel('friends-online')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
      }, (payload) => {
        const userId = payload.new?.id;
        if (!userId) return;
        const online = isOnline(payload.new.last_seen_at);
        setOnlineMap(prev => ({ ...prev, [userId]: online }));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [friends?.length]);

  return onlineMap;
}
