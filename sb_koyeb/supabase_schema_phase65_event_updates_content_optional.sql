-- Phase 65: Allow event updates with only an image (no text)
--
-- event_updates.content was defined as NOT NULL with CHECK (char_length(content) >= 1),
-- which blocks posting a photo-only update since phase21 introduced image_url as an
-- alternative way to attach content. Postgres CHECK constraints already pass when a
-- column value is NULL, so dropping NOT NULL is enough to keep the "non-empty string"
-- check working for whenever content IS provided.
--
-- We also add an explicit constraint requiring at least one of content / image_url,
-- matching the validation already enforced by the API.

ALTER TABLE public.event_updates
  ALTER COLUMN content DROP NOT NULL;

ALTER TABLE public.event_updates
  DROP CONSTRAINT IF EXISTS event_updates_has_content_or_image;

ALTER TABLE public.event_updates
  ADD CONSTRAINT event_updates_has_content_or_image
  CHECK (content IS NOT NULL OR image_url IS NOT NULL);
