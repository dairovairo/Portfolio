-- ============================================================
-- SocialBattery — Phase 92: Silenciar nuevos eventos de tus comunidades /
-- Silenciar recomendaciones de eventos de otras comunidades (ajuste global)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Mismo problema que mute_new_pools (fase 90) y mute_pool_chats /
-- mute_community_chats (fase 91): estos dos toggles de Ajustes >
-- Notificaciones vivían solo en localStorage (SettingsContext) y nunca se
-- consultaban server-side, así que NO silenciaban nada — el aviso real de
-- "nuevo evento en tu comunidad" (POST /community/events y
-- /renew-promotion) y el de recomendaciones premium/ultra
-- (server/jobs/eventPromoPacing.js) son web-push que el servidor manda
-- siempre, sin mirar ningún ajuste de usuario, y llegan igual con la app en
-- foreground o en segundo plano/cerrada.
--
-- mute_new_events:          silencia el aviso inmediato de "nuevo evento en
--                            tu comunidad" (cualquier plan) para las
--                            comunidades de las que el usuario es miembro.
-- mute_event_recommendations: silencia el reparto premium/ultra hacia fuera
--                            de tus comunidades (el "recomendado" a usuarios
--                            que no son miembros) — los eventos de tus
--                            propias comunidades los sigue controlando
--                            mute_new_events, no este ajuste.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS mute_new_events           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mute_event_recommendations boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
