-- Fase 118: silencio global de notificaciones de check-in del Sniffer
-- ("Estoy dentro" / círculo verde de la quedada).
--
-- Mismo patrón que mute_pool_chats (fase 91) / mute_new_events (fase 92):
-- server-persisted para que aplique tanto en foreground (broadcast +
-- fireNotification en useMessageNotifications.js) como en segundo
-- plano/app cerrada (web-push real vía notifyUsers en routes/pools.js).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mute_pool_sniffer BOOLEAN NOT NULL DEFAULT false;
