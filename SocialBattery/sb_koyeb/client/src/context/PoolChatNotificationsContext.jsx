import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * PoolChatNotificationsContext
 *
 * Lleva la cuenta de qué quedadas tienen mensajes de chat sin leer.
 * No abre ninguna suscripción propia a Supabase: escucha el evento global
 * `sb-pool-message` que emite useMessageNotifications.js cada vez que llega
 * un broadcast `new_pool_message` (el mismo que dispara el push), así se
 * evita duplicar canales sobre el mismo topic `pool-chat-notif-{userId}`.
 *
 * El badge resultante se usa en tres sitios:
 *   1. El botón "Chat" dentro del panel de una quedada (ParticipantsSheet).
 *   2. La propia tarjeta de la quedada en el listado (PoolCard).
 *   3. El icono "Quedadas" del dock inferior (BottomNav).
 */
const PoolChatNotificationsContext = createContext({
  unreadPoolChats: new Set(),
  poolChatBadgeCount: 0,
  hasUnreadPoolChat: () => false,
  clearPoolChatBadge: () => {},
});

export function usePoolChatNotifications() {
  return useContext(PoolChatNotificationsContext);
}

const STORAGE_KEY = 'sb_pool_chat_unread'; // Set<poolId> serializado como array JSON

function loadUnreadSet() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveUnreadSet(set) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set])); } catch {}
}

export function PoolChatNotificationsProvider({ children }) {
  const location = useLocation();
  const locationRef = useRef(location.pathname);
  useEffect(() => { locationRef.current = location.pathname; }, [location.pathname]);

  const [unreadPoolChats, setUnreadPoolChats] = useState(loadUnreadSet);

  useEffect(() => {
    saveUnreadSet(unreadPoolChats);
  }, [unreadPoolChats]);

  useEffect(() => {
    function handlePoolMessage(e) {
      const data = e.detail;
      if (!data?.pool_id) return;

      // Si el usuario ya tiene ese chat abierto en primer plano, no lo marques como no leído
      const chatPath = `/pools/${data.pool_id}/chat`;
      if (!document.hidden && locationRef.current === chatPath) return;

      setUnreadPoolChats(prev => {
        if (prev.has(data.pool_id)) return prev;
        const next = new Set(prev);
        next.add(data.pool_id);
        return next;
      });
    }

    window.addEventListener('sb-pool-message', handlePoolMessage);
    return () => window.removeEventListener('sb-pool-message', handlePoolMessage);
  }, []);

  const clearPoolChatBadge = useCallback((poolId) => {
    if (!poolId) return;
    setUnreadPoolChats(prev => {
      if (!prev.has(poolId)) return prev;
      const next = new Set(prev);
      next.delete(poolId);
      return next;
    });
  }, []);

  const hasUnreadPoolChat = useCallback(
    (poolId) => unreadPoolChats.has(poolId),
    [unreadPoolChats]
  );

  return (
    <PoolChatNotificationsContext.Provider
      value={{
        unreadPoolChats,
        poolChatBadgeCount: unreadPoolChats.size,
        hasUnreadPoolChat,
        clearPoolChatBadge,
      }}
    >
      {children}
    </PoolChatNotificationsContext.Provider>
  );
}
