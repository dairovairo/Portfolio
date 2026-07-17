import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';

/**
 * PoolInviteNotificationsContext
 *
 * Lleva la cuenta de cuántas notificaciones de "creación de quedada" sin ver
 * tiene el usuario — tanto quedadas públicas de un amigo como invitaciones a
 * quedadas privadas — y a las que aún no se ha unido.
 *
 * El badge resultante se usa en dos sitios, que SIEMPRE muestran el mismo
 * número porque ambos leen de aquí (antes cada uno calculaba el suyo por
 * separado y se desincronizaban):
 *   1. El icono "Quedadas" del dock inferior (BottomNav).
 *   2. El tab "🌐 Activos" dentro de PoolsPage.jsx.
 *
 * BUG #1 (arreglado): el conteo salía de GET /pools/invites/count, que SOLO
 * contaba invitaciones privadas (pool_invitees). Pero el servidor manda la
 * misma notificación ("🎉 Fulano propone una quedada") tanto para invitaciones
 * privadas como para quedadas públicas notificadas a los amigos del creador
 * — y estas últimas nunca generan fila en pool_invitees, así que el badge
 * nunca aparecía para ellas pese a que la notificación sí llegaba. Ahora se
 * usa GET /pools/notifications/count?since=..., que cubre ambos casos.
 *
 * BUG #2 (arreglado): no existía forma de "marcar como visto" — el badge solo
 * bajaba si el usuario se unía a la quedada, así que si entrabas al tab
 * "Activos" sin unirte, el badge se quedaba puesto. Ahora se guarda un
 * timestamp "última vez visto" (localStorage, por usuario) y
 * markPoolNotificationsSeen() lo actualiza a "ahora" — PoolsPage.jsx lo llama
 * al montar (= entrar en el menú Quedadas), y eso vacía el badge en ambos
 * sitios a la vez porque comparten este mismo estado.
 *
 * IMPORTANTE: NO abrir aquí un canal de Supabase con el mismo nombre
 * `pool-notif-{userId}` — ese canal ya lo abre y suscribe
 * useMessageNotifications.js, y Supabase reutiliza el canal existente si el
 * topic coincide; un segundo .subscribe() sobre el mismo objeto rompe la
 * suscripción entera (así se rompió el badge la primera vez que se intentó
 * este fix). Por eso el punto de enganche aquí es el evento de window, no
 * un canal nuevo.
 */
const PoolInviteNotificationsContext = createContext({
  poolInviteBadgeCount: 0,
  refreshPoolInviteBadge: () => {},
  markPoolNotificationsSeen: () => {},
});

export function usePoolInviteNotifications() {
  return useContext(PoolInviteNotificationsContext);
}

function storageKey(userId) {
  return `sb_pools_notif_last_seen:${userId}`;
}

function loadLastSeen(userId) {
  try { return localStorage.getItem(storageKey(userId)); } catch { return null; }
}

function saveLastSeen(userId, iso) {
  try { localStorage.setItem(storageKey(userId), iso); } catch { /* non-fatal */ }
}

export function PoolInviteNotificationsProvider({ children }) {
  const { profile } = useAuth();
  const [count, setCount] = useState(0);
  const refreshTimerRef = useRef(null);
  const channelRef = useRef(null);

  const refreshPoolInviteBadge = useCallback(async () => {
    if (!profile?.id) { setCount(0); return; }

    // Primera vez que este usuario usa la app en este dispositivo: no hay
    // "última vez visto" guardado. Lo inicializamos a "ahora" en vez de
    // contar todo el historial de quedadas — el badge arranca en 0 y solo
    // sube con quedadas creadas a partir de este momento.
    let lastSeen = loadLastSeen(profile.id);
    if (!lastSeen) {
      lastSeen = new Date().toISOString();
      saveLastSeen(profile.id, lastSeen);
      setCount(0);
      return;
    }

    try {
      const { count: n } = await api.get(`/pools/notifications/count?since=${encodeURIComponent(lastSeen)}`);
      setCount(n || 0);
    } catch { /* non-fatal — se reintentará en el próximo evento realtime */ }
  }, [profile?.id]);

  useEffect(() => { refreshPoolInviteBadge(); }, [refreshPoolInviteBadge]);

  // Varios eventos pueden llegar seguidos (p. ej. el creador invita a 3
  // amigos a la vez) — debounce corto para no machacar el endpoint.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      refreshPoolInviteBadge();
    }, 500);
  }, [refreshPoolInviteBadge]);

  // Marca todas las notificaciones de quedadas como vistas — se llama al
  // entrar en el menú Quedadas (PoolsPage.jsx), y limpia el badge del dock
  // inferior Y el del tab "Activos" a la vez, porque ambos leen `count`.
  const markPoolNotificationsSeen = useCallback(() => {
    if (!profile?.id) return;
    saveLastSeen(profile.id, new Date().toISOString());
    setCount(0);
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`pool-invite-badge-${profile.id}`)
      // Te acaban de invitar (directamente o por solicitud aceptada) →
      // el badge sube.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pool_invitees' },
        (payload) => { if (payload.new?.user_id === profile.id) scheduleRefresh(); })
      // Te unes a la quedada (o te retiran la invitación) → el badge baja.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pool_participants' },
        (payload) => { if (payload.new?.user_id === profile.id) scheduleRefresh(); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'pool_invitees' },
        (payload) => { if (payload.old?.user_id === profile.id) scheduleRefresh(); })
      .subscribe();

    // Evento de window emitido por useMessageNotifications.js cuando llega el
    // broadcast personal `pool-notif-{userId}` (mismo canal que usa el push
    // del servidor, sin depender de RLS). No abrimos un canal de Supabase
    // aquí a propósito — ver comentario del bloque de arriba del archivo.
    // Se dispara tanto para quedadas públicas como privadas.
    const handleInviteBroadcast = () => scheduleRefresh();
    window.addEventListener('sb-pool-invite', handleInviteBroadcast);

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('sb-pool-invite', handleInviteBroadcast);
      channelRef.current = null;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [profile?.id, scheduleRefresh]);

  return (
    <PoolInviteNotificationsContext.Provider
      value={{
        poolInviteBadgeCount: count,
        refreshPoolInviteBadge,
        markPoolNotificationsSeen,
      }}
    >
      {children}
    </PoolInviteNotificationsContext.Provider>
  );
}
