-- ============================================================
-- SocialBattery — Phase 123: Métricas del banner del menú principal
--                            (evento Ultra)
-- Run this in Supabase SQL Editor
-- ============================================================
-- El plan Ultra tiene una prestación exclusiva: el evento "notificado
-- hoy" aparece como panel fino en el menú principal (HomePage) —
-- fase 109. Hasta ahora nadie contaba ni cuántas veces se enseñaba ese
-- banner, ni cuántas veces la gente lo tapeaba para abrir el evento.
-- El dashboard de publicidad enseñaba SOLO los clicks a la notificación
-- push (event_promo_notifications.clicked_at), pero no la mitad que
-- justifica el precio extra del plan Ultra frente a Premium.
--
-- Esta fase añade dos contadores acumulados a community_events y las
-- RPCs para incrementarlos atómicamente. NO se usa tabla granular como
-- en la fase 111 (event_promo_notifications) porque el banner del menú
-- principal NO tiene concepto de "target" — no se le asigna a un
-- usuario concreto, se enseña sí o sí a quien tenga un claim del día
-- (ver GET /notifications/today-event). Con contador plano basta para
-- lo que el dashboard tiene que enseñar: vistas del banner y CTR
-- respecto a esas vistas.
--
-- Los sorteos tienen un mecanismo distinto (raffle_banner_targets) por
-- eso NO se aplica aquí: aquellos SÍ eligen a quién enseñar el banner,
-- así que necesitan filas por target para poder deduplicar por
-- persona. En el banner Ultra "cuántas veces se enseñó" es
-- exactamente lo que quiere medir el organizador (impresiones), no
-- personas únicas.

ALTER TABLE public.community_events
  ADD COLUMN IF NOT EXISTS ultra_banner_views  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultra_banner_clicks INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.community_events.ultra_banner_views IS
  'Impresiones acumuladas del banner del menú principal (exclusivo Ultra). Se incrementa cada vez que GET /notifications/today-event devuelve el evento como banner. NO son personas únicas: si el mismo usuario abre el menú principal 3 veces en el día, suma 3. Para Premium y Basic queda a 0 (el banner no aparece).';
COMMENT ON COLUMN public.community_events.ultra_banner_clicks IS
  'Clicks acumulados al banner del menú principal (exclusivo Ultra). Se incrementa desde POST /events/:id/ultra-banner-click cuando el usuario tapea el banner. Igual que views: contador ingenuo, no dedupe por persona.';

-- ── RPCs de incremento atómico ────────────────────────────────────────────
-- Mismo patrón que las de la fase 121 (URL clicks): SECURITY DEFINER,
-- EXECUTE limitado a service_role. La autenticación del usuario se
-- comprueba en el server (requireAuth), no aquí — desde el cliente vía
-- PostgREST no se puede llamar. STRICT para que un id inexistente sea
-- NO-OP y no ensucie logs si el evento se borró entre el ping y el
-- procesamiento.

CREATE OR REPLACE FUNCTION public.increment_event_ultra_banner_views(p_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.community_events
    SET ultra_banner_views = ultra_banner_views + 1
    WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION public.increment_event_ultra_banner_clicks(p_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.community_events
    SET ultra_banner_clicks = ultra_banner_clicks + 1
    WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.increment_event_ultra_banner_views(UUID)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_event_ultra_banner_clicks(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_event_ultra_banner_views(UUID)  TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_event_ultra_banner_clicks(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
