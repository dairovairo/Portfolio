-- Fase 107 — Silenciar avisos inmediatos de nuevos sorteos de mi comunidad.
--
-- Hasta ahora notifyCommunityRaffleTargets (server/routes/community.js) enviaba
-- broadcast + web-push a los miembros de la comunidad del sorteo (tier
-- Community y la intersección de Volt con miembros) SIN comprobar ninguna
-- preferencia del usuario. Fase 92 introdujo el patrón "silenciar nuevos
-- eventos de tus comunidades" (users.mute_new_events); esta fase añade el
-- equivalente para sorteos.
--
-- Se filtra tanto el broadcast (avioneta popup instantánea con la app abierta)
-- como el web-push (con la app en segundo plano/cerrada): si el usuario ha
-- silenciado nuevos sorteos, no quiere ver ni el pop-up ni la notificación.
-- Mismo criterio que mute_new_events / mute_new_pools.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mute_new_raffles boolean NOT NULL DEFAULT false;
