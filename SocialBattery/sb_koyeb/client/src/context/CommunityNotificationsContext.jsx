import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';

const CommunityNotificationsContext = createContext({
  eventBadgeCount: 0,
  communitiesWithEvents: new Set(),
  clearEventBadge: () => {},
  clearCommunityBadge: () => {},
  refreshJoinedCommunities: () => {},
});

export function useCommunityNotifications() {
  return useContext(CommunityNotificationsContext);
}

const STORAGE_KEY        = 'sb_community_events_badge';
const STORAGE_KEY_BY_COM = 'sb_community_events_by_community';

const ICON  = '/icons/icon-192.png';
const BADGE = '/icons/badge-72.png';

// ── Dispara una notificación local con sonido (funciona aunque la app
//    esté en background pero el SW activo). Para app cerrada, el server
//    usa webpush que ya tiene su propia lógica.
function fireLocalNotification({ title, body, tag, url }) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = {
    body,
    icon: ICON,
    badge: BADGE,
    tag: tag || 'community-event',
    renotify: true,
    silent: false,
    data: { url: url || '/community' },
  };
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then(reg => reg.showNotification(title, opts))
        .catch(() => { try { new Notification(title, opts); } catch {} });
    } else {
      new Notification(title, opts);
    }
  } catch { /* progressive enhancement */ }
}

// ── Serialize / deserialize el mapa { communityId -> count } ─────────────────
function loadByComMap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BY_COM);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveByComMap(map) {
  try { localStorage.setItem(STORAGE_KEY_BY_COM, JSON.stringify(map)); } catch {}
}

function totalCount(map) {
  return Object.values(map).reduce((acc, n) => acc + n, 0);
}

export function CommunityNotificationsProvider({ children }) {
  const { profile } = useAuth();

  // eventsByCommunity: { [communityId: string]: number }
  const [eventsByCommunity, setEventsByCommunity] = useState(loadByComMap);
  const joinedCommunityIdsRef = useRef(new Set());
  const channelRef = useRef(null);

  // ── Derivados ──────────────────────────────────────────────────────────────
  const eventBadgeCount     = totalCount(eventsByCommunity);
  const communitiesWithEvents = new Set(
    Object.entries(eventsByCommunity)
      .filter(([, n]) => n > 0)
      .map(([id]) => id)
  );

  // ── Persistencia ───────────────────────────────────────────────────────────
  useEffect(() => {
    saveByComMap(eventsByCommunity);
    try { localStorage.setItem(STORAGE_KEY, String(totalCount(eventsByCommunity))); } catch {}
  }, [eventsByCommunity]);

  // ── Carga los IDs de comunidades a las que pertenece el usuario ───────────
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
    } catch { /* non-fatal */ }
  }, [profile?.id]);

  useEffect(() => { refreshJoinedCommunities(); }, [refreshJoinedCommunities]);

  // ── Supabase Realtime: escucha inserts en community_events ────────────────
  useEffect(() => {
    if (!profile?.id) return;

    if (channelRef.current) {
      channelRef.current.unsubscribe();
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`community-event-badge-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'community_events' },
        async (payload) => {
          const newEvent = payload.new;
          // Sólo notificar si:
          // 1. El evento pertenece a una comunidad en la que está el usuario
          // 2. El usuario NO es el creador
          if (
            newEvent?.community_id &&
            joinedCommunityIdsRef.current.has(newEvent.community_id) &&
            newEvent.creator_id !== profile.id
          ) {
            // Incrementar badge por comunidad
            setEventsByCommunity(prev => ({
              ...prev,
              [newEvent.community_id]: (prev[newEvent.community_id] || 0) + 1,
            }));

            // Obtener nombre de la comunidad para la notificación
            let communityLabel = 'tu comunidad';
            try {
              const { data: comm } = await supabase
                .from('communities')
                .select('name')
                .eq('id', newEvent.community_id)
                .single();
              if (comm?.name) communityLabel = comm.name;
            } catch {}

            // Disparar notificación local con sonido
            fireLocalNotification({
              title: `📅 Nuevo evento en ${communityLabel}`,
              body:  `${newEvent.title || 'Se ha creado un nuevo evento'}${newEvent.location ? ` · ${newEvent.location}` : ''}`,
              tag:   `community-event-${newEvent.id}`,
              url:   `/community/${newEvent.community_id}`,
            });
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

  // ── Limpia todos los badges ───────────────────────────────────────────────
  const clearEventBadge = useCallback(() => {
    setEventsByCommunity({});
  }, []);

  // ── Limpia el badge de una comunidad concreta ────────────────────────────
  const clearCommunityBadge = useCallback((communityId) => {
    if (!communityId) return;
    setEventsByCommunity(prev => {
      const next = { ...prev };
      delete next[communityId];
      return next;
    });
  }, []);

  return (
    <CommunityNotificationsContext.Provider
      value={{
        eventBadgeCount,
        communitiesWithEvents,
        clearEventBadge,
        clearCommunityBadge,
        refreshJoinedCommunities,
      }}
    >
      {children}
    </CommunityNotificationsContext.Provider>
  );
}
