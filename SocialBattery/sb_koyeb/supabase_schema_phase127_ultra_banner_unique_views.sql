-- ============================================================
-- SocialBattery — Phase 127: impresiones del banner Ultra,
--                            una por usuario (no por carga de menú)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Bug de la fase 123: GET /notifications/today-event incrementaba
-- ultra_banner_views CADA VEZ que el endpoint se llamaba — es decir,
-- cada vez que el usuario cargaba o recargaba el menú principal
-- mientras tuviera el claim del evento para ese día. Un usuario que
-- entra 10 veces al día sumaba 10 impresiones, cuando en realidad vio
-- (y "gastó" su hueco publicitario de) el mismo banner una sola vez.
--
-- Esta fase añade una tabla de "ya visto" (event_id, user_id) con
-- PRIMARY KEY compuesta, para que el server pueda comprobar de forma
-- atómica "¿es la primera vez que ESTE usuario ve ESTE banner?" antes
-- de incrementar el contador o loguear en promo_metric_events. A partir
-- de ahora, ultra_banner_views deja de ser "impresiones brutas" y pasa
-- a ser "usuarios distintos alcanzados" (reach) — el dato que de verdad
-- le importa al organizador. El contador de clicks (ultra_banner_clicks)
-- NO se toca: sigue siendo bruto, igual que el resto de métricas de
-- clicks a enlaces (fase 121), porque ahí sí interesa la tracción total,
-- no solo alcance.
--
-- Nota: los valores de ultra_banner_views acumulados ANTES de esta
-- migración están inflados por recargas repetidas — no se pueden
-- corregir retroactivamente sin perder el dato. A partir de aquí el
-- contador es preciso.

CREATE TABLE IF NOT EXISTS public.event_ultra_banner_impressions (
  event_id       UUID NOT NULL REFERENCES public.community_events(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  first_shown_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

COMMENT ON TABLE public.event_ultra_banner_impressions IS
  'Fase 127. Marca de "este usuario ya vio el banner del menú principal de este evento". Se usa con upsert + ignoreDuplicates para contar cada usuario una sola vez en community_events.ultra_banner_views, sin importar cuántas veces recargue el menú.';

ALTER TABLE public.event_ultra_banner_impressions ENABLE ROW LEVEL SECURITY;
-- Sin policy: solo el service_role (que bypassa RLS) lee/escribe aquí.
-- El cliente nunca llama a esta tabla directamente.

NOTIFY pgrst, 'reload schema';
