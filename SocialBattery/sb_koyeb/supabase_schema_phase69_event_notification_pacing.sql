-- ============================================================
-- SocialBattery — Phase 69: Pacing de notificaciones Premium/Ultra
-- Run this in Supabase SQL Editor
-- ============================================================
-- Hasta ahora, al publicar un evento premium/ultra se disparaban TODAS las
-- notificaciones contratadas de golpe (fire-and-forget), sin:
--   · registrar a quién se había notificado (no habia forma de saber
--     cuántas se habían enviado realmente, solo cuántas se contrataron)
--   · ningún tope de frecuencia por usuario
--   · reparto entre varios eventos activos a la vez
--
-- A partir de esta fase, el envío se reparte en el tiempo (job periódico,
-- ver server/jobs/eventPromoPacing.js) hasta el inicio del evento:
--   · Máximo 1 notificación promocional (premium/ultra) por usuario y día,
--     contando TODOS los eventos activos (no solo el mismo evento).
--   · Se prioriza que cada evento alcance las 200 notificaciones mínimas
--     (umbral de cobro) antes de repartir el resto de forma uniforme.
--   · notification_sent_count es la cifra real enviada hasta el inicio del
--     evento, y será la base para la facturación (cuando se implemente).

-- 1. Contador de notificaciones REALMENTE enviadas (vs. notification_count = contratadas)
ALTER TABLE public.community_events
  ADD COLUMN IF NOT EXISTS notification_sent_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.community_events.notification_sent_count IS
  'Nº de notificaciones promocionales (premium/ultra) realmente enviadas hasta el momento (o hasta el inicio del evento). Se compara con notification_count (contratadas) y es la base de facturación tras el inicio del evento.';

-- 2. Log de envíos: una fila por (evento, usuario) notificado.
--    Sirve para:
--      a) no notificar dos veces al mismo usuario por el mismo evento
--      b) calcular el tope de 1 notificación/usuario/día ENTRE TODOS los eventos
--      c) auditar cuántas se enviaron realmente por evento (notification_sent_count)
CREATE TABLE IF NOT EXISTS public.event_promo_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES public.community_events(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

-- Índice para el chequeo diario "¿a quién ya se ha notificado hoy?" (across events)
CREATE INDEX IF NOT EXISTS idx_event_promo_notifications_user_day
  ON public.event_promo_notifications (user_id, sent_at);

-- Índice para leer rápido el historial de un evento concreto
CREATE INDEX IF NOT EXISTS idx_event_promo_notifications_event
  ON public.event_promo_notifications (event_id);

ALTER TABLE public.event_promo_notifications ENABLE ROW LEVEL SECURITY;

-- Solo el backend (service role, que bypassea RLS) lee/escribe esta tabla;
-- ningún cliente necesita acceso directo.
DROP POLICY IF EXISTS "Service role only" ON public.event_promo_notifications;
CREATE POLICY "Service role only"
  ON public.event_promo_notifications
  FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.event_promo_notifications IS
  'Log de notificaciones push promocionales (premium/ultra) enviadas, por evento y usuario. Usado por server/jobs/eventPromoPacing.js para deduplicar, calcular notification_sent_count y aplicar el tope de 1 notificación promocional por usuario y día (across events).';
