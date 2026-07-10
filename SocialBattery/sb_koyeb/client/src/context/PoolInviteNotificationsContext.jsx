import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';

/**
 * PoolInviteNotificationsContext
 *
 * Lleva la cuenta de cuántas quedadas privadas tienen invitaciones
 * pendientes para el usuario (está en pool_invitees pero aún no se ha
 * unido). A diferencia de PoolChatNotificationsContext, el conjunto de
 * invitaciones pendientes (`pendingIds`) es un dato derivado del estado
 * real en el servidor (GET /pools/invites/count, que ahora también
 * devuelve `ids`), no algo que el cliente pueda inventar — no hace falta
 * lógica de "marcar como visto" para saber que una invitación existe, esa
 * parte desaparece sola en cuanto el usuario se une (o pierde acceso).
 *
 * Lo que SÍ se marca localmente es qué invitaciones ya ha *visto* el
 * usuario (`seenIds`, persistido en localStorage) — así, al entrar en la
 * sección de Quedadas, el badge desaparece aunque el usuario todavía no se
 * haya unido a esas quedadas. Si llega una invitación nueva después, vuelve
 * a aparecer, porque esa invitación no está en `seenIds`.
 *
 * El badge resultante (`poolInviteBadgeCount` = pendientes - vistas) se usa
 * en dos sitios:
 *   1. El icono "Quedadas" del dock inferior (BottomNav).
 *   2. El tab "🌐 Activos" dentro de PoolsPage.jsx.
 * Ambos leen directamente de aquí, así que se sincronizan solos: no hace
 * falta que PoolsPage calcule su propio conteo a partir de `pool.is_invited`.
 * PoolsPage llama a `markPoolInvitesSeen()` al montar para vaciar ambos
 * badges (ver comentario en ese archivo).
 *
 * BUG (arreglado, fase anterior): el dock se quedaba siempre en 0 aunque el
 * tab "Activos" sí mostrara el badge. El tab se refrescaba a través del
 * canal 'pools-realtime' de PoolsPage.jsx, que escucha postgres_changes
 * sobre hangout_pools/pool_participants — canales que sí reciben eventos.
 * Este contexto, en cambio, dependía solo de postgres_changes sobre
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
  markPoolInvitesSeen: () => {},
});

export function usePoolInviteNotifications() {
  return useContext(PoolInviteNotificationsContext);
}

const STORAGE_KEY_SEEN = 'sb_pool_invite_seen'; // Set<poolId> serializado como array JSON

function loadSeenSet() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SEEN);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveSeenSet(set) {
  try { localStorage.setItem(STORAGE_KEY_SEEN, JSON.stringify([...set])); } catch {}
}

export function PoolInviteNotificationsProvider({ children }) {
  const { profile } = useAuth();
  const [pendingIds, setPendingIds] = useState([]);
  const [seenIds, setSeenIds] = useState(loadSeenSet);
  const pendingIdsRef = useRef([]);
  const refreshTimerRef = useRef(null);
  const channelRef = useRef(null);

  useEffect(() => { pendingIdsRef.current = pendingIds; }, [pendingIds]);

  useEffect(() => { saveSeenSet(seenIds); }, [seenIds]);

  // Limpieza: si una invitación ya no está pendiente (el usuario se unió, la
  // quitaron, o la quedada se cerró), no tiene sentido seguir guardando su id
  // como "vista" — se poda del set para que no crezca sin límite.
  useEffect(() => {
    setSeenIds(prev => {
      const pendingSet = new Set(pendingIds);
      const next = new Set([...prev].filter(id => pendingSet.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [pendingIds]);

  const poolInviteBadgeCount = pendingIds.filter(id => !seenIds.has(id)).length;

  const refreshPoolInviteBadge = useCallback(async () => {
    if (!profile?.id) { setPendingIds([]); return; }
    try {
      const { ids } = await api.get('/pools/invites/count');
      setPendingIds(Array.isArray(ids) ? ids : []);
    } catch { /* non-fatal — se reintentará en el próximo evento realtime */ }
  }, [profile?.id]);

  // Marca como vistas todas las invitaciones pendientes conocidas ahora
  // mismo — se llama al entrar en la sección de Quedadas (PoolsPage), así
  // ambos badges (dock + tab "Activos") desaparecen de golpe.
  const markPoolInvitesSeen = useCallback(() => {
    setSeenIds(prev => {
      const next = new Set(prev);
      let changed = false;
      pendingIdsRef.current.forEach(id => {
        if (!next.has(id)) { next.add(id); changed = true; }
      });
      return changed ? next : prev;
    });
  }, []);

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
        poolInviteBadgeCount,
        refreshPoolInviteBadge,
        markPoolInvitesSeen,
      }}
    >
      {children}
    </PoolInviteNotificationsContext.Provider>
  );
}
