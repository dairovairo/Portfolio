-- ============================================================
-- SocialBattery — Phase 134: monedero prepago, pagos, Volts y suscripciones
-- Run this in Supabase SQL Editor (idempotente: se puede re-ejecutar)
-- ============================================================
--
-- Modelo "saldo prepago" para la publicidad (eventos Premium/Ultra y
-- sorteos Light/Community):
--
--   1. El usuario recarga saldo (packs de 10/25/50/100/250 €) con Stripe
--      en la web o con Google Play Billing en la app. Cada pago verificado
--      queda en `payments` (provider_ref UNIQUE => idempotente: un webhook
--      repetido o un reintento del cliente nunca acredita dos veces).
--   2. Al lanzar una campaña se RESERVA el importe máximo
--      (unidades contratadas × precio unitario) => `ad_holds` status='held'.
--      El saldo disponible baja en ese importe.
--   3. Al terminar la campaña (finalizar, renovar, empezar el evento,
--      terminar/sortear el sorteo) se LIQUIDA: se cobra solo lo entregado
--      (si supera el umbral mínimo; si no, 0) y el resto vuelve al saldo.
--
-- Además:
--   * `user_volts`: saldo de Volts (moneda de la mascota) en servidor. Antes
--     vivía en localStorage, lo que no sirve si se venden Volts con dinero.
--   * `subscriptions`: suscripciones Volt / Enterprise (Stripe o Play).
--     users.is_volt_subscriber / users.is_enterprise se derivan de aquí.
--
-- Todas las funciones son SECURITY DEFINER y solo las puede ejecutar la
-- service_role (el backend). Ningún cliente puede tocar saldos directamente.

-- ── Tablas ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wallets (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_cents  BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  provider      TEXT NOT NULL CHECK (provider IN ('stripe','google_play')),
  provider_ref  TEXT NOT NULL,
  product_id    TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('wallet_topup','volts','subscription')),
  amount_cents  BIGINT NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'eur',
  status        TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','refunded')),
  raw           JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_ref)
);
CREATE INDEX IF NOT EXISTS payments_user_idx ON payments(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ad_holds (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('event','raffle')),
  target_id         UUID NOT NULL,
  plan              TEXT NOT NULL,
  unit_price_cents  INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  units_contracted  INTEGER NOT NULL CHECK (units_contracted >= 0),
  amount_cents      BIGINT NOT NULL CHECK (amount_cents >= 0),
  status            TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','settled')),
  units_delivered   INTEGER,
  charged_cents     BIGINT,
  settle_reason     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at        TIMESTAMPTZ
);
-- Como mucho UNA reserva abierta por campaña.
CREATE UNIQUE INDEX IF NOT EXISTS ad_holds_one_open_per_target
  ON ad_holds(kind, target_id) WHERE status = 'held';
CREATE INDEX IF NOT EXISTS ad_holds_user_idx ON ad_holds(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- topup: recarga | hold: reserva | release: devolución de reserva
  -- fee: cargo directo (p.ej. sorteo Community) | adjust: ajuste manual/reembolso
  type          TEXT NOT NULL CHECK (type IN ('topup','hold','release','fee','adjust')),
  -- Efecto sobre el saldo disponible (positivo suma, negativo resta).
  amount_cents  BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  hold_id       UUID REFERENCES ad_holds(id) ON DELETE SET NULL,
  payment_id    UUID REFERENCES payments(id) ON DELETE SET NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_tx_user_idx ON wallet_transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_volts (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance          BIGINT NOT NULL DEFAULT 150 CHECK (balance >= 0),
  last_daily_claim DATE,
  last_weekly_grant DATE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL CHECK (provider IN ('stripe','google_play')),
  -- Stripe: subscription id (sub_...). Play: purchaseToken.
  provider_ref     TEXT NOT NULL,
  product_id       TEXT NOT NULL CHECK (product_id IN ('sub_volt','sub_enterprise')),
  status           TEXT NOT NULL,           -- active | canceled | expired | past_due | on_hold ...
  current_period_end TIMESTAMPTZ,
  auto_renew       BOOLEAN NOT NULL DEFAULT true,
  raw              JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_ref)
);
CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions(user_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_enterprise BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- RLS: el cliente solo puede LEER lo suyo. Escrituras => backend (service_role).
ALTER TABLE wallets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_holds            ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_volts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read own wallet" ON wallets;
CREATE POLICY "read own wallet" ON wallets FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "read own payments" ON payments;
CREATE POLICY "read own payments" ON payments FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "read own holds" ON ad_holds;
CREATE POLICY "read own holds" ON ad_holds FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "read own wallet tx" ON wallet_transactions;
CREATE POLICY "read own wallet tx" ON wallet_transactions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "read own volts" ON user_volts;
CREATE POLICY "read own volts" ON user_volts FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "read own subscriptions" ON subscriptions;
CREATE POLICY "read own subscriptions" ON subscriptions FOR SELECT USING (auth.uid() = user_id);

-- Que nadie se ponga a sí mismo de suscriptor/enterprise desde el cliente
-- (users suele tener una policy de UPDATE sobre la propia fila).
CREATE OR REPLACE FUNCTION protect_paid_user_flags() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
       IN ('authenticated','anon') THEN
    NEW.is_volt_subscriber := OLD.is_volt_subscriber;
    NEW.is_enterprise      := OLD.is_enterprise;
    NEW.stripe_customer_id := OLD.stripe_customer_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_paid_user_flags ON users;
CREATE TRIGGER protect_paid_user_flags BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION protect_paid_user_flags();

-- ── Funciones del monedero ───────────────────────────────────────────────

-- Recarga idempotente. Devuelve {credited, balance_cents}.
CREATE OR REPLACE FUNCTION wallet_topup(
  p_user UUID, p_provider TEXT, p_ref TEXT, p_product TEXT,
  p_amount BIGINT, p_currency TEXT DEFAULT 'eur', p_raw JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_payment_id UUID;
  v_balance BIGINT;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  INSERT INTO payments(user_id, provider, provider_ref, product_id, kind, amount_cents, currency, raw)
  VALUES (p_user, p_provider, p_ref, p_product, 'wallet_topup', p_amount, p_currency, p_raw)
  ON CONFLICT (provider, provider_ref) DO NOTHING
  RETURNING id INTO v_payment_id;

  IF v_payment_id IS NULL THEN
    SELECT balance_cents INTO v_balance FROM wallets WHERE user_id = p_user;
    RETURN jsonb_build_object('credited', false, 'balance_cents', coalesce(v_balance, 0));
  END IF;

  INSERT INTO wallets(user_id, balance_cents) VALUES (p_user, p_amount)
  ON CONFLICT (user_id) DO UPDATE
    SET balance_cents = wallets.balance_cents + EXCLUDED.balance_cents, updated_at = now()
  RETURNING balance_cents INTO v_balance;

  INSERT INTO wallet_transactions(user_id, type, amount_cents, balance_after, payment_id, description)
  VALUES (p_user, 'topup', p_amount, v_balance, v_payment_id, 'Recarga ' || p_product);

  RETURN jsonb_build_object('credited', true, 'balance_cents', v_balance);
END $$;

-- Reserva el importe máximo de una campaña. Lanza INSUFFICIENT_FUNDS si no
-- llega el saldo (el backend lo traduce a HTTP 402).
CREATE OR REPLACE FUNCTION wallet_hold(
  p_user UUID, p_kind TEXT, p_target UUID, p_plan TEXT,
  p_unit_price INTEGER, p_units INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_amount BIGINT := p_unit_price::BIGINT * p_units::BIGINT;
  v_balance BIGINT;
  v_hold_id UUID;
BEGIN
  INSERT INTO wallets(user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT balance_cents INTO v_balance FROM wallets WHERE user_id = p_user FOR UPDATE;

  IF v_balance < v_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS:%:%', v_amount, v_balance;
  END IF;

  UPDATE wallets SET balance_cents = balance_cents - v_amount, updated_at = now()
  WHERE user_id = p_user RETURNING balance_cents INTO v_balance;

  INSERT INTO ad_holds(user_id, kind, target_id, plan, unit_price_cents, units_contracted, amount_cents)
  VALUES (p_user, p_kind, p_target, p_plan, p_unit_price, p_units, v_amount)
  RETURNING id INTO v_hold_id;

  INSERT INTO wallet_transactions(user_id, type, amount_cents, balance_after, hold_id, description)
  VALUES (p_user, 'hold', -v_amount, v_balance, v_hold_id,
          'Reserva campaña ' || p_kind || ' (' || p_plan || ', ' || p_units || ' uds.)');

  RETURN jsonb_build_object('hold_id', v_hold_id, 'amount_cents', v_amount, 'balance_cents', v_balance);
END $$;

-- Liquida la reserva abierta de una campaña: cobra solo lo entregado
-- (min(entregado, contratado) × precio unitario) si se alcanzó el umbral
-- mínimo de facturación; si no, 0. El resto vuelve al saldo. Si no hay
-- reserva abierta no hace nada (campañas anteriores a los pagos, o ya
-- liquidadas) — así es seguro llamarla varias veces.
DROP FUNCTION IF EXISTS wallet_settle(text,uuid,integer,bigint,text);
CREATE OR REPLACE FUNCTION wallet_settle(
  p_kind TEXT, p_target UUID, p_units_delivered INTEGER, p_threshold INTEGER, p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h ad_holds%ROWTYPE;
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

  IF coalesce(p_units_delivered, 0) >= coalesce(p_threshold, 0) THEN
    v_charge := least(greatest(p_units_delivered, 0), h.units_contracted)::BIGINT * h.unit_price_cents;
  ELSE
    v_charge := 0;
  END IF;
  v_charge := least(v_charge, h.amount_cents);
  v_refund := h.amount_cents - v_charge;

  UPDATE ad_holds SET status = 'settled', units_delivered = p_units_delivered,
    charged_cents = v_charge, settle_reason = p_reason, settled_at = now()
  WHERE id = h.id;

  UPDATE wallets SET balance_cents = balance_cents + v_refund, updated_at = now()
  WHERE user_id = h.user_id RETURNING balance_cents INTO v_balance;

  IF v_refund > 0 THEN
    INSERT INTO wallet_transactions(user_id, type, amount_cents, balance_after, hold_id, description)
    VALUES (h.user_id, 'release', v_refund, v_balance, h.id,
            'Devolución campaña: ' || p_units_delivered || '/' || h.units_contracted ||
            ' entregadas, cobrado ' || to_char(v_charge / 100.0, 'FM999990.00') || ' €');
  END IF;

  RETURN jsonb_build_object('settled', true, 'hold_id', h.id, 'charged_cents', v_charge,
                            'refunded_cents', v_refund, 'balance_cents', v_balance);
END $$;

-- Cargo directo (tarifa fija, p.ej. sorteo Community).
CREATE OR REPLACE FUNCTION wallet_charge(
  p_user UUID, p_amount BIGINT, p_description TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance BIGINT;
BEGIN
  IF p_amount <= 0 THEN RETURN jsonb_build_object('charged', false); END IF;
  INSERT INTO wallets(user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT balance_cents INTO v_balance FROM wallets WHERE user_id = p_user FOR UPDATE;
  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS:%:%', p_amount, v_balance;
  END IF;
  UPDATE wallets SET balance_cents = balance_cents - p_amount, updated_at = now()
  WHERE user_id = p_user RETURNING balance_cents INTO v_balance;
  INSERT INTO wallet_transactions(user_id, type, amount_cents, balance_after, description)
  VALUES (p_user, 'fee', -p_amount, v_balance, p_description);
  RETURN jsonb_build_object('charged', true, 'balance_cents', v_balance);
END $$;

-- Ajuste manual (devolución de un cargo, compensación, reembolso de una
-- recarga). p_amount con signo. Nunca deja el saldo en negativo.
CREATE OR REPLACE FUNCTION wallet_adjust(
  p_user UUID, p_amount BIGINT, p_description TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance BIGINT;
BEGIN
  INSERT INTO wallets(user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  UPDATE wallets SET balance_cents = greatest(0, balance_cents + p_amount), updated_at = now()
  WHERE user_id = p_user RETURNING balance_cents INTO v_balance;
  INSERT INTO wallet_transactions(user_id, type, amount_cents, balance_after, description)
  VALUES (p_user, 'adjust', p_amount, v_balance, p_description);
  RETURN jsonb_build_object('balance_cents', v_balance);
END $$;

-- ── Volts ────────────────────────────────────────────────────────────────

-- Crea la fila de Volts sembrando el saldo que el usuario tenía en
-- localStorage (migración única, acotada para que no se pueda inflar).
CREATE OR REPLACE FUNCTION volts_init(p_user UUID, p_seed BIGINT) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance BIGINT;
BEGIN
  INSERT INTO user_volts(user_id, balance)
  VALUES (p_user, greatest(0, least(coalesce(p_seed, 150), 5000)))
  ON CONFLICT (user_id) DO NOTHING;
  SELECT balance INTO v_balance FROM user_volts WHERE user_id = p_user;
  RETURN v_balance;
END $$;

-- Suma (p_delta > 0) o gasta (p_delta < 0). Lanza INSUFFICIENT_VOLTS.
CREATE OR REPLACE FUNCTION volts_add(p_user UUID, p_delta BIGINT) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance BIGINT;
BEGIN
  INSERT INTO user_volts(user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT balance INTO v_balance FROM user_volts WHERE user_id = p_user FOR UPDATE;
  IF v_balance + p_delta < 0 THEN RAISE EXCEPTION 'INSUFFICIENT_VOLTS'; END IF;
  UPDATE user_volts SET balance = balance + p_delta, updated_at = now()
  WHERE user_id = p_user RETURNING balance INTO v_balance;
  RETURN v_balance;
END $$;

-- Compra de Volts con dinero (idempotente por pago).
CREATE OR REPLACE FUNCTION volts_purchase(
  p_user UUID, p_provider TEXT, p_ref TEXT, p_product TEXT,
  p_volts BIGINT, p_amount BIGINT, p_raw JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_payment_id UUID; v_balance BIGINT;
BEGIN
  INSERT INTO payments(user_id, provider, provider_ref, product_id, kind, amount_cents, raw)
  VALUES (p_user, p_provider, p_ref, p_product, 'volts', p_amount, p_raw)
  ON CONFLICT (provider, provider_ref) DO NOTHING
  RETURNING id INTO v_payment_id;
  IF v_payment_id IS NULL THEN
    SELECT balance INTO v_balance FROM user_volts WHERE user_id = p_user;
    RETURN jsonb_build_object('credited', false, 'volts', coalesce(v_balance, 0));
  END IF;
  v_balance := volts_add(p_user, p_volts);
  RETURN jsonb_build_object('credited', true, 'volts', v_balance);
END $$;

-- Recompensa diaria (una por día natural de Madrid).
CREATE OR REPLACE FUNCTION volts_claim_daily(p_user UUID, p_amount BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_today DATE := (now() AT TIME ZONE 'Europe/Madrid')::date; v_row user_volts%ROWTYPE;
BEGIN
  INSERT INTO user_volts(user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_row FROM user_volts WHERE user_id = p_user FOR UPDATE;
  IF v_row.last_daily_claim = v_today THEN
    RETURN jsonb_build_object('claimed', false, 'volts', v_row.balance);
  END IF;
  UPDATE user_volts SET balance = balance + p_amount, last_daily_claim = v_today, updated_at = now()
  WHERE user_id = p_user RETURNING * INTO v_row;
  RETURN jsonb_build_object('claimed', true, 'volts', v_row.balance);
END $$;

-- Créditos semanales de la suscripción Volt (una vez cada 7 días).
CREATE OR REPLACE FUNCTION volts_weekly_grant(p_user UUID, p_amount BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_today DATE := (now() AT TIME ZONE 'Europe/Madrid')::date; v_row user_volts%ROWTYPE;
BEGIN
  INSERT INTO user_volts(user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_row FROM user_volts WHERE user_id = p_user FOR UPDATE;
  IF v_row.last_weekly_grant IS NOT NULL AND v_row.last_weekly_grant > v_today - 7 THEN
    RETURN jsonb_build_object('granted', false, 'volts', v_row.balance);
  END IF;
  UPDATE user_volts SET balance = balance + p_amount, last_weekly_grant = v_today, updated_at = now()
  WHERE user_id = p_user RETURNING * INTO v_row;
  RETURN jsonb_build_object('granted', true, 'volts', v_row.balance);
END $$;

-- Solo el backend (service_role) puede ejecutar estas funciones.
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'wallet_topup(uuid,text,text,text,bigint,text,jsonb)',
    'wallet_hold(uuid,text,uuid,text,integer,integer)',
    'wallet_settle(text,uuid,integer,integer,text)',
    'wallet_charge(uuid,bigint,text)',
    'wallet_adjust(uuid,bigint,text)',
    'volts_init(uuid,bigint)',
    'volts_add(uuid,bigint)',
    'volts_purchase(uuid,text,text,text,bigint,bigint,jsonb)',
    'volts_claim_daily(uuid,bigint)',
    'volts_weekly_grant(uuid,bigint)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
