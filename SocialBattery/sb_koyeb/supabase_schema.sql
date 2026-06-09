-- ══════════════════════════════════════════════════
--  SocialBattery — Supabase Schema (Fases 1–4)
--  Run this in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════

-- ── Extensions ────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id                   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username             TEXT UNIQUE NOT NULL,
  display_name         TEXT NOT NULL,
  avatar_url           TEXT,
  battery_level        SMALLINT NOT NULL DEFAULT 50 CHECK (battery_level >= 0 AND battery_level <= 100),
  battery_updated_at   TIMESTAMPTZ,
  battery_is_estimated BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- last_seen_at migration (if upgrading from phase 2)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- ── Battery history ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.battery_history (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  level       SMALLINT NOT NULL CHECK (level >= 0 AND level <= 100),
  day_of_week SMALLINT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  hour        SMALLINT NOT NULL CHECK (hour >= 0 AND hour <= 23),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_battery_history_user_day
  ON public.battery_history(user_id, day_of_week);

-- ── Friendships ───────────────────────────────────
DO $$ BEGIN
  CREATE TYPE friendship_status AS ENUM ('pending', 'accepted', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.friendships (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status       friendship_status NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_friend CHECK (requester_id <> addressee_id),
  CONSTRAINT unique_friendship UNIQUE (requester_id, addressee_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON public.friendships(addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON public.friendships(requester_id, status);

-- ── Messages ──────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE message_type AS ENUM ('text', 'hangout_request');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE hangout_req_status AS ENUM ('pending', 'accepted', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.messages (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  receiver_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content        TEXT NOT NULL,
  type           message_type NOT NULL DEFAULT 'text',
  hangout_status hangout_req_status DEFAULT 'pending',
  hangout_time   TEXT,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migrations for upgrading from phase 2
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS hangout_status hangout_req_status DEFAULT 'pending';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS hangout_time TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON public.messages(sender_id, receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_receiver
  ON public.messages(receiver_id, read_at);

-- ── Hangout Pools ─────────────────────────────────
DO $$ BEGIN
  CREATE TYPE pool_status AS ENUM ('open', 'full', 'closed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.hangout_pools (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  activity      TEXT NOT NULL,
  description   TEXT,
  location_hint TEXT,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  max_people    SMALLINT DEFAULT NULL CHECK (max_people IS NULL OR (max_people >= 2 AND max_people <= 50)),
  is_public     BOOLEAN NOT NULL DEFAULT FALSE,
  status        pool_status NOT NULL DEFAULT 'open',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pools_creator ON public.hangout_pools(creator_id);
CREATE INDEX IF NOT EXISTS idx_pools_status_date ON public.hangout_pools(status, scheduled_at);

CREATE TABLE IF NOT EXISTS public.pool_participants (
  pool_id   UUID NOT NULL REFERENCES public.hangout_pools(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pool_id, user_id)
);

-- ── Badges ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.badges (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  description TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'general'
);

INSERT INTO public.badges (id, name, emoji, description, category) VALUES
  ('night_owl',        'Noctámbulo',         '🦉', 'Actualiza tu batería después de las 22h',        'tiempo'),
  ('early_bird',       'Madrugador Social',  '☀️', 'Actualiza tu batería antes de las 9h',           'tiempo'),
  ('low_battery_hero', 'Batería Crítica',    '🪫', 'Registrado con batería al 10% o menos',          'bateria'),
  ('fully_charged',    'Al 100%',            '⚡', 'Registrado con batería al máximo',               'bateria'),
  ('weekend_warrior',  'Guerrero del Finde', '🎉', 'Activo los fines de semana',                     'tiempo'),
  ('consistent_7',     'Constante',          '🔋', '7 días seguidos actualizando tu batería',        'habito'),
  ('organizer_5',      'Organizador Nato',   '📅', 'Has creado 5 o más pools de quedada',            'social'),
  ('introvert_proud',  'Introvertido Feliz', '🧘', '10 o más días con batería por debajo del 30%',  'bateria'),
  ('social_butterfly', 'Mariposa Social',    '🦋', '10 o más días con batería por encima del 80%',  'bateria'),
  ('connector',        'Conector',           '🤝', 'Tienes 10 o más amigos en SocialBattery',        'social')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_badges (
  user_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  badge_id  TEXT NOT NULL REFERENCES public.badges(id) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, badge_id)
);

-- ══════════════════════════════════════════════════
--  Row Level Security
-- ══════════════════════════════════════════════════

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battery_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hangout_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pool_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

-- Users
DROP POLICY IF EXISTS "Public profiles are viewable" ON public.users;
CREATE POLICY "Public profiles are viewable" ON public.users FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
CREATE POLICY "Users can insert own profile" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid() = id);

-- Battery history
DROP POLICY IF EXISTS "Users read own battery history" ON public.battery_history;
CREATE POLICY "Users read own battery history" ON public.battery_history FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own battery history" ON public.battery_history;
CREATE POLICY "Users insert own battery history" ON public.battery_history FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Friendships
DROP POLICY IF EXISTS "Friendship participants can read" ON public.friendships;
CREATE POLICY "Friendship participants can read" ON public.friendships FOR SELECT
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

DROP POLICY IF EXISTS "Authenticated can create friend requests" ON public.friendships;
CREATE POLICY "Authenticated can create friend requests" ON public.friendships FOR INSERT
  WITH CHECK (auth.uid() = requester_id);

DROP POLICY IF EXISTS "Addressee can update status" ON public.friendships;
CREATE POLICY "Addressee can update status" ON public.friendships FOR UPDATE
  USING (auth.uid() = addressee_id OR auth.uid() = requester_id);

DROP POLICY IF EXISTS "Participants can delete friendship" ON public.friendships;
CREATE POLICY "Participants can delete friendship" ON public.friendships FOR DELETE
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- Messages
DROP POLICY IF EXISTS "Message participants can read" ON public.messages;
CREATE POLICY "Message participants can read" ON public.messages FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

DROP POLICY IF EXISTS "Authenticated can send messages" ON public.messages;
CREATE POLICY "Authenticated can send messages" ON public.messages FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "Receiver can update message" ON public.messages;
CREATE POLICY "Receiver can update message" ON public.messages FOR UPDATE
  USING (auth.uid() = receiver_id OR auth.uid() = sender_id);

-- Badges
DROP POLICY IF EXISTS "Badges are public" ON public.badges;
CREATE POLICY "Badges are public" ON public.badges FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "User badges are public" ON public.user_badges;
CREATE POLICY "User badges are public" ON public.user_badges FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Users can earn badges" ON public.user_badges;
CREATE POLICY "Users can earn badges" ON public.user_badges FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ══════════════════════════════════════════════════
--  Realtime
-- ══════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
