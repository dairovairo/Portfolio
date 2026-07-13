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

// ── Tope de 1 notificación local/día (salvo evento de tu propia comunidad) ──
// Este listener de Realtime dispara notificaciones locales al instante y en
// paralelo al webpush del backend (que sí respeta el tope de 1/día vía
// user_daily_notification_claims). Sin esto, cada evento ultra/premium que
// se crea dispara un aviso local aparte, sin ningún límite — que es
// exactamente el bug: varios eventos cualquiera notificando el mismo día.
// Usamos la misma clave de día (UTC) que el backend (notificationDay.js)
// para que el criterio de "hoy" sea el mismo.
const DAILY_LOCAL_NOTIF_KEY = 'sb_daily_local_notif_claim';

function getLocalDayKey() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' UTC
}

function hasClaimedLocalNotifToday() {
  try {
    return localStorage.getItem(DAILY_LOCAL_NOTIF_KEY) === getLocalDayKey();
  } catch { return false; }
}

function claimLocalNotifToday() {
  try { localStorage.setItem(DAILY_LOCAL_NOTIF_KEY, getLocalDayKey()); } catch {}
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
  const { muteAllNotifications, muteNewEvents, muteEventRecommendations, muteCommunityThreads, isConversationMuted } = useSettings();

  // eventsByCommunity: { [communityId: string]: number }
  const [eventsByCommunity, setEventsByCommunity] = useState(loadByComMap);

  // eventsWithUpdates: Set<eventId> — eventos planificados con actualizaciones no leídas
  const [eventsWithUpdates, setEventsWithUpdates] = useState(loadUpdatesSet);

  const joinedCommunityIdsRef   = useRef(new Set());
  // Set<eventId> de eventos en los que el usuario está apuntado
  const attendingEventIdsRef    = useRef(new Set());
  const settingsRef             = useRef({ muteAllNotifications, muteNewEvents, muteEventRecommendations, muteCommunityThreads });
  const channelRef              = useRef(null);
  const updateChannelRef        = useRef(null);

  useEffect(() => {
    settingsRef.current = { muteAllNotifications, muteNewEvents, muteEventRecommendations, muteCommunityThreads };
  }, [muteAllNotifications, muteNewEvents, muteEventRecommendations, muteCommunityThreads]);

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

          // Tope de 1 notificación local/día, salvo que el evento sea de una
          // comunidad del usuario (excepción explícita, igual que en el
          // backend): esos SIEMPRE notifican. Un evento genérico ultra/premium
          // que no sea de "tu" comunidad, en cambio, solo dispara aviso si hoy
          // todavía no se ha disparado ninguno.
          if (!isMember && hasClaimedLocalNotifToday()) return;

          // Incrementar badge solo si el evento pertenece a una comunidad conocida del usuario
          // (los ultra/premium sin comunidad no generan badge de comunidad, solo notificación)
          if (isMember) {
            setEventsByCommunity(prev => ({
              ...prev,
              [newEvent.community_id]: (prev[newEvent.community_id] || 0) + 1,
            }));
          }

          const settings = settingsRef.current;
          if (settings.muteAllNotifications) return;

          // "Silenciar recomendaciones de eventos de otras comunidades" solo
          // debe silenciar eventos ultra/premium que NO sean de una comunidad
          // tuya. Los eventos de tus propias comunidades (de cualquier plan,
          // incluidos ultra/premium) se controlan con "Silenciar nuevos
          // eventos de tus comunidades" (muteNewEvents) — antes ultra/premium
          // se silenciaban siempre con muteEventRecommendations aunque fueran
          // de tu propia comunidad, lo cual no era lo esperado.
          if (isMember) {
            if (settings.muteNewEvents) return;
          } else {
            // No socio: aquí solo llegan eventos ultra/premium (ya filtrado
            // arriba en el `if (!isUltraOrPremium && !isMember) return;`)
            if (settings.muteEventRecommendations) return;
          }

          if (plan === 'ultra') {
            claimLocalNotifToday();
            fireLocalNotification({
              title: `🚀 Evento destacado: ${newEvent.title || 'Nuevo evento'}`,
              body:  `${newEvent.location ? newEvent.location + ' · ' : ''}¡No te lo pierdas!`,
              tag:   `ultra-event-${newEvent.id}`,
              url:   newEvent.community_id
                ? `/community/event/${newEvent.id}`
                : '/community',
            });
          } else if (plan === 'premium') {
            claimLocalNotifToday();
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

            claimLocalNotifToday();
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

  // ── Supabase Realtime: escucha el broadcast de nuevas actualizaciones ────
  // Antes escuchaba postgres_changes sobre event_updates directamente, pero
  // ese patrón ya nos dio problemas de fiabilidad con RLS en los chats de
  // grupo/quedada/comunidad (el propio Realtime puede ignorar filas
  // protegidas por RLS sin avisar) — por eso ahí se sustituyó por un
  // broadcast explícito del servidor con la service key. Aplicamos el mismo
  // arreglo aquí: el servidor (broadcastEventUpdateToAttendees en
  // server/routes/community.js) ya comprueba la asistencia y manda el aviso
  // solo a quien corresponde, así que aquí no hace falta volver a verificarlo.
  useEffect(() => {
    if (!profile?.id) return;

    if (updateChannelRef.current) {
      updateChannelRef.current.unsubscribe();
      updateChannelRef.current = null;
    }

    const updateChannel = supabase
      .channel(`event-update-notif-${profile.id}`)
      .on('broadcast', { event: 'new_event_update' }, (msg) => {
        const data = msg.payload;
        if (!data?.event_id) return;
        if (data.creator_id === profile.id) return;

        // Añadir el evento al set de actualizaciones no leídas (badge)
        setEventsWithUpdates(prev => {
          const next = new Set(prev);
          next.add(data.event_id);
          return next;
        });

        // Notificación local en foreground
        const settings = settingsRef.current;
        if (settings.muteAllNotifications) return;
        if (isConversationMuted('event', data.event_id)) return;

        fireLocalNotification({
          title: `${data.kind === 'poll' ? '📊' : '📣'} ${data.event_title || 'Tu evento'}`,
          body:  data.body || 'Nueva actualización',
          tag:   `event-update-${data.event_id}`,
          url:   `/community/event/${data.event_id}`,
        });
      })
      .subscribe();

    updateChannelRef.current = updateChannel;

    return () => {
      updateChannel.unsubscribe();
      updateChannelRef.current = null;
    };
  }, [profile?.id, isConversationMuted]);

  // ── Supabase Realtime: escucha el broadcast de nuevas publicaciones del
  //    hilo de comunidad (server/routes/community.js →
  //    broadcastCommunityPostToMembers). App abierta = notificación local
  //    instantánea; app en segundo plano/cerrada = la cubre el web-push que
  //    manda el mismo endpoint.
  const postChannelRef = useRef(null);
  useEffect(() => {
    if (!profile?.id) return;

    if (postChannelRef.current) {
      postChannelRef.current.unsubscribe();
      postChannelRef.current = null;
    }

    const postChannel = supabase
      .channel(`community-post-notif-${profile.id}`)
      .on('broadcast', { event: 'new_community_post' }, (msg) => {
        const data = msg.payload;
        if (!data?.community_id) return;
        if (data.creator_id === profile.id) return;

        const settings = settingsRef.current;
        if (settings.muteAllNotifications) return;
        if (settings.muteCommunityThreads) return;
        if (isConversationMuted('community_thread', data.community_id)) return;

        fireLocalNotification({
          title: `📌 ${data.community_name || 'Comunidad'}`,
          body:  `${data.creator_name || 'El admin'}: ${data.body || 'Nueva publicación en el hilo'}`,
          tag:   `community-post-${data.community_id}`,
          url:   `/community/${data.community_id}`,
        });
      })
      .subscribe();

    postChannelRef.current = postChannel;

    return () => {
      postChannel.unsubscribe();
      postChannelRef.current = null;
    };
  }, [profile?.id, isConversationMuted]);

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
