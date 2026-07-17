-- ============================================================
-- SocialBattery — Phase 111: Dashboard de publicidad de comunidad
-- Run this in Supabase SQL Editor
-- ============================================================
-- Hasta ahora, de toda la publicidad contratada (eventos Premium/Ultra y
-- sorteos Light/Volt/Community) el creador de la comunidad solo veía dos
-- cifras sueltas y desperdigadas:
--
--   · notification_sent_count / notification_count en el detalle del evento
--     (fase 68/69).
--   · banner_views_sent / banner_views_contracted en el cartelito de la
--     tarjeta de sorteo (fase 102/103).
--
-- Faltaba lo importante para saber si la publicidad FUNCIONA:
--
--   a) CLICKS. No se registraba en ningún sitio si alguien llegó a tocar la
--      notificación push del evento o la avioneta del sorteo. Sin esto no
--      hay CTR y no hay forma de comparar campañas.
--
--   b) A QUIÉN se envió. event_promo_notifications y raffle_banner_targets
--      guardan el user_id, pero no si ese usuario era "interesado" (sus
--      users.interests cruzan con las categorías del evento/comunidad) o
--      no. Cruzarlo a posteriori sería mentir: los intereses del perfil
--      cambian con el tiempo, y lo que importa es cómo estaba el usuario EN
--      EL MOMENTO del envío. Así que se congela en la propia fila.
--
--      Ojo: en un evento/sorteo contratado con el filtro duro activo
--      (audience_interested_only / banner_interested_only, fases 104/105)
--      esto es trivialmente TRUE para todas las filas — el desglose
--      interesados/no interesados solo aporta información cuando NO se
--      filtró, que es justo el caso que el dashboard destaca (¿merece la
--      pena pagar por el filtro? compara el CTR de los dos segmentos).
--
--   c) POR QUÉ se envió. event_promo_notifications mezcla dos cosas muy
--      distintas: el aviso inmediato a los MIEMBROS de la comunidad (que se
--      manda siempre, sea cual sea el plan, y NO cuenta contra el cupo
--      contratado — ver POST /events en community.js) y los envíos
--      PUBLICITARIOS que reparte el job de pacing (que sí cuentan y son la
--      base de facturación). Sin distinguirlos, el total de la tabla nunca
--      cuadraría con el notification_sent_count que se enseña en el resto
--      de la app.
--
-- Filas anteriores a esta fase se quedan con NULL en las tres columnas
-- nuevas: son datos que no se capturaron en su momento y no se inventan.
-- El dashboard los agrupa aparte como "sin clasificar" (ver
-- CommunityDashboardPage.jsx).

-- ── 1. Envíos de eventos Premium/Ultra ────────────────────────────────────
ALTER TABLE public.event_promo_notifications
  ADD COLUMN IF NOT EXISTS clicked_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS matched_interest BOOLEAN,
  ADD COLUMN IF NOT EXISTS source           TEXT;

-- Defensivo: si esta migración (u otra cosa) ya dejó algún valor en
-- `source` que no sea uno de los dos válidos — por ejemplo un reintento
-- parcial de este mismo script, o una cadena vacía en vez de NULL — se
-- normaliza a NULL ANTES de añadir la constraint, para que "añadir la
-- CHECK" nunca falle por datos ya existentes. NULL sigue significando lo
-- mismo de siempre: "fila anterior a la fase 111 / sin clasificar", así
-- que no se pierde información real, solo se descarta un valor que ya
-- era inválido de por sí.
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

-- Índice para el conteo de clicks por evento del dashboard.
CREATE INDEX IF NOT EXISTS idx_event_promo_notifications_clicked
  ON public.event_promo_notifications (event_id)
  WHERE clicked_at IS NOT NULL;

-- ── 2. Targets del banner volador de sorteos ──────────────────────────────
ALTER TABLE public.raffle_banner_targets
  ADD COLUMN IF NOT EXISTS clicked_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS matched_interest BOOLEAN;

COMMENT ON COLUMN public.raffle_banner_targets.clicked_at IS
  'Momento en que el usuario tocó la avioneta (o el push del sorteo) y aterrizó en la comunidad → POST /raffles/:raffleId/banner-click. NULL = banner mostrado (shown_at) pero no tocado.';
COMMENT ON COLUMN public.raffle_banner_targets.matched_interest IS
  'TRUE si en el momento de asignar el target users.interests cruzaba con communities.categories. NULL = no clasificable (comunidad sin categorías, o fila anterior a la fase 111).';

CREATE INDEX IF NOT EXISTS idx_raffle_banner_targets_clicked
  ON public.raffle_banner_targets (raffle_id)
  WHERE clicked_at IS NOT NULL;

-- ── 3. Agregación para el dashboard ───────────────────────────────────────
-- Los conteos se hacen en Postgres, no en JS, por dos motivos:
--
--   · Volumen. Un sorteo Volt asigna un target por CADA usuario de la app
--     (capCount = null, ver assignRaffleBannerTargets): traerse esas filas
--     al servidor para contarlas en memoria no escala, y PostgREST además
--     pagina a 1000 filas por defecto.
--   · Round trips. El desglose son 9-10 conteos por evento y por sorteo; a
--     base de .select(count: 'exact', head: true) serían cientos de
--     peticiones para pintar una sola pantalla.
--
-- Los nombres de las columnas de salida llevan prefijo stat_ a propósito:
-- en una función LANGUAGE sql los parámetros de RETURNS TABLE son visibles
-- dentro del cuerpo, y un OUT llamado event_id chocaría con la columna
-- event_id de la tabla ("column reference is ambiguous").
CREATE OR REPLACE FUNCTION public.community_event_ad_stats(p_community_id UUID)
RETURNS TABLE (
  stat_event_id         UUID,
  sends_total           BIGINT,
  sends_community       BIGINT,
  sends_promo           BIGINT,
  sends_unknown_source  BIGINT,
  sends_interested      BIGINT,
  sends_not_interested  BIGINT,
  sends_unknown_interest BIGINT,
  clicks_total          BIGINT,
  clicks_interested     BIGINT,
  clicks_not_interested BIGINT,
  last_click_at         TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    n.event_id,
    COUNT(*),
    COUNT(*) FILTER (WHERE n.source = 'community'),
    COUNT(*) FILTER (WHERE n.source = 'promo'),
    COUNT(*) FILTER (WHERE n.source IS NULL),
    COUNT(*) FILTER (WHERE n.matched_interest IS TRUE),
    COUNT(*) FILTER (WHERE n.matched_interest IS FALSE),
    COUNT(*) FILTER (WHERE n.matched_interest IS NULL),
    COUNT(*) FILTER (WHERE n.clicked_at IS NOT NULL),
    COUNT(*) FILTER (WHERE n.clicked_at IS NOT NULL AND n.matched_interest IS TRUE),
    COUNT(*) FILTER (WHERE n.clicked_at IS NOT NULL AND n.matched_interest IS FALSE),
    MAX(n.clicked_at)
  FROM public.event_promo_notifications n
  JOIN public.community_events e ON e.id = n.event_id
  WHERE e.community_id = p_community_id
  GROUP BY n.event_id;
$$;

CREATE OR REPLACE FUNCTION public.community_raffle_ad_stats(p_community_id UUID)
RETURNS TABLE (
  stat_raffle_id        UUID,
  targets_total         BIGINT,
  shown_total           BIGINT,
  shown_interested      BIGINT,
  shown_not_interested  BIGINT,
  shown_unknown_interest BIGINT,
  clicks_total          BIGINT,
  clicks_interested     BIGINT,
  clicks_not_interested BIGINT,
  last_click_at         TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.raffle_id,
    COUNT(*),
    COUNT(*) FILTER (WHERE t.shown_at IS NOT NULL),
    COUNT(*) FILTER (WHERE t.shown_at IS NOT NULL AND t.matched_interest IS TRUE),
    COUNT(*) FILTER (WHERE t.shown_at IS NOT NULL AND t.matched_interest IS FALSE),
    COUNT(*) FILTER (WHERE t.shown_at IS NOT NULL AND t.matched_interest IS NULL),
    COUNT(*) FILTER (WHERE t.clicked_at IS NOT NULL),
    COUNT(*) FILTER (WHERE t.clicked_at IS NOT NULL AND t.matched_interest IS TRUE),
    COUNT(*) FILTER (WHERE t.clicked_at IS NOT NULL AND t.matched_interest IS FALSE),
    MAX(t.clicked_at)
  FROM public.raffle_banner_targets t
  JOIN public.community_raffles r ON r.id = t.raffle_id
  WHERE r.community_id = p_community_id
  GROUP BY t.raffle_id;
$$;

-- Solo el backend (service role) llama a estas funciones; el permiso de
-- "eres el creador de esta comunidad" se comprueba en
-- GET /api/community/communities/:id/dashboard, no aquí. Como son SECURITY
-- DEFINER, se revoca el EXECUTE por defecto de PUBLIC para que ningún
-- cliente autenticado pueda pedir las métricas de una comunidad ajena
-- llamando a la RPC directamente vía PostgREST.
REVOKE ALL ON FUNCTION public.community_event_ad_stats(UUID)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_raffle_ad_stats(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_event_ad_stats(UUID)  TO service_role;
GRANT EXECUTE ON FUNCTION public.community_raffle_ad_stats(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
