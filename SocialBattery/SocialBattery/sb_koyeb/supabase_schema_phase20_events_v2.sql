-- ══════════════════════════════════════════════════
--  SocialBattery — Schema Phase 20: Events v2
--  Adds: price, additional_info, event updates thread
--  Run this in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════

-- ── New columns on community_events ───────────────
ALTER TABLE public.community_events
  ADD COLUMN IF NOT EXISTS price          NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS additional_info TEXT;

-- ── Event Updates (organiser thread) ──────────────
CREATE TABLE IF NOT EXISTS public.event_updates (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id    UUID         NOT NULL REFERENCES public.community_events(id) ON DELETE CASCADE,
  creator_id  UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content     TEXT         NOT NULL CHECK (char_length(content) >= 1),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_updates_event
  ON public.event_updates(event_id, created_at);

-- ── Row Level Security ─────────────────────────────
ALTER TABLE public.event_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Event updates are public"         ON public.event_updates;
CREATE POLICY "Event updates are public" ON public.event_updates
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Event creators can post updates"  ON public.event_updates;
CREATE POLICY "Event creators can post updates" ON public.event_updates
  FOR INSERT WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Event creators can delete updates" ON public.event_updates;
CREATE POLICY "Event creators can delete updates" ON public.event_updates
  FOR DELETE USING (auth.uid() = creator_id);

-- ── Realtime ──────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.event_updates;
