-- ============================================================
-- SocialBattery - Phase 16: Event organization
-- Run this in Supabase SQL Editor after phase15_event_engagement.
-- ============================================================

ALTER TABLE public.community_events
  ADD COLUMN IF NOT EXISTS organization TEXT;
