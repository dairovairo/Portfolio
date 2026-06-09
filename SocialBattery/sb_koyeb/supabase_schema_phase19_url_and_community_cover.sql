-- Phase 19: URL fields for events and communities, cover image for communities

-- Add url column to community_events
ALTER TABLE public.community_events
  ADD COLUMN IF NOT EXISTS url TEXT;

-- Add url and cover_image_url columns to communities
ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS url TEXT;

ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
