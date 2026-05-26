import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';

const CommunityNotificationsContext = createContext({
  eventBadgeCount: 0,
  clearEventBadge: () => {},
  refreshJoinedCommunities: () => {},
});

export function useCommunityNotifications() {
  return useContext(CommunityNotificationsContext);
}

const STORAGE_KEY = 'sb_community_events_badge';

export function CommunityNotificationsProvider({ children }) {
  const { profile } = useAuth();
  const [eventBadgeCount, setEventBadgeCount] = useState(() => {
    try { return parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10) || 0; } catch { return 0; }
  });
  const joinedCommunityIdsRef = useRef(new Set());
  const channelRef = useRef(null);

  // ── Load joined community IDs from Supabase ───────────────────────────────
  const refreshJoinedCommunities = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const { data } = await supabase
        .from('community_members')
        .select('community_id')
        .eq('user_id', profile.id);
      if (data) {
        joinedCommunityIdsRef.current = new Set(data.map(m => m.community_id));
      }
    } catch {
      // non-fatal
    }
  }, [profile?.id]);

  useEffect(() => {
    refreshJoinedCommunities();
  }, [refreshJoinedCommunities]);

  // ── Persist badge count to localStorage ───────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(eventBadgeCount)); } catch {}
  }, [eventBadgeCount]);

  // ── Supabase Realtime: subscribe to new community_events inserts ──────────
  useEffect(() => {
    if (!profile?.id) return;

    // Clean up previous channel
    if (channelRef.current) {
      channelRef.current.unsubscribe();
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`community-event-badge-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'community_events' },
        (payload) => {
          const newEvent = payload.new;
          // Only show badge if:
          // 1. Event belongs to a community the user has joined
          // 2. The user is NOT the creator (no self-notification)
          if (
            newEvent?.community_id &&
            joinedCommunityIdsRef.current.has(newEvent.community_id) &&
            newEvent.creator_id !== profile.id
          ) {
            setEventBadgeCount(c => c + 1);
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [profile?.id]);

  // ── Clear badge (call when user opens Comunidad > Eventos) ────────────────
  const clearEventBadge = useCallback(() => {
    setEventBadgeCount(0);
    try { localStorage.setItem(STORAGE_KEY, '0'); } catch {}
  }, []);

  return (
    <CommunityNotificationsContext.Provider
      value={{ eventBadgeCount, clearEventBadge, refreshJoinedCommunities }}
    >
      {children}
    </CommunityNotificationsContext.Provider>
  );
}
