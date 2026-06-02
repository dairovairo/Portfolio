-- Phase 21: Event update images
-- Adds optional image_url column to event_updates so event admins can post photos
-- without forcing every update to include text.

ALTER TABLE public.event_updates
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE public.event_updates
  ALTER COLUMN content DROP NOT NULL;

ALTER TABLE public.event_updates
  DROP CONSTRAINT IF EXISTS event_updates_content_check;

ALTER TABLE public.event_updates
  DROP CONSTRAINT IF EXISTS event_updates_content_or_image_check;

ALTER TABLE public.event_updates
  ADD CONSTRAINT event_updates_content_or_image_check
  CHECK (
    image_url IS NOT NULL
    OR (content IS NOT NULL AND char_length(trim(content)) >= 1)
  );

COMMENT ON COLUMN public.event_updates.image_url IS
  'URL of an optional image attached to this update, stored in Supabase Storage (event-updates bucket)';
