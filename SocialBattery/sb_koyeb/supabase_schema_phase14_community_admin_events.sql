-- ============================================================
-- SocialBattery - Phase 14: Community roles and scoped events
-- Run this in Supabase SQL Editor after phase13_community.
-- ============================================================

ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS organization TEXT;

ALTER TABLE public.community_events
  ADD COLUMN IF NOT EXISTS community_id UUID REFERENCES public.communities(id) ON DELETE CASCADE;

ALTER TABLE public.community_members
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';

ALTER TABLE public.community_members
  DROP CONSTRAINT IF EXISTS community_members_role_check;

ALTER TABLE public.community_members
  ADD CONSTRAINT community_members_role_check
  CHECK (role IN ('admin', 'member'));

CREATE INDEX IF NOT EXISTS idx_community_events_community_date
  ON public.community_events(community_id, event_date);

CREATE INDEX IF NOT EXISTS idx_community_members_role
  ON public.community_members(community_id, role);

UPDATE public.community_members cm
SET role = 'admin'
FROM public.communities c
WHERE c.id = cm.community_id
  AND c.creator_id = cm.user_id;

INSERT INTO public.community_members (community_id, user_id, role)
SELECT c.id, c.creator_id, 'admin'
FROM public.communities c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.community_members cm
  WHERE cm.community_id = c.id
    AND cm.user_id = c.creator_id
);
