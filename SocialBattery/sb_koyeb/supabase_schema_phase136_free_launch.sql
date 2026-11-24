-- ============================================================
-- SocialBattery — Phase 136: lanzamiento gratuito
-- Run this in Supabase SQL Editor DESPUÉS de la phase 135 (idempotente)
-- ============================================================
--
-- EJECÚTALA ANTES de desplegar el código de esta fase.
--
-- Mientras los pagos están apagados la promoción de eventos y sorteos es
-- gratis. Para que unas pocas cuentas no acaparen los avisos y banners, cada
-- cuenta tiene un tope de campañas activas y de campañas por cada 30 días.
-- Los números están en server/lib/freePromo.js.

CREATE TABLE IF NOT EXISTS free_promo_launches (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('event', 'raffle')),
  target_id  UUID NOT NULL,
  units      INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_free_promo_launches_user
  ON free_promo_launches(user_id, created_at DESC);

-- Solo la usa el servidor (service key): sin policies, nadie más entra.
ALTER TABLE free_promo_launches ENABLE ROW LEVEL SECURITY;

-- Campañas gratis activas de una cuenta: en marcha y con algo por entregar (sin
-- contar p_exclude: al renovar no se cuenta la propia actividad).
CREATE OR REPLACE FUNCTION free_promo_active_count(p_user UUID, p_exclude UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT COUNT(*)::INTEGER FROM community_events
       WHERE creator_id = p_user
         AND promotion_plan IN ('premium', 'ultra')
         AND cancelled_at IS NULL
         AND event_date > NOW()
         AND COALESCE(notification_sent_count, 0) < COALESCE(notification_count, 0)
         AND id IS DISTINCT FROM p_exclude)
    +
    (SELECT COUNT(*)::INTEGER FROM community_raffles r
       WHERE r.creator_id = p_user
         AND r.tier = 'light'
         AND r.promo_ended_at IS NULL
         AND r.drawn_at IS NULL
         AND r.ends_at > NOW()
         AND COALESCE(r.banner_views_contracted, 0) > (
           SELECT COUNT(*) FROM raffle_banner_targets t
            WHERE t.raffle_id = r.id AND t.shown_at IS NOT NULL)
         AND r.id IS DISTINCT FROM p_exclude);
$$;

-- Comprueba los topes y apunta la campaña. El candado por usuario evita que
-- dos peticiones a la vez se salten el tope.
CREATE OR REPLACE FUNCTION free_promo_launch(
  p_user UUID, p_kind TEXT, p_target UUID, p_units INTEGER,
  p_max_active INTEGER, p_max_month INTEGER
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('free_promo:' || p_user::text, 0));

  IF free_promo_active_count(p_user, p_target) >= p_max_active THEN
    RAISE EXCEPTION 'FREE_PROMO_LIMIT:active';
  END IF;

  IF (SELECT COUNT(*) FROM free_promo_launches
       WHERE user_id = p_user AND created_at > NOW() - INTERVAL '30 days') >= p_max_month THEN
    RAISE EXCEPTION 'FREE_PROMO_LIMIT:month';
  END IF;

  INSERT INTO free_promo_launches(user_id, kind, target_id, units)
  VALUES (p_user, p_kind, p_target, GREATEST(COALESCE(p_units, 0), 0));
END $$;

DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('free_promo_active_count', 'free_promo_launch')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
