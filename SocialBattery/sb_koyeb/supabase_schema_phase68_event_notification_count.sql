-- ============================================================
-- SocialBattery — Phase 68: Notificaciones Premium/Ultra on-demand con tope
-- Run this in Supabase SQL Editor
-- ============================================================
-- Hasta ahora el número de notificaciones push enviadas al publicar un
-- evento Premium/Ultra era un límite fijo hardcodeado en el servidor
-- (PREMIUM_LIMIT / ULTRA_LIMIT en server/routes/community.js).
--
-- A partir de esta fase, quien crea el evento elige cuántas notificaciones
-- quiere contratar (500 - 50.000) al seleccionar Premium o Ultra. Ese
-- número se guarda en community_events.notification_count y es lo que el
-- servidor usa como `limit` al llamar a notifyUpToNUsers().
--
-- Reglas:
--   · plan 'basic'            → notification_count debe ser NULL (no aplica)
--   · plan 'premium' / 'ultra'→ notification_count obligatorio, entre 500 y 50.000

ALTER TABLE public.community_events
  ADD COLUMN IF NOT EXISTS notification_count INTEGER;

ALTER TABLE public.community_events DROP CONSTRAINT IF EXISTS community_events_notification_count_range;
ALTER TABLE public.community_events ADD CONSTRAINT community_events_notification_count_range
  CHECK (
    (promotion_plan = 'basic' AND notification_count IS NULL)
    OR (promotion_plan IN ('premium', 'ultra') AND notification_count BETWEEN 500 AND 50000)
  );

COMMENT ON COLUMN public.community_events.notification_count IS
  'Nº de notificaciones push contratadas on-demand para planes premium/ultra (500-50000). NULL para basic.';
