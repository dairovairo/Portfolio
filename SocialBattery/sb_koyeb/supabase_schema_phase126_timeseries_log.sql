-- ============================================================
-- SocialBattery — Phase 126: log de eventos para métricas
--                            temporales del dashboard
-- Run this in Supabase SQL Editor
-- ============================================================
-- El dashboard va a enseñar gráficos temporales de todas las métricas de
-- publicidad. Las siguientes ya tienen timestamps por fila y NO
-- necesitan nada nuevo:
--
--   · event_promo_notifications.sent_at    (envíos push evento)
--   · event_promo_notifications.clicked_at (clicks push evento)
--   · raffle_banner_targets.created_at     (banners asignados a usuario)
--   · raffle_banner_targets.shown_at       (banners realmente enseñados)
--   · raffle_banner_targets.clicked_at     (clicks al banner del sorteo)
--
-- El problema son las métricas que hoy son SOLO un contador entero,
-- añadidas en fases posteriores (121 y 123):
--
--   · community_events.url_click_count      (fase 121)
--   · community_events.ultra_banner_views   (fase 123)
--   · community_events.ultra_banner_clicks  (fase 123)
--   · communities.url_click_count           (fase 121)
--
-- No se puede reconstruir historia de un contador entero: solo sabemos
-- el total acumulado. A partir de esta fase se sigue actualizando el
-- contador (para el fast-path del dashboard), PERO además se inserta
-- una fila por evento en la tabla nueva promo_metric_events. Los
-- gráficos temporales de esas métricas mostrarán solo lo que pase
-- desde el día en que se ejecute esta migración — es lo mejor que se
-- puede hacer sin cambiar el modelo de datos.
--
-- Modelo:
--   Tabla ÚNICA promo_metric_events (no una por métrica) para no
--   multiplicar tablas de dos columnas. `kind` diferencia el tipo de
--   evento; `target_id` es el id de la entidad a la que aplica
--   (event/community). No hay FK a community_events/communities porque
--   un solo target_id apunta a tipos distintos según kind; validación
--   de existencia se hace en el server antes del insert.

CREATE TABLE IF NOT EXISTS public.promo_metric_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Discriminador. Valores actuales:
  --   'event_url_click'     — click al enlace externo del evento
  --   'ultra_banner_view'   — impresión del banner Ultra (HomePage)
  --   'ultra_banner_click'  — click al banner Ultra
  --   'community_url_click' — click al enlace externo de la comunidad
  -- Al añadir nuevos tipos, actualizar también el CHECK y el endpoint
  -- de timeseries en server/routes/community.js.
  kind       TEXT NOT NULL CHECK (kind IN (
    'event_url_click', 'ultra_banner_view', 'ultra_banner_click', 'community_url_click'
  )),
  -- id del evento o comunidad según el kind. Sin FK — los kinds
  -- 'event_*' apuntan a community_events.id, los 'community_*' apuntan
  -- a communities.id. La validación de existencia la hace el server
  -- antes de insertar (endpoints que ya comprueban permisos).
  target_id  UUID NOT NULL,
  -- Usuario que realizó la acción. NULL cuando el evento no tiene
  -- usuario claramente asociado (p.ej. un scan cron podría querer
  -- insertar; hoy no aplica). Para gráficos de "personas únicas por
  -- bucket" en futuras iteraciones se agregaría COUNT(DISTINCT user_id).
  user_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice principal: la consulta más común del endpoint de timeseries
-- es "todos los eventos de tipo X para target Y en rango de fechas
-- [A, B]". Este índice compuesto (kind, target_id, created_at) cubre
-- exactamente ese acceso.
CREATE INDEX IF NOT EXISTS idx_promo_metric_events_kind_target_ts
  ON public.promo_metric_events (kind, target_id, created_at);

COMMENT ON TABLE public.promo_metric_events IS 'Log de eventos con timestamp para poder reconstruir series temporales de métricas de publicidad que hoy son solo contador. Fase 126. Los contadores agregados en community_events y communities se siguen actualizando en paralelo (fast-path del dashboard).';

-- ── RLS ───────────────────────────────────────────────────────────────────
-- No se lee nunca desde el cliente vía PostgREST — todo pasa por el
-- server con service_role. RLS enabled sin policy = tabla vacía para
-- cualquier rol autenticado, lo cual es exactamente lo que queremos:
-- solo el service_role bypasea RLS y puede leer/escribir.
ALTER TABLE public.promo_metric_events ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
