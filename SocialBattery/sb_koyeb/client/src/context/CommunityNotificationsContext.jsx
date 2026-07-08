import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useSettings } from './SettingsContext';
import { supabase } from '../lib/supabase';

const CommunityNotificationsContext = createContext({
  eventBadgeCount: 0,
  communitiesWithEvents: new Set(),
  clearEventBadge: () => {},
  clearCommunityBadge: () => {},
  refreshJoinedCommunities: () => {},
  // event-update badges
  eventsWithUpdates: new Set(),
  planningUpdateCount: 0,
  clearEventUpdateBadge: () => {},
  clearAllEventUpdateBadges: () => {},
});

export function useCommunityNotifications() {
  return useContext(CommunityNotificationsContext);
}

const STORAGE_KEY           = 'sb_community_events_badge';
const STORAGE_KEY_BY_COM    = 'sb_community_events_by_community';
const STORAGE_KEY_UPDATES   = 'sb_event_updates_badge'; // Set<eventId> serialized as JSON array

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

// ── Serialize / deserialize el Set<eventId> de actualizaciones no leídas ─────
function loadUpdatesSet() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_UPDATES);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveUpdatesSet(set) {
  try { localStorage.setItem(STORAGE_KEY_UPDATES, JSON.stringify([...set])); } catch {}
}

export function CommunityNotificationsProvider({ children }) {
  const { profile } = useAuth();
  const { muteAllNotifications, muteNewEvents, muteEventRecommendations } = useSettings();

  // eventsByCommunity: { [communityId: string]: number }
  const [eventsByCommunity, setEventsByCommunity] = useState(loadByComMap);

  // eventsWithUpdates: Set<eventId> — eventos planificados con actualizaciones no leídas
  const [eventsWithUpdates, setEventsWithUpdates] = useState(loadUpdatesSet);

  const joinedCommunityIdsRef   = useRef(new Set());
  // Set<eventId> de eventos en los que el usuario está apuntado
  const attendingEventIdsRef    = useRef(new Set());
  const settingsRef             = useRef({ muteAllNotifications, muteNewEvents, muteEventRecommendations });
  const channelRef              = useRef(null);
  const updateChannelRef        = useRef(null);

  useEffect(() => {
    settingsRef.current = { muteAllNotifications, muteNewEvents, muteEventRecommendations };
  }, [muteAllNotifications, muteNewEvents, muteEventRecommendations]);

  // ── Derivados ──────────────────────────────────────────────────────────────
  const eventBadgeCount     = totalCount(eventsByCommunity);
  const communitiesWithEvents = new Set(
    Object.entries(eventsByCommunity)
      .filter(([, n]) => n > 0)
      .map(([id]) => id)
  );
  const planningUpdateCount = eventsWithUpdates.size;

  // ── Persistencia ───────────────────────────────────────────────────────────
  useEffect(() => {
    saveByComMap(eventsByCommunity);
    try { localStorage.setItem(STORAGE_KEY, String(totalCount(eventsByCommunity))); } catch {}
  }, [eventsByCommunity]);

  useEffect(() => {
    saveUpdatesSet(eventsWithUpdates);
  }, [eventsWithUpdates]);

  // ── Carga los IDs de comunidades + eventos a los que pertenece el usuario ──
  const refreshJoinedCommunities = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const [{ data: memberships }, { data: attendances }] = await Promise.all([
        supabase
          .from('community_members')
          .select('community_id')
          .eq('user_id', profile.id),
        supabase
          .from('community_event_attendees')
          .select('event_id')
          .eq('user_id', profile.id),
      ]);
      if (memberships) {
        joinedCommunityIdsRef.current = new Set(memberships.map(m => m.community_id));
      }
      if (attendances) {
        attendingEventIdsRef.current = new Set(attendances.map(a => a.event_id));
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

          // Ignorar siempre si el usuario es el creador
          if (!newEvent?.id || newEvent.creator_id === profile.id) return;

          const plan = newEvent.promotion_plan || 'basic';
          const isUltraOrPremium = plan === 'ultra' || plan === 'premium';
          const isMember = newEvent.community_id &&
            joinedCommunityIdsRef.current.has(newEvent.community_id);

          // Notificar si:
          //   a) El plan es ultra o premium  → todos los usuarios (sin importar membresía)
          //   b) Plan básico → solo miembros de la comunidad del evento
          if (!isUltraOrPremium && !isMember) return;

          // Incrementar badge solo si el evento pertenece a una comunidad conocida del usuario
          // (los ultra/premium sin comunidad no generan badge de comunidad, solo notificación)
          if (isMember) {
            setEventsByCommunity(prev => ({
              ...prev,
              [newEvent.community_id]: (prev[newEvent.community_id] || 0) + 1,
            }));
          }

          const settings = settingsRef.current;
          if (settings.muteAllNotifications || settings.muteNewEvents) return;

          if (plan === 'ultra') {
            // ultra y premium también respetan muteEventRecommendations
            if (settings.muteEventRecommendations) return;
            fireLocalNotification({
              title: `🚀 Evento destacado: ${newEvent.title || 'Nuevo evento'}`,
              body:  `${newEvent.location ? newEvent.location + ' · ' : ''}¡No te lo pierdas!`,
              tag:   `ultra-event-${newEvent.id}`,
              url:   newEvent.community_id
                ? `/community/event/${newEvent.id}`
                : '/community',
            });
          } else if (plan === 'premium') {
            if (settings.muteEventRecommendations) return;
            fireLocalNotification({
              title: `⚡ Nuevo evento Premium: ${newEvent.title || 'Nuevo evento'}`,
              body:  `${newEvent.location ? newEvent.location + ' · ' : ''}¡Échale un vistazo!`,
              tag:   `premium-event-${newEvent.id}`,
              url:   newEvent.community_id
                ? `/community/event/${newEvent.id}`
                : '/community',
            });
          } else {
            // basic — solo miembros de la comunidad (ya filtrado arriba)
            let communityLabel = 'tu comunidad';
            try {
              const { data: comm } = await supabase
                .from('communities')
                .select('name')
                .eq('id', newEvent.community_id)
                .single();
              if (comm?.name) communityLabel = comm.name;
            } catch {}

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

  // ── Supabase Realtime: escucha inserts en event_updates ──────────────────
  // Solo notifica si el usuario está apuntado al evento y NO es el creador
  useEffect(() => {
    if (!profile?.id) return;

    if (updateChannelRef.current) {
      updateChannelRef.current.unsubscribe();
      updateChannelRef.current = null;
    }

    const updateChannel = supabase
      .channel(`event-updates-badge-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'event_updates' },
        async (payload) => {
          const newUpdate = payload.new;

          // Ignorar si no hay datos o si el propio usuario es quien publica
          if (!newUpdate?.id || !newUpdate?.event_id) return;
          if (newUpdate.creator_id === profile.id) return;

          // Verificar asistencia en tiempo real directamente en Supabase
          // (evita race condition con attendingEventIdsRef)
          let isAttending = attendingEventIdsRef.current.has(newUpdate.event_id);
          if (!isAttending) {
            try {
              const { data: att } = await supabase
                .from('community_event_attendees')
                .select('event_id')
                .eq('event_id', newUpdate.event_id)
                .eq('user_id', profile.id)
                .maybeSingle();
              isAttending = !!att;
              // Actualizar el ref si encontramos asistencia
              if (isAttending) {
                attendingEventIdsRef.current = new Set([
                  ...attendingEventIdsRef.current,
                  newUpdate.event_id,
                ]);
              }
            } catch { /* non-fatal */ }
          }

          if (!isAttending) return;

          // Añadir el evento al set de actualizaciones no leídas (badge)
          setEventsWithUpdates(prev => {
            const next = new Set(prev);
            next.add(newUpdate.event_id);
            return next;
          });

          // Notificación local en foreground
          const settings = settingsRef.current;
          if (settings.muteAllNotifications) return;

          // Obtener título del evento para la notificación
          let eventTitle = 'Tu evento';
          try {
            const { data: ev } = await supabase
              .from('community_events')
              .select('title')
              .eq('id', newUpdate.event_id)
              .single();
            if (ev?.title) eventTitle = ev.title;
          } catch {}

          const body = newUpdate.content
            ? (newUpdate.content.length > 80 ? newUpdate.content.slice(0, 77) + '…' : newUpdate.content)
            : '📷 Se ha publicado una imagen';

          fireLocalNotification({
            title: `📣 ${eventTitle}`,
            body,
            tag:   `event-update-${newUpdate.event_id}`,
            url:   `/community/event/${newUpdate.event_id}`,
          });
        }
      )
      .subscribe();

    updateChannelRef.current = updateChannel;

    return () => {
      updateChannel.unsubscribe();
      updateChannelRef.current = null;
    };
  }, [profile?.id]);

  // ── Limpia todos los badges de eventos nuevos ─────────────────────────────
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

  // ── Limpia el badge de actualización de un evento concreto ───────────────
  const clearEventUpdateBadge = useCallback((eventId) => {
    if (!eventId) return;
    setEventsWithUpdates(prev => {
      const next = new Set(prev);
      next.delete(eventId);
      return next;
    });
  }, []);

  // ── Limpia todos los badges de actualizaciones ────────────────────────────
  const clearAllEventUpdateBadges = useCallback(() => {
    setEventsWithUpdates(new Set());
  }, []);

  return (
    <CommunityNotificationsContext.Provider
      value={{
        eventBadgeCount,
        communitiesWithEvents,
        clearEventBadge,
        clearCommunityBadge,
        refreshJoinedCommunities,
        eventsWithUpdates,
        planningUpdateCount,
        clearEventUpdateBadge,
        clearAllEventUpdateBadges,
      }}
    >
      {children}
    </CommunityNotificationsContext.Provider>
  );
}
