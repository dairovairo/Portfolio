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

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
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
