import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';

/**
 * PoolInviteNotificationsContext
 *
 * Lleva la cuenta de cuántas quedadas privadas tienen invitaciones
 * pendientes para el usuario (está en pool_invitees pero aún no se ha
 * unido). A diferencia de PoolChatNotificationsContext, esto no es un
 * "no leído" que se marca localmente: es un conteo derivado del estado
 * real en el servidor (GET /pools/invites/count), así que no hace falta
 * lógica de "marcar como visto" — el badge desaparece solo en cuanto el
 * usuario se une (o dejan de tener acceso a la quedada).
 *
 * El badge resultante se usa en dos sitios:
 *   1. El icono "Quedadas" del dock inferior (BottomNav).
 *   2. El tab "🌐 Activos" dentro de PoolsPage.jsx (calculado ahí mismo a
 *      partir de los pools ya cargados, usando el flag is_invited).
 *
 * BUG (arreglado): el dock se quedaba siempre en 0 aunque el tab "Activos"
 * sí mostrara el badge. El tab se refresca a través del canal
 * 'pools-realtime' de PoolsPage.jsx, que escucha postgres_changes sobre
 * hangout_pools/pool_participants — canales que sí reciben eventos. Este
 * contexto, en cambio, dependía solo de postgres_changes sobre
 * pool_invitees, que por lo visto no llega de forma fiable (¿RLS de
 * Realtime sin política de SELECT para el invitado en esa tabla?). Como
 * red fiable escuchamos también el evento de window 'sb-pool-invite', que
 * useMessageNotifications.js emite al recibir el broadcast personal
 * `pool-notif-{userId}` que el servidor ya usa para el push (ese canal usa
 * la service key y no depende de RLS, así que sí llega siempre).
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
});

export function usePoolInviteNotifications() {
  return useContext(PoolInviteNotificationsContext);
}

export function PoolInviteNotificationsProvider({ children }) {
  const { profile } = useAuth();
  const [count, setCount] = useState(0);
  const refreshTimerRef = useRef(null);
  const channelRef = useRef(null);

  const refreshPoolInviteBadge = useCallback(async () => {
    if (!profile?.id) { setCount(0); return; }
    try {
      const { count: n } = await api.get('/pools/invites/count');
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
      }}
    >
      {children}
    </PoolInviteNotificationsContext.Provider>
  );
}
