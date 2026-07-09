-- ============================================================
-- SocialBattery — Phase 70: Tope diario de notificaciones, a prueba
-- de instancias/ejecuciones concurrentes del cron
-- Run this in Supabase SQL Editor
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
