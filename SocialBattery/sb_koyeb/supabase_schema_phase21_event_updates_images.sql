-- Phase 21: Event update images
-- Adds optional image_url column to event_updates so event admins can post photos

ALTER TABLE event_updates
  ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMENT ON COLUMN event_updates.image_url IS
  'URL of an optional image attached to this update, stored in Supabase Storage (event-updates bucket)';
