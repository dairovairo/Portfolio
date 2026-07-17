-- ============================================================
-- SocialBattery — Phase 112: Fix NOT NULL residual en event_promo_notifications.source
-- Run this in Supabase SQL Editor
-- ============================================================
-- La fase 111 debía añadir tres columnas nuevas a event_promo_notifications:
-- clicked_at, matched_interest y source (las tres nullable — NULL = fila
-- anterior a esa fase, sin clasificar, ver comentario de cada columna).
--
-- Un intento previo de aplicar esa migración se quedó a medias: solo llegó
-- a crear `source`, y encima con NOT NULL (nunca se llegó a ejecutar el
-- resto del script, que es el que documenta que debe ser nullable). Como
-- el ALTER TABLE de la fase 111 usa `ADD COLUMN IF NOT EXISTS`, al ya
-- existir `source` ese ALTER no la vuelve a tocar y el NOT NULL residual
-- se queda, rompiendo los inserts de source='community' (aviso inmediato,
-- POST /events en community.js) y source='promo' (job de pacing,
-- eventPromoPacing.js).
--
-- Este fix es idempotente y no borra ni modifica datos: primero se
-- asegura de que las tres columnas existan (por si clicked_at o
-- matched_interest tampoco llegaron a crearse) y luego relaja el
-- constraint de `source` para que vuelva a ser nullable, tal y como el
-- propio diseño de la fase 111 (y su CHECK, que ya permite NULL) siempre
-- pretendió.

-- 1. Asegura que las tres columnas existan (no-op si ya están).
ALTER TABLE public.event_promo_notifications
  ADD COLUMN IF NOT EXISTS clicked_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS matched_interest BOOLEAN,
  ADD COLUMN IF NOT EXISTS source           TEXT;

-- 2. Quita el NOT NULL residual de `source` (la causa del error).
ALTER TABLE public.event_promo_notifications
  ALTER COLUMN source DROP NOT NULL;

-- 3. Repone el CHECK de la fase 111 (por si tampoco llegó a aplicarse en
--    ese intento parcial). DROP + ADD para que sea repetible sin fallar
--    si ya existe.
UPDATE public.event_promo_notifications
  SET source = NULL
  WHERE source IS NOT NULL AND source NOT IN ('community', 'promo');

ALTER TABLE public.event_promo_notifications
  DROP CONSTRAINT IF EXISTS event_promo_notifications_source_check;
ALTER TABLE public.event_promo_notifications
  ADD CONSTRAINT event_promo_notifications_source_check
    CHECK (source IS NULL OR source IN ('community', 'promo'));

COMMENT ON COLUMN public.event_promo_notifications.clicked_at IS
  'Momento en que el usuario abrió el evento desde la notificación (?src= en la URL del push → POST /events/:id/ad-click). NULL = enviada pero no tocada. Solo se marca la PRIMERA vez.';
COMMENT ON COLUMN public.event_promo_notifications.matched_interest IS
  'TRUE si en el momento del envío users.interests cruzaba con community_events.categories. NULL = no clasificable (evento sin categorías, o fila anterior a la fase 111).';
COMMENT ON COLUMN public.event_promo_notifications.source IS
  'community = aviso inmediato a miembros de la comunidad (no cuenta contra el cupo contratado). promo = envío publicitario del job de pacing (sí cuenta, base de facturación). NULL = fila anterior a la fase 111.';

CREATE INDEX IF NOT EXISTS idx_event_promo_notifications_clicked
  ON public.event_promo_notifications (event_id)
  WHERE clicked_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
