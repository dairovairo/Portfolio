-- ============================================================
-- SocialBattery — Phase 135: revisión de publicidad, sorteos y permisos
-- Run this in Supabase SQL Editor DESPUÉS de la phase 134 (idempotente)
-- ============================================================
--
-- EJECÚTALA ANTES de desplegar el código de esta fase: el servidor lee las
-- columnas nuevas.
--
--   1. Cobro: 50 primeras entregas gratis por campaña (antes: 0 € si <200) y
--      banner Ultra cobrado aparte, solo si se ve.
--   2. Eventos: se pueden cancelar. Compra mínima de 100 push/banners.
--   3. Sorteos: participación explícita con bases, meta colectiva en los
--      Community, sorteo verificable y seguimiento de la entrega de premios.
--   4. Aportaciones reales con Stripe Connect.
--   5. Permisos: se cierran varios agujeros de RLS (ver sección 6).

-- ── 1. Cobro de campañas ─────────────────────────────────────────────────

ALTER TABLE ad_holds
  ADD COLUMN IF NOT EXISTS free_units             INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_unit_price_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_units_delivered  INTEGER;

-- Reserva: (unidades - gratis) × (precio + precio del extra).
CREATE OR REPLACE FUNCTION wallet_hold_v2(
  p_user UUID, p_kind TEXT, p_target UUID, p_plan TEXT,
  p_unit_price INTEGER, p_units INTEGER, p_free_units INTEGER, p_extra_unit_price INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_free INTEGER := greatest(0, least(coalesce(p_free_units, 0), p_units));
  v_amount BIGINT := (p_units - v_free)::BIGINT * (p_unit_price + coalesce(p_extra_unit_price, 0))::BIGINT;
  v_balance BIGINT;
  v_hold_id UUID;
BEGIN
  IF p_units <= 0 OR p_unit_price < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  INSERT INTO wallets(user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT balance_cents INTO v_balance FROM wallets WHERE user_id = p_user FOR UPDATE;

  IF v_balance < v_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS:%:%', v_amount, v_balance;
  END IF;

  UPDATE wallets SET balance_cents = balance_cents - v_amount, updated_at = now()
  WHERE user_id = p_user RETURNING balance_cents INTO v_balance;

  INSERT INTO ad_holds(user_id, kind, target_id, plan, unit_price_cents, units_contracted,
                       amount_cents, free_units, extra_unit_price_cents)
  VALUES (p_user, p_kind, p_target, p_plan, p_unit_price, p_units,
          v_amount, v_free, coalesce(p_extra_unit_price, 0))
  RETURNING id INTO v_hold_id;

  INSERT INTO wallet_transactions(user_id, type, amount_cents, balance_after, hold_id, description)
  VALUES (p_user, 'hold', -v_amount, v_balance, v_hold_id,
          CASE p_kind WHEN 'raffle' THEN 'Sorteo ' ELSE 'Evento ' END || initcap(p_plan) || ' (' || p_units || ' uds.)');

  RETURN jsonb_build_object('hold_id', v_hold_id, 'amount_cents', v_amount, 'balance_cents', v_balance);
END $$;

-- Liquidación: se cobra cada unidad entregada a partir de las gratis. Sin
-- reserva abierta no hace nada (seguro de llamar varias veces).
CREATE OR REPLACE FUNCTION wallet_settle_v2(
  p_kind TEXT, p_target UUID, p_units_delivered INTEGER, p_extra_units INTEGER, p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h ad_holds%ROWTYPE;
  v_units INTEGER;
  v_extra INTEGER;
  v_charge BIGINT;
  v_refund BIGINT;
  v_balance BIGINT;
BEGIN
  SELECT * INTO h FROM ad_holds
  WHERE kind = p_kind AND target_id = p_target AND status = 'held'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('settled', false);
  END IF;

  v_units := least(greatest(coalesce(p_units_delivered, 0), 0), h.units_contracted);
  v_extra := least(greatest(coalesce(p_extra_units, 0), 0), h.units_contracted);
  v_charge := greatest(0, v_units - h.free_units)::BIGINT * h.unit_price_cents
            + greatest(0, v_extra - h.free_units)::BIGINT * h.extra_unit_price_cents;
  v_charge := least(v_charge, h.amount_cents);
  v_refund := h.amount_cents - v_charge;

  UPDATE ad_holds SET status = 'settled', units_delivered = v_units,
    extra_units_delivered = v_extra, charged_cents = v_charge,
    settle_reason = p_reason, settled_at = now()
  WHERE id = h.id;

  UPDATE wallets SET balance_cents = balance_cents + v_refund, updated_at = now()
  WHERE user_id = h.user_id RETURNING balance_cents INTO v_balance;

  IF v_refund > 0 THEN
    INSERT INTO wallet_transactions(user_id, type, amount_cents, balance_after, hold_id, description)
    VALUES (h.user_id, 'release', v_refund, v_balance, h.id,
            v_units || ' de ' || h.units_contracted || ' entregadas, cobrado ' ||
            replace(to_char(v_charge / 100.0, 'FM999990.00'), '.', ',') || ' €');
  END IF;

  RETURN jsonb_build_object('settled', true, 'hold_id', h.id, 'charged_cents', v_charge,
                            'refunded_cents', v_refund, 'balance_cents', v_balance);
END $$;

-- Historial de campañas: al renovar o finalizar se guarda un resumen, en vez
-- de perder las métricas del ciclo anterior.
CREATE TABLE IF NOT EXISTS ad_campaign_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID REFERENCES communities(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('event', 'raffle')),
  target_id     UUID NOT NULL,
  title         TEXT,
  plan          TEXT,
  contracted    INTEGER,
  delivered     INTEGER NOT NULL DEFAULT 0,
  clicks        INTEGER NOT NULL DEFAULT 0,
  banner_views  INTEGER NOT NULL DEFAULT 0,
  charged_cents BIGINT NOT NULL DEFAULT 0,
  reason        TEXT,
  ended_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_campaign_history_community_idx
  ON ad_campaign_history(community_id, ended_at DESC);
ALTER TABLE ad_campaign_history ENABLE ROW LEVEL SECURITY;

-- Impresiones del banner Ultra que se cobran (las de los propios miembros de
-- la comunidad organizadora no).
ALTER TABLE event_ultra_banner_impressions
  ADD COLUMN IF NOT EXISTS billable BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS event_ultra_banner_impressions_user_idx
  ON event_ultra_banner_impressions(user_id, first_shown_at DESC);

-- ── 2. Eventos ───────────────────────────────────────────────────────────

ALTER TABLE community_events
  ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE community_events DROP CONSTRAINT IF EXISTS community_events_notification_count_range;
ALTER TABLE community_events ADD CONSTRAINT community_events_notification_count_range
  CHECK (
    (promotion_plan = 'basic' AND notification_count IS NULL)
    OR (promotion_plan IN ('premium', 'ultra') AND notification_count BETWEEN 100 AND 50000)
  );

-- ── 3. Sorteos ───────────────────────────────────────────────────────────

ALTER TABLE community_raffles DROP CONSTRAINT IF EXISTS community_raffles_banner_views_contracted_check;
ALTER TABLE community_raffles ADD CONSTRAINT community_raffles_banner_views_contracted_check
  CHECK (banner_views_contracted IS NULL OR banner_views_contracted BETWEEN 100 AND 100000);

ALTER TABLE community_raffles
  -- false en los sorteos anteriores a esta fase: ahí participan todos los
  -- miembros, como hasta ahora.
  ADD COLUMN IF NOT EXISTS requires_entry    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS goal_cents        INTEGER CHECK (goal_cents IS NULL OR goal_cents BETWEEN 500 AND 1000000),
  ADD COLUMN IF NOT EXISTS organizer_name    TEXT,
  ADD COLUMN IF NOT EXISTS organizer_contact TEXT,
  ADD COLUMN IF NOT EXISTS rules_text        TEXT,
  -- sha256(seed) publicado al crear; la semilla se revela al sortear.
  ADD COLUMN IF NOT EXISTS draw_commit       TEXT,
  ADD COLUMN IF NOT EXISTS draw_seed         TEXT,
  ADD COLUMN IF NOT EXISTS draw_entries      INTEGER,
  -- Último aviso a los miembros al renovar (NULL = el de la creación).
  ADD COLUMN IF NOT EXISTS member_notice_at  TIMESTAMPTZ;

-- La semilla NO puede estar en community_raffles antes de sortear: los
-- miembros pueden leer esa tabla.
CREATE TABLE IF NOT EXISTS raffle_draw_secrets (
  raffle_id UUID PRIMARY KEY REFERENCES community_raffles(id) ON DELETE CASCADE,
  seed      TEXT NOT NULL,
  -- Participantes y papeletas en el momento del sorteo: [{u, t}].
  entries   JSONB
);
ALTER TABLE raffle_draw_secrets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS raffle_entries (
  raffle_id   UUID NOT NULL REFERENCES community_raffles(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (raffle_id, user_id)
);
CREATE INDEX IF NOT EXISTS raffle_entries_user_idx ON raffle_entries(user_id);
ALTER TABLE raffle_entries ENABLE ROW LEVEL SECURITY;

ALTER TABLE community_raffle_prizes
  -- Premio extra: solo se sortea si la comunidad llega a la meta.
  ADD COLUMN IF NOT EXISTS requires_goal    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claim_status     TEXT,
  ADD COLUMN IF NOT EXISTS claim_deadline   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS previous_winners UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE community_raffle_prizes DROP CONSTRAINT IF EXISTS community_raffle_prizes_claim_status_check;
ALTER TABLE community_raffle_prizes ADD CONSTRAINT community_raffle_prizes_claim_status_check
  CHECK (claim_status IS NULL OR claim_status IN ('pending','claimed','delivered','received','disputed'));

-- ── 4. Aportaciones reales (Stripe Connect) ──────────────────────────────

ALTER TABLE community_collaborations
  -- 'legacy' = aportación simbólica de antes de que hubiera pagos: no cuenta
  -- para ninguna meta. 'paid' solo lo escribe el servidor tras cobrar.
  ADD COLUMN IF NOT EXISTS status            TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS payment_ref       TEXT,
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;
ALTER TABLE community_collaborations DROP CONSTRAINT IF EXISTS community_collaborations_status_check;
ALTER TABLE community_collaborations ADD CONSTRAINT community_collaborations_status_check
  CHECK (status IN ('legacy', 'paid', 'refunded'));
-- Sin WHERE: PostgREST necesita un índice único completo para el upsert
-- (los NULL no chocan entre sí).
CREATE UNIQUE INDEX IF NOT EXISTS community_collaborations_payment_ref_key
  ON community_collaborations(payment_ref);

CREATE TABLE IF NOT EXISTS creator_payout_accounts (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL UNIQUE,
  charges_enabled   BOOLEAN NOT NULL DEFAULT false,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE creator_payout_accounts ENABLE ROW LEVEL SECURITY;

-- Recaudado por una comunidad en un periodo (meta de los sorteos Community).
CREATE OR REPLACE FUNCTION community_raised_cents(
  p_community_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ
) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(amount_cents), 0)::BIGINT
    FROM community_collaborations
   WHERE community_id = p_community_id AND status = 'paid'
     AND created_at >= p_from AND created_at <= p_to;
$$;

-- ── 5. Actividades vivas ─────────────────────────────────────────────────

-- Un evento cancelado deja de ocupar hueco.
CREATE OR REPLACE FUNCTION community_active_activity_count(p_community_id UUID)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT COUNT(*)::INTEGER FROM community_events
       WHERE community_id = p_community_id
         AND cancelled_at IS NULL
         AND COALESCE(ends_at, event_date) > NOW())
    +
    (SELECT COUNT(*)::INTEGER FROM community_raffles
       WHERE community_id = p_community_id
         AND drawn_at IS NULL
         AND ends_at > NOW());
$$;

-- Total de un usuario entre todas sus comunidades (límite del plan gratis).
CREATE OR REPLACE FUNCTION user_active_activity_count(p_user_id UUID)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT COUNT(*)::INTEGER FROM community_events
       WHERE creator_id = p_user_id
         AND cancelled_at IS NULL
         AND COALESCE(ends_at, event_date) > NOW())
    +
    (SELECT COUNT(*)::INTEGER FROM community_raffles
       WHERE creator_id = p_user_id
         AND drawn_at IS NULL
         AND ends_at > NOW());
$$;

-- ── 6. Permisos ──────────────────────────────────────────────────────────
-- La clave anónima es pública (va en el cliente), así que cualquier policy
-- de escritura se puede usar saltándose el servidor.

-- 6a. Eventos: con estas policies cualquiera podía darse una promoción Ultra
--     de 50.000 push sin pagar. La app solo escribe eventos desde el servidor.
DROP POLICY IF EXISTS "Authenticated users can create events" ON community_events;
DROP POLICY IF EXISTS "Creators can update own events"        ON community_events;
DROP POLICY IF EXISTS "Creators can delete own events"        ON community_events;

-- 6b. Miembros: nadie puede apuntarse a una comunidad como admin.
DROP POLICY IF EXISTS "Users can join communities" ON community_members;
CREATE POLICY "Users can join communities" ON community_members
  FOR INSERT WITH CHECK (auth.uid() = user_id AND role = 'member');

-- 6c. Usuarios: is_admin, las suscripciones y el cliente de Stripe solo los
--     cambia el servidor (la phase 134 no cubría is_admin ni el INSERT).
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION protect_paid_user_flags() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
       IN ('authenticated','anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.is_admin           := false;
      NEW.is_volt_subscriber := false;
      NEW.is_enterprise      := false;
      NEW.stripe_customer_id := NULL;
    ELSE
      NEW.is_admin           := OLD.is_admin;
      NEW.is_volt_subscriber := OLD.is_volt_subscriber;
      NEW.is_enterprise      := OLD.is_enterprise;
      NEW.stripe_customer_id := OLD.stripe_customer_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_paid_user_flags ON users;
CREATE TRIGGER protect_paid_user_flags BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION protect_paid_user_flags();

-- 6d. Funciones internas: REVOKE ... FROM PUBLIC no basta en Supabase, que da
--     EXECUTE a anon y authenticated por defecto. Con increment_event_* se
--     podía agotar la campaña de otro.
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'wallet_hold_v2', 'wallet_settle_v2', 'community_raised_cents',
         'community_active_activity_count', 'user_active_activity_count',
         'increment_event_notification_sent_count',
         'increment_event_ultra_banner_views', 'increment_event_ultra_banner_clicks',
         'increment_event_url_clicks', 'increment_community_url_clicks',
         'community_event_ad_stats', 'community_raffle_ad_stats')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
