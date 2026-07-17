-- ============================================================
-- SocialBattery - Phase 15: Event likes
-- Run this in Supabase SQL Editor after phase14_community_admin_events.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.community_event_likes (
  event_id    UUID NOT NULL REFERENCES public.community_events(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_event_likes_user
  ON public.community_event_likes(user_id);

ALTER TABLE public.community_event_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Event likes are public" ON public.community_event_likes;
CREATE POLICY "Event likes are public" ON public.community_event_likes
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Users can like events" ON public.community_event_likes;
CREATE POLICY "Users can like events" ON public.community_event_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can remove own event likes" ON public.community_event_likes;
CREATE POLICY "Users can remove own event likes" ON public.community_event_likes
  FOR DELETE USING (auth.uid() = user_id);
