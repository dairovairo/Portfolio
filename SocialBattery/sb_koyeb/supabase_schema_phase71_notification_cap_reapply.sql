-- ============================================================
-- SocialBattery — Phase 71: Re-aplicación segura del tope diario
-- de notificaciones (fases 68 + 69 + 70 en un solo script)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Este archivo NO cambia ninguna regla nueva: es exactamente la unión de
-- supabase_schema_phase68_event_notification_count.sql +
-- supabase_schema_phase69_event_notification_pacing.sql +
-- supabase_schema_phase70_atomic_daily_notification_cap.sql.
--
-- Se creó porque, tras 2 días depurando "el tope diario no funciona", la
-- causa más probable si el código del servidor ya es correcto es que UNA
-- de esas tres migraciones no se llegó a ejecutar en Supabase (o se
-- ejecutó contra el proyecto equivocado). Las tres usan siempre
-- CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE
-- FUNCTION / DROP POLICY IF EXISTS, así que re-ejecutar este archivo entero
-- es 100% seguro pase lo que pase con lo que ya exista.
--
-- Después de correr esto, comprueba GET /api/debug/notifications con el
-- header x-debug-secret — debe devolver reachable:true en los 4 checks.

-- ============ Fase 68 ============
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


-- ============ Fase 69 ============
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


-- ============ Fase 70 ============
-- ============================================================
-- Bug real: durante el bucle de crashes/reinicios en Railway (ya arreglado),
-- llegaron a convivir brevemente dos procesos, cada uno con su propio cron
-- (*/5 * * * *). server/jobs/eventPromoPacing.js decidía a quién notificar
-- con un patrón "leer quién fue notificado hoy" -> (más tarde) "escribir el
-- envío". No es atómico: dos ejecuciones solapadas pueden leer ambas "nadie
-- notificado todavía" para el mismo usuario y disparar las dos.
--
-- Esta fase mueve la reserva del "hueco del día" a una operación atómica de
-- Postgres (INSERT ... ON CONFLICT DO NOTHING sobre una clave única
-- (user_id, claim_date)), inmune a que corran 1, 2 o N instancias a la vez:
-- solo una puede ganar la fila para un usuario y un día dados, sea cual sea
-- el número de procesos que lo intenten en paralelo.
--
-- Esta tabla es la ÚNICA fuente de verdad para el tope de 1
-- notificación/usuario/día. event_promo_notifications se mantiene tal cual
-- (deduplicar el mismo evento+usuario y contar notification_sent_count),
-- pero deja de usarse para calcular "¿a quién ya se le avisó hoy?".
--
-- Los eventos de comunidad SIEMPRE se notifican a sus miembros (excepción
-- explícita al tope), pero también reservan el hueco del día para que ese
-- mismo usuario no reciba además un evento genérico no relacionado el mismo
-- día. Esa reserva no compite por nada (siempre se envía primero), así que
-- un simple upsert ignorando conflictos es suficiente ahí.

CREATE TABLE IF NOT EXISTS public.user_daily_notification_claims (
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  claim_date  DATE NOT NULL,
  event_id    UUID REFERENCES public.community_events(id) ON DELETE SET NULL,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, claim_date)
);

COMMENT ON TABLE public.user_daily_notification_claims IS
  'Reserva atómica del hueco de "1 notificación promocional/día" por usuario. La UNIQUE (user_id, claim_date) vía PRIMARY KEY hace que INSERT ... ON CONFLICT DO NOTHING sea inmune a carreras entre instancias/ticks concurrentes. Fuente de verdad para el tope diario; event_promo_notifications sigue existiendo aparte para deduplicar por evento y alimentar notification_sent_count.';

CREATE INDEX IF NOT EXISTS idx_user_daily_notification_claims_date
  ON public.user_daily_notification_claims (claim_date);

ALTER TABLE public.user_daily_notification_claims ENABLE ROW LEVEL SECURITY;

-- Solo el backend (service role, que bypassea RLS) lee/escribe esta tabla.
DROP POLICY IF EXISTS "Service role only" ON public.user_daily_notification_claims;
CREATE POLICY "Service role only"
  ON public.user_daily_notification_claims
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- ------------------------------------------------------------------
-- Incremento atómico de notification_sent_count.
--
-- El mismo archivo (eventPromoPacing.js) también tenía un segundo
-- read-then-write no atómico: leía event.notification_sent_count y luego
-- escribía "valor leído + enviados", con la misma ventana de carrera (una
-- ejecución solapada podía pisar el incremento de la otra -> contador de
-- facturación por debajo de lo realmente enviado). Se corrige aquí de paso
-- con un UPDATE atómico a nivel de fila (Postgres serializa los UPDATEs
-- concurrentes sobre la misma fila), y de propina se evita pasarse del
-- cupo contratado con el LEAST().
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_event_notification_sent_count(
  p_event_id UUID,
  p_delta INTEGER
)
RETURNS INTEGER
LANGUAGE sql
AS $$
  UPDATE public.community_events
  SET notification_sent_count = LEAST(notification_count, notification_sent_count + p_delta)
  WHERE id = p_event_id
  RETURNING notification_sent_count;
$$;

COMMENT ON FUNCTION public.increment_event_notification_sent_count IS
  'Incremento atómico de community_events.notification_sent_count (evita lost updates entre ejecuciones concurrentes del job de pacing) y evita superar notification_count.';
