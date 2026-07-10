-- ══════════════════════════════════════════════════
--  SocialBattery — Schema Phase 13: Community
--  Run this in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════

-- ── Community Events ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_events (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  description    TEXT,
  category       TEXT,
  event_date     TIMESTAMPTZ NOT NULL,
  location       TEXT,
  max_attendees  INT NOT NULL DEFAULT 50 CHECK (max_attendees >= 2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_events_creator
  ON public.community_events(creator_id);
CREATE INDEX IF NOT EXISTS idx_community_events_date
  ON public.community_events(event_date);

-- ── Event Attendees ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_event_attendees (
  event_id   UUID NOT NULL REFERENCES public.community_events(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

-- ── Communities ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.communities (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  category    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_communities_creator
  ON public.communities(creator_id);

-- ── Community Members ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_members (
  community_id  UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (community_id, user_id)
);

-- ══════════════════════════════════════════════════
--  Row Level Security
-- ══════════════════════════════════════════════════

ALTER TABLE public.community_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_event_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;

-- community_events: anyone authenticated can read/insert
DROP POLICY IF EXISTS "Events are public" ON public.community_events;
CREATE POLICY "Events are public" ON public.community_events
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Authenticated users can create events" ON public.community_events;
CREATE POLICY "Authenticated users can create events" ON public.community_events
  FOR INSERT WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Creators can update own events" ON public.community_events;
CREATE POLICY "Creators can update own events" ON public.community_events
  FOR UPDATE USING (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Creators can delete own events" ON public.community_events;
CREATE POLICY "Creators can delete own events" ON public.community_events
  FOR DELETE USING (auth.uid() = creator_id);

-- community_event_attendees
DROP POLICY IF EXISTS "Attendees are public" ON public.community_event_attendees;
CREATE POLICY "Attendees are public" ON public.community_event_attendees
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Users can join events" ON public.community_event_attendees;
CREATE POLICY "Users can join events" ON public.community_event_attendees
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can leave events" ON public.community_event_attendees;
CREATE POLICY "Users can leave events" ON public.community_event_attendees
  FOR DELETE USING (auth.uid() = user_id);

-- communities
DROP POLICY IF EXISTS "Communities are public" ON public.communities;
CREATE POLICY "Communities are public" ON public.communities
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Authenticated users can create communities" ON public.communities;
CREATE POLICY "Authenticated users can create communities" ON public.communities
  FOR INSERT WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Creators can update own communities" ON public.communities;
CREATE POLICY "Creators can update own communities" ON public.communities
  FOR UPDATE USING (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Creators can delete own communities" ON public.communities;
CREATE POLICY "Creators can delete own communities" ON public.communities
  FOR DELETE USING (auth.uid() = creator_id);

-- community_members
DROP POLICY IF EXISTS "Community members are public" ON public.community_members;
CREATE POLICY "Community members are public" ON public.community_members
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Users can join communities" ON public.community_members;
CREATE POLICY "Users can join communities" ON public.community_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can leave communities" ON public.community_members;
CREATE POLICY "Users can leave communities" ON public.community_members
  FOR DELETE USING (auth.uid() = user_id);

-- ══════════════════════════════════════════════════
--  Realtime
-- ══════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE public.community_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.community_event_attendees;
ALTER PUBLICATION supabase_realtime ADD TABLE public.communities;
ALTER PUBLICATION supabase_realtime ADD TABLE public.community_members;
