-- Phase 29: Privacy toggles — show_interests & show_public_stats
-- show_interests:    when false, interest tags are hidden from other users' profile views
-- show_public_stats: when false, the public stats grid is hidden from other users' profile views

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS show_interests    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_public_stats boolean NOT NULL DEFAULT true;
